/**
 * Confidence-before-reveal, honest tallies, and question provenance.
 *
 * Three review rules from spec v3 §5.7 live here, all as pure functions so
 * mobile jest (node env) can exercise them without a navigator, a store or a
 * theme:
 *
 *   1. On a PRACTICE attempt the reader commits to "Sure" or "Not sure" before
 *      the answer is revealed, and the pair (correct × confidence) is what the
 *      review reports — `Locked in`, `Lucky`, `Slipped`, `Learning`. Founder
 *      decision (spec §9 #5): practice only. A TIMED attempt is an exam and
 *      stays exactly as plain as it was, so the JAMB/WAEC presets keep shape.
 *   2. An unanswered question is NOT a wrong answer. StudyFetch reports 17
 *      blanks as "Missed" and calls the result 10%; `tallyAttempt` keeps the
 *      three counts apart so the results screen can say what really happened.
 *   3. A reviewed question says where it came from, so "why am I being asked
 *      this?" has an answer one tap away.
 *
 * Nothing in this module imports anything — not React, not the store, not the
 * theme. That is deliberate: it is the contract the screens agree on, and the
 * only place these rules are written down once.
 */

// ─── 1. Confidence ────────────────────────────────────────

/** What the reader commits to before the answer is shown. */
export type ConfidenceLevel = 'sure' | 'unsure';

/**
 * The four honest outcomes of (correct × confidence), plus the two a plain
 * attempt can produce and the blank.
 *
 * `correct` / `incorrect` are what an attempt with no confidence recorded
 * reports — a timed exam, or a practice question the reader skipped the
 * commitment on. They are never dressed up as `locked_in` / `slipped`:
 * claiming a confidence the reader never gave is the dishonest version of
 * this feature.
 */
export type ReviewOutcome =
  | 'locked_in'
  | 'lucky'
  | 'slipped'
  | 'learning'
  | 'correct'
  | 'incorrect'
  | 'unanswered';

/**
 * How one outcome is presented.
 *
 * `label` and `icon` both carry the meaning, because spec §5.6's honesty rule
 * is that colour is never the only signal: a badge that is merely green says
 * nothing to a reader who cannot see green, and nothing at all in a
 * screenshot. `detail` is the sentence under it — what the pair actually
 * means for revision, which is the whole reason to ask.
 */
export interface ReviewOutcomePresentation {
  label: string;
  /** AppIcon name. */
  icon: string;
  detail: string;
}

export const REVIEW_OUTCOMES: Record<ReviewOutcome, ReviewOutcomePresentation> = {
  locked_in: {
    label: 'Locked in',
    icon: 'lock-closed',
    detail: 'Right, and you knew it. Safe to move past.',
  },
  lucky: {
    label: 'Lucky',
    icon: 'help-circle',
    detail: 'Right, but you were not sure. Revisit before the exam.',
  },
  slipped: {
    label: 'Slipped',
    icon: 'alert-circle',
    detail: 'Wrong while you felt sure — the most expensive kind. Read the rationale.',
  },
  learning: {
    label: 'Learning',
    icon: 'school',
    detail: 'Wrong and you knew you were guessing. This is new ground, not a slip.',
  },
  correct: { label: 'Correct', icon: 'checkmark-circle', detail: '' },
  incorrect: { label: 'Incorrect', icon: 'close-circle', detail: '' },
  unanswered: {
    label: 'Not answered',
    icon: 'remove-circle',
    detail: 'Left blank — this is not counted as a wrong answer.',
  },
};

/**
 * The outcome to report for one reviewed question.
 *
 * Blank beats everything: a question with no answer is `unanswered` even when
 * the grader wrote `isCorrect: false` onto it, which is precisely the
 * "unanswered ≠ missed" defect. Confidence is used only when it was actually
 * recorded.
 */
export function classifyReviewOutcome(input: {
  isCorrect: boolean;
  answered: boolean;
  confidence?: ConfidenceLevel | null;
}): ReviewOutcome {
  if (!input.answered) return 'unanswered';
  if (input.confidence === 'sure') return input.isCorrect ? 'locked_in' : 'slipped';
  if (input.confidence === 'unsure') return input.isCorrect ? 'lucky' : 'learning';
  return input.isCorrect ? 'correct' : 'incorrect';
}

/**
 * Is this attempt a practice attempt — the only kind that asks for confidence?
 *
 * Two independent disqualifiers, either of which is enough:
 *   - a time limit. A countdown makes it an exam whatever it is called, and
 *     the founder decision keeps exams plain. `timeLimitMinutes` of 0, null or
 *     undefined all mean "no limit"; only a positive number is a limit.
 *   - an explicit exam mode, so a future timed-but-paused format cannot slip
 *     through on a zero.
 *
 * Everything else — mobile's untimed `test`, `study`, and web's `practice` —
 * is quiz-style practice and gets the prompt.
 */
export function isPracticeAttempt(input: {
  mode?: string | null;
  timeLimitMinutes?: number | null;
}): boolean {
  const limit = input.timeLimitMinutes;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) return false;
  const mode = (input.mode || '').toLowerCase();
  if (mode === 'exam' || mode === 'timed') return false;
  return true;
}

// ─── 2. Unanswered ≠ missed ───────────────────────────────

/**
 * Did the reader actually put something here?
 *
 * The stored answer is one of three shapes (a string, a list of option texts,
 * a prompt→answer map), and every one of them has an empty value that is NOT
 * an answer: `''`, `[]`, `{}`. Counting those as attempts is what let an
 * abandoned session be reported as a 10%.
 */
export function isAnswerProvided(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.some((entry) => isAnswerProvided(entry));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) => isAnswerProvided(entry));
  }
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/** One reviewed row, reduced to what the tally needs. */
export interface TallyRow {
  isCorrect: boolean;
  userAnswer?: unknown;
}

export interface AttemptTally {
  total: number;
  /** Questions the reader put an answer to. */
  answered: number;
  correct: number;
  /** Answered AND wrong. Never includes a blank. */
  incorrect: number;
  unanswered: number;
  /** Correct as a share of ALL questions — the graded score. */
  scorePercentage: number;
  /**
   * Correct as a share of the questions ANSWERED, or null when none were.
   * This is the number a reader who ran out of time actually wants.
   */
  accuracyPercentage: number | null;
  /** Some questions were left blank, so `scorePercentage` is not accuracy. */
  isPartial: boolean;
  /** Nothing was answered at all: there is no score to report, only a fact. */
  isAbandoned: boolean;
}

export function tallyAttempt(rows: readonly TallyRow[]): AttemptTally {
  const total = rows.length;
  let answered = 0;
  let correct = 0;
  for (const row of rows) {
    const didAnswer = isAnswerProvided(row.userAnswer);
    if (didAnswer) answered += 1;
    // A grader can only mark something right if there was something there.
    if (didAnswer && row.isCorrect) correct += 1;
  }
  const unanswered = total - answered;
  return {
    total,
    answered,
    correct,
    incorrect: answered - correct,
    unanswered,
    scorePercentage: total > 0 ? Math.round((correct / total) * 100) : 0,
    accuracyPercentage: answered > 0 ? Math.round((correct / answered) * 100) : null,
    isPartial: unanswered > 0,
    isAbandoned: total > 0 && answered === 0,
  };
}

/**
 * The percentage the results header shows. The stored figure and the answers
 * on the attempt can disagree: an attempt rehydrated from a server that had
 * not yet learned to score practice runs carries `percentage: 0` beside five
 * graded answers, and the header then says 0% above a sentence that says
 * "right on 50% of what you answered". The answers are the record of what
 * happened, so when they exist the header is derived from them; the stored
 * figure is used only when there is nothing else to go on.
 */
export function displayedScorePercentage(
  tally: Pick<AttemptTally, 'total' | 'scorePercentage'>,
  storedPercentage: number | null | undefined
): number {
  if (tally.total > 0) return tally.scorePercentage;
  return Math.max(0, Math.round(storedPercentage ?? 0));
}

/**
 * The one line that stops a blank from reading as a failure.
 *
 * Returns null when every question was answered — there is nothing to
 * qualify, and a caption that appears on a complete attempt is just noise.
 */
export function describeTally(tally: AttemptTally): string | null {
  if (tally.isAbandoned) {
    return `Not attempted — all ${tally.total} question${tally.total === 1 ? '' : 's'} left blank. This is not a score.`;
  }
  if (!tally.isPartial) return null;
  return (
    `${tally.unanswered} question${tally.unanswered === 1 ? '' : 's'} left blank, ` +
    `counted separately from the ${tally.incorrect} answered wrong. ` +
    `You were right on ${tally.accuracyPercentage}% of what you answered.`
  );
}

// ─── 3. Where a question came from ────────────────────────

export type QuestionSourceKind = 'note' | 'deck' | 'group';

export interface QuestionSource {
  kind: QuestionSourceKind;
  id: string;
  title: string;
  /** "From Cell Biology" — the chip's whole text. */
  label: string;
}

/** Whatever provenance a stored question snapshot happens to carry. */
export interface QuestionProvenanceLike {
  noteId?: string | null;
  noteTitle?: string | null;
  deckId?: string | null;
  deckName?: string | null;
}

/** The attempt's own provenance, used when the question carries none. */
export interface AttemptProvenanceLike {
  groupId?: string | null;
  groupName?: string | null;
  deckId?: string | null;
  deckName?: string | null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * Where this question came from, or null when nothing knows.
 *
 * Question-level provenance wins over attempt-level, because a session built
 * from several notes is exactly the case where the attempt's own name is the
 * least useful answer. A source with an id but no title still resolves — the
 * chip falls back to the kind — but a title with no id does not, because the
 * chip is a link and a link with nowhere to go is worse than no chip.
 */
export function resolveQuestionSource(input: {
  question?: QuestionProvenanceLike | null;
  attempt?: AttemptProvenanceLike | null;
}): QuestionSource | null {
  const q = input.question;
  const a = input.attempt;

  const noteId = firstNonEmpty(q?.noteId);
  if (noteId) {
    const title = firstNonEmpty(q?.noteTitle) || 'this note';
    return { kind: 'note', id: noteId, title, label: `From ${title}` };
  }

  const questionDeckId = firstNonEmpty(q?.deckId);
  if (questionDeckId) {
    const title = firstNonEmpty(q?.deckName) || 'this deck';
    return { kind: 'deck', id: questionDeckId, title, label: `From ${title}` };
  }

  const groupId = firstNonEmpty(a?.groupId);
  if (groupId) {
    const title = firstNonEmpty(a?.groupName) || 'this study group';
    return { kind: 'group', id: groupId, title, label: `From ${title}` };
  }

  const deckId = firstNonEmpty(a?.deckId);
  if (deckId) {
    const title = firstNonEmpty(a?.deckName) || 'this deck';
    return { kind: 'deck', id: deckId, title, label: `From ${title}` };
  }

  return null;
}

/**
 * The tab and screen a source chip opens.
 *
 * Named here rather than at the call site so the two screens that draw the
 * chip cannot disagree, and so the round-4 navigation invariants (reset the
 * Study stack first, `toTab(..., initial: false)` second) have one target to
 * be applied to. Notes and decks live on the Study tab; a study group's
 * thread lives on Chat.
 */
export interface QuestionSourceTarget {
  tab: 'StudyTab' | 'ChatTab';
  screen: string;
  params: Record<string, unknown>;
}

export function questionSourceTarget(source: QuestionSource): QuestionSourceTarget {
  switch (source.kind) {
    case 'note':
      return { tab: 'StudyTab', screen: 'NoteEditor', params: { noteId: source.id } };
    case 'deck':
      return {
        tab: 'StudyTab',
        screen: 'DeckDetail',
        params: { deckId: source.id, deckName: source.title },
      };
    case 'group':
    default:
      return {
        tab: 'ChatTab',
        screen: 'GroupChat',
        params: { groupId: source.id, groupName: source.title },
      };
  }
}
