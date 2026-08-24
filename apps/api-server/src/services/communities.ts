/**
 * Communities, group discovery and the Discover hub (Phase 3 · L).
 *
 * A community is the place a campus network happens: everyone at a university,
 * everyone on a programme, everyone taking a course, plus horizontal interest
 * communities anyone can join.
 *
 * Two membership sources, and the difference is a privacy boundary, not a
 * detail: 'auto' is derived from the academic profile and course enrolment,
 * 'joined' is an affirmative act. Only 'joined' membership widens
 * `profile_visible_to_viewer`'s "groups" tier (see the 20260824120000
 * migration) — auto-derived membership must never turn a semi-private profile
 * into a university-wide public one.
 *
 * GET /groups stays memberships-only and cached per user. Discovery is a
 * SEPARATE query with its own cache key; conflating them would poison every
 * user's group list with groups they are not in.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import { cacheService } from './cache';
import { normalizeUserSettings } from '@lantern/shared/settings';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COMMUNITY_KINDS = ['institution', 'programme', 'level', 'course', 'topic'] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

/** Discovery pages are small and cached; these bound every list this service serves. */
export const DISCOVER_LIMIT_DEFAULT = 20;
export const DISCOVER_LIMIT_MAX = 50;
const DISCOVER_CACHE_TTL = 60;

export interface CommunityRow {
  id: string;
  kind: CommunityKind;
  slug: string;
  name: string;
  description: string | null;
  institution_id: string | null;
  programme: string | null;
  study_level: number | null;
  course_id: string | null;
  tags: string[];
  visibility: 'public' | 'private';
  is_official: boolean;
  member_count: number;
}

export interface DiscoverGroup {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  questionCount: number;
  tags: string[];
  communityId: string | null;
  courseId: string | null;
  visibility: string;
  isMember: boolean;
}

const COMMUNITY_COLUMNS =
  'id, kind, slug, name, description, institution_id, programme, study_level, course_id, tags, visibility, is_official, member_count';

export class CommunitiesService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private assertUuid(id: string, label = 'id'): void {
    if (!id || !UUID_RE.test(String(id))) throw new PublicError(`Invalid ${label}`);
  }

  private clampLimit(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return DISCOVER_LIMIT_DEFAULT;
    return Math.min(DISCOVER_LIMIT_MAX, Math.floor(n));
  }

  /**
   * Recompute a user's auto-derived memberships. Never throws: a stale
   * membership must not fail the academic-profile save that triggered it.
   */
  async refreshAutoMemberships(userId: string): Promise<void> {
    if (!userId || !UUID_RE.test(String(userId))) return;
    try {
      const { error } = await this.db.rpc('refresh_auto_communities', { p_user_id: userId });
      if (error) throw error;
      await cacheService.delete(`communities:mine:${userId}`);
    } catch (err) {
      logger.warn('auto community refresh failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** The communities this user belongs to, auto-derived and joined alike. */
  async listMine(userId: string): Promise<Array<CommunityRow & { role: string; source: string }>> {
    const cacheKey = `communities:mine:${userId}`;
    const cached = await cacheService.get<Array<CommunityRow & { role: string; source: string }>>(
      cacheKey
    );
    if (cached) return cached;

    const { data, error } = await this.db
      .from('community_members')
      .select(`role, source, communities!inner(${COMMUNITY_COLUMNS})`)
      .eq('user_id', userId)
      .is('opted_out_at', null)
      .order('joined_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const rows = (data || [])
      .map((r: any) => {
        const c = Array.isArray(r.communities) ? r.communities[0] : r.communities;
        return c ? { ...(c as CommunityRow), role: r.role, source: r.source } : null;
      })
      .filter(Boolean) as Array<CommunityRow & { role: string; source: string }>;

    await cacheService.set(cacheKey, rows, 60);
    return rows;
  }

  /**
   * Discover communities. Narrows to the viewer's institution FIRST when one is
   * known, then falls back to global — filtering after the limit would return a
   * page of other universities' communities and then empty it.
   */
  async discoverCommunities(
    viewerId: string,
    opts: { q?: string; kind?: string; institutionId?: string; courseId?: string; limit?: number } = {}
  ): Promise<CommunityRow[]> {
    const limit = this.clampLimit(opts.limit);
    let institutionId = opts.institutionId;
    if (!institutionId) {
      const { data: me } = await this.db
        .from('profiles')
        .select('institution_id')
        .eq('id', viewerId)
        .maybeSingle();
      institutionId = (me as any)?.institution_id || undefined;
    }

    const build = (scoped: boolean) => {
      let q = this.db
        .from('communities')
        .select(COMMUNITY_COLUMNS)
        .eq('visibility', 'public')
        .order('member_count', { ascending: false })
        .limit(limit);
      if (scoped && institutionId && UUID_RE.test(institutionId)) {
        q = q.or(`institution_id.eq.${institutionId},institution_id.is.null`);
      }
      if (opts.kind && (COMMUNITY_KINDS as readonly string[]).includes(opts.kind)) {
        q = q.eq('kind', opts.kind);
      }
      if (opts.courseId && UUID_RE.test(opts.courseId)) q = q.eq('course_id', opts.courseId);
      if (opts.q && opts.q.trim()) {
        q = q.ilike('name', `%${opts.q.trim().replace(/[%_]/g, '')}%`);
      }
      return q;
    };

    const { data, error } = await build(true);
    if (error) throw error;
    if (data && data.length > 0) return data as unknown as CommunityRow[];

    // Nothing on campus — widen rather than show an empty Discover tab.
    const { data: global, error: globalError } = await build(false);
    if (globalError) throw globalError;
    return (global || []) as unknown as CommunityRow[];
  }

  async getBySlug(viewerId: string, slug: string): Promise<CommunityRow & { isMember: boolean }> {
    if (!slug || typeof slug !== 'string') throw new PublicError('Invalid community');
    const { data, error } = await this.db
      .from('communities')
      .select(COMMUNITY_COLUMNS)
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });

    const community = data as unknown as CommunityRow;
    const { data: membership } = await this.db
      .from('community_members')
      .select('user_id')
      .eq('community_id', community.id)
      .eq('user_id', viewerId)
      .is('opted_out_at', null)
      .maybeSingle();

    const isMember = !!membership;
    if (community.visibility === 'private' && !isMember) {
      // Do not confirm a private community exists to a non-member.
      throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });
    }
    return { ...community, isMember };
  }

  /**
   * Create a horizontal (topic) community — the only kind a person can make.
   *
   * Without this there is no code path anywhere that creates a non-derived
   * community, so the join/leave machinery had nothing to act on and the
   * Communities tab could only ever show the four auto-derived campus scopes.
   *
   * institution/programme/level/course communities stay derived: they are
   * minted by ensure_scope_community from the academic profile, and letting a
   * client mint one would fork the canonical row that scope depends on.
   */
  async createTopicCommunity(
    userId: string,
    input: { name?: string; description?: string; tags?: string[] }
  ): Promise<CommunityRow> {
    const name = String(input?.name ?? '').trim();
    if (name.length < 3 || name.length > 60) {
      throw new PublicError('Community name must be 3-60 characters');
    }
    const description = String(input?.description ?? '').trim().slice(0, 500) || null;
    const tags = Array.isArray(input?.tags)
      ? [...new Set(input.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 8)
      : [];

    const slug =
      'topic-' +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    if (slug.length < 8) throw new PublicError('Please use a more descriptive name');

    const { data, error } = await this.db
      .from('communities')
      .insert({
        kind: 'topic',
        slug,
        name,
        description,
        tags,
        visibility: 'public',
        // Never is_official: that badge is for derived campus scopes.
        is_official: false,
        created_by: userId,
      })
      .select(COMMUNITY_COLUMNS)
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new PublicError('A community with that name already exists');
      }
      throw error;
    }

    const community = data as unknown as CommunityRow;
    // The creator joins their own community, as a 'joined' member — which is
    // what makes it count for the profile-visibility widening.
    await this.db
      .from('community_members')
      .upsert(
        { community_id: community.id, user_id: userId, source: 'joined', role: 'admin', opted_out_at: null },
        { onConflict: 'community_id,user_id' }
      );
    await cacheService.delete(`communities:mine:${userId}`);
    return community;
  }

  async join(userId: string, communityId: string): Promise<{ joined: true }> {
    this.assertUuid(communityId, 'community id');
    const { data: community, error } = await this.db
      .from('communities')
      .select('id, visibility, name')
      .eq('id', communityId)
      .maybeSingle();
    if (error) throw error;
    if (!community) throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });
    if ((community as any).visibility === 'private') {
      throw Object.assign(new PublicError('This community is invite only'), { statusCode: 403 });
    }

    // upsert, not insert: re-joining a community the user previously left must
    // clear opted_out_at, or refresh_auto_communities keeps honouring the
    // opt-out and the user silently falls back out.
    const { error: upsertError } = await this.db.from('community_members').upsert(
      { community_id: communityId, user_id: userId, source: 'joined', opted_out_at: null },
      { onConflict: 'community_id,user_id' }
    );
    if (upsertError) throw upsertError;
    await cacheService.delete(`communities:mine:${userId}`);

    // Phase 3 M: joined_community had no writer. Addressed to the community
    // itself — joining is news to the room you joined, not to the internet.
    const { getActivityFeedService } = await import('./activityFeed');
    await getActivityFeedService(this.supabaseService).record({
      actorId: userId,
      verb: 'joined_community',
      objectType: 'community',
      objectId: communityId,
      audienceType: 'community',
      audienceId: communityId,
      payload: { title: (community as { name?: string }).name ?? null },
    });

    return { joined: true };
  }

  async leave(userId: string, communityId: string): Promise<{ left: true }> {
    this.assertUuid(communityId, 'community id');
    const { data: existing } = await this.db
      .from('community_members')
      .select('source')
      .eq('community_id', communityId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing && (existing as any).source === 'auto') {
      // Auto membership is recomputed on every profile save, so a DELETE would
      // be undone within minutes. Record the opt-out instead and let
      // refresh_auto_communities honour it.
      const { error } = await this.db
        .from('community_members')
        .update({ opted_out_at: new Date().toISOString() })
        .eq('community_id', communityId)
        .eq('user_id', userId);
      if (error) throw error;
    } else {
      const { error } = await this.db
        .from('community_members')
        .delete()
        .eq('community_id', communityId)
        .eq('user_id', userId);
      if (error) throw error;
    }
    await cacheService.delete(`communities:mine:${userId}`);
    return { left: true };
  }

  async listMembers(
    viewerId: string,
    communityId: string,
    limit = DISCOVER_LIMIT_DEFAULT
  ): Promise<Array<{ id: string; name: string; avatarUrl: string | null; programme: string | null }>> {
    this.assertUuid(communityId, 'community id');
    const { data: mine } = await this.db
      .from('community_members')
      .select('user_id, source')
      .eq('community_id', communityId)
      .eq('user_id', viewerId)
      .is('opted_out_at', null)
      .maybeSingle();
    if (!mine) {
      throw Object.assign(new PublicError('Join this community to see its members'), {
        statusCode: 403,
      });
    }
    const viewerJoined = (mine as { source?: string }).source === 'joined';

    const { data, error } = await this.db
      .from('community_members')
      .select('user_id, source, profiles!inner(id, name, avatar_url, programme, settings)')
      .eq('community_id', communityId)
      .is('opted_out_at', null)
      .limit(this.clampLimit(limit));
    if (error) throw error;

    const blocked = await this.supabaseService.listBlockedUserIds(viewerId).catch(() => []);
    const blockedSet = new Set(blocked || []);

    return (data || [])
      .map((r: any) => {
        const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
        if (!p || blockedSet.has(p.id)) return null;

        // PRIVACY: the roster must apply the SAME rule as
        // profile_visible_to_viewer, or this endpoint quietly undoes the
        // auto-vs-joined split the whole design rests on. Being AUTO-added to
        // your institution's community is not consent to have your name shown
        // to everyone else who was auto-added to it.
        if (p.id !== viewerId) {
          const visibility =
            normalizeUserSettings(p.settings).privacy.profileVisibility ?? 'public';
          if (visibility === 'private') return null;
          if (visibility === 'groups') {
            // The 'groups' tier is widened by a shared JOINED community only —
            // both sides must have chosen to be here.
            const memberJoined = r.source === 'joined';
            if (!viewerJoined || !memberJoined) return null;
          }
        }

        return {
          id: p.id,
          name: p.name,
          avatarUrl: p.avatar_url ?? null,
          programme: p.programme ?? null,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      avatarUrl: string | null;
      programme: string | null;
    }>;
  }

  /**
   * Discoverable groups. This is deliberately NOT `GET /groups`: that endpoint
   * is memberships-only and cached under a per-user key, and reusing it would
   * leak non-member groups into every user's sidebar.
   */
  async discoverGroups(
    viewerId: string,
    opts: { q?: string; communityId?: string; courseId?: string; limit?: number } = {}
  ): Promise<DiscoverGroup[]> {
    const limit = this.clampLimit(opts.limit);
    const cacheKey = `groups:discover:${viewerId}:${opts.communityId || '-'}:${
      opts.courseId || '-'
    }:${opts.q || '-'}:${limit}`;
    const cached = await cacheService.get<DiscoverGroup[]>(cacheKey);
    if (cached) return cached;

    // 'community' groups are only visible to members of that community; the
    // viewer's own community ids bound the query rather than filtering after.
    const mine = await this.listMine(viewerId);
    const myCommunityIds = mine.map((c) => c.id);

    let query = this.db
      .from('groups')
      .select(
        'id, name, description, avatar_url, member_count, question_count, tags, community_id, course_id, visibility'
      )
      .neq('is_archived', true)
      .order('member_count', { ascending: false })
      .limit(limit);

    if (opts.communityId && UUID_RE.test(opts.communityId)) {
      query = query.eq('community_id', opts.communityId).in('visibility', ['community', 'public']);
    } else if (myCommunityIds.length > 0) {
      query = query.or(
        `visibility.eq.public,and(visibility.eq.community,community_id.in.(${myCommunityIds.join(
          ','
        )}))`
      );
    } else {
      query = query.eq('visibility', 'public');
    }

    if (opts.courseId && UUID_RE.test(opts.courseId)) query = query.eq('course_id', opts.courseId);
    if (opts.q && opts.q.trim()) query = query.ilike('name', `%${opts.q.trim().replace(/[%_]/g, '')}%`);

    const { data, error } = await query;
    if (error) throw error;

    const ids = (data || []).map((g: any) => g.id);
    const memberIds = new Set<string>();
    if (ids.length > 0) {
      const { data: memberships } = await this.db
        .from('group_members')
        .select('group_id')
        .eq('user_id', viewerId)
        .in('group_id', ids);
      for (const m of memberships || []) memberIds.add((m as any).group_id);
    }

    const rows: DiscoverGroup[] = (data || []).map((g: any) => ({
      id: g.id,
      name: g.name,
      description: g.description ?? null,
      avatarUrl: g.avatar_url ?? null,
      memberCount: g.member_count ?? 0,
      questionCount: g.question_count ?? 0,
      tags: Array.isArray(g.tags) ? g.tags : [],
      communityId: g.community_id ?? null,
      courseId: g.course_id ?? null,
      visibility: g.visibility,
      isMember: memberIds.has(g.id),
    }));

    await cacheService.set(cacheKey, rows, DISCOVER_CACHE_TTL);
    return rows;
  }

  /**
   * People to follow: creators on the viewer's campus first. Reuses
   * creator_stats so Discover and the creator profile agree on trust.
   */
  async discoverPeople(
    viewerId: string,
    opts: { institutionId?: string; courseId?: string; limit?: number } = {}
  ): Promise<
    Array<{
      id: string;
      name: string;
      avatarUrl: string | null;
      programme: string | null;
      trustLevel: string;
      activePacks: number;
      learnersHelped: number;
      followerCount: number;
    }>
  > {
    const limit = this.clampLimit(opts.limit);
    const { data, error } = await this.db
      .from('creator_stats')
      .select('user_id, active_packs, learners_helped, follower_count, trust_level, trust_score')
      .gt('active_packs', 0)
      .order('trust_score', { ascending: false })
      .limit(limit * 3);
    if (error) throw error;

    const ids = (data || []).map((r: any) => r.user_id).filter((id: string) => id !== viewerId);
    if (ids.length === 0) return [];

    const [{ data: profiles }, blocked] = await Promise.all([
      this.db.from('profiles').select('id, name, avatar_url, programme, institution_id').in('id', ids),
      this.supabaseService.listBlockedUserIds(viewerId).catch(() => [] as string[]),
    ]);
    const blockedSet = new Set(blocked || []);
    const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));

    let institutionId = opts.institutionId;
    if (!institutionId) {
      const { data: me } = await this.db
        .from('profiles')
        .select('institution_id')
        .eq('id', viewerId)
        .maybeSingle();
      institutionId = (me as any)?.institution_id || undefined;
    }

    const mapped = (data || [])
      .filter((r: any) => r.user_id !== viewerId && !blockedSet.has(r.user_id))
      .map((r: any) => {
        const p = profileById.get(r.user_id);
        if (!p) return null;
        return {
          id: r.user_id,
          name: p.name,
          avatarUrl: p.avatar_url ?? null,
          programme: p.programme ?? null,
          trustLevel: r.trust_level,
          activePacks: r.active_packs ?? 0,
          learnersHelped: r.learners_helped ?? 0,
          followerCount: r.follower_count ?? 0,
          _sameCampus: !!institutionId && p.institution_id === institutionId,
        };
      })
      .filter(Boolean) as Array<any>;

    mapped.sort((a, b) => Number(b._sameCampus) - Number(a._sameCampus));
    return mapped.slice(0, limit).map(({ _sameCampus, ...rest }) => rest);
  }
}

let service: CommunitiesService | null = null;

export function getCommunitiesService(supabaseService: SupabaseService): CommunitiesService {
  if (!service) service = new CommunitiesService(supabaseService);
  return service;
}
