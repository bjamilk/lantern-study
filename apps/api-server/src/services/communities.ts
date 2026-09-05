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
import { CacheKeys } from './cachePolicy';
import { getStudyRoomsService } from './studyRooms';
import {
  normalizeUserSettings,
  ONLINE_THRESHOLD_MS,
  resolvePublicOnlineStatus,
  userShowsOnlineStatus,
} from '@lantern/shared/settings';
import {
  communityPageGroupVisibilities,
  resolveCommunityRole,
  resolveGroupDiscovery,
  sortCommunityChannels,
  sortCommunityStudyGroups,
  type CommunityChannel,
  type CommunityChannels,
  type CommunityMember,
  type CommunityMembersPage,
  type CommunityRole,
  type CommunityStudyGroup,
} from '@lantern/shared/network';
import {
  groupColumns,
  hasGroupCommunitySurface,
  isMissingColumnError,
  markGroupCommunitySurfaceMissing,
} from './schemaCapabilities';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Roster pages (community server view). */
export const MEMBERS_LIMIT_DEFAULT = 30;
export const MEMBERS_LIMIT_MAX = 50;
/** Online count: 30s cache, capped — above this the number is a vibe, not a fact. */
const ONLINE_COUNT_TTL = 30;
const ONLINE_COUNT_CAP = 1000;
/** Text channels per community page. */
const CHANNELS_LIMIT = 50;

/** Strict ISO-8601 timestamptz as PostgREST emits it — the only shape a cursor may carry. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Roster cursor = base64url(`${joined_at}|${user_id}`) of the LAST RAW ROW of
 * the previous page (before privacy filtering), so a page of hidden profiles
 * still advances. The timestamp is kept verbatim (microsecond precision) so
 * the `joined_at.eq` half of the keyset filter matches what Postgres stored.
 */
export function encodeMembersCursor(joinedAt: string, userId: string): string {
  return Buffer.from(`${joinedAt}|${userId}`, 'utf8').toString('base64url');
}

export function decodeMembersCursor(cursor: string): { joinedAt: string; userId: string } {
  const invalid = () => new PublicError('Invalid cursor');
  if (typeof cursor !== 'string' || !cursor || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw invalid();
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) throw invalid();
  const joinedAt = decoded.slice(0, sep);
  const userId = decoded.slice(sep + 1);
  if (!TIMESTAMP_RE.test(joinedAt) || !UUID_RE.test(userId)) throw invalid();
  return { joinedAt, userId };
}

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
  /**
   * The community's one live chat. Carried on the membership list so a client
   * can tell a lounge from a board BEFORE it has opened the community page —
   * without it, a cold-started chat list classifies every lounge as a board
   * and drops the community's one chat (founder decision 1). Null pre-
   * 20260829170000, and for a community whose lounge has not been minted.
   */
  lounge_group_id?: string | null;
}

/**
 * The public (unauthenticated) community card. Five fields, chosen so the
 * payload cannot grow a leak by accident: adding a field here is a deliberate
 * act, not an inherited `select('*')`.
 */
export interface CommunityPublicSummary {
  slug: string;
  name: string;
  kind: CommunityKind;
  institutionName: string | null;
  memberCount: number;
}

/**
 * Community slugs are machine-minted lowercase kebab (`campus-unilag`,
 * `course-<32 hex>`, `topic-…`). Anything else never becomes a query.
 */
const PUBLIC_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,120}$/;

export function normalizePublicCommunitySlug(raw: unknown): string | null {
  // Strings only: a number or a null coerced through String() would otherwise
  // become the perfectly valid-looking slugs "42" and "null".
  if (typeof raw !== 'string') return null;
  const slug = raw.trim().toLowerCase();
  return PUBLIC_SLUG_RE.test(slug) ? slug : null;
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
/**
 * The detail page's extra columns. `lounge_group_id` only exists once
 * 20260829170000 is applied — every select that names it goes through
 * selectCommunity(), which retries without it on 42703.
 */
const COMMUNITY_COLUMNS_FULL = `${COMMUNITY_COLUMNS}, lounge_group_id, created_by`;

/** GET /communities/:slug — CommunityDetail on the wire. */
export type CommunityDetailRow = CommunityRow & {
  lounge_group_id: string | null;
  created_by: string | null;
  isMember: boolean;
  source: 'auto' | 'joined' | null;
  viewerRole: CommunityRole | null;
  onlineCount: number;
};

type GroupChannelRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  member_count: number | null;
  question_count: number | null;
  visibility: string | null;
  course_id: string | null;
  parent_id: string | null;
  last_message: string | null;
  last_message_time: string | null;
  community_surface?: 'board' | 'study_group' | null;
};
const GROUP_CHANNEL_COLUMNS =
  'id, name, description, avatar_url, member_count, question_count, visibility, course_id, parent_id, last_message, last_message_time';

/**
 * A board is `community_surface IS NULL OR 'board'` — NULL is legacy and every
 * group that has a community_id today IS a channel, so the backfill is a
 * no-op and this filter is what keeps study groups out of the board list.
 */
const BOARD_SURFACE_FILTER = 'community_surface.is.null,community_surface.eq.board';

type MembershipRow = { source: 'auto' | 'joined' | null; role: string | null };

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

  private clampMembersLimit(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return MEMBERS_LIMIT_DEFAULT;
    return Math.min(MEMBERS_LIMIT_MAX, Math.max(1, Math.floor(n)));
  }

  /**
   * One community row by id or slug. Pre-migration (20260829170000 not
   * applied) `lounge_group_id` does not exist: Postgres answers 42703, and we
   * retry without that column and report the pointer as null so the page
   * still renders (§3.1 degrade rule).
   */
  private async selectCommunity<T extends object>(
    columns: string,
    match: { column: 'id' | 'slug'; value: string }
  ): Promise<T | null> {
    const run = (cols: string) =>
      this.db.from('communities').select(cols).eq(match.column, match.value).maybeSingle();
    const { data, error } = await run(columns);
    if (!error) return (data as unknown as T | null) ?? null;
    if ((error as { code?: string }).code !== '42703') throw error;

    const fallback = columns
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c && c !== 'lounge_group_id')
      .join(', ');
    const retry = await run(fallback);
    if (retry.error) throw retry.error;
    if (!retry.data) return null;
    return { ...(retry.data as unknown as T), lounge_group_id: null } as T;
  }

  /** The viewer's active membership row, or null. */
  private async viewerMembership(
    viewerId: string,
    communityId: string
  ): Promise<MembershipRow | null> {
    const { data } = await this.db
      .from('community_members')
      .select('user_id, source, role')
      .eq('community_id', communityId)
      .eq('user_id', viewerId)
      .is('opted_out_at', null)
      .maybeSingle();
    if (!data) return null;
    const raw = data as { source?: string | null; role?: string | null };
    return {
      source: raw.source === 'auto' || raw.source === 'joined' ? raw.source : null,
      role: raw.role ?? null,
    };
  }

  /** Active (not opted-out) member of the community? Used by the group routes' community guard. */
  async isActiveMember(userId: string, communityId: string): Promise<boolean> {
    if (!userId || !communityId || !UUID_RE.test(String(communityId))) return false;
    const { data, error } = await this.db
      .from('community_members')
      .select('user_id')
      .eq('community_id', communityId)
      .eq('user_id', userId)
      .is('opted_out_at', null)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  /**
   * Members seen in the last ONLINE_THRESHOLD_MS who share their online
   * status. Cached 30s per community; capped so an institution-sized
   * community never fans out a 40k-row read. Fails soft to 0 — a broken
   * count must not take the community page down with it.
   */
  private async countOnline(communityId: string): Promise<number> {
    const cacheKey = `communities:online:${communityId}`;
    const cached = await cacheService.get<number>(cacheKey);
    if (typeof cached === 'number') return cached;

    let count = 0;
    try {
      const since = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();
      const { data, error } = await this.db
        .from('community_members')
        .select('user_id, profiles!inner(settings, last_seen_at)')
        .eq('community_id', communityId)
        .is('opted_out_at', null)
        .gt('profiles.last_seen_at', since)
        .limit(ONLINE_COUNT_CAP);
      if (error) throw error;
      for (const r of (data || []) as Array<{ profiles: unknown }>) {
        const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
        if (p && userShowsOnlineStatus(normalizeUserSettings((p as { settings?: unknown }).settings).privacy)) {
          count += 1;
        }
      }
      count = Math.min(count, ONLINE_COUNT_CAP);
    } catch (err) {
      logger.warn('community online count failed', {
        communityId,
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
    await cacheService.set(cacheKey, count, ONLINE_COUNT_TTL);
    return count;
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

    let rows = await this.queryMemberships(userId);

    // Self-heal: several signup paths (the mobile PostgREST profile insert,
    // OAuth profile triggers) write academic fields WITHOUT going through the
    // profile PUT that refreshes auto-memberships — leaving an account with a
    // real profile but zero communities. Discover then falls back to other
    // campuses' communities, which reads as "I was put in the wrong
    // university". Recompute once when we see that state.
    if (rows.length === 0 && (await this.hasAcademicSignal(userId))) {
      await this.refreshAutoMemberships(userId);
      rows = await this.queryMemberships(userId);
    }

    await cacheService.set(cacheKey, rows, 60);
    return rows;
  }

  private async queryMemberships(
    userId: string
  ): Promise<Array<CommunityRow & { role: string; source: string }>> {
    const run = (columns: string) =>
      this.db
        .from('community_members')
        .select(`role, source, communities!inner(${columns})`)
        .eq('user_id', userId)
        .is('opted_out_at', null)
        .order('joined_at', { ascending: false })
        .limit(100);

    // `lounge_group_id` only exists once 20260829170000 is applied; the same
    // 42703 retry `selectCommunity` uses keeps the membership list working
    // before it lands, with the pointer reported as null.
    let loungeAvailable = true;
    let { data, error } = await run(`${COMMUNITY_COLUMNS}, lounge_group_id`);
    if (error && (error as { code?: string }).code === '42703') {
      loungeAvailable = false;
      ({ data, error } = await run(COMMUNITY_COLUMNS));
    }
    if (error) throw error;

    return (data || [])
      .map((r: any) => {
        const c = Array.isArray(r.communities) ? r.communities[0] : r.communities;
        if (!c) return null;
        return {
          ...(c as CommunityRow),
          lounge_group_id: loungeAvailable ? ((c as CommunityRow).lounge_group_id ?? null) : null,
          role: r.role,
          source: r.source,
        };
      })
      .filter(Boolean) as Array<CommunityRow & { role: string; source: string }>;
  }

  /** Anything on the profile (or an active course) the derivation could use. */
  private async hasAcademicSignal(userId: string): Promise<boolean> {
    const { data: profile } = await this.db
      .from('profiles')
      .select('institution_id, programme, study_level')
      .eq('id', userId)
      .maybeSingle();
    const p = profile as
      | { institution_id?: string | null; programme?: string | null; study_level?: number | null }
      | null;
    if (p && (p.institution_id || (p.programme && p.programme.trim()) || p.study_level != null)) {
      return true;
    }
    const { count } = await this.db
      .from('user_courses')
      .select('course_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');
    return (count ?? 0) > 0;
  }

  /**
   * Open a community's lounge — the one persistent, admin-less chat every
   * member shares. Lazily mints a groups row (visibility='community', which
   * joinDiscoverableGroup already gates on membership) and pins it on
   * communities.lounge_group_id, then joins the caller. Chat itself rides the
   * existing groups/messages stack — no new chat machinery.
   */
  async openLounge(
    userId: string,
    communityId: string
  ): Promise<{ groupId: string; name: string; created: boolean }> {
    this.assertUuid(communityId, 'community id');

    const { data: membership } = await this.db
      .from('community_members')
      .select('user_id')
      .eq('community_id', communityId)
      .eq('user_id', userId)
      .is('opted_out_at', null)
      .maybeSingle();
    if (!membership) {
      throw Object.assign(new PublicError('Join this community first'), { statusCode: 403 });
    }

    const { data: community, error } = await this.db
      .from('communities')
      .select('id, name, course_id, lounge_group_id')
      .eq('id', communityId)
      .maybeSingle();
    if (error) {
      // Pre-migration (20260829170000 not applied): the pointer column does
      // not exist yet. Fail soft — clients show the message, nothing breaks.
      if ((error as { code?: string }).code === '42703') {
        throw Object.assign(new PublicError('Community chat is not available yet'), {
          statusCode: 503,
        });
      }
      throw error;
    }
    if (!community) {
      throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });
    }

    const loungeName = `${String((community as any).name || 'Community')} Lounge`.slice(0, 80);
    let groupId = (community as any).lounge_group_id as string | null;
    let created = false;

    if (!groupId) {
      // The pointer is ON DELETE SET NULL, so anything that removes the lounge
      // row — or any write outside this service — leaves it null while the
      // community may still HAVE a lounge. Minting a second one then strands
      // the first, and members open an empty General with their history
      // apparently gone (2026-09-03). Adopt the existing one first; only mint
      // when the community genuinely has none.
      //
      // Oldest first: if duplicates already exist, the original is the one
      // holding the conversation. A lounge is minted with no admins and
      // community visibility, which is what distinguishes it from a board that
      // a member happened to name "<Community> Lounge".
      const { data: existingLounges, error: existingError } = await this.db
        .from('groups')
        .select('id, created_at')
        .eq('community_id', communityId)
        .eq('visibility', 'community')
        .eq('name', loungeName)
        .neq('is_archived', true)
        .order('created_at', { ascending: true })
        .limit(1);
      if (existingError) throw existingError;
      const adopted = (existingLounges as Array<{ id: string }> | null)?.[0]?.id ?? null;
      if (adopted) {
        groupId = adopted;
        // Re-point the community at the lounge it already had. Guarded on null
        // so a concurrent opener that just claimed the pointer still wins.
        await this.db
          .from('communities')
          .update({ lounge_group_id: adopted })
          .eq('id', communityId)
          .is('lounge_group_id', null);
      }
    }

    if (!groupId) {
      const { data: group, error: groupError } = await this.db
        .from('groups')
        .insert({
          name: loungeName,
          description:
            'The open chat for this community. Everyone here is a member — say hi, ask questions, share what you are studying.',
          // No admins on purpose: an official scope community's lounge must
          // not be deletable or reconfigurable by whoever opened it first.
          admin_ids: [],
          permissions: {},
          visibility: 'community',
          community_id: communityId,
          course_id: (community as any).course_id ?? null,
          is_archived: false,
        })
        .select('id')
        .single();
      if (groupError || !group) throw groupError || new PublicError('Could not open the lounge');

      // Claim the pointer; exactly one concurrent opener wins.
      const { data: claimed, error: claimError } = await this.db
        .from('communities')
        .update({ lounge_group_id: (group as any).id })
        .eq('id', communityId)
        .is('lounge_group_id', null)
        .select('id');
      if (claimError) throw claimError;

      if (claimed && claimed.length > 0) {
        groupId = (group as any).id;
        created = true;
      } else {
        // Lost the race: adopt the winner's lounge, remove the orphan group.
        const { data: winner } = await this.db
          .from('communities')
          .select('lounge_group_id')
          .eq('id', communityId)
          .maybeSingle();
        groupId = ((winner as any)?.lounge_group_id as string | null) ?? null;
        await this.db.from('groups').delete().eq('id', (group as any).id);
        if (!groupId) throw new PublicError('Could not open the lounge');
      }
    }

    const { error: joinError } = await this.db.from('group_members').upsert(
      { group_id: groupId, user_id: userId, pending: false },
      { onConflict: 'group_id,user_id' }
    );
    if (joinError) throw joinError;

    await cacheService.deletePattern('groups:discover:*');
    await cacheService.deletePattern('groups:user:*');
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern(`group:${groupId}:*`);
    await cacheService.deletePattern(`user:groups:${userId}:*`);

    return { groupId: groupId as string, name: loungeName, created };
  }

  /**
   * True when this group is a community's lounge. The lounge is the community's
   * only conversation room and is minted with no admins precisely so nobody
   * owns it; deleting one takes its whole history with it (messages cascade).
   */
  async isCommunityLounge(groupId: string): Promise<boolean> {
    if (!groupId) return false;
    const { data, error } = await this.db
      .from('communities')
      .select('id')
      .eq('lounge_group_id', groupId)
      .limit(1);
    if (error) {
      // Pre-migration the column does not exist; nothing can be a lounge yet.
      if ((error as { code?: string }).code === '42703') return false;
      throw error;
    }
    return !!(data && data.length > 0);
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

  async getBySlug(viewerId: string, slug: string): Promise<CommunityDetailRow> {
    if (!slug || typeof slug !== 'string') throw new PublicError('Invalid community');
    const data = await this.selectCommunity<
      CommunityRow & { lounge_group_id?: string | null; created_by?: string | null }
    >(COMMUNITY_COLUMNS_FULL, { column: 'slug', value: slug });
    if (!data) throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });

    const { lounge_group_id, created_by, ...community } = data;
    const membership = await this.viewerMembership(viewerId, community.id);

    const isMember = !!membership;
    if (community.visibility === 'private' && !isMember) {
      // Do not confirm a private community exists to a non-member.
      throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });
    }
    const createdBy = created_by ?? null;
    return {
      ...(community as CommunityRow),
      lounge_group_id: lounge_group_id ?? null,
      created_by: createdBy,
      isMember,
      source: membership?.source ?? null,
      viewerRole: membership ? resolveCommunityRole(membership.role, viewerId, createdBy) : null,
      onlineCount: isMember ? await this.countOnline(community.id) : 0,
    };
  }

  /**
   * GET /communities/public/:slug — the ONLY unauthenticated read of a
   * community, and the payload behind the crawler join card at
   * /discover/c/:slug.
   *
   * THE RULE THAT MATTERS (same as campusSummary): this client is the SERVICE
   * ROLE, so it bypasses RLS. Every visibility guard has to be written here by
   * hand. Two are:
   *   - `visibility = 'public'` — a private community must not even confirm it
   *     exists to a stranger holding its URL (getBySlug takes the same line).
   *   - the select names five columns and nothing else. No created_by, no
   *     course_id, no member rows, no message rows, no lounge pointer: the
   *     card says what the room is and how big it is, never who is in it or
   *     what was said in it.
   *
   * Returns null for unknown/private/malformed — the caller answers 404.
   */
  async publicSummaryBySlug(rawSlug: unknown): Promise<CommunityPublicSummary | null> {
    const slug = normalizePublicCommunitySlug(rawSlug);
    if (!slug) return null;

    const { data, error } = await this.db
      .from('communities')
      .select('slug, name, kind, institution_id, member_count')
      .eq('slug', slug)
      .eq('visibility', 'public')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = data as unknown as {
      slug: string;
      name: string;
      kind: string;
      institution_id: string | null;
      member_count: number | null;
    };

    // The institution's DISPLAY NAME only, and only for a campus that is still
    // active — a deactivated campus should not resurface on a public card.
    let institutionName: string | null = null;
    if (row.institution_id) {
      const { data: campus } = await this.db
        .from('marketplace_campuses')
        .select('name')
        .eq('id', row.institution_id)
        .eq('active', true)
        .maybeSingle();
      institutionName = ((campus as { name?: string } | null)?.name ?? null) || null;
    }

    const kind = (COMMUNITY_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as CommunityKind)
      : 'topic';

    return {
      slug: row.slug,
      name: row.name,
      kind,
      institutionName,
      memberCount: Math.max(0, Number(row.member_count) || 0),
    };
  }

  /**
   * The community as a server: its lounge, its text channels (top-level
   * groups with community_id), its open study rooms and the head counts —
   * one payload for both clients' community screens.
   *
   * Guests of a public community get the public channels only: no rooms, no
   * roster, no online count, no unjoined-channel previews. Not cached — the
   * unread counts must be fresh.
   */
  async listChannels(viewerId: string, communityId: string): Promise<CommunityChannels> {
    this.assertUuid(communityId, 'community id');
    const community = await this.selectCommunity<{
      id: string;
      name: string;
      visibility: 'public' | 'private';
      course_id: string | null;
      member_count: number | null;
      lounge_group_id?: string | null;
      created_by?: string | null;
    }>('id, name, visibility, course_id, member_count, lounge_group_id, created_by', {
      column: 'id',
      value: communityId,
    });
    if (!community) {
      throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });
    }

    const membership = await this.viewerMembership(viewerId, communityId);
    const isMember = !!membership;
    if (community.visibility === 'private' && !isMember) {
      throw Object.assign(new PublicError('Community not found'), { statusCode: 404 });
    }

    const loungeGroupId = community.lounge_group_id ?? null;
    const vis = communityPageGroupVisibilities(isMember);
    const columns = await groupColumns(this.db, GROUP_CHANNEL_COLUMNS);

    /**
     * One shape for both community-group queries. `surface` picks the half:
     * 'board' adds the NULL-or-board filter, 'study_group' the equality one.
     * Pre-migration neither filter is applied and everything is a board.
     */
    const selectCommunityGroups = async (
      surface: 'board' | 'study_group',
      withSurfaceFilter: boolean,
    ) => {
      // `columns` is resolved at runtime (it grows a column only once the
      // migration is applied), so the generated select type is intractable.
      let query = (this.db as any)
        .from('groups')
        .select(columns)
        .eq('community_id', communityId)
        .neq('is_archived', true)
        .is('parent_id', null)
        .in('visibility', vis)
        .neq('id', loungeGroupId ?? NIL_UUID);
      if (withSurfaceFilter) {
        query =
          surface === 'board'
            ? query.or(BOARD_SURFACE_FILTER)
            : query.eq('community_surface', 'study_group');
      }
      return query.order('member_count', { ascending: false }).limit(CHANNELS_LIMIT);
    };

    // The probe can race a migration in either direction, so a query that
    // still sees 42703 flips the flag and retries once without the filter.
    let hasSurface = await hasGroupCommunitySurface(this.db);
    let { data: channelData, error: channelError } = await selectCommunityGroups('board', hasSurface);
    if (channelError && hasSurface && isMissingColumnError(channelError)) {
      markGroupCommunitySurfaceMissing();
      hasSurface = false;
      ({ data: channelData, error: channelError } = await selectCommunityGroups(
        'board',
        false,
      ));
    }
    if (channelError) throw channelError;
    const channelRows = (channelData || []) as GroupChannelRow[];

    // Study groups are listed here but opened in Chat. Members only: a guest
    // of a public community gets boards and nothing else.
    let studyGroupRows: GroupChannelRow[] = [];
    if (hasSurface && isMember) {
      const { data, error } = await selectCommunityGroups('study_group', true);
      if (error) {
        if (isMissingColumnError(error)) {
          markGroupCommunitySurfaceMissing();
        } else {
          throw error;
        }
      } else {
        studyGroupRows = (data || []) as GroupChannelRow[];
      }
    }

    // An archived or deleted lounge reads as "not minted yet"; the next
    // POST /lounge re-mints against the stale pointer's own guard.
    let loungeRow: GroupChannelRow | null = null;
    if (isMember && loungeGroupId) {
      const { data, error } = await this.db
        .from('groups')
        .select(GROUP_CHANNEL_COLUMNS)
        .eq('id', loungeGroupId)
        .neq('is_archived', true)
        .maybeSingle();
      if (error) throw error;
      loungeRow = (data as GroupChannelRow | null) ?? null;
    }

    // One membership read covers boards, study groups and the lounge.
    const allIds = channelRows.map((g) => g.id);
    for (const g of studyGroupRows) allIds.push(g.id);
    if (loungeRow) allIds.push(loungeRow.id);

    const joined = new Set<string>();
    if (allIds.length > 0) {
      const { data: memberships, error } = await this.db
        .from('group_members')
        .select('group_id')
        .eq('user_id', viewerId)
        .eq('pending', false)
        .in('group_id', allIds);
      if (error) throw error;
      for (const m of (memberships || []) as Array<{ group_id: string }>) joined.add(m.group_id);
    }

    // Read-only on the unread cache: /groups/unread/all owns the write.
    let unread: Record<string, number> = {};
    if (joined.size > 0) {
      unread =
        (await cacheService.get<Record<string, number>>(CacheKeys.unreadGroups(viewerId))) ??
        (await this.supabaseService.getAllGroupUnreadCounts(viewerId));
    }

    const rooms = isMember
      ? await getStudyRoomsService(this.supabaseService).list(viewerId, {
          communityId,
          courseId: community.course_id ?? undefined,
        })
      : [];
    const onlineCount = isMember ? await this.countOnline(communityId) : 0;

    const toChannel = (g: GroupChannelRow, isLounge: boolean): CommunityChannel => {
      const member = joined.has(g.id);
      return {
        id: g.id,
        name: g.name,
        description: g.description ?? null,
        avatarUrl: g.avatar_url ?? null,
        memberCount: g.member_count ?? 0,
        questionCount: g.question_count ?? 0,
        visibility: g.visibility === 'public' ? 'public' : 'community',
        courseId: g.course_id ?? null,
        isLounge,
        isMember: member,
        unreadCount: member ? Math.max(0, Number(unread[g.id]) || 0) : 0,
        lastMessage: member ? g.last_message ?? null : null,
        lastMessageTime: member ? g.last_message_time ?? null : null,
      };
    };

    /**
     * A study group is listed here and opened in Chat, so it carries no
     * unread and no message preview — the same unjoined-privacy rule as a
     * board, applied to `lastMessageTime` because that is all this row shows.
     */
    const toStudyGroup = (g: GroupChannelRow): CommunityStudyGroup => {
      const member = joined.has(g.id);
      return {
        id: g.id,
        name: g.name,
        description: g.description ?? null,
        avatarUrl: g.avatar_url ?? null,
        memberCount: g.member_count ?? 0,
        questionCount: g.question_count ?? 0,
        isMember: member,
        visibility: g.visibility === 'public' ? 'public' : 'community',
        lastMessageTime: member ? g.last_message_time ?? null : null,
      };
    };

    const boards = sortCommunityChannels(channelRows.map((g) => toChannel(g, false)));

    return {
      communityId,
      viewer: {
        isMember,
        source: membership?.source ?? null,
        role: membership
          ? resolveCommunityRole(membership.role, viewerId, community.created_by ?? null)
          : null,
      },
      lounge: loungeRow ? toChannel(loungeRow, true) : null,
      loungeGroupId,
      boards,
      // @deprecated one release only — the identical array to `boards`, kept
      // so a client shipped before this deploy still renders.
      channels: boards,
      studyGroups: sortCommunityStudyGroups(studyGroupRows.map(toStudyGroup)),
      rooms,
      memberCount: community.member_count ?? 0,
      onlineCount,
    };
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

  /**
   * The roster, keyset-paged by (joined_at, user_id). The cursor is taken
   * from the last RAW row, before privacy filtering, so a page may come back
   * shorter than `limit` while `nextCursor` is still set — clients keep paging
   * until it is null.
   */
  async listMembers(
    viewerId: string,
    communityId: string,
    opts: { limit?: number; cursor?: string } = {}
  ): Promise<CommunityMembersPage> {
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
    const limit = this.clampMembersLimit(opts.limit);
    const cursor = opts.cursor ? decodeMembersCursor(opts.cursor) : null;

    // Owner badge needs the creator; membership already proved the row exists.
    const community = await this.selectCommunity<{ created_by?: string | null }>(
      'id, created_by',
      { column: 'id', value: communityId }
    );
    const createdBy = community?.created_by ?? null;

    let query = this.db
      .from('community_members')
      .select(
        'user_id, source, role, joined_at, profiles!inner(id, name, avatar_url, programme, settings, last_seen_at)'
      )
      .eq('community_id', communityId)
      .is('opted_out_at', null);
    if (cursor) {
      query = query.or(
        `joined_at.gt.${cursor.joinedAt},and(joined_at.eq.${cursor.joinedAt},user_id.gt.${cursor.userId})`
      );
    }
    const { data, error } = await query
      .order('joined_at', { ascending: true })
      .order('user_id', { ascending: true })
      .limit(limit);
    if (error) throw error;
    const rawRows = (data || []) as any[];
    const last = rawRows.length === limit ? rawRows[rawRows.length - 1] : null;
    const nextCursor =
      last && last.joined_at && last.user_id
        ? encodeMembersCursor(String(last.joined_at), String(last.user_id))
        : null;

    const blocked = await this.supabaseService.listBlockedUserIds(viewerId).catch(() => []);
    const blockedSet = new Set(blocked || []);

    const members = rawRows
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

        const row: CommunityMember = {
          id: p.id,
          name: p.name,
          avatarUrl: p.avatar_url ?? null,
          programme: p.programme ?? null,
          role: resolveCommunityRole(r.role, p.id, createdBy),
          source: r.source === 'joined' ? 'joined' : 'auto',
          joinedAt: String(r.joined_at ?? ''),
          onlineStatus: resolvePublicOnlineStatus(p.settings, p.last_seen_at ?? null),
        };
        return row;
      })
      .filter(Boolean) as CommunityMember[];

    return { members, nextCursor };
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
      const vis = communityPageGroupVisibilities(myCommunityIds.includes(opts.communityId));
      query = query.eq('community_id', opts.communityId).in('visibility', vis);
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
    opts: { q?: string; institutionId?: string; courseId?: string; limit?: number } = {}
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
    const needle = opts.q?.trim().toLowerCase();
    const filtered = needle
      ? mapped.filter((row) => String(row.name || '').toLowerCase().includes(needle))
      : mapped;
    return filtered.slice(0, limit).map(({ _sameCampus, ...rest }) => rest);
  }

  /**
   * Join a group that Discover already showed this viewer. Private groups stay
   * invite-link only — this must not become a back door into them.
   */
  async joinDiscoverableGroup(
    userId: string,
    groupId: string
  ): Promise<{ joined: true }> {
    this.assertUuid(groupId, 'group id');
    const { data: group, error } = await this.db
      .from('groups')
      .select('id, name, visibility, community_id, is_archived')
      .eq('id', groupId)
      .maybeSingle();
    if (error) throw error;
    if (!group || (group as { is_archived?: boolean }).is_archived) {
      throw Object.assign(new PublicError('Group not found'), { statusCode: 404 });
    }

    const discovery = resolveGroupDiscovery({
      visibility: (group as { visibility?: 'private' | 'community' | 'public' }).visibility,
      communityId: (group as { community_id?: string | null }).community_id,
    });
    if (discovery.visibility === 'private') {
      throw Object.assign(new PublicError('This group is invite only'), { statusCode: 403 });
    }
    if (discovery.visibility === 'community') {
      const mine = await this.listMine(userId);
      if (!mine.some((c) => c.id === discovery.communityId)) {
        throw Object.assign(new PublicError('Join this community first'), { statusCode: 403 });
      }
    }

    const { error: upsertError } = await this.db.from('group_members').upsert(
      { group_id: groupId, user_id: userId, pending: false },
      { onConflict: 'group_id,user_id' }
    );
    if (upsertError) throw upsertError;

    await cacheService.deletePattern(`groups:discover:*`);
    await cacheService.deletePattern(`groups:user:*`);
    await cacheService.deletePattern('groups:list:*');
    await cacheService.deletePattern(`group:${groupId}:*`);
    await cacheService.deletePattern(`user:groups:${userId}:*`);

    try {
      const { getActivityFeedService } = await import('./activityFeed');
      await getActivityFeedService(this.supabaseService).record({
        actorId: userId,
        verb: 'joined_group',
        objectType: 'group',
        objectId: groupId,
        audienceType: 'group',
        audienceId: groupId,
        payload: { groupName: (group as { name?: string }).name ?? null },
      });
    } catch (err) {
      logger.warn('discover group join feed write skipped', {
        userId,
        groupId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { joined: true };
  }
}

let service: CommunitiesService | null = null;

export function getCommunitiesService(supabaseService: SupabaseService): CommunitiesService {
  if (!service) service = new CommunitiesService(supabaseService);
  return service;
}
