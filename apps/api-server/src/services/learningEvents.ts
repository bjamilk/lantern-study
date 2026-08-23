/**
 * learning_events — the append-only learning log (Phase 1 · C).
 *
 * Every emitter in the API funnels through `recordLearningEvent(s)`. The
 * contract (docs/phase1-learning-events-contract.md §3) is strict about one
 * thing: recording an event must NEVER fail the user action. So this module
 *   - coalesces sloppy input (undefined, '', non-uuid ids, NaN) to NULL,
 *   - batches inserts (≤ LEARNING_EVENTS_BATCH_CAP rows per statement),
 *   - catches and logs every failure (including "table missing" before the
 *     20260822150000 migration is applied) and resolves normally.
 *
 * Decision D9: these rows are PRODUCT data — written server-side regardless of
 * the analytics cookie, kept while the account exists, exported and deleted
 * with it (userDataLifecycle.ts). dataRetention.ts must NOT purge them.
 */
import type { Request } from 'express';
import type { SupabaseService } from './supabase';
import { logger } from '../utils/logger';
import {
  LEARNING_EVENT_TARGET_TYPES,
  LEARNING_EVENT_TYPES,
  LEARNING_SURFACE_HEADER,
  flashcardRatingToNumber,
  isUuidLike,
  parseQuestionBankListingId,
  type LearningEventInput,
  type LearningEventTargetType,
  type LearningEventType,
  type LearningSurface,
} from '@lantern/shared/learning';
import {
  isUserAnswerAttempted,
  normalizeStoredUserAnswers,
} from '@lantern/shared/utils/testHelpers';

export const LEARNING_EVENTS_TABLE = 'learning_events';
/** PostgREST bulk-insert chunk size. */
export const LEARNING_EVENTS_BATCH_CAP = 500;

const SMALLINT_MAX = 32767;
const INT_MAX = 2147483647;

/** Exact column shape written to public.learning_events (all keys always present — PostgREST bulk inserts need uniform objects). */
export interface LearningEventRow {
  user_id: string;
  event_type: LearningEventType;
  target_type: LearningEventTargetType | null;
  target_id: string | null;
  deck_id: string | null;
  group_id: string | null;
  note_id: string | null;
  course_id: string | null;
  session_id: string | null;
  listing_id: string | null;
  rating: number | null;
  is_correct: boolean | null;
  response_ms: number | null;
  confidence: number | null;
  attempt_no: number | null;
  count: number | null;
  srs_before: Record<string, unknown> | null;
  srs_after: Record<string, unknown> | null;
  surface: LearningSurface;
  occurred_at: string;
}

/** PostgREST/Postgres "relation does not exist" — i.e. migration not applied yet. */
export function isMissingRelationError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /does not exist|could not find the table/i.test(error.message || '')
  );
}

/** 'web' | 'mobile' pass through; anything else (missing, typo, server-side caller) is 'api'. */
export function normalizeSurface(value: unknown): LearningSurface {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'web' || v === 'mobile' ? v : 'api';
}

/** Read `x-lantern-surface` from a request (works with Express requests and plain header bags). */
export function surfaceFromRequest(
  req: Pick<Request, 'header'> | { headers?: Record<string, unknown> } | null | undefined
): LearningSurface {
  if (!req) return 'api';
  try {
    const viaFn = typeof (req as Request).header === 'function'
      ? (req as Request).header(LEARNING_SURFACE_HEADER)
      : undefined;
    if (viaFn != null) return normalizeSurface(viaFn);
    const headers = (req as { headers?: Record<string, unknown> }).headers;
    const raw = headers ? headers[LEARNING_SURFACE_HEADER] : undefined;
    return normalizeSurface(Array.isArray(raw) ? raw[0] : raw);
  } catch {
    return 'api';
  }
}

function uuidOrNull(value: unknown): string | null {
  return isUuidLike(value) ? value.toLowerCase() : null;
}

function textOrNull(value: unknown, max = 256): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function intOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  if (n < min || n > max) return null;
  return n;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function jsonObjectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isoOrNow(value: unknown): string {
  if (typeof value === 'string' && value) {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return new Date().toISOString();
}

/**
 * Coalesce an emitter's input to the exact DB row. Returns null (and the
 * caller drops the row) only when the row could never be valid: no uuid
 * user_id or an unknown event_type.
 */
export function toLearningEventRow(input: LearningEventInput): LearningEventRow | null {
  const userId = uuidOrNull(input?.userId);
  if (!userId) return null;
  const eventType = input.eventType;
  if (!(LEARNING_EVENT_TYPES as readonly string[]).includes(eventType)) return null;
  const targetType =
    input.targetType && (LEARNING_EVENT_TARGET_TYPES as readonly string[]).includes(input.targetType)
      ? input.targetType
      : null;

  return {
    user_id: userId,
    event_type: eventType,
    target_type: targetType,
    target_id: textOrNull(input.targetId),
    deck_id: uuidOrNull(input.deckId),
    group_id: uuidOrNull(input.groupId),
    note_id: uuidOrNull(input.noteId),
    course_id: uuidOrNull(input.courseId),
    session_id: uuidOrNull(input.sessionId),
    listing_id: uuidOrNull(input.listingId),
    rating: intOrNull(input.rating, 1, 4),
    is_correct: boolOrNull(input.isCorrect),
    response_ms: intOrNull(input.responseMs, 0, INT_MAX),
    confidence: intOrNull(input.confidence, 0, SMALLINT_MAX),
    attempt_no: intOrNull(input.attemptNo, 0, SMALLINT_MAX),
    count: intOrNull(input.count, 0, INT_MAX),
    srs_before: jsonObjectOrNull(input.srsBefore),
    srs_after: jsonObjectOrNull(input.srsAfter),
    surface: normalizeSurface(input.surface),
    occurred_at: isoOrNow(input.occurredAt),
  };
}

let warnedMissingTable = false;

/**
 * Batch-insert learning events. Never throws; returns how many rows were
 * written (0 on any failure). Rows that cannot be valid are dropped silently
 * (they are the emitter's bug, not the student's problem).
 */
export async function recordLearningEvents(
  service: Pick<SupabaseService, 'getClient'>,
  inputs: ReadonlyArray<LearningEventInput>
): Promise<number> {
  let rows: LearningEventRow[];
  try {
    rows = (inputs || [])
      .map((input) => toLearningEventRow(input))
      .filter((row): row is LearningEventRow => row !== null);
  } catch (err) {
    logger.warn('learning_events: failed to build rows', { err });
    return 0;
  }
  if (rows.length === 0) return 0;

  let written = 0;
  try {
    const client = service.getClient();
    for (let i = 0; i < rows.length; i += LEARNING_EVENTS_BATCH_CAP) {
      const chunk = rows.slice(i, i + LEARNING_EVENTS_BATCH_CAP);
      const { error } = await client.from(LEARNING_EVENTS_TABLE).insert(chunk);
      if (error) {
        if (isMissingRelationError(error)) {
          if (!warnedMissingTable) {
            warnedMissingTable = true;
            logger.warn(
              'learning_events table is missing; run migration 20260822150000_learning_events_and_concepts.sql'
            );
          }
          return written;
        }
        logger.warn('learning_events: insert failed', {
          code: error.code,
          message: error.message,
          rows: chunk.length,
          eventTypes: Array.from(new Set(chunk.map((r) => r.event_type))),
        });
        return written;
      }
      written += chunk.length;
    }
  } catch (err) {
    logger.warn('learning_events: insert threw', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return written;
}

/** Single-row convenience over recordLearningEvents (same never-throws contract). */
export async function recordLearningEvent(
  service: Pick<SupabaseService, 'getClient'>,
  input: LearningEventInput
): Promise<number> {
  return recordLearningEvents(service, [input]);
}

/** decks.course_id for course attribution on card events; null on any failure. */
/**
 * Deck owner + course in ONE round trip (Phase 3 · M/O).
 *
 * reviewFlashcard already spent a query on lookupDeckCourseId; the deck OWNER
 * is needed there too (for the `deck_collaborated` learning connection and the
 * decks.study_count counter). Selecting both columns together keeps the hottest
 * path in the app at the same query count it had before.
 *
 * Never throws — a review must never fail on telemetry.
 */
export async function lookupDeckOwnerAndCourse(
  service: Pick<SupabaseService, 'getClient'>,
  deckId: unknown
): Promise<{ ownerId: string | null; courseId: string | null }> {
  if (!isUuidLike(deckId)) return { ownerId: null, courseId: null };
  try {
    const { data, error } = await service
      .getClient()
      .from('decks')
      .select('user_id, course_id')
      .eq('id', deckId)
      .maybeSingle();
    if (error || !data) return { ownerId: null, courseId: null };
    return {
      ownerId: uuidOrNull((data as { user_id?: unknown }).user_id),
      courseId: uuidOrNull((data as { course_id?: unknown }).course_id),
    };
  } catch {
    return { ownerId: null, courseId: null };
  }
}

export async function lookupDeckCourseId(
  service: Pick<SupabaseService, 'getClient'>,
  deckId: unknown
): Promise<string | null> {
  if (!isUuidLike(deckId)) return null;
  try {
    const { data, error } = await service
      .getClient()
      .from('decks')
      .select('course_id')
      .eq('id', deckId)
      .maybeSingle();
    if (error || !data) return null;
    return uuidOrNull((data as { course_id?: unknown }).course_id);
  } catch {
    return null;
  }
}

/** Build the `card_reviewed` input for SupabaseService.reviewFlashcard (kept here so the row shape has one owner). */
export function buildCardReviewedEvent(params: {
  userId: string;
  flashcardId: string;
  deckId?: string | null;
  courseId?: string | null;
  rating: unknown;
  srsBefore: unknown;
  srsAfter: unknown;
  surface?: LearningSurface | null;
  occurredAt?: string | null;
}): LearningEventInput {
  return {
    userId: params.userId,
    eventType: 'card_reviewed',
    targetType: 'flashcard',
    targetId: params.flashcardId,
    deckId: params.deckId ?? null,
    courseId: params.courseId ?? null,
    rating: flashcardRatingToNumber(params.rating),
    srsBefore: params.srsBefore ?? null,
    srsAfter: params.srsAfter ?? null,
    surface: params.surface ?? 'api',
    occurredAt: params.occurredAt ?? null,
  };
}

/** Raw test_sessions row fields the answer emitter reads. */
export interface TestSessionRowForEvents {
  id: string;
  user_id?: string;
  config?: Record<string, unknown> | null;
  questions?: unknown[] | null;
  user_answers?: unknown;
  course_id?: string | null;
  end_time?: string | null;
}

/**
 * One `question_answered` input per attempted answer in a test/study session.
 * group_id comes from config.groupId (uuid-validated — mobile drafts wrote
 * deckId/"custom-*" there), course_id from test_sessions.course_id ||
 * config.courseId, listing_id from config.bundleId ("qbank-<uuid>").
 */
export function buildQuestionAnsweredEvents(
  session: TestSessionRowForEvents,
  userId: string,
  surface: LearningSurface
): LearningEventInput[] {
  const config =
    session.config && typeof session.config === 'object' && !Array.isArray(session.config)
      ? (session.config as Record<string, unknown>)
      : {};
  const questions = Array.isArray(session.questions) ? session.questions : [];
  const answers = normalizeStoredUserAnswers(
    session.user_answers as Record<string, unknown> | unknown[] | undefined | null,
    questions as Array<{ id?: string }>
  );
  const occurredAt = typeof session.end_time === 'string' ? session.end_time : null;
  const courseId =
    (typeof session.course_id === 'string' && session.course_id) ||
    (typeof config.courseId === 'string' ? config.courseId : null);
  const listingId = parseQuestionBankListingId(config.bundleId);
  const groupId = typeof config.groupId === 'string' ? config.groupId : null;

  const events: LearningEventInput[] = [];
  for (const [key, answer] of Object.entries(answers)) {
    if (!isUserAnswerAttempted(answer)) continue;
    const questionId = answer.questionId || key;
    const spent = answer.timeSpentSeconds;
    events.push({
      userId,
      eventType: 'question_answered',
      targetType: 'question',
      targetId: questionId,
      sessionId: session.id,
      groupId,
      courseId,
      listingId,
      isCorrect: typeof answer.isCorrect === 'boolean' ? answer.isCorrect : null,
      responseMs:
        typeof spent === 'number' && Number.isFinite(spent) && spent >= 0
          ? Math.round(spent * 1000)
          : null,
      surface,
      occurredAt,
    });
  }
  return events;
}

/**
 * Emit the session's `question_answered` rows exactly once. Both completion
 * paths (completeTestDraft → createTestResult, and POST /tests/:id/results →
 * createTestResult) land here, and a client may legitimately call both for
 * one session, so the guard is a (user_id, session_id, event_type) existence
 * check. If the check itself fails we still insert — a duplicate row is
 * cheaper than a lost session.
 */
export async function recordTestSessionAnswers(
  service: Pick<SupabaseService, 'getClient'>,
  params: { session: TestSessionRowForEvents | null | undefined; userId: string; surface?: LearningSurface | null }
): Promise<{ inserted: number; skipped: boolean }> {
  const session = params.session;
  if (!session || !isUuidLike(session.id) || !isUuidLike(params.userId)) {
    return { inserted: 0, skipped: false };
  }
  const surface = normalizeSurface(params.surface);
  let events: LearningEventInput[];
  try {
    events = buildQuestionAnsweredEvents(session, params.userId, surface);
  } catch (err) {
    logger.warn('learning_events: failed to build question_answered rows', {
      sessionId: session.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { inserted: 0, skipped: false };
  }
  if (events.length === 0) return { inserted: 0, skipped: false };

  try {
    const { data, error } = await service
      .getClient()
      .from(LEARNING_EVENTS_TABLE)
      .select('id')
      .eq('user_id', params.userId)
      .eq('session_id', session.id)
      .eq('event_type', 'question_answered')
      .limit(1)
      .maybeSingle();
    if (!error && data) return { inserted: 0, skipped: true };
    if (error && isMissingRelationError(error)) return { inserted: 0, skipped: false };
  } catch {
    /* fall through and insert */
  }

  const inserted = await recordLearningEvents(service, events);

  // North-star metric (Phase 3 · O) — `group_question_answered`.
  //
  // Direction: the question's AUTHOR is the actor. In this product a group
  // QUESTION is practice material someone contributed, and answering it is how
  // a group-mate benefits — the same direction already used for
  // `question_voted` and `question_verified`. Writing the answerer as actor
  // would invert all three relative to each other.
  //
  // Placed after the once-per-session guard above, so a client calling both
  // completion paths cannot double-write.
  void recordGroupQuestionConnections(service, events, params.userId).catch(() => {});

  return { inserted, skipped: false };
}

/**
 * Credit the authors of the group questions this session answered.
 *
 * Best-effort and detached: a session result must never fail on a metric. The
 * question ids come from the session's own events, and only rows that really
 * are group QUESTIONs by another member produce a connection (the service drops
 * self-connections, so answering your own question is naturally ignored).
 */
async function recordGroupQuestionConnections(
  service: Pick<SupabaseService, 'getClient'>,
  events: LearningEventInput[],
  userId: string
): Promise<void> {
  const groupId = events.find((e) => e.groupId)?.groupId;
  // config.groupId is a raw client string — mobile historically wrote deckId or
  // "custom-*" there — so it must be uuid-validated before it reaches a query.
  if (!isUuidLike(groupId) || !isUuidLike(userId)) return;

  // targetId is `answer.questionId || key` — a RAW CLIENT STRING that is never
  // uuid-checked upstream (mobile has historically written non-uuid keys). It is
  // about to be compared against messages.id, a uuid column: a single non-uuid
  // in the list makes Postgres reject the WHOLE query with 22P02, and because
  // this function swallows errors the entire session's connections would vanish
  // silently. Filter, do not trust.
  const questionIds = [
    ...new Set(events.map((e) => e.targetId).filter((id): id is string => isUuidLike(id))),
  ].slice(0, 200);
  if (questionIds.length === 0) return;

  try {
    const { data, error } = await service
      .getClient()
      .from('messages')
      .select('id, sender_id')
      .eq('group_id', groupId)
      .eq('type', 'QUESTION')
      .in('id', questionIds);
    if (error) {
      // Do not swallow silently: the whole batch is lost here, and the only
      // symptom would be missing north-star rows with nothing to explain them.
      logger.warn('learning_connections: group question author lookup failed', {
        groupId,
        err: error.message,
      });
      return;
    }
    if (!data) return;

    const authors = [
      ...new Set(
        (data as Array<{ sender_id?: unknown }>)
          .map((row) => uuidOrNull(row.sender_id))
          .filter((id): id is string => !!id && id !== userId)
      ),
    ];
    // record() is one HTTP insert per call with no batching, so bound the
    // fan-out. A session touching more than this many DISTINCT askers is not a
    // real study session.
    if (authors.length === 0) return;
    const bounded = authors.slice(0, 25);

    const { getLearningConnectionsService } = await import('./learningConnections');
    const connections = getLearningConnectionsService(service as never);
    await Promise.all(
      bounded.map((authorId) =>
        connections.record({
          actorId: authorId,
          beneficiaryId: userId,
          kind: 'group_question_answered',
          objectType: 'question',
        })
      )
    );
  } catch {
    /* best-effort */
  }
}
