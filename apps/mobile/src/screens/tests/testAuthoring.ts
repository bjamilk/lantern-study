/**
 * Authoring and relaunching a test: the decisions, with no React and no
 * native import anywhere in the module.
 *
 * Two things live here.
 *
 * 1. `planRetake` — what pressing Retake on a row of the Tests screen means.
 *    Every history retake on build 161 failed with "Cannot retake — Question
 *    data is no longer available for this test", including a result sat the
 *    day before. The cause was not the message: the tests LIST is served lean
 *    (the server mirrors questions only onto launchable rows), so an attempt's
 *    source test is present in `tests` with no entry in `testQuestionsById`,
 *    and the old handler treated "nothing local" as "gone forever" without
 *    ever asking the server. The planner adds the missing middle step —
 *    fetch `GET /tests/:id` — and only refuses when THAT comes back empty.
 *
 * 2. The New test door's own vocabulary: its three sources, the summary line
 *    the config sheet pins above Start, and the one rule for naming a test a
 *    student made from something of their own.
 *
 * Pure on purpose: mobile jest runs on the `node` environment with
 * `testMatch: ['**\/*.test.ts']` and cannot transform a native module, so the
 * screens render what these return and hold no judgement of their own.
 */

/* ------------------------------------------------------------------ *
 * Retake
 * ------------------------------------------------------------------ */

/** Why a retake cannot happen. */
export type RetakeRefusalReason =
  /** The test is gone, or the server has no questions for it. */
  | 'noQuestions'
  /** The fetch itself failed — offline, a 500. Trying again may work. */
  | 'fetchFailed';

export interface RetakeSourceState {
  /**
   * Question snapshots recoverable from the attempt's own answers. The best
   * source there is: the exact question set that was sat, even if the test has
   * since been edited or deleted.
   */
  snapshotCount: number;
  /**
   * The test the attempt came from — `originalTestId` when the attempt was a
   * one-off session, otherwise `testId`. Null when the attempt names none.
   */
  sourceTestId?: string | null;
  /**
   * Questions this device already holds for `sourceTestId`
   * (`testQuestionsById`). Zero for every row that came off the lean list,
   * which is the case this planner exists for.
   */
  localQuestionCount: number;
  /**
   * Set once `GET /tests/:id` has been tried, so the planner cannot ask for
   * the same fetch twice and spin.
   */
  fetchAttempted?: boolean;
  /** The fetch was tried and threw, rather than answering with no questions. */
  fetchFailed?: boolean;
}

export type RetakePlan =
  /** Relaunch from the attempt's own snapshots (`startQuestionSet`). */
  | { action: 'launchSnapshot' }
  /** Relaunch the source test through the store's normal start path. */
  | { action: 'launchTest'; testId: string }
  /** Nothing local has questions: pull the full session, then re-plan. */
  | { action: 'fetchTest'; testId: string }
  | {
      action: 'refuse';
      reason: RetakeRefusalReason;
      title: string;
      message: string;
    };

const REFUSAL_COPY: Record<RetakeRefusalReason, { title: string; message: string }> = {
  noQuestions: {
    title: 'Cannot retake',
    message: 'Question data is no longer available for this test.',
  },
  // Named apart from the one above because the student can DO something about
  // this one, and being told the questions are gone when they are merely
  // unreachable is the kind of lie that gets a feature abandoned.
  fetchFailed: {
    title: 'Could not load this test',
    message: 'Its questions could not be fetched just now. Check your connection and try again.',
  },
};

function refuse(reason: RetakeRefusalReason): RetakePlan {
  return { action: 'refuse', reason, ...REFUSAL_COPY[reason] };
}

/**
 * What Retake should do for one row.
 *
 * Preference order, best source first:
 *   1. the attempt's own snapshots — no network, exactly what was sat;
 *   2. the source test, when this device already holds its questions;
 *   3. `GET /tests/:id` — the step that was missing, and the reason a result
 *      from yesterday refused to reopen;
 *   4. refusal, and only now is it honest.
 *
 * Call it again with `fetchAttempted: true` (and the counts the fetch
 * produced) to decide what the fetch bought.
 */
export function planRetake(input: RetakeSourceState): RetakePlan {
  const { snapshotCount, sourceTestId, localQuestionCount } = input;

  if (snapshotCount > 0) return { action: 'launchSnapshot' };

  const testId = sourceTestId?.trim() || '';
  if (testId && localQuestionCount > 0) return { action: 'launchTest', testId };

  if (testId && !input.fetchAttempted) return { action: 'fetchTest', testId };

  if (input.fetchFailed) return refuse('fetchFailed');
  return refuse('noQuestions');
}

/* ------------------------------------------------------------------ *
 * The New test door
 * ------------------------------------------------------------------ */

export type TestBuilderSourceId = 'deck' | 'note' | 'group';

export interface TestBuilderSource {
  id: TestBuilderSourceId;
  title: string;
  description: string;
  /**
   * What this costs before it is pressed, or null when it spends nothing.
   * Never typed as a number here — `AI_CREDIT_COSTS` is what the server
   * charges, and a figure written into a label is how the counter starts
   * lying.
   */
  costsCredit: boolean;
  /**
   * True for the one source that leaves the Study tab. The card SAYS so
   * (`description`), because a button that silently switches the global tab is
   * the defect this screen replaces: "+ New test" used to jump to Chat with no
   * warning at all.
   */
  leavesStudyTab: boolean;
}

/**
 * The three ways a student makes a test, in the order the screen lists them.
 *
 * "With your group" is the ONLY cross-tab path in the Tests lane, and it is
 * allowed precisely because it announces itself. The other two build a test of
 * the student's own and stay where they are.
 */
export const TEST_BUILDER_SOURCES: readonly TestBuilderSource[] = [
  {
    id: 'deck',
    title: 'From a deck',
    description: 'Turn the cards in one of your decks into test questions.',
    costsCredit: true,
    leavesStudyTab: false,
  },
  {
    id: 'note',
    title: 'From a note',
    description: 'Turn one of your notes into a test you can sit and retake.',
    costsCredit: true,
    leavesStudyTab: false,
  },
  {
    id: 'group',
    title: 'With your group',
    description: 'Opens your group chat, where a shared test is set up and sat together.',
    costsCredit: false,
    leavesStudyTab: true,
  },
];

/**
 * The name a test made from the student's own material carries.
 *
 * One word for one thing (§5.7): a student sits TESTS. "Quiz · <note>" was the
 * only place the other word survived into a title, so a note-made test read as
 * a different species from every other row of the same list.
 */
export function personalTestTitle(sourceName: string | null | undefined): string {
  const name = (sourceName ?? '').trim();
  return name ? `Test · ${name}` : 'Test';
}

/* ------------------------------------------------------------------ *
 * Legacy titles
 * ------------------------------------------------------------------ */

/**
 * What a STORED title is called on screen.
 *
 * `personalTestTitle` fixed the word going forward, but every test saved
 * before it keeps its old name in the database — build 162 showed "Quiz ·
 * SDOH" on Available Tests and "From Quiz · SDOH" under the same row in
 * History, beside a dozen surfaces that say "test" (T3). Two words for one
 * thing, and the student cannot tell whether they are different features.
 *
 * A DISPLAY-TIME rename, never a migration: nothing here writes to the
 * server. Only the two shapes the old builder actually produced are touched —
 * "Quiz · X" and "Quiz from X" — so a title a student typed themselves ("Quiz
 * technique drills") is left exactly as they wrote it.
 */
export function displayTestTitle(title: string | null | undefined): string {
  const name = (title ?? '').trim();
  if (!name) return '';
  const dotted = /^quiz\s*·\s*/i.exec(name);
  if (dotted) return `Test · ${name.slice(dotted[0].length).trim()}`;
  const worded = /^quiz\s+from\s+/i.exec(name);
  if (worded) return `Test from ${name.slice(worded[0].length).trim()}`;
  return name;
}

/**
 * What a stored SOURCE name is called on screen — the "From …" line.
 *
 * The source of a note quiz is the note, so "From Quiz · SDOH" attributed the
 * test to a note that does not exist: the prefix belongs to the test's own
 * title, not to the note's. Stripped here, the line reads "From SDOH", which
 * is the note the student would go looking for.
 */
export function displayTestSourceName(source: string | null | undefined): string {
  const name = (source ?? '').trim();
  if (!name) return '';
  // BOTH words, not just the old one. `displayTestTitle` renames a stored
  // "Quiz · SDOH" to "Test · SDOH" for display, and a source line fed from
  // that renamed title then read "From Test · SDOH" — the same
  // attributed-to-a-thing-that-does-not-exist defect, one word later. The
  // prefix belongs to the TEST's title in either vocabulary; the source is
  // what follows it.
  const stripped = name.replace(/^(?:quiz|test)\s*(?:·|from)\s*/i, '').trim();
  return stripped || name;
}

/* ------------------------------------------------------------------ *
 * Where a saved test came from
 * ------------------------------------------------------------------ */

/** What a derived source chip points at. `null` id = text, not a link. */
export type TestSourceKind = 'note' | 'deck' | 'group';

export interface DerivedTestSource {
  kind: TestSourceKind;
  /** Null when only a NAME is known — the chip is then plain text. */
  id: string | null;
  title: string;
  /** "From SDOH" — the chip's whole text. */
  label: string;
}

export interface DeriveTestSourceInput {
  /** The note a personal test was generated from. */
  noteId?: string | null;
  noteTitle?: string | null;
  /** The deck a test was built from. */
  deckId?: string | null;
  deckName?: string | null;
  /** The thread a group test was sat in. */
  groupId?: string | null;
  groupName?: string | null;
  /**
   * The test's own title, the source of LAST resort: "Test · SDOH" names its
   * note in the only place a legacy row records it. Read through
   * `displayTestSourceName`, so the prefix never leaks into the chip.
   */
  testTitle?: string | null;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The source chip for a whole attempt, derived on the DEVICE.
 *
 * The results screen already had `resolveQuestionSource`, but it answers only
 * from provenance the server put on the row, and it refuses to resolve a
 * source it cannot link to. On build 163 that meant no chip at all on a test
 * made from a note: mobile question snapshots carry no note id, the attempt
 * has no group, and the source test has no deck. Everything needed was on
 * screen the whole time — the test is called "Test · SDOH".
 *
 * A NAME is enough here, because a chip that says where the questions came
 * from is worth more than a link. `id` is null in that case and the caller
 * renders text rather than a button — never a link with nowhere to go.
 */
export function deriveTestSource(input: DeriveTestSourceInput): DerivedTestSource | null {
  const chip = (kind: TestSourceKind, id: string, title: string): DerivedTestSource => ({
    kind,
    id: id || null,
    title,
    label: `From ${title}`,
  });

  const candidates: DerivedTestSource[] = [];

  const noteTitle = displayTestSourceName(trimmed(input.noteTitle));
  const noteId = trimmed(input.noteId);
  if (noteId || noteTitle) candidates.push(chip('note', noteId, noteTitle || 'this note'));

  const deckName = displayTestSourceName(trimmed(input.deckName));
  const deckId = trimmed(input.deckId);
  if (deckId || deckName) candidates.push(chip('deck', deckId, deckName || 'this deck'));

  const groupName = displayTestSourceName(trimmed(input.groupName));
  const groupId = trimmed(input.groupId);
  if (groupId || groupName) candidates.push(chip('group', groupId, groupName || 'this study group'));

  // A source that can be OPENED beats one that is only a name, whatever the
  // order above. The tests list folds a group's (or a note's) name into
  // `deckName` when the row has no deck of its own (D3), so a group test
  // arrives here as a name-only "deck" AND a linkable group — and the
  // name-only one must not shadow the link.
  const linked = candidates.find(candidate => candidate.id);
  if (linked) return linked;
  if (candidates.length > 0) return candidates[0];

  // The title's own tail. Only a title that ACTUALLY carries the prefix names
  // a source: "Cell Biology mock" is a name the student typed, not a note.
  const title = trimmed(input.testTitle);
  const fromTitle = /^(?:quiz|test)\s*(?:·|from)\s+/i.test(title)
    ? displayTestSourceName(title)
    : '';
  if (fromTitle && fromTitle !== title) return chip('note', '', fromTitle);

  return null;
}

/* ------------------------------------------------------------------ *
 * A row of History
 * ------------------------------------------------------------------ */

export interface AttemptRowInput {
  /** `'study'` is a practice sitting. Absent = never recorded. */
  mode?: 'test' | 'study';
  /** Only ever read for an EXAM row. */
  passed?: boolean;
}

export interface AttemptRowPlan {
  /** Draw the neutral "Practice" chip. */
  showPracticeChip: boolean;
  /**
   * The pass/fail glyph and word, or null when this sitting has no pass mark.
   *
   * Practice is untimed and gives feedback as you go, so its percentage does
   * not mean what an exam's does; a red ✗ and "Not passed" on it turns the
   * low-stakes surface into a verdict, which is the reason to practise at all
   * (T2). Null is also the honest answer for a row that never recorded
   * whether it passed.
   */
  verdict: 'passed' | 'notPassed' | null;
}

/** What one History row shows beside its score. */
export function planAttemptRow(input: AttemptRowInput): AttemptRowPlan {
  if (input.mode === 'study') return { showPracticeChip: true, verdict: null };
  if (typeof input.passed !== 'boolean') return { showPracticeChip: false, verdict: null };
  return { showPracticeChip: false, verdict: input.passed ? 'passed' : 'notPassed' };
}

/**
 * The study text a deck's cards become before the question generator sees
 * them. Front and back on one line each, blank line between cards — the same
 * shape a student would paste in by hand.
 */
export function deckStudyNotes(
  cards: readonly { front?: string | null; back?: string | null }[]
): string {
  return cards
    .map(card => {
      const front = (card.front ?? '').trim();
      const back = (card.back ?? '').trim();
      if (!front && !back) return '';
      return back ? `${front}\n${back}` : front;
    })
    .filter(Boolean)
    .join('\n\n');
}

/* ------------------------------------------------------------------ *
 * The config sheet's summary line
 * ------------------------------------------------------------------ */

export interface TestConfigSummaryInput {
  questionCount: number;
  /** Minutes. 0 is a real answer — an untimed test — not a missing value. */
  timeLimitMinutes: number;
  shuffled: boolean;
  /** Test mode only: cannot return to a question once answered. */
  lockAnswered?: boolean;
}

/** Minutes as the sheet says them: "15 min", "1h 30m", "No time limit". */
export function formatSummaryMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'No time limit';
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * The one line pinned above Start: "20 questions · 15 min · shuffled".
 *
 * The sheet is long enough that the count set at the top is off-screen by the
 * time Start is in reach, which is how a student ends up sitting a 10-question
 * test they thought was 30. Everything the footer states is a decision made
 * higher up the same sheet; nothing here is computed for the first time.
 */
export function formatTestConfigSummary(input: TestConfigSummaryInput): string {
  const count = Math.max(0, Math.round(input.questionCount || 0));
  const parts = [count === 1 ? '1 question' : `${count} questions`];
  parts.push(formatSummaryMinutes(input.timeLimitMinutes));
  if (input.shuffled) parts.push('shuffled');
  if (input.lockAnswered) parts.push('answers locked');
  return parts.join(' · ');
}
