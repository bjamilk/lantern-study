/**
 * Community moderation — roles, mutes, post removal, announcements, invites.
 *
 * ONE moderation stack. Reports go through the Phase 1 · E `content_reports`
 * queue (services/moderation.ts) with the two new target types, and every
 * action here writes the SAME `admin_audit_log` every other moderation action
 * writes. A second moderation stack is a review blocker.
 *
 * Every rule is decided by a PURE helper in `@lantern/shared/network`
 * (communityGovernance.ts) that both clients also call, so a permission cannot
 * mean one thing in the app and another on the server. The client hides the
 * control; this service refuses the request. Calling the endpoint with curl is
 * refused too.
 *
 * DEGRADE RULE (§ hand-applied migrations): the API ships before
 * 20260908120000 is applied. Every method below feature-detects and answers
 * 503 with a plain reason rather than 500 — a moderator on a pre-migration
 * database is told the tool is not available yet, and nobody is silently
 * un-muted or silently un-moderated.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import { cacheService } from './cache';
import { logAdminAction } from './adminAudit';
import {
  BOARD_ANNOUNCEMENT_PIN_MAX,
  COMMUNITY_INVITE_ACTIVE_MAX,
  COMMUNITY_INVITE_ALPHABET,
  COMMUNITY_INVITE_CODE_LENGTH,
  COMMUNITY_MODERATION_COPY,
  COMMUNITY_MUTE_REASON_MAX,
  INVITE_REFUSAL_COPY,
  boardPostRules,
  canAssignCommunityRole,
  canModerateCommunityMember,
  isAssignableCommunityRole,
  isCommunityMemberMuted,
  isCommunityMuteDuration,
  normalizeInviteCode,
  resolveCommunityRole,
  resolveInviteExpiry,
  resolveInviteMaxUses,
  resolveMuteUntil,
  type AssignableCommunityRole,
  type CommunityRole,
} from '@lantern/shared/network';
import {
  hasCommunityInvites,
  hasCommunityMemberMute,
  hasMessagePostKind,
  isMissingSchemaError,
  markCommunityInvitesMissing,
  markCommunityMemberMuteMissing,
  markMessagePostKindMissing,
} from './schemaCapabilities';
import { randomInt } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string, statusCode: 400 | 403 | 404 | 409 | 503): PublicError {
  return Object.assign(new PublicError(message), { statusCode });
}

/** The migration is not applied here yet. Never a 500. */
function unavailable(what: string): PublicError {
  return fail(`${what} is not available yet`, 503);
}

/** Who the actor is INSIDE one community. Everything else is decided from this. */
export interface CommunityActor {
  userId: string;
  communityId: string;
  isMember: boolean;
  role: CommunityRole | null;
  isPlatformAdmin: boolean;
  mutedUntil: string | null;
  /** `communities.created_by`; null for auto-derived academic communities. */
  createdBy: string | null;
}

export class CommunityModerationService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private assertUuid(id: unknown, label: string): string {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw fail(`Invalid ${label}`, 400);
    return id;
  }

  // ─── Actor resolution ─────────────────────────────────────────────────────

  /**
   * The caller's standing in one community.
   *
   * `created_by` decides ownership, so it is read here and not inferred from
   * the membership row: an auto-derived academic community has NO owner, and
   * the only moderation it gets is a platform admin's — which is exactly why
   * `isPlatformAdmin` is resolved on the same trip.
   */
  async resolveActor(userId: string, communityId: string): Promise<CommunityActor> {
    this.assertUuid(communityId, 'community id');

    const { data: community, error } = await this.db
      .from('communities')
      .select('id, created_by, visibility')
      .eq('id', communityId)
      .maybeSingle();
    if (error) throw error;
    if (!community) throw fail('Community not found', 404);

    const withMute = await hasCommunityMemberMute(this.db);
    const columns = withMute ? 'role, source, muted_until' : 'role, source';
    const readMembership = (cols: string) =>
      this.db
        .from('community_members')
        .select(cols)
        .eq('community_id', communityId)
        .eq('user_id', userId)
        .is('opted_out_at', null)
        .maybeSingle();

    let { data: membership, error: memberError } = await readMembership(columns);
    if (memberError && withMute && isMissingSchemaError(memberError)) {
      markCommunityMemberMuteMissing();
      ({ data: membership, error: memberError } = await readMembership('role, source'));
    }
    if (memberError) throw memberError;

    const row = (membership ?? null) as { role?: string | null; muted_until?: string | null } | null;
    const createdBy = (community as { created_by?: string | null }).created_by ?? null;
    const isPlatformAdmin = await this.supabaseService
      .isPlatformAdmin(userId)
      .catch(() => false);

    return {
      userId,
      communityId,
      isMember: !!row,
      role: row ? resolveCommunityRole(row.role ?? null, userId, createdBy) : null,
      isPlatformAdmin,
      mutedUntil: row?.muted_until ?? null,
      createdBy,
    };
  }

  /** The actor plus the target member's role, for a two-party decision. */
  private async resolveTargetRole(
    communityId: string,
    targetUserId: string,
    createdBy: string | null,
  ): Promise<{ exists: boolean; role: CommunityRole }> {
    const { data, error } = await this.db
      .from('community_members')
      .select('role')
      .eq('community_id', communityId)
      .eq('user_id', targetUserId)
      .is('opted_out_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { exists: false, role: 'member' };
    return {
      exists: true,
      role: resolveCommunityRole((data as { role?: string | null }).role ?? null, targetUserId, createdBy),
    };
  }

  /** Throws unless the caller may post in this community right now. */
  async assertCanPost(userId: string, communityId: string): Promise<CommunityActor> {
    const actor = await this.resolveActor(userId, communityId);
    if (!actor.isMember && !actor.isPlatformAdmin) {
      throw fail(COMMUNITY_MODERATION_COPY.notMember, 403);
    }
    if (isCommunityMemberMuted(actor.mutedUntil)) {
      throw fail(COMMUNITY_MODERATION_COPY.mutedTitle, 403);
    }
    return actor;
  }

  // ─── Roles ────────────────────────────────────────────────────────────────

  /**
   * POST /communities/:id/members/:userId/role
   *
   * Owner-only (or a platform admin, which is the only moderation an
   * auto-derived campus room has). An admin who could mint admins is an owner
   * by another name.
   */
  async setMemberRole(
    actorId: string,
    communityId: string,
    targetUserId: string,
    role: unknown,
  ): Promise<{ userId: string; role: AssignableCommunityRole }> {
    this.assertUuid(targetUserId, 'user id');
    if (!isAssignableCommunityRole(role)) throw fail('Invalid role', 400);

    const actor = await this.resolveActor(actorId, communityId);
    const target = await this.resolveTargetRole(communityId, targetUserId, actor.createdBy);
    if (!target.exists) throw fail('That person is not in this community', 404);

    const decision = canAssignCommunityRole({
      actorRole: actor.role,
      actorId,
      targetId: targetUserId,
      targetRole: target.role,
      isPlatformAdmin: actor.isPlatformAdmin,
    });
    if (!decision.ok) {
      throw fail(
        decision.reason === 'self'
          ? COMMUNITY_MODERATION_COPY.cannotModerateSelf
          : decision.reason === 'owner_target'
            ? 'The owner’s role cannot be changed'
            : COMMUNITY_MODERATION_COPY.onlyOwner,
        403,
      );
    }

    const { error } = await this.db
      .from('community_members')
      .update({ role })
      .eq('community_id', communityId)
      .eq('user_id', targetUserId);
    if (error) throw error;

    await cacheService.delete(`communities:mine:${targetUserId}`);
    await logAdminAction(this.supabaseService, {
      actorId,
      action: 'community_role_set',
      targetType: 'community_member',
      targetId: targetUserId,
      metadata: { communityId, role, previousRole: target.role },
    });
    return { userId: targetUserId, role };
  }

  // ─── Mutes ────────────────────────────────────────────────────────────────

  /**
   * POST /communities/:id/members/:userId/mute
   *
   * `duration` is one of COMMUNITY_MUTE_DURATIONS, or omitted to UNMUTE. There
   * is no permanent mute: a mute nobody remembers to lift is a ban with no
   * appeal, and bans belong to the Phase 1 · E suspension machinery.
   */
  async muteMember(
    actorId: string,
    communityId: string,
    targetUserId: string,
    input: { duration?: unknown; reason?: unknown },
  ): Promise<{ userId: string; mutedUntil: string | null }> {
    this.assertUuid(targetUserId, 'user id');
    if (!(await hasCommunityMemberMute(this.db))) throw unavailable('Muting');

    const actor = await this.resolveActor(actorId, communityId);
    const target = await this.resolveTargetRole(communityId, targetUserId, actor.createdBy);
    if (!target.exists) throw fail('That person is not in this community', 404);

    const decision = canModerateCommunityMember({
      actorRole: actor.role,
      actorId,
      targetId: targetUserId,
      targetRole: target.role,
      isPlatformAdmin: actor.isPlatformAdmin,
    });
    if (!decision.ok) {
      throw fail(
        decision.reason === 'self'
          ? COMMUNITY_MODERATION_COPY.cannotModerateSelf
          : decision.reason === 'peer'
            ? COMMUNITY_MODERATION_COPY.cannotModeratePeer
            : COMMUNITY_MODERATION_COPY.autoCommunityModeration,
        403,
      );
    }

    // An unrecognised duration UNMUTES rather than muting forever — the one
    // safe direction for a value the server does not understand.
    const unmuting = input.duration == null || !isCommunityMuteDuration(input.duration);
    const mutedUntil = unmuting ? null : resolveMuteUntil(input.duration);
    const reason =
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim().slice(0, COMMUNITY_MUTE_REASON_MAX)
        : null;

    const update = mutedUntil
      ? { muted_until: mutedUntil, muted_by: actorId, muted_reason: reason }
      : { muted_until: null, muted_by: null, muted_reason: null };

    const { error } = await this.db
      .from('community_members')
      .update(update)
      .eq('community_id', communityId)
      .eq('user_id', targetUserId);
    if (error) {
      if (isMissingSchemaError(error)) {
        markCommunityMemberMuteMissing();
        throw unavailable('Muting');
      }
      throw error;
    }

    await logAdminAction(this.supabaseService, {
      actorId,
      action: mutedUntil ? 'community_member_mute' : 'community_member_unmute',
      targetType: 'community_member',
      targetId: targetUserId,
      reason: reason ?? undefined,
      metadata: { communityId, mutedUntil },
    });
    return { userId: targetUserId, mutedUntil };
  }

  // ─── Post removal ─────────────────────────────────────────────────────────

  /**
   * DELETE /communities/:id/posts/:postId
   *
   * A SOFT removal: `removed_at` / `removed_by` / `removed_reason`. The card
   * stays on the board as a tombstone that says a moderator removed it, so a
   * reader who saw the post is told what happened instead of watching it
   * vanish. Moderators keep seeing it, marked removed.
   */
  async removePost(
    actorId: string,
    communityId: string,
    postId: string,
    reason: unknown,
  ): Promise<{ id: string; removedAt: string }> {
    this.assertUuid(postId, 'post id');
    const actor = await this.resolveActor(actorId, communityId);

    const { data: post, error } = await this.db
      .from('messages')
      .select('id, sender_id, group_id, removed_at, groups!inner(id, community_id)')
      .eq('id', postId)
      .maybeSingle();
    if (error) throw error;
    if (!post) throw fail('Post not found', 404);

    const group = Array.isArray((post as any).groups) ? (post as any).groups[0] : (post as any).groups;
    if (!group || group.community_id !== communityId) {
      // Wrong community: answer exactly as if the post did not exist, so this
      // endpoint cannot confirm a post's existence to an outsider.
      throw fail('Post not found', 404);
    }
    if ((post as any).removed_at) {
      return { id: postId, removedAt: (post as any).removed_at };
    }

    const isAuthor = (post as any).sender_id === actorId;
    const canRemove =
      actor.isPlatformAdmin ||
      isAuthor ||
      actor.role === 'owner' ||
      actor.role === 'admin' ||
      actor.role === 'moderator';
    if (!canRemove) throw fail('Only a moderator can remove this post', 403);

    const removedAt = new Date().toISOString();
    const text =
      typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 300) : null;

    const withReason = await hasMessagePostKind(this.db);
    const apply = (includeReason: boolean) =>
      this.db
        .from('messages')
        .update({
          removed_at: removedAt,
          removed_by: actorId,
          // A removed post also loses its pin — a tombstone at the top of the
          // board is worse than no pin at all.
          pinned_at: null,
          pinned_by: null,
          ...(includeReason ? { removed_reason: text } : {}),
        })
        .eq('id', postId);

    let { error: updateError } = await apply(withReason);
    if (updateError && withReason && isMissingSchemaError(updateError)) {
      markMessagePostKindMissing();
      ({ error: updateError } = await apply(false));
    }
    if (updateError) throw updateError;

    await logAdminAction(this.supabaseService, {
      actorId,
      action: 'community_post_remove',
      targetType: 'community_post',
      targetId: postId,
      reason: text ?? undefined,
      metadata: { communityId, groupId: (post as any).group_id, authorId: (post as any).sender_id, byAuthor: isAuthor },
    });
    return { id: postId, removedAt };
  }

  // ─── Accepted answer ──────────────────────────────────────────────────────

  /**
   * POST /communities/:id/posts/:postId/answered { answerMessageId }
   *
   * Marks a QUESTION post answered by pointing at the reply that answered it,
   * or clears it when `answerMessageId` is null (un-answer).
   *
   * THE GATE IS THE SERVER. Whether the caller may mark answered is re-derived
   * here from the SAME shared `boardPostRules` both clients call — author or
   * moderator, an answerable (question) kind, not removed — never from a flag
   * the client sends. The client hides the row; this refuses the request.
   *
   * THE ANSWER MUST BELONG TO THIS QUESTION. The reply must be a real message
   * whose `thread_root_id` is this post — which is exactly the set of comments
   * under the question. That one check rejects an id from another board,
   * another community, a removed reply, and the post itself (a root post has
   * no `thread_root_id`, so it can never point at itself).
   *
   * Un-answer is possible for anyone who could answer, and is a distinct,
   * audited action (`community_post_unanswer`) that returns `cleared: true`, so
   * clearing an answer is never confused with a post that was never marked.
   *
   * DEGRADE: gated on the SAME `hasMessagePostKind` capability the read path,
   * removal reason and post kinds already use — a database without
   * `answered_message_id` answers 503, never 500.
   */
  async markPostAnswered(
    actorId: string,
    communityId: string,
    postId: string,
    answerMessageId: unknown,
  ): Promise<{ id: string; answeredMessageId: string | null; cleared: boolean }> {
    this.assertUuid(postId, 'post id');
    const clearing = answerMessageId === null || answerMessageId === undefined;
    const answerId = clearing ? null : this.assertUuid(answerMessageId, 'answer message id');

    if (!(await hasMessagePostKind(this.db))) throw unavailable('Marking a question answered');

    const actor = await this.resolveActor(actorId, communityId);

    const { data: post, error } = await this.db
      .from('messages')
      .select(
        'id, sender_id, group_id, post_kind, removed_at, answered_message_id, groups:group_id(id, community_id)',
      )
      .eq('id', postId)
      .maybeSingle();
    if (error) {
      if (isMissingSchemaError(error)) {
        markMessagePostKindMissing();
        throw unavailable('Marking a question answered');
      }
      throw error;
    }
    if (!post) throw fail('Post not found', 404);

    const group = Array.isArray((post as any).groups) ? (post as any).groups[0] : (post as any).groups;
    if (!group || group.community_id !== communityId) {
      // Wrong community: answer exactly as if the post did not exist, so this
      // endpoint cannot confirm a post's existence to an outsider.
      throw fail('Post not found', 404);
    }

    // The permission gate — the SAME matrix the clients render from. A
    // non-question, a removed post, or a viewer who is neither the author nor
    // a moderator all fail here, with one refusal so the caller cannot probe
    // which of the three it was.
    const permissions = boardPostRules(actor.role, {
      senderId: (post as any).sender_id ?? '',
      viewerId: actorId,
      postKind: (post as any).post_kind ?? null,
      removedAt: (post as any).removed_at ?? null,
      answeredMessageId: (post as any).answered_message_id ?? null,
      isPlatformAdmin: actor.isPlatformAdmin,
    });
    if (!permissions.canMarkAnswered) {
      throw fail('Only the author or a moderator can mark this answered', 403);
    }

    if (!clearing) {
      // The answering reply must be real AND live in THIS post's thread. A
      // comment's `thread_root_id` is the question it hangs under, so this one
      // equality rejects a reply from another board or community, a removed
      // reply, and the post itself (its own `thread_root_id` is null).
      const { data: reply, error: replyError } = await this.db
        .from('messages')
        .select('id, thread_root_id, removed_at')
        .eq('id', answerId)
        .maybeSingle();
      if (replyError) throw replyError;
      if (
        !reply ||
        (reply as any).thread_root_id !== postId ||
        (reply as any).removed_at
      ) {
        throw fail('That reply is not part of this question', 400);
      }
    }

    const previous = ((post as any).answered_message_id ?? null) as string | null;
    const { error: updateError } = await this.db
      .from('messages')
      .update({ answered_message_id: answerId })
      .eq('id', postId);
    if (updateError) {
      if (isMissingSchemaError(updateError)) {
        markMessagePostKindMissing();
        throw unavailable('Marking a question answered');
      }
      throw updateError;
    }

    await logAdminAction(this.supabaseService, {
      actorId,
      action: clearing ? 'community_post_unanswer' : 'community_post_answer',
      targetType: 'community_post',
      targetId: postId,
      metadata: {
        communityId,
        groupId: (post as any).group_id,
        answerMessageId: answerId,
        previousAnsweredMessageId: previous,
      },
    });
    return { id: postId, answeredMessageId: answerId, cleared: clearing };
  }

  // ─── Announcements ────────────────────────────────────────────────────────

  /**
   * Keep at most BOARD_ANNOUNCEMENT_PIN_MAX announcements pinned across the
   * WHOLE community, unpinning the oldest. Per-community, not per-board: three
   * boards each holding three pinned announcements is nine banners on one
   * community page, which is where the cap actually has to bite.
   *
   * Returns the ids it unpinned so the caller can tell the moderator.
   * Fails soft: a community whose announcement cap could not be enforced is a
   * cosmetic problem, and throwing here would fail the post that was just
   * written.
   */
  async enforceAnnouncementCap(communityId: string): Promise<string[]> {
    if (!(await hasMessagePostKind(this.db))) return [];
    try {
      const { data: groups, error: groupError } = await this.db
        .from('groups')
        .select('id')
        .eq('community_id', communityId);
      if (groupError) throw groupError;
      const groupIds = ((groups || []) as Array<{ id: string }>).map((g) => g.id);
      if (groupIds.length === 0) return [];

      const { data, error } = await this.db
        .from('messages')
        .select('id, pinned_at')
        .in('group_id', groupIds)
        .eq('post_kind', 'announcement')
        .not('pinned_at', 'is', null)
        .is('removed_at', null)
        .order('pinned_at', { ascending: false });
      if (error) throw error;

      const rows = (data || []) as Array<{ id: string }>;
      const stale = rows.slice(BOARD_ANNOUNCEMENT_PIN_MAX).map((r) => r.id);
      if (stale.length === 0) return [];

      const { error: unpinError } = await this.db
        .from('messages')
        .update({ pinned_at: null, pinned_by: null })
        .in('id', stale);
      if (unpinError) throw unpinError;
      return stale;
    } catch (err) {
      logger.warn('Failed to enforce community announcement cap', { communityId, err });
      return [];
    }
  }

  // ─── Invite codes ─────────────────────────────────────────────────────────

  /**
   * A code from the unambiguous alphabet (no O/0, no I/1/L): it is read off
   * one phone screen and typed into another, so a confusable glyph pair is a
   * support ticket. `crypto.randomInt` and not `Math.random`: a guessable
   * invite to a private community is a way into it.
   */
  private mintCode(): string {
    let code = '';
    for (let i = 0; i < COMMUNITY_INVITE_CODE_LENGTH; i += 1) {
      code += COMMUNITY_INVITE_ALPHABET[randomInt(COMMUNITY_INVITE_ALPHABET.length)];
    }
    return code;
  }

  /** POST /communities/:id/invites — moderators only. */
  async createInvite(
    actorId: string,
    communityId: string,
    input: { expiresInMs?: unknown; maxUses?: unknown },
  ): Promise<{ code: string; expiresAt: string; maxUses: number; uses: number }> {
    if (!(await hasCommunityInvites(this.db))) throw unavailable('Invite links');

    const actor = await this.resolveActor(actorId, communityId);
    const mayInvite =
      actor.isPlatformAdmin ||
      actor.role === 'owner' ||
      actor.role === 'admin' ||
      actor.role === 'moderator';
    if (!mayInvite) throw fail('Only a community moderator can create an invite link', 403);

    const { count, error: countError } = await this.db
      .from('community_invites')
      .select('code', { count: 'exact', head: true })
      .eq('community_id', communityId)
      .is('revoked_at', null);
    if (countError && isMissingSchemaError(countError)) {
      markCommunityInvitesMissing();
      throw unavailable('Invite links');
    }
    if (countError) throw countError;
    if ((count ?? 0) >= COMMUNITY_INVITE_ACTIVE_MAX) {
      throw fail(
        `This community already has ${COMMUNITY_INVITE_ACTIVE_MAX} invite links. Revoke one first.`,
        409,
      );
    }

    const expiresAt = resolveInviteExpiry(input.expiresInMs);
    const maxUses = resolveInviteMaxUses(input.maxUses);

    // Retry on the astronomically unlikely PK collision rather than handing
    // the moderator a 500 for a coin flip.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = this.mintCode();
      const { error } = await this.db.from('community_invites').insert({
        code,
        community_id: communityId,
        created_by: actorId,
        expires_at: expiresAt,
        max_uses: maxUses,
      });
      if (!error) {
        await logAdminAction(this.supabaseService, {
          actorId,
          action: 'community_invite_create',
          targetType: 'community',
          targetId: communityId,
          metadata: { expiresAt, maxUses },
        });
        return { code, expiresAt, maxUses, uses: 0 };
      }
      if ((error as { code?: string }).code !== '23505') {
        if (isMissingSchemaError(error)) {
          markCommunityInvitesMissing();
          throw unavailable('Invite links');
        }
        throw error;
      }
    }
    throw fail('Could not create an invite link. Try again.', 409);
  }

  /** GET /communities/:id/invites — moderators only. */
  async listInvites(actorId: string, communityId: string) {
    if (!(await hasCommunityInvites(this.db))) throw unavailable('Invite links');
    const actor = await this.resolveActor(actorId, communityId);
    const mayInvite =
      actor.isPlatformAdmin ||
      actor.role === 'owner' ||
      actor.role === 'admin' ||
      actor.role === 'moderator';
    if (!mayInvite) throw fail('Only a community moderator can see invite links', 403);

    const { data, error } = await this.db
      .from('community_invites')
      .select('code, expires_at, max_uses, uses, created_at, created_by')
      .eq('community_id', communityId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(COMMUNITY_INVITE_ACTIVE_MAX);
    if (error) {
      if (isMissingSchemaError(error)) {
        markCommunityInvitesMissing();
        throw unavailable('Invite links');
      }
      throw error;
    }
    return ((data || []) as any[]).map((row) => ({
      code: row.code,
      expiresAt: row.expires_at ?? null,
      maxUses: row.max_uses ?? null,
      uses: row.uses ?? 0,
      createdAt: row.created_at,
      createdBy: row.created_by ?? null,
    }));
  }

  /** DELETE /communities/:id/invites/:code */
  async revokeInvite(actorId: string, communityId: string, rawCode: unknown): Promise<{ revoked: true }> {
    if (!(await hasCommunityInvites(this.db))) throw unavailable('Invite links');
    const code = normalizeInviteCode(rawCode);
    if (!code) throw fail(INVITE_REFUSAL_COPY, 404);

    const actor = await this.resolveActor(actorId, communityId);
    const mayInvite =
      actor.isPlatformAdmin ||
      actor.role === 'owner' ||
      actor.role === 'admin' ||
      actor.role === 'moderator';
    if (!mayInvite) throw fail('Only a community moderator can revoke an invite link', 403);

    const { error } = await this.db
      .from('community_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('code', code)
      .eq('community_id', communityId);
    if (error) throw error;
    await logAdminAction(this.supabaseService, {
      actorId,
      action: 'community_invite_revoke',
      targetType: 'community',
      targetId: communityId,
      metadata: { code },
    });
    return { revoked: true };
  }

  /**
   * POST /communities/join-by-code { code }
   *
   * THE ONLY way into a private community. Every refusal — unknown code,
   * expired, exhausted, revoked, malformed — answers the SAME string with the
   * same status, so the endpoint cannot become an oracle for which codes are
   * real or which private communities exist.
   *
   * Redemption is a single conditional UPDATE inside `redeem_community_invite`
   * so two students racing for the last seat of a `max_uses` invite cannot
   * both win.
   */
  async joinByCode(
    userId: string,
    rawCode: unknown,
  ): Promise<{ joined: true; communityId: string; slug: string; name: string }> {
    if (!(await hasCommunityInvites(this.db))) throw unavailable('Invite links');
    const code = normalizeInviteCode(rawCode);
    if (!code) throw fail(INVITE_REFUSAL_COPY, 404);

    const { data, error } = await (this.db as any).rpc('redeem_community_invite', { p_code: code });
    if (error) {
      if (isMissingSchemaError(error)) {
        markCommunityInvitesMissing();
        throw unavailable('Invite links');
      }
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const communityId = row?.community_id ?? null;
    if (!communityId) throw fail(INVITE_REFUSAL_COPY, 404);

    const { data: community, error: communityError } = await this.db
      .from('communities')
      .select('id, slug, name')
      .eq('id', communityId)
      .maybeSingle();
    if (communityError) throw communityError;
    if (!community) throw fail(INVITE_REFUSAL_COPY, 404);

    const { error: upsertError } = await this.db.from('community_members').upsert(
      { community_id: communityId, user_id: userId, source: 'joined', opted_out_at: null },
      { onConflict: 'community_id,user_id' },
    );
    if (upsertError) throw upsertError;
    await cacheService.delete(`communities:mine:${userId}`);

    return {
      joined: true,
      communityId,
      slug: (community as { slug: string }).slug,
      name: (community as { name: string }).name,
    };
  }
}

let instance: CommunityModerationService | null = null;

export function getCommunityModerationService(
  supabaseService: SupabaseService,
): CommunityModerationService {
  if (!instance) instance = new CommunityModerationService(supabaseService);
  return instance;
}

/** Tests reset the singleton between scripted databases. */
export function resetCommunityModerationService(): void {
  instance = null;
}
