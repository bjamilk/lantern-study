/**
 * The Academic Feed (Phase 3 · M).
 *
 * PULL-BASED BY DESIGN. Web already holds ~8 realtime channels per user, and
 * notifications already do per-recipient fan-out — which is the expensive path.
 * So an activity writes ONE row addressed to an audience, and readers resolve
 * their own audiences at read time. Do not turn this into a channel, and do not
 * fan it out per recipient; direct-to-me events belong in notifications.
 *
 * Writers call `record()` from hooks that already exist (pack publish, note
 * share, group join, challenge completion, follow, badge unlock). Every one of
 * those actions already succeeded by the time we get here, so `record()` never
 * throws — a missing feed row must not roll back a real publish.
 */
import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTIVITY_VERBS = [
  'published_pack',
  'published_bank',
  'shared_note',
  'joined_group',
  'joined_community',
  'completed_challenge',
  'unlocked_badge',
  'followed_creator',
  'added_deck_collaborator',
  'answered_question',
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

export type ActivityAudience = 'community' | 'group' | 'followers' | 'public';

export const FEED_LIMIT_DEFAULT = 25;
export const FEED_LIMIT_MAX = 50;

export interface ActivityInput {
  actorId: string;
  verb: ActivityVerb;
  objectType?: string | null;
  objectId?: string | null;
  audienceType: ActivityAudience;
  audienceId?: string | null;
  courseId?: string | null;
  payload?: Record<string, unknown>;
}

export interface FeedItem {
  id: number;
  verb: ActivityVerb;
  objectType: string | null;
  objectId: string | null;
  audienceType: ActivityAudience;
  audienceId: string | null;
  courseId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string; avatarUrl: string | null; programme: string | null } | null;
}

export class ActivityFeedService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /**
   * Write one activity row. Best-effort: the action it describes has already
   * committed, so a feed failure is logged and swallowed.
   */
  async record(input: ActivityInput): Promise<void> {
    try {
      if (!input?.actorId || !UUID_RE.test(String(input.actorId))) return;
      if (!(ACTIVITY_VERBS as readonly string[]).includes(input.verb)) return;

      const audienceId =
        input.audienceId && UUID_RE.test(String(input.audienceId)) ? input.audienceId : null;
      // community/group activities are meaningless without their audience id —
      // storing them with a NULL audience would make them visible to nobody and
      // silently lose the event.
      if ((input.audienceType === 'community' || input.audienceType === 'group') && !audienceId) {
        return;
      }

      const { error } = await this.db.from('activity_events').insert({
        actor_id: input.actorId,
        verb: input.verb,
        object_type: input.objectType ?? null,
        object_id: input.objectId ? String(input.objectId) : null,
        audience_type: input.audienceType,
        audience_id: audienceId,
        course_id:
          input.courseId && UUID_RE.test(String(input.courseId)) ? input.courseId : null,
        payload: input.payload ?? {},
      });
      if (error) throw error;
    } catch (err) {
      logger.warn('activity event write failed', {
        verb: input?.verb,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * The viewer's feed: people they follow ∪ their communities ∪ their groups,
   * plus public activity. One query per audience dimension, merged and sorted
   * in memory — the alternative is a five-way OR that no index can serve.
   */
  async getFeed(
    viewerId: string,
    opts: { limit?: number; before?: string } = {}
  ): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
    const rawLimit = Number(opts.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(FEED_LIMIT_MAX, Math.floor(rawLimit))
      : FEED_LIMIT_DEFAULT;
    // Reject a malformed cursor rather than letting an invalid timestamp reach
    // PostgREST, which turns it into a 500.
    const before =
      opts.before && !Number.isNaN(new Date(opts.before).getTime()) ? opts.before : null;

    const [followees, communities, groups, blocked] = await Promise.all([
      this.db
        .from('profile_follows')
        .select('followee_id')
        .eq('follower_id', viewerId)
        .limit(500)
        .then((r) => (r.data || []).map((x: any) => x.followee_id)),
      this.db
        .from('community_members')
        .select('community_id')
        .eq('user_id', viewerId)
        .is('opted_out_at', null)
        .limit(100)
        .then((r) => (r.data || []).map((x: any) => x.community_id)),
      this.db
        .from('group_members')
        .select('group_id')
        .eq('user_id', viewerId)
        .neq('pending', true)
        .limit(200)
        .then((r) => (r.data || []).map((x: any) => x.group_id)),
      this.supabaseService.listBlockedUserIds(viewerId).catch(() => [] as string[]),
    ]);

    const select =
      'id, actor_id, verb, object_type, object_id, audience_type, audience_id, course_id, payload, created_at';
    const base = () => {
      let q = this.db
        .from('activity_events')
        .select(select)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (before) q = q.lt('created_at', before);
      return q;
    };

    const queries: Array<PromiseLike<{ data: any[] | null }>> = [base().eq('audience_type', 'public')];
    if (followees.length > 0) {
      queries.push(base().eq('audience_type', 'followers').in('actor_id', followees));
    }
    if (communities.length > 0) {
      queries.push(base().eq('audience_type', 'community').in('audience_id', communities));
    }
    if (groups.length > 0) {
      queries.push(base().eq('audience_type', 'group').in('audience_id', groups));
    }

    const results = await Promise.all(queries);
    const blockedSet = new Set(blocked || []);
    const seen = new Set<number>();
    const merged: any[] = [];
    for (const r of results) {
      for (const row of r.data || []) {
        if (seen.has(row.id)) continue;
        if (row.actor_id === viewerId) continue; // your own actions are not news
        if (blockedSet.has(row.actor_id)) continue;
        seen.add(row.id);
        merged.push(row);
      }
    }

    merged.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const page = merged.slice(0, limit);

    const actorIds = [...new Set(page.map((r) => r.actor_id))];
    const actorById = new Map<string, any>();
    if (actorIds.length > 0) {
      const { data: profiles } = await this.db
        .from('profiles')
        .select('id, name, avatar_url, programme')
        .in('id', actorIds);
      for (const p of profiles || []) actorById.set((p as any).id, p);
    }

    const items: FeedItem[] = page.map((row) => {
      const p = actorById.get(row.actor_id);
      return {
        id: row.id,
        verb: row.verb,
        objectType: row.object_type ?? null,
        objectId: row.object_id ?? null,
        audienceType: row.audience_type,
        audienceId: row.audience_id ?? null,
        courseId: row.course_id ?? null,
        payload: row.payload || {},
        createdAt: row.created_at,
        actor: p
          ? { id: p.id, name: p.name, avatarUrl: p.avatar_url ?? null, programme: p.programme ?? null }
          : null,
      };
    });

    return {
      items,
      // Only advertise a cursor when the page was full; otherwise the client
      // pages forever against an exhausted feed.
      nextCursor: page.length === limit && page.length > 0 ? page[page.length - 1].createdAt : null,
    };
  }
}

let service: ActivityFeedService | null = null;

export function getActivityFeedService(supabaseService: SupabaseService): ActivityFeedService {
  if (!service) service = new ActivityFeedService(supabaseService);
  return service;
}
