/**
 * Creator profiles, follows and creator_stats (Phase 2 · J).
 *
 * A creator is any user who publishes digital study products. This service
 * serves their public profile (academic line, bio, stats, packs), the follow
 * graph, and refreshes the materialised `creator_stats` row.
 *
 * SEC-08 invariant: a creator profile NEVER exposes earnings — only counts,
 * ratings, learners-helped and the trust level.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BIO_MAX_LENGTH = 280;

export interface CreatorStatsRow {
  active_packs: number;
  learners_helped: number;
  avg_rating: number;
  review_count: number;
  follower_count: number;
  following_count: number;
  trust_score: number;
  trust_level: string;
}

export class CreatorsService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private assertUuid(id: string, label = 'user id'): void {
    if (!id || !UUID_RE.test(String(id))) throw new PublicError(`Invalid ${label}`);
  }

  /** Blocks in EITHER direction hide the creator and refuse a follow. */
  private async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    // Both ids are interpolated into a PostgREST .or() filter, so they must be
    // proven uuids first — never trust a caller-supplied id here.
    if (!UUID_RE.test(String(a)) || !UUID_RE.test(String(b))) return false;
    const { data } = await this.db
      .from('user_blocks')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`
      )
      .limit(1);
    return !!(data && data.length > 0);
  }

  /**
   * Recompute a creator's materialised stats. Never throws — a stale counter
   * must not fail a publish/purchase/review that already succeeded.
   */
  async refreshStats(userId: string): Promise<void> {
    if (!userId || !UUID_RE.test(String(userId))) return;
    try {
      const { error } = await this.db.rpc('refresh_creator_stats', { p_user_id: userId });
      if (error) throw error;
    } catch (err) {
      logger.warn('creator_stats refresh failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async follow(followerId: string, followeeId: string): Promise<{ following: true }> {
    this.assertUuid(followeeId);
    if (followerId === followeeId) throw new PublicError('You cannot follow yourself');
    if (await this.isBlockedEitherWay(followerId, followeeId)) {
      throw Object.assign(new PublicError('You cannot follow this account'), { statusCode: 403 });
    }
    const { error } = await this.db
      .from('profile_follows')
      .upsert(
        { follower_id: followerId, followee_id: followeeId },
        { onConflict: 'follower_id,followee_id', ignoreDuplicates: true }
      );
    if (error) throw error;
    // Both sides' counters change.
    await Promise.all([this.refreshStats(followeeId), this.refreshStats(followerId)]);

    // Phase 3: a follow is both feed-worthy and a learning connection. Actor is
    // the FOLLOWEE — they are the one whose work reached someone new — which is
    // also why this is not symmetric with unfollow.
    const [{ getActivityFeedService }, { getLearningConnectionsService }] = await Promise.all([
      import('./activityFeed'),
      import('./learningConnections'),
    ]);
    await Promise.all([
      getActivityFeedService(this.supabaseService).record({
        actorId: followerId,
        verb: 'followed_creator',
        objectType: 'profile',
        objectId: followeeId,
        audienceType: 'followers',
      }),
      getLearningConnectionsService(this.supabaseService).record({
        actorId: followeeId,
        beneficiaryId: followerId,
        kind: 'followed',
        objectType: 'profile',
        objectId: followeeId,
      }),
    ]);
    return { following: true };
  }

  async unfollow(followerId: string, followeeId: string): Promise<{ following: false }> {
    this.assertUuid(followeeId);
    const { error } = await this.db
      .from('profile_follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('followee_id', followeeId);
    if (error) throw error;
    await Promise.all([this.refreshStats(followeeId), this.refreshStats(followerId)]);
    return { following: false };
  }

  async listFollowers(userId: string, page = 1, pageSize = 30, viewerId?: string) {
    this.assertUuid(userId);
    return this.listFollowGraph('followee_id', 'follower_id', userId, page, pageSize, viewerId);
  }

  async listFollowing(userId: string, page = 1, pageSize = 30, viewerId?: string) {
    this.assertUuid(userId);
    return this.listFollowGraph('follower_id', 'followee_id', userId, page, pageSize, viewerId);
  }

  private async listFollowGraph(
    matchColumn: 'follower_id' | 'followee_id',
    idColumn: 'follower_id' | 'followee_id',
    userId: string,
    page: number,
    pageSize: number,
    viewerId?: string
  ) {
    // NaN/garbage paging must not reach .range() (PostgREST 500s on it).
    const rawSize = Number(pageSize);
    const rawPage = Number(page);
    const size = Number.isFinite(rawSize) ? Math.min(Math.max(1, Math.floor(rawSize)), 50) : 30;
    const safePage = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
    const from = (safePage - 1) * size;
    const { data, error } = await this.db
      .from('profile_follows')
      .select(`${idColumn}, created_at`)
      .eq(matchColumn, userId)
      .order('created_at', { ascending: false })
      .range(from, from + size - 1);
    if (error) throw error;

    let ids = (data || []).map((r: any) => String(r[idColumn])).filter(Boolean);
    if (ids.length === 0) return [];

    // Never surface accounts the viewer has blocked (or that blocked them).
    if (viewerId && UUID_RE.test(String(viewerId))) {
      const { data: blocks } = await this.db
        .from('user_blocks')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
      const hidden = new Set<string>();
      for (const b of blocks || []) {
        const other =
          String((b as any).blocker_id) === viewerId
            ? String((b as any).blocked_id)
            : String((b as any).blocker_id);
        hidden.add(other);
      }
      ids = ids.filter((id) => !hidden.has(id));
      if (ids.length === 0) return [];
    }

    const { data: profiles } = await this.db
      .from('profiles')
      .select('id, name, username, avatar_url, verification_level')
      .in('id', ids);
    const byId = new Map((profiles || []).map((p: any) => [String(p.id), p]));
    return ids
      .map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        return {
          id,
          name: p.name || 'Student',
          username: p.username || null,
          avatarUrl: p.avatar_url || null,
          isVerified: Number(p.verification_level || 0) >= 2,
        };
      })
      .filter(Boolean);
  }

  /**
   * The public creator profile. `viewerId` decides `isFollowing` and whether
   * owner-only fields (followingCount) are included. Never returns earnings.
   */
  async getCreatorProfile(userId: string, viewerId?: string) {
    this.assertUuid(userId);
    const { data: profile, error } = await this.db
      .from('profiles')
      .select(
        'id, name, username, avatar_url, bio, institution_id, programme, study_level, verification_level'
      )
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) throw new PublicError('Creator not found');

    if (viewerId && viewerId !== userId && (await this.isBlockedEitherWay(viewerId, userId))) {
      throw Object.assign(new PublicError('Creator not found'), { statusCode: 404 });
    }

    // This endpoint is public (optionalAuth), so it must only ever serve
    // CREATORS — otherwise it becomes an open directory of every profile.
    // Owners may always view their own (empty) creator page.
    if (viewerId !== userId) {
      const { data: anyProduct } = await this.db
        .from('marketplace_listings')
        .select('id')
        .eq('user_id', userId)
        .in('listing_kind', ['study_pack', 'question_bank'])
        .limit(1);
      if (!anyProduct || anyProduct.length === 0) {
        throw Object.assign(new PublicError('Creator not found'), { statusCode: 404 });
      }
    }

    // Stats (materialised). A creator with no row yet reads as all-zero.
    const { data: statsRow } = await this.db
      .from('creator_stats')
      .select(
        'active_packs, learners_helped, avg_rating, review_count, follower_count, following_count, trust_score, trust_level'
      )
      .eq('user_id', userId)
      .maybeSingle();
    const stats = (statsRow || {}) as Partial<CreatorStatsRow>;

    let institution: string | null = null;
    if ((profile as any).institution_id) {
      const { data: campus } = await this.db
        .from('marketplace_campuses')
        .select('name')
        .eq('id', (profile as any).institution_id)
        .maybeSingle();
      institution = (campus as any)?.name || null;
    }

    let isFollowing = false;
    if (viewerId && viewerId !== userId) {
      const { data: follow } = await this.db
        .from('profile_follows')
        .select('follower_id')
        .eq('follower_id', viewerId)
        .eq('followee_id', userId)
        .maybeSingle();
      isFollowing = !!follow;
    }

    // Their active digital products (listing cards).
    const { data: listings } = await this.db
      .from('marketplace_listings')
      .select('id, title, price, images, listing_kind, course_id, created_at')
      .eq('user_id', userId)
      .in('listing_kind', ['study_pack', 'question_bank'])
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(24);

    return {
      id: profile.id,
      username: (profile as any).username || null,
      name: (profile as any).name || 'Student',
      avatarUrl: (profile as any).avatar_url || null,
      bio: (profile as any).bio || null,
      institution,
      programme: (profile as any).programme || null,
      studyLevel: (profile as any).study_level ?? null,
      stats: {
        activePacks: Number(stats.active_packs ?? 0),
        learnersHelped: Number(stats.learners_helped ?? 0),
        avgRating: Number(stats.avg_rating ?? 0),
        reviewCount: Number(stats.review_count ?? 0),
        followerCount: Number(stats.follower_count ?? 0),
        // Owner-only: how many people THEY follow.
        ...(viewerId === userId ? { followingCount: Number(stats.following_count ?? 0) } : {}),
      },
      isFollowing,
      isVerified: Number((profile as any).verification_level || 0) >= 2,
      trustLevel: String(stats.trust_level ?? 'new'),
      packs: (listings || []).map((l: any) => ({
        id: l.id,
        title: l.title,
        price: l.price,
        images: l.images || [],
        listingKind: l.listing_kind,
        courseId: l.course_id ?? null,
      })),
    };
  }

  /** Creators to discover, ranked by learners helped then rating. */
  async discoverCreators(options: { institutionId?: string; courseId?: string; limit?: number } = {}) {
    const rawLimit = Number(options.limit ?? 12);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 50) : 12;

    // Narrow to a candidate creator set FIRST when a filter is given, so the
    // filters actually shape the ranked page instead of thinning it afterwards.
    let candidateIds: string[] | null = null;
    const institutionId =
      options.institutionId && UUID_RE.test(options.institutionId) ? options.institutionId : null;
    const courseId = options.courseId && UUID_RE.test(options.courseId) ? options.courseId : null;

    if (courseId) {
      // Creators who publish for this course.
      const { data: courseListings } = await this.db
        .from('marketplace_listings')
        .select('user_id')
        .eq('course_id', courseId)
        .in('listing_kind', ['study_pack', 'question_bank'])
        .eq('status', 'active')
        .limit(500);
      candidateIds = Array.from(new Set((courseListings || []).map((l: any) => String(l.user_id))));
      if (candidateIds.length === 0) return [];
    }
    if (institutionId) {
      const q = this.db.from('profiles').select('id').eq('institution_id', institutionId).limit(500);
      const { data: instProfiles } = await (candidateIds ? q.in('id', candidateIds) : q);
      candidateIds = (instProfiles || []).map((p: any) => String(p.id));
      if (candidateIds.length === 0) return [];
    }

    let statsQuery = this.db
      .from('creator_stats')
      .select('user_id, active_packs, learners_helped, avg_rating, follower_count, trust_level')
      .gt('active_packs', 0);
    if (candidateIds) statsQuery = statsQuery.in('user_id', candidateIds);
    const { data: stats } = await statsQuery
      .order('learners_helped', { ascending: false })
      .order('avg_rating', { ascending: false })
      .limit(limit);

    const rows = (stats || []) as any[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => String(r.user_id));
    const { data: profiles } = await this.db
      .from('profiles')
      .select('id, name, username, avatar_url, institution_id, programme, verification_level')
      .in('id', ids);
    const byId = new Map((profiles || []).map((p: any) => [String(p.id), p]));

    return rows
      .slice(0, limit)
      .map((r) => {
        const p = byId.get(String(r.user_id));
        if (!p) return null;
        return {
          id: String(r.user_id),
          name: p.name || 'Student',
          username: p.username || null,
          avatarUrl: p.avatar_url || null,
          programme: p.programme || null,
          activePacks: Number(r.active_packs || 0),
          learnersHelped: Number(r.learners_helped || 0),
          avgRating: Number(r.avg_rating || 0),
          followerCount: Number(r.follower_count || 0),
          trustLevel: String(r.trust_level || 'new'),
          isVerified: Number(p.verification_level || 0) >= 2,
        };
      })
      .filter(Boolean);
  }

  /**
   * Verified v1 (decision D8): level 2 = confirmed email AND an active payout
   * profile; level 1 = confirmed email only. Cheap enough to run on profile reads.
   */
  async syncVerificationLevel(userId: string, emailConfirmedAt: string | null): Promise<number> {
    if (!userId || !UUID_RE.test(String(userId))) return 0;
    let level = 0;
    if (emailConfirmedAt) level = 1;
    if (level === 1) {
      const { data: payout } = await this.db
        .from('marketplace_seller_payout_profiles')
        .select('status')
        .eq('user_id', userId)
        .maybeSingle();
      if ((payout as any)?.status === 'active') level = 2;
    }
    await this.db
      .from('profiles')
      .update({ email_confirmed_at: emailConfirmedAt, verification_level: level })
      .eq('id', userId);
    return level;
  }

  /** Validate + store a creator bio (≤ 280 chars). */
  normalizeBio(raw: unknown): string | null {
    if (raw == null) return null;
    if (typeof raw !== 'string') throw new PublicError('Bio must be text');
    const bio = raw.trim();
    if (!bio) return null;
    if (bio.length > BIO_MAX_LENGTH) {
      throw new PublicError(`Bio must be ${BIO_MAX_LENGTH} characters or fewer`);
    }
    return bio;
  }
}

let service: CreatorsService | null = null;

export function getCreatorsService(supabaseService: SupabaseService): CreatorsService {
  if (!service) service = new CreatorsService(supabaseService);
  return service;
}
