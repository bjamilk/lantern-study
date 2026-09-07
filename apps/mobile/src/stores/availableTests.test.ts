import {
  LOCAL_TEST_GRACE_MS,
  availableTestName,
  isAvailableTestRow,
  mergeAvailableTests,
  testSourceLine,
  type TestSessionRow,
} from './availableTests';

/** The row `POST /tests/personal` writes for a quiz generated from a note. */
const personalTest = (overrides: Partial<TestSessionRow> = {}): TestSessionRow => ({
  id: 'ts-1',
  title: 'Quiz · SDOH',
  config: { name: 'Quiz · SDOH', numberOfQuestions: 5, source: 'note' },
  questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }, { id: 'q5' }],
  status: 'in_progress',
  session_kind: 'test',
  end_time: null,
  created_at: '2026-09-05T10:00:00.000Z',
  ...overrides,
});

describe('what belongs under Available — F5', () => {
  it('lists a personal test saved from a note', () => {
    // The device run saved "Quiz · SDOH" and the Tests list still read "No
    // Tests Available".
    expect(isAvailableTestRow(personalTest())).toBe(true);
  });

  it('accepts the older rows that predate session_kind', () => {
    expect(isAvailableTestRow(personalTest({ session_kind: undefined }))).toBe(true);
  });

  it('accepts a status of "available" as well as in_progress', () => {
    expect(isAvailableTestRow(personalTest({ status: 'available' }))).toBe(true);
    expect(isAvailableTestRow(personalTest({ status: 'paused' }))).toBe(true);
  });

  it('leaves out anything that has already been answered to the end', () => {
    expect(isAvailableTestRow(personalTest({ end_time: '2026-09-05T11:00:00.000Z' }))).toBe(false);
    expect(isAvailableTestRow(personalTest({ status: 'completed' }))).toBe(false);
    expect(isAvailableTestRow(personalTest({ status: 'abandoned' }))).toBe(false);
  });

  it('leaves out a study session and an empty one', () => {
    expect(isAvailableTestRow(personalTest({ session_kind: 'study' }))).toBe(false);
    expect(isAvailableTestRow(personalTest({ questions: [] }))).toBe(false);
    expect(isAvailableTestRow(personalTest({ questions: null }))).toBe(false);
    expect(isAvailableTestRow(undefined)).toBe(false);
  });

  it('names it from the title the student gave it', () => {
    expect(availableTestName(personalTest())).toBe('Quiz · SDOH');
    // A row whose title lives only in config still gets its name.
    expect(availableTestName(personalTest({ title: undefined }))).toBe('Quiz · SDOH');
    expect(availableTestName(personalTest({ title: undefined, config: null }))).toBe(
      'Untitled Test'
    );
  });
});

describe('a test the client filed before the server listed it', () => {
  const NOW = Date.parse('2026-09-05T10:00:10.000Z');
  const local = { id: 'ts-1', createdAt: '2026-09-05T10:00:00.000Z' };
  const other = { id: 'ts-2', createdAt: '2026-09-01T10:00:00.000Z' };

  it('survives a fetch that has not caught up with it', () => {
    expect(mergeAvailableTests([local], [other], NOW)).toEqual([local, other]);
  });

  it('is not duplicated once the fetch does list it', () => {
    const fetched = { id: 'ts-1', createdAt: '2026-09-05T10:00:00.000Z' };
    expect(mergeAvailableTests([local], [fetched], NOW)).toEqual([fetched]);
  });

  it('lets go of one the server has stopped listing', () => {
    // Deleted elsewhere, or never really saved: after the grace window the
    // server's answer is the only one.
    expect(mergeAvailableTests([local], [], NOW + LOCAL_TEST_GRACE_MS + 1)).toEqual([]);
    expect(mergeAvailableTests([{ id: 'x', createdAt: 'nonsense' }], [], NOW)).toEqual([]);
  });
});

describe('the "From …" line under a test — D3', () => {
  it('names the source when there is one', () => {
    expect(testSourceLine('SDOH lecture')).toBe('From SDOH lecture');
    expect(testSourceLine('  Anatomy deck  ')).toBe('From Anatomy deck');
  });

  it('is omitted — never "From undefined" — when there is no source to name', () => {
    // A note quiz has no deck and no group; the server sends `null` for a
    // title it could not resolve. None of these may reach the screen.
    expect(testSourceLine(undefined)).toBeNull();
    expect(testSourceLine(null)).toBeNull();
    expect(testSourceLine('')).toBeNull();
    expect(testSourceLine('   ')).toBeNull();
  });
});
