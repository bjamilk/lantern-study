/**
 * Which sessions belong under "Available" in the Tests list — the pure half.
 *
 * A quiz generated from a note is saved as a personal test session
 * (`POST /tests/personal`): `session_kind: 'test'`, `status: 'in_progress'`,
 * no `end_time`, questions present, and its title in `title` as well as in
 * `config.name`. The device run of 2026-09-05 saved one of those and the Tests
 * list still read "No Tests Available" (F5), so the rule that decides what is
 * listed — and the rule that stops a refetch from dropping a test the client
 * has just filed — live here, where they can be asserted in node.
 *
 * Nothing here imports anything: mobile jest never loads a store.
 */

/** The fields of a `GET /tests` row this rule reads. Everything is optional. */
export interface TestSessionRow {
  id?: string;
  title?: string;
  config?: {
    name?: string;
    testName?: string;
    description?: string;
    numberOfQuestions?: number;
    [key: string]: unknown;
  } | null;
  questions?: unknown[] | null;
  status?: string;
  session_kind?: string;
  sessionKind?: string;
  end_time?: string | null;
  endTime?: string | null;
  created_at?: string;
  createdAt?: string;
}

/** A session that has been answered to the end is history, not a test to take. */
const isFinished = (row: TestSessionRow): boolean =>
  Boolean(row.end_time || row.endTime) ||
  row.status === 'completed' ||
  row.status === 'abandoned';

/**
 * A study session is not a test.
 *
 * `session_kind` is absent on rows written before the column existed, and
 * those are tests — treating "missing" as "not a test" would empty the list
 * for anyone with older sessions.
 */
const isTestKind = (row: TestSessionRow): boolean => {
  const kind = row.session_kind ?? row.sessionKind;
  return kind === undefined || kind === null || kind === 'test';
};

/**
 * Is this row a test the student can start right now?
 *
 * `status` is `in_progress` for a personal test the server just wrote and for
 * one that was paused; `available` is accepted too, since that is the word a
 * status filter uses for the same thing. Anything with no questions is not
 * startable and is left out rather than listed as an empty test.
 */
export const isAvailableTestRow = (row: TestSessionRow | null | undefined): boolean => {
  if (!row || typeof row.id !== 'string' || !row.id) return false;
  if (!isTestKind(row)) return false;
  if (isFinished(row)) return false;
  if (
    row.status !== undefined &&
    row.status !== null &&
    !['in_progress', 'paused', 'available', 'not_started'].includes(row.status)
  ) {
    return false;
  }
  const questionCount = Array.isArray(row.questions) ? row.questions.length : 0;
  return questionCount > 0;
};

/**
 * What to call it.
 *
 * `title` first: a personal test carries its name there, and reading only
 * `config.name` is what listed a saved note quiz as "Untitled Test" on the
 * clients that did see it.
 */
export const availableTestName = (row: TestSessionRow): string =>
  (typeof row.title === 'string' && row.title.trim()) ||
  (typeof row.config?.name === 'string' && row.config.name.trim()) ||
  (typeof row.config?.testName === 'string' && row.config.testName.trim()) ||
  'Untitled Test';

/** How long a locally filed test survives a fetch that does not mention it. */
export const LOCAL_TEST_GRACE_MS = 10 * 60 * 1000;

/** The two fields the merge below needs from a listed test. */
export interface ListedTest {
  id: string;
  createdAt: string;
}

/**
 * Keep a test the client filed itself but the server has not listed yet.
 *
 * `fetchTests` replaces the whole list, so a note quiz inserted a second
 * earlier vanished the moment anything refreshed — a cached `GET /tests`, a
 * read replica, a page boundary. A locally known test that the fetch does not
 * mention is kept for `graceMs` and then allowed to go: long enough to cover
 * that window, short enough that a test deleted elsewhere does not haunt the
 * list.
 */
export const mergeAvailableTests = <T extends ListedTest>(
  previous: T[],
  fetched: T[],
  now: number,
  graceMs: number = LOCAL_TEST_GRACE_MS
): T[] => {
  const seen = new Set(fetched.map((t) => t.id));
  const held = previous.filter((t) => {
    if (seen.has(t.id)) return false;
    const created = Date.parse(t.createdAt);
    return Number.isFinite(created) && now - created <= graceMs;
  });
  return [...held, ...fetched];
};

/**
 * The "From …" line under a test's name — or nothing at all.
 *
 * The device run showed "Quiz · SDOH" over the literal string
 * "From undefined" (D3): a note quiz has no deck and no group, so the row's
 * `From ${deckName}` template printed the word `undefined` at the student. A
 * missing source is not a source — the line is omitted entirely — and any
 * source the server does name (a deck, a group, or the note the quiz was
 * generated from) is shown as it is.
 */
export const testSourceLine = (
  source: string | null | undefined
): string | null => {
  const name = typeof source === 'string' ? source.trim() : '';
  return name ? `From ${name}` : null;
};
