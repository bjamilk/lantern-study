/**
 * How long a test session actually took.
 *
 * A session can be paused and resumed, and its `startTime` is the moment the
 * FIRST run began — it is the draft's `start_time` and the attempt's
 * `startedAt`, so it must keep meaning that. Measuring `now - startTime` on
 * submit therefore billed the reader for every hour the draft sat paused: a
 * three-question quiz resumed the next morning reported "439m 6s".
 *
 * The duration is instead accumulated: seconds banked from earlier runs, plus
 * the wall time of the run that is submitting. Nothing here imports a store or
 * a native module, so it is unit-tested directly (jest runs on `node`).
 */

/** Non-finite / negative inputs are treated as 0 rather than poisoning a total. */
function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export interface ActiveElapsedInput {
  /** Active seconds already banked by earlier runs of this session. */
  bankedSeconds: number;
  /** Epoch ms at which the CURRENT run started (first start, or the resume). */
  runStartedAtMs: number;
  /** Epoch ms now. */
  nowMs: number;
}

/**
 * Total active seconds for a session, rounded to whole seconds.
 *
 * A clock that has gone backwards contributes 0 for the current run rather
 * than subtracting from what was already banked.
 */
export function activeElapsedSeconds({
  bankedSeconds,
  runStartedAtMs,
  nowMs,
}: ActiveElapsedInput): number {
  const banked = seconds(bankedSeconds);
  const runMs =
    Number.isFinite(runStartedAtMs) && Number.isFinite(nowMs)
      ? Math.max(0, nowMs - runStartedAtMs)
      : 0;
  return Math.round(banked + runMs / 1000);
}

/**
 * Seconds to bank when resuming, from the per-question timings the draft
 * already persists.
 *
 * This is deliberately the only source: `user_answers[qid].timeSpentSeconds`
 * is written on every autosave, so it needs no new column, no new config key
 * and no server change. It counts time spent ON questions, so a run that was
 * paused before anything was answered banks 0 — an undercount, never the
 * hours-long overcount it replaces.
 */
export function bankedSecondsFromTimings(
  timings: Record<string, number | undefined> | null | undefined
): number {
  if (!timings || typeof timings !== 'object') return 0;
  return Object.values(timings).reduce<number>((sum, value) => sum + seconds(value), 0);
}

/**
 * Per-question timings recovered from a draft's `user_answers` map, so a
 * resumed session keeps the time-per-question chart it had already earned.
 */
export function timingsFromDraftAnswers(
  userAnswers: Record<string, unknown> | null | undefined
): Record<string, number> {
  const timings: Record<string, number> = {};
  if (!userAnswers || typeof userAnswers !== 'object') return timings;
  for (const [questionId, record] of Object.entries(userAnswers)) {
    if (!record || typeof record !== 'object') continue;
    const raw =
      (record as { timeSpentSeconds?: unknown }).timeSpentSeconds ??
      (record as { time_spent_seconds?: unknown }).time_spent_seconds;
    const value = seconds(raw);
    if (value > 0) timings[questionId] = value;
  }
  return timings;
}
