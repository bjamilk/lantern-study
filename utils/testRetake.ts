import type { TestConfig, TestQuestion, TestResult, TestSessionData } from '../types';
import { attemptKindFromConfig } from './testBuilder';

/**
 * Retaking a test the student has already sat.
 *
 * The defect this exists to close: the tests list returns LEAN rows — a score,
 * a date, a session id, and no questions, because the server only mirrors
 * questions onto rows that are launchable. Retake read `result.session.questions`
 * straight off that lean row, found an empty array, and told the student
 * "Question data is no longer available for this test" — for every attempt in
 * their history, including yesterday's. The data was never gone; it was simply
 * never asked for.
 *
 * So the plan is three-state, not two: a row that already carries its questions
 * is ready; a row that does not but knows its session id needs one fetch first;
 * only a row with neither is genuinely unavailable.
 */

export type RetakePlan =
  /** The questions are in hand — start immediately. */
  | { kind: 'ready'; questions: TestQuestion[]; config: TestConfig; title: string }
  /** Lean row: fetch `GET /tests/:id`, then plan again on what comes back. */
  | { kind: 'fetch'; sessionId: string }
  /** Nothing to fetch and nothing to replay. */
  | { kind: 'unavailable'; reason: string };

/** The id a lean row can be re-fetched by, if it has one. */
export function retakeSessionId(result: Pick<TestResult, 'id' | 'session'>): string | null {
  const sessionId = result.session?.id;
  if (typeof sessionId === 'string' && sessionId.trim() !== '') return sessionId;
  const rowId = result.id;
  if (typeof rowId === 'string' && rowId.trim() !== '') return rowId;
  return null;
}

/**
 * Locally-created sessions never existed on the server, so there is nothing to
 * fetch for them and asking would 404. They are only replayable while their
 * questions are still in hand.
 */
function isFetchableId(id: string): boolean {
  return !id.startsWith('local-') && !id.startsWith('offline-');
}

export function planRetake(
  result: Pick<TestResult, 'id' | 'session'> | null | undefined,
  /** True once a fetch has already been tried, so a second empty answer is final. */
  options: { alreadyFetched?: boolean } = {}
): RetakePlan {
  if (!result || !result.session) {
    return { kind: 'unavailable', reason: 'That attempt could not be opened.' };
  }
  const questions = Array.isArray(result.session.questions) ? result.session.questions : [];
  if (questions.length > 0) {
    const config = result.session.config ?? ({ groupId: '' } as TestConfig);
    return {
      kind: 'ready',
      questions,
      config,
      title: retakeTitle(result.session),
    };
  }
  const sessionId = retakeSessionId(result);
  if (!options.alreadyFetched && sessionId && isFetchableId(sessionId)) {
    return { kind: 'fetch', sessionId };
  }
  return {
    kind: 'unavailable',
    reason: options.alreadyFetched
      ? 'This attempt no longer has its questions stored, so it cannot be retaken. You can make a new test from the same source.'
      : 'This attempt was only ever on this device, and its questions are gone. You can make a new test from the same source.',
  };
}

/** What to call the retake. Never "Unknown Group" — one name, "Test". */
export function retakeTitle(session: Pick<TestSessionData, 'config' | 'title'>): string {
  const fromConfig =
    session.config?.sourceNoteTitle ||
    session.config?.sourceDeckTitle ||
    session.config?.groupName;
  const title = session.title || fromConfig;
  return (typeof title === 'string' && title.trim()) || 'Test';
}

/**
 * Build the fresh session a retake runs in.
 *
 * The order is re-shuffled (a retake that asks the same questions in the same
 * order measures recall of the order), answers start empty, and the timer is
 * re-armed from the original config so a timed test stays timed.
 *
 * The session kind comes from the config too: a test the student built as
 * practice is sat as practice every time it is opened, not just the first. That
 * is what makes the builder's promise ("answers revealed as you go") true on
 * the launch that actually happens, which is always this one — a generated test
 * is opened from a link or a notification, never from the builder's own state.
 */
export function buildRetakeSession(
  plan: Extract<RetakePlan, { kind: 'ready' }>,
  options: {
    shuffle?: (questions: TestQuestion[]) => TestQuestion[];
    now?: Date;
  } = {}
): TestSessionData {
  const now = options.now ?? new Date();
  // The shuffler gets a COPY: an in-place shuffler (`qs => qs.reverse()`) would
  // otherwise reorder the stored attempt the student is retaking from.
  const questions = options.shuffle ? options.shuffle([...plan.questions]) : [...plan.questions];
  const timerSeconds = plan.config?.timerDuration;
  const isPractice = attemptKindFromConfig(plan.config) === 'practice';
  return {
    config: plan.config,
    questions,
    userAnswers: {},
    currentQuestionIndex: 0,
    startTime: now,
    // A practice attempt is never on a clock, whatever a stale config says.
    endTime: !isPractice && timerSeconds ? new Date(now.getTime() + timerSeconds * 1000) : undefined,
    sessionKind: isPractice ? 'study' : 'test',
    status: 'in_progress',
    title: plan.title,
  };
}
