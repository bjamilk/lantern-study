/**
 * THE one rule for "how long does this session run", in minutes, 0 = no limit.
 *
 * There used to be two. The config sheet had its own (screens/tests/
 * testConfigRules), the store had this one, and GroupChatScreen had a third
 * written inline — which is what let a reader pick the Timer "None" chip,
 * watch Start Test honour it, and then land in the test under a 10:00
 * countdown: the group session path quietly substituted
 * `max(questionCount * 2, 5)` minutes for the choice the reader had made.
 *
 * Every caller now goes through this file, so "None" can only mean one thing.
 * Pure and import-free: mobile jest runs `**\/*.test.ts` on the node
 * environment and cannot transform a native module.
 *
 * UNITS. `timerDuration` is SECONDS everywhere current code writes it
 * (`minutes * 60`), but older mobile payloads stored MINUTES in the same key,
 * so a stored config can be ambiguous. Three defences, in order:
 *   1. `timerDurationMinutes` — the unambiguous field. Every session this
 *      build writes carries it (attempt config AND draft config), so nothing
 *      written from here on has to be guessed at.
 *   2. `timerDurationSeconds` — as unambiguous, for anything that spells it.
 *   3. `timerDuration` — guessed, and the guess is documented below.
 */

/** Anything a stored session/attempt/draft config can be. */
export type StoredTimerConfig = Record<string, any> | undefined | null;

/** The keys a timer choice can arrive under, most trustworthy first. */
const TIMER_KEYS = ['timerDurationMinutes', 'timerDurationSeconds', 'timerDuration'] as const;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Whether the payload expresses a timer choice AT ALL — 0 ("None") included.
 *
 * The distinction matters on resume: a config that says `timerDuration: 0` is
 * a reader who chose an untimed test, while a config with no timer key is a
 * payload that simply never recorded one. The first must stay untimed; the
 * second has to fall back to whatever else we know.
 */
export function hasStoredTimerChoice(config: StoredTimerConfig): boolean {
  if (!config) return false;
  return TIMER_KEYS.some((key) => finiteNumber(config[key]) !== null);
}

/**
 * Minutes recorded in a stored config. 0 = no limit (and 0 is a real answer,
 * never a "missing value" to paper over with a default).
 */
export function resolveAttemptTimeLimitMinutes(config: StoredTimerConfig): number {
  if (!config) return 0;

  const minutes = finiteNumber(config.timerDurationMinutes);
  if (minutes !== null) return Math.max(0, Math.round(minutes));

  const seconds = finiteNumber(config.timerDurationSeconds);
  if (seconds !== null) return seconds > 0 ? Math.ceil(seconds / 60) : 0;

  const raw = finiteNumber(config.timerDuration);
  if (raw === null || raw <= 0) return 0;

  // The guess, for legacy payloads only. Everything that writes this key
  // writes `minutes * 60`, so an exact multiple of 60 is seconds; anything
  // else (17, 45, 90) can only have been minutes. 60 and 120 stay genuinely
  // ambiguous — they are read as seconds, as they always were — which is why
  // (1) above exists.
  return raw % 60 === 0 ? Math.round(raw / 60) : Math.round(raw);
}

export interface TestTimeLimitInput {
  /** The timer chip the reader picked, in seconds. 0 = None. */
  timerDurationSeconds: number;
  /** The session that is actually being started. */
  sessionMode: 'test' | 'study';
  /**
   * The limit to fall back on when nothing was picked — a study session's
   * source test, say. Pass 0 when there is nothing to fall back to, which is
   * the honest answer for a session assembled out of chat messages.
   */
  fallbackMinutes: number;
}

/**
 * Minutes a session STARTS with. 0 means untimed.
 *
 * A study session never shows the Timer section, so nothing was chosen there
 * and the fallback stands. In a test the chip IS the choice, 0 included —
 * falling back on 0 (as both older rules did) turned "None" into "whatever we
 * felt like", silently timing a session the reader had asked to be untimed.
 */
export function resolveSessionTimeLimitMinutes(input: TestTimeLimitInput): number {
  const { timerDurationSeconds, sessionMode, fallbackMinutes } = input;
  if (sessionMode === 'study') {
    return Number.isFinite(fallbackMinutes) && fallbackMinutes > 0 ? Math.round(fallbackMinutes) : 0;
  }
  if (!Number.isFinite(timerDurationSeconds) || timerDurationSeconds <= 0) return 0;
  return Math.ceil(timerDurationSeconds / 60);
}

/**
 * Minutes a RESUMED session runs for.
 *
 * The clock restarts from what was left on it, so the remaining seconds are
 * the limit — except when the draft's own config says the session was untimed,
 * in which case no arithmetic on `remaining` may reintroduce a clock.
 */
export function resolveResumeTimeLimitMinutes(input: {
  mode: 'test' | 'study';
  remainingSeconds: number | null | undefined;
  config?: StoredTimerConfig;
}): number {
  if (input.mode !== 'test') return 0;
  // An explicit "None" in the draft outranks anything left on the clock.
  if (hasStoredTimerChoice(input.config) && resolveAttemptTimeLimitMinutes(input.config) === 0) {
    return 0;
  }
  const remaining = finiteNumber(input.remainingSeconds);
  if (remaining === null || remaining <= 0) return 0;
  return Math.ceil(remaining / 60);
}
