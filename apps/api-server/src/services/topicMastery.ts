/**
 * The Mastery Graph (Phase 3 · P).
 *
 * Until now, per-topic performance existed only on the CLIENT
 * (packages/shared/src/utils/buildDashboardStats.ts buildTopicPerformance and
 * the mobile getDeckCardStats). The server therefore never knew which topics a
 * student was weak on — which is why `companionContext` read a `tagBreakdown`
 * that nothing produced, and why /ai/study-recommendations ran on thin inputs.
 *
 * This service owns the materialised `user_topic_mastery` rows. The heavy walk
 * over `test_sessions.questions` happens in SQL (refresh_user_topic_mastery),
 * not here: pulling every session's jsonb into Node to tally tags would move
 * megabytes per refresh and block the event loop.
 *
 * Refresh is DEBOUNCED. A student finishing a 40-question test triggers one
 * refresh, not forty; and a refresh is never on the critical path of the write
 * that triggered it.
 */
import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';
import {
  computeCourseReadiness,
  type CourseReadiness,
} from '@lantern/shared/network';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A topic needs this much evidence before it can be called weak. */
export const WEAK_TOPIC_MIN_ATTEMPTS = 3;
/** Mastery strictly below this (0-100) counts as weak. */
export const WEAK_TOPIC_MAX_SCORE = 60;
/** Minimum cohort before any population aggregate is served. */
export const MIN_COHORT = 20;
/** Debounce window — repeated refreshes for one user inside this collapse. */
const REFRESH_DEBOUNCE_MS = 30_000;

export interface TopicMasteryRow {
  topic: string;
  courseId: string | null;
  attempts: number;
  correct: number;
  accuracy: number;
  avgResponseS: number | null;
  lastAttemptAt: string | null;
  cardsTotal: number;
  cardsMature: number;
  cardsDue: number;
  leechCount: number;
  masteryScore: number | null;
}

export interface ExamReadiness {
  courseId: string;
  courseCode: string | null;
  examDate: string;
  daysUntil: number;
  topicsTracked: number;
  averageMastery: number | null;
  weakestTopics: string[];
}

function mapRow(row: any): TopicMasteryRow {
  return {
    topic: row.topic,
    courseId: row.course_id ?? null,
    attempts: row.attempts ?? 0,
    correct: row.correct ?? 0,
    accuracy: Number(row.accuracy ?? 0),
    avgResponseS: row.avg_response_s == null ? null : Number(row.avg_response_s),
    lastAttemptAt: row.last_attempt_at ?? null,
    cardsTotal: row.cards_total ?? 0,
    cardsMature: row.cards_mature ?? 0,
    cardsDue: row.cards_due ?? 0,
    leechCount: row.leech_count ?? 0,
    masteryScore: row.mastery_score == null ? null : Number(row.mastery_score),
  };
}

export class TopicMasteryService {
  private lastRefresh = new Map<string, number>();

  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /**
   * Recompute a user's mastery graph. Never throws — a stale graph must not
   * fail the test submission or review that triggered it.
   *
   * `force` skips the debounce for paths that must read fresh data immediately
   * (an explicit dashboard refresh), not for hot write paths.
   */
  async refresh(userId: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!userId || !UUID_RE.test(String(userId))) return;

    if (!opts.force) {
      const last = this.lastRefresh.get(userId) ?? 0;
      if (Date.now() - last < REFRESH_DEBOUNCE_MS) return;
    }
    this.lastRefresh.set(userId, Date.now());

    try {
      const { error } = await this.db.rpc('refresh_user_topic_mastery', {
        p_user_id: userId,
        p_session_limit: 200,
      });
      if (error) throw error;
    } catch (err) {
      // Clear the stamp so a transient failure does not suppress the next
      // attempt for the whole debounce window.
      this.lastRefresh.delete(userId);
      logger.warn('topic mastery refresh failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Fire-and-forget refresh for write paths that must not wait on it. */
  refreshAsync(userId: string): void {
    void this.refresh(userId);
  }

  async listForUser(
    userId: string,
    opts: { courseId?: string | null; limit?: number } = {}
  ): Promise<TopicMasteryRow[]> {
    const rawLimit = Number(opts.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.floor(rawLimit)) : 50;

    let query = this.db
      .from('user_topic_mastery')
      .select(
        'topic, course_id, attempts, correct, accuracy, avg_response_s, last_attempt_at, cards_total, cards_mature, cards_due, leech_count, mastery_score'
      )
      .eq('user_id', userId)
      .limit(limit);
    if (opts.courseId && UUID_RE.test(String(opts.courseId))) {
      query = query.eq('course_id', opts.courseId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  /**
   * Weakest topics with enough evidence to be worth naming. Rows with a NULL
   * mastery_score are EXCLUDED, not treated as zero: "we don't know yet" is not
   * the same as "you are bad at this", and telling a student the latter when we
   * mean the former is the fastest way to lose their trust in the companion.
   */
  async weakTopics(userId: string, limit = 5): Promise<TopicMasteryRow[]> {
    const { data, error } = await this.db
      .from('user_topic_mastery')
      .select(
        'topic, course_id, attempts, correct, accuracy, avg_response_s, last_attempt_at, cards_total, cards_mature, cards_due, leech_count, mastery_score'
      )
      .eq('user_id', userId)
      .not('mastery_score', 'is', null)
      .lt('mastery_score', WEAK_TOPIC_MAX_SCORE)
      .gte('attempts', WEAK_TOPIC_MIN_ATTEMPTS)
      .order('mastery_score', { ascending: true })
      .limit(Math.min(20, Math.max(1, Math.floor(Number(limit) || 5))));
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  /** Strongest topics — the other half of an honest picture. */
  async strongTopics(userId: string, limit = 5): Promise<TopicMasteryRow[]> {
    const { data, error } = await this.db
      .from('user_topic_mastery')
      .select(
        'topic, course_id, attempts, correct, accuracy, avg_response_s, last_attempt_at, cards_total, cards_mature, cards_due, leech_count, mastery_score'
      )
      .eq('user_id', userId)
      .not('mastery_score', 'is', null)
      .gte('attempts', WEAK_TOPIC_MIN_ATTEMPTS)
      .order('mastery_score', { ascending: false })
      .limit(Math.min(20, Math.max(1, Math.floor(Number(limit) || 5))));
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  /**
   * "16 days to your exam — biggest gain: ETC and gluconeogenesis."
   * Only courses with an exam date still ahead of us.
   */
  async examReadiness(userId: string): Promise<ExamReadiness[]> {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    const { data: enrolments, error } = await this.db
      .from('user_courses')
      .select('course_id, exam_date, courses!inner(id, code)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .not('exam_date', 'is', null)
      .gte('exam_date', todayIso)
      .order('exam_date', { ascending: true })
      .limit(10);
    if (error) throw error;
    if (!enrolments || enrolments.length === 0) return [];

    const courseIds = enrolments.map((e: any) => e.course_id);
    const { data: mastery } = await this.db
      .from('user_topic_mastery')
      .select('topic, course_id, mastery_score')
      .eq('user_id', userId)
      .in('course_id', courseIds)
      .limit(500);

    const byCourse = new Map<string, Array<{ topic: string; score: number | null }>>();
    for (const row of mastery || []) {
      const cid = (row as any).course_id;
      if (!cid) continue;
      if (!byCourse.has(cid)) byCourse.set(cid, []);
      byCourse.get(cid)!.push({
        topic: (row as any).topic,
        score: (row as any).mastery_score == null ? null : Number((row as any).mastery_score),
      });
    }

    return enrolments.map((e: any) => {
      const course = Array.isArray(e.courses) ? e.courses[0] : e.courses;
      const topics = byCourse.get(e.course_id) || [];
      const scored = topics.filter((t) => t.score != null) as Array<{ topic: string; score: number }>;
      const examDate = new Date(`${e.exam_date}T00:00:00Z`);
      const daysUntil = Math.max(
        0,
        Math.ceil((examDate.getTime() - today.getTime()) / 86_400_000)
      );

      return {
        courseId: e.course_id,
        courseCode: course?.code ?? null,
        examDate: e.exam_date,
        daysUntil,
        topicsTracked: topics.length,
        averageMastery: scored.length
          ? Math.round(scored.reduce((sum, t) => sum + t.score, 0) / scored.length)
          : null,
        weakestTopics: scored
          .sort((a, b) => a.score - b.score)
          .slice(0, 3)
          .map((t) => t.topic),
      };
    });
  }

  /**
   * Syllabus-aware readiness for every ACTIVE enrolled course — unlike
   * examReadiness above it does not require an exam date, so a brand-new
   * student sees their courses (and where to start) from day one. The
   * outline↔mastery bridge and all the arithmetic live in the shared
   * computeCourseReadiness so web, mobile and this API can never disagree.
   */
  async courseReadiness(
    userId: string,
    opts: { courseId?: string | null } = {}
  ): Promise<CourseReadiness[]> {
    const today = new Date();

    let enrolQuery = this.db
      .from('user_courses')
      .select('course_id, exam_date, courses!inner(id, code, title)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(12);
    if (opts.courseId && UUID_RE.test(String(opts.courseId))) {
      enrolQuery = enrolQuery.eq('course_id', opts.courseId);
    }
    const { data: enrolments, error } = await enrolQuery;
    if (error) throw error;
    if (!enrolments || enrolments.length === 0) return [];

    const courseIds = enrolments.map((e: any) => e.course_id);
    const [outlineResult, masteryResult] = await Promise.all([
      this.db
        .from('course_topics')
        .select('id, course_id, title, position')
        .in('course_id', courseIds)
        .limit(1000),
      this.db
        .from('user_topic_mastery')
        .select('topic, course_id, mastery_score, attempts, cards_total, cards_due')
        .eq('user_id', userId)
        .in('course_id', courseIds)
        .limit(1000),
    ]);
    if (outlineResult.error) throw outlineResult.error;
    if (masteryResult.error) throw masteryResult.error;

    const outlineByCourse = new Map<string, Array<{ id: string; title: string; position: number }>>();
    for (const row of outlineResult.data || []) {
      const cid = (row as any).course_id as string;
      if (!outlineByCourse.has(cid)) outlineByCourse.set(cid, []);
      outlineByCourse.get(cid)!.push({
        id: (row as any).id,
        title: (row as any).title,
        position: Number((row as any).position ?? 0),
      });
    }

    const masteryByCourse = new Map<
      string,
      Array<{ topic: string; masteryScore: number | null; attempts: number; cardsTotal: number; cardsDue: number }>
    >();
    for (const row of masteryResult.data || []) {
      const cid = (row as any).course_id as string | null;
      if (!cid) continue;
      if (!masteryByCourse.has(cid)) masteryByCourse.set(cid, []);
      masteryByCourse.get(cid)!.push({
        topic: (row as any).topic,
        masteryScore: (row as any).mastery_score == null ? null : Number((row as any).mastery_score),
        attempts: (row as any).attempts ?? 0,
        cardsTotal: (row as any).cards_total ?? 0,
        cardsDue: (row as any).cards_due ?? 0,
      });
    }

    const courses = enrolments.map((e: any) => {
      const course = Array.isArray(e.courses) ? e.courses[0] : e.courses;
      let daysUntil: number | null = null;
      if (e.exam_date) {
        const examDate = new Date(`${e.exam_date}T00:00:00Z`);
        daysUntil = Math.max(0, Math.ceil((examDate.getTime() - today.getTime()) / 86_400_000));
      }
      return computeCourseReadiness({
        courseId: e.course_id,
        courseCode: course?.code ?? null,
        courseTitle: course?.title ?? null,
        examDate: e.exam_date ?? null,
        daysUntil,
        outline: outlineByCourse.get(e.course_id) || [],
        mastery: masteryByCourse.get(e.course_id) || [],
      });
    });

    // Soonest exam first; date-less courses after, stable by code.
    return courses.sort((a, b) => {
      const da = a.daysUntil ?? Number.POSITIVE_INFINITY;
      const db = b.daysUntil ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return (a.courseCode ?? '').localeCompare(b.courseCode ?? '');
    });
  }

  /**
   * Population aggregate for a course, refused below the min cohort. The RPC
   * enforces the threshold too — this is defence in depth, not a duplicate:
   * the API must not be the only thing standing between a small class and a
   * re-identifiable per-topic breakdown.
   */
  async courseAggregate(courseId: string): Promise<Record<string, unknown>> {
    if (!courseId || !UUID_RE.test(String(courseId))) {
      return { available: false, reason: 'no_course' };
    }
    const { data, error } = await this.db.rpc('course_topic_mastery', {
      p_course_id: courseId,
      p_min_cohort: MIN_COHORT,
    });
    if (error) throw error;
    return (data || { available: false }) as Record<string, unknown>;
  }
}

let service: TopicMasteryService | null = null;

export function getTopicMasteryService(supabaseService: SupabaseService): TopicMasteryService {
  if (!service) service = new TopicMasteryService(supabaseService);
  return service;
}
