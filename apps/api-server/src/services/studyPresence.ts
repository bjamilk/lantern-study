/**
 * Presence as INTENT (Phase 3 · M).
 *
 * The existing heartbeat answers "is this user online". This answers the
 * question that actually creates a network effect on a campus: "who else is
 * studying cardiology right now". Rows carry an expiry and readers filter on
 * it, so a crashed client stops counting within minutes without a sweeper.
 *
 * PRIVACY: this service is the enforcement point for `showStudyActivity` and
 * `showOnlineStatus`. A user with either switched off is never written into
 * study_presence — not written-and-filtered, NOT WRITTEN. Aggregate reads are
 * counts only and never name anybody unless the viewer shares a course with
 * them and they allow activity sharing.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  userSharesStudyActivity,
  userShowsOnlineStatus,
  normalizeUserSettings,
} from '@lantern/shared/settings';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRESENCE_CONTEXTS = ['studying', 'reviewing', 'testing', 'reading', 'writing'] as const;
export type PresenceContext = (typeof PRESENCE_CONTEXTS)[number];

/** How long one heartbeat keeps a user "present". */
export const PRESENCE_TTL_MINUTES = 10;
export const PRESENCE_TOPIC_MAX = 80;

export interface PresenceHeartbeatInput {
  context?: string;
  courseId?: string | null;
  topic?: string | null;
}

export interface PresenceSnapshot {
  total: number;
  byContext: Record<string, number>;
  topics: Array<{ topic: string; count: number }>;
  sharing: boolean;
}

export class StudyPresenceService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /**
   * True when this user has opted into sharing study activity. Defaults to the
   * product default (on) only when the setting is absent — an explicit false
   * always wins.
   */
  private async sharesActivity(
    userId: string
  ): Promise<{ shares: boolean; institutionId: string | null }> {
    const { data } = await this.db
      .from('profiles')
      .select('settings, institution_id')
      .eq('id', userId)
      .maybeSingle();
    // Reuse the shared predicates rather than reading the raw jsonb: the
    // defaults and the "explicit false wins" rule live in one place, and this
    // service must agree with what the settings screens promise the user.
    const settings = normalizeUserSettings((data as any)?.settings);
    const shares =
      userSharesStudyActivity(settings.privacy) && userShowsOnlineStatus(settings.privacy);
    return { shares, institutionId: (data as any)?.institution_id ?? null };
  }

  /**
   * Record what the user is studying. Returns `{ shared: false }` rather than
   * throwing when privacy settings opt them out, so the client can keep calling
   * the same endpoint without branching on settings it may not have synced.
   */
  async heartbeat(
    userId: string,
    input: PresenceHeartbeatInput = {}
  ): Promise<{ shared: boolean }> {
    const context = (PRESENCE_CONTEXTS as readonly string[]).includes(String(input.context))
      ? (input.context as PresenceContext)
      : 'studying';
    const courseId =
      input.courseId && UUID_RE.test(String(input.courseId)) ? String(input.courseId) : null;
    const topic =
      typeof input.topic === 'string' && input.topic.trim()
        ? input.topic.trim().slice(0, PRESENCE_TOPIC_MAX)
        : null;

    const { shares, institutionId } = await this.sharesActivity(userId);
    if (!shares) {
      // Opted out: make sure any row from before they flipped the setting is
      // gone, or they keep appearing in "who is studying now" forever.
      await this.db.from('study_presence').delete().eq('user_id', userId);
      return { shared: false };
    }

    const now = Date.now();
    const { error } = await this.db.from('study_presence').upsert(
      {
        user_id: userId,
        context,
        course_id: courseId,
        topic,
        institution_id: institutionId,
        updated_at: new Date(now).toISOString(),
        expires_at: new Date(now + PRESENCE_TTL_MINUTES * 60_000).toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    return { shared: true };
  }

  async clear(userId: string): Promise<void> {
    try {
      await this.db.from('study_presence').delete().eq('user_id', userId);
    } catch (err) {
      logger.warn('presence clear failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * "23 people studying cardiology tonight" — counts only, scoped to a course
   * or to the viewer's institution. Never returns identities.
   */
  async now(
    viewerId: string,
    opts: { courseId?: string | null; institutionId?: string | null } = {}
  ): Promise<PresenceSnapshot> {
    const courseId =
      opts.courseId && UUID_RE.test(String(opts.courseId)) ? String(opts.courseId) : null;

    let institutionId = opts.institutionId && UUID_RE.test(String(opts.institutionId))
      ? String(opts.institutionId)
      : null;
    const { shares } = await this.sharesActivity(viewerId);
    if (!courseId && !institutionId) {
      const { data: me } = await this.db
        .from('profiles')
        .select('institution_id')
        .eq('id', viewerId)
        .maybeSingle();
      institutionId = (me as any)?.institution_id ?? null;
    }

    if (!courseId && !institutionId) {
      return { total: 0, byContext: {}, topics: [], sharing: shares };
    }

    let query = this.db
      .from('study_presence')
      .select('user_id, context, topic')
      .gt('expires_at', new Date().toISOString())
      .neq('user_id', viewerId)
      .limit(500);
    if (courseId) query = query.eq('course_id', courseId);
    else if (institutionId) query = query.eq('institution_id', institutionId);

    const { data, error } = await query;
    if (error) throw error;

    const byContext: Record<string, number> = {};
    const topicCounts = new Map<string, number>();
    for (const row of data || []) {
      const ctx = (row as any).context || 'studying';
      byContext[ctx] = (byContext[ctx] || 0) + 1;
      const t = (row as any).topic;
      if (t) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
    }

    const topics = [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { total: (data || []).length, byContext, topics, sharing: shares };
  }

  assertContext(value: unknown): PresenceContext {
    if (!(PRESENCE_CONTEXTS as readonly string[]).includes(String(value))) {
      throw new PublicError('Invalid study context');
    }
    return value as PresenceContext;
  }
}

let service: StudyPresenceService | null = null;

export function getStudyPresenceService(supabaseService: SupabaseService): StudyPresenceService {
  if (!service) service = new StudyPresenceService(supabaseService);
  return service;
}
