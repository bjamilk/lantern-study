import {
  TEST_BUILDER_SOURCES,
  deckStudyNotes,
  deriveTestSource,
  displayTestSourceName,
  displayTestTitle,
  formatSummaryMinutes,
  formatTestConfigSummary,
  personalTestTitle,
  planAttemptRow,
  planRetake,
} from './testAuthoring';

describe('planRetake', () => {
  const base = { snapshotCount: 0, localQuestionCount: 0 } as const;

  it('launches the attempt snapshots when it has them, without a fetch', () => {
    expect(
      planRetake({ ...base, snapshotCount: 12, sourceTestId: 'test-1', localQuestionCount: 5 })
    ).toEqual({ action: 'launchSnapshot' });
  });

  it('launches the source test when this device already holds its questions', () => {
    expect(planRetake({ ...base, sourceTestId: 'test-1', localQuestionCount: 5 })).toEqual({
      action: 'launchTest',
      testId: 'test-1',
    });
  });

  /**
   * The build-161 defect. A history row off the lean list has no snapshots and
   * no cached questions, and the old handler refused right here.
   */
  it('fetches GET /tests/:id before refusing a row with no questions anywhere local', () => {
    expect(planRetake({ ...base, sourceTestId: 'test-1' })).toEqual({
      action: 'fetchTest',
      testId: 'test-1',
    });
  });

  it('launches once the fetch has supplied questions', () => {
    expect(
      planRetake({
        ...base,
        sourceTestId: 'test-1',
        localQuestionCount: 20,
        fetchAttempted: true,
      })
    ).toEqual({ action: 'launchTest', testId: 'test-1' });
  });

  it('refuses honestly only after the fetch came back empty', () => {
    const plan = planRetake({ ...base, sourceTestId: 'test-1', fetchAttempted: true });
    expect(plan).toMatchObject({
      action: 'refuse',
      reason: 'noQuestions',
      message: 'Question data is no longer available for this test.',
    });
  });

  it('separates a failed fetch from a test with no questions', () => {
    const plan = planRetake({
      ...base,
      sourceTestId: 'test-1',
      fetchAttempted: true,
      fetchFailed: true,
    });
    expect(plan).toMatchObject({ action: 'refuse', reason: 'fetchFailed' });
    if (plan.action !== 'refuse') throw new Error('expected a refusal');
    expect(plan.message).not.toContain('no longer available');
  });

  it('refuses immediately when the attempt names no source test at all', () => {
    expect(planRetake({ ...base, sourceTestId: null })).toMatchObject({
      action: 'refuse',
      reason: 'noQuestions',
    });
    expect(planRetake({ ...base, sourceTestId: '   ' })).toMatchObject({ action: 'refuse' });
  });

  it('never asks for the same fetch twice', () => {
    const first = planRetake({ ...base, sourceTestId: 'test-1' });
    expect(first.action).toBe('fetchTest');
    const second = planRetake({ ...base, sourceTestId: 'test-1', fetchAttempted: true });
    expect(second.action).toBe('refuse');
  });
});

describe('TEST_BUILDER_SOURCES', () => {
  it('offers exactly the three doors, deck and note first', () => {
    expect(TEST_BUILDER_SOURCES.map(s => s.id)).toEqual(['deck', 'note', 'group']);
  });

  it('marks the group source as the only one that leaves the Study tab, and says so', () => {
    const leaving = TEST_BUILDER_SOURCES.filter(s => s.leavesStudyTab);
    expect(leaving.map(s => s.id)).toEqual(['group']);
    expect(leaving[0].description).toContain('Opens your group chat');
  });

  it('prices the two AI doors and nothing else', () => {
    expect(TEST_BUILDER_SOURCES.filter(s => s.costsCredit).map(s => s.id)).toEqual([
      'deck',
      'note',
    ]);
  });

  it('says "test", never "quiz", anywhere a student reads it', () => {
    for (const source of TEST_BUILDER_SOURCES) {
      expect(`${source.title} ${source.description}`.toLowerCase()).not.toContain('quiz');
    }
  });
});

describe('personalTestTitle', () => {
  it('titles a test made from a note "Test · <note>"', () => {
    expect(personalTestTitle('Cell biology')).toBe('Test · Cell biology');
  });

  it('trims, and falls back to a bare name', () => {
    expect(personalTestTitle('  Kinetics  ')).toBe('Test · Kinetics');
    expect(personalTestTitle('')).toBe('Test');
    expect(personalTestTitle(undefined)).toBe('Test');
  });
});

describe('deckStudyNotes', () => {
  it('lays each card out as front then back, blank line between cards', () => {
    expect(
      deckStudyNotes([
        { front: 'Mitochondria', back: 'Powerhouse of the cell' },
        { front: 'DNA', back: 'Deoxyribonucleic acid' },
      ])
    ).toBe('Mitochondria\nPowerhouse of the cell\n\nDNA\nDeoxyribonucleic acid');
  });

  it('drops empty cards and keeps a front with no back', () => {
    expect(deckStudyNotes([{ front: '', back: '' }, { front: 'Osmosis' }, {}])).toBe('Osmosis');
  });
});

describe('formatSummaryMinutes', () => {
  it('says "No time limit" for 0 rather than inventing one', () => {
    expect(formatSummaryMinutes(0)).toBe('No time limit');
    expect(formatSummaryMinutes(-5)).toBe('No time limit');
    expect(formatSummaryMinutes(Number.NaN)).toBe('No time limit');
  });

  it('formats minutes and hours', () => {
    expect(formatSummaryMinutes(15)).toBe('15 min');
    expect(formatSummaryMinutes(60)).toBe('1h');
    expect(formatSummaryMinutes(90)).toBe('1h 30m');
  });
});

describe('formatTestConfigSummary', () => {
  it('reads back the decisions made further up the sheet', () => {
    expect(
      formatTestConfigSummary({ questionCount: 20, timeLimitMinutes: 15, shuffled: true })
    ).toBe('20 questions · 15 min · shuffled');
  });

  it('drops the parts that were not chosen', () => {
    expect(
      formatTestConfigSummary({ questionCount: 1, timeLimitMinutes: 0, shuffled: false })
    ).toBe('1 question · No time limit');
  });

  it('states the exam lock when it is on', () => {
    expect(
      formatTestConfigSummary({
        questionCount: 5,
        timeLimitMinutes: 5,
        shuffled: false,
        lockAnswered: true,
      })
    ).toBe('5 questions · 5 min · answers locked');
  });
});

describe('displayTestTitle', () => {
  it('renames the two shapes the old builder wrote', () => {
    expect(displayTestTitle('Quiz · SDOH')).toBe('Test · SDOH');
    expect(displayTestTitle('Quiz from Cell Biology')).toBe('Test from Cell Biology');
  });

  it('is case- and spacing-tolerant, because stored titles are not uniform', () => {
    expect(displayTestTitle('quiz ·  SDOH')).toBe('Test · SDOH');
    expect(displayTestTitle('QUIZ FROM Anatomy')).toBe('Test from Anatomy');
  });

  it('leaves a title the student wrote alone', () => {
    expect(displayTestTitle('Quiz technique drills')).toBe('Quiz technique drills');
    expect(displayTestTitle('Test · SDOH')).toBe('Test · SDOH');
    expect(displayTestTitle('Pop quiz · SDOH')).toBe('Pop quiz · SDOH');
  });

  it('has nothing to say about an empty title', () => {
    expect(displayTestTitle('')).toBe('');
    expect(displayTestTitle(null)).toBe('');
    expect(displayTestTitle(undefined)).toBe('');
  });
});

describe('displayTestSourceName', () => {
  it('strips the test title prefix off the note the test came from', () => {
    // "From Quiz · SDOH" named a note that does not exist. The note is SDOH.
    expect(displayTestSourceName('Quiz · SDOH')).toBe('SDOH');
    expect(displayTestSourceName('Quiz from SDOH')).toBe('SDOH');
  });

  it('leaves a real source name alone', () => {
    expect(displayTestSourceName('Cell Biology')).toBe('Cell Biology');
    expect(displayTestSourceName('Quiz Club')).toBe('Quiz Club');
  });

  it('keeps the original rather than returning nothing', () => {
    expect(displayTestSourceName('Quiz ·')).toBe('Quiz ·');
    expect(displayTestSourceName(undefined)).toBe('');
  });

  it('strips the NEW word too, so History never reads "From Test · SDOH"', () => {
    // displayTestTitle renames the stored title for display; a source line fed
    // from the renamed title reproduced the same defect one word later.
    expect(displayTestSourceName('Test · SDOH')).toBe('SDOH');
    expect(displayTestSourceName('Test from SDOH')).toBe('SDOH');
    expect(displayTestSourceName(displayTestTitle('Quiz · SDOH'))).toBe('SDOH');
  });

  it('does not eat a source that merely starts with the word', () => {
    expect(displayTestSourceName('Test Club')).toBe('Test Club');
    expect(displayTestSourceName('Testing methods')).toBe('Testing methods');
  });
});

describe('deriveTestSource', () => {
  it('prefers the note, and links it when there is an id', () => {
    expect(deriveTestSource({ noteId: 'n1', noteTitle: 'SDOH', deckName: 'Anatomy' })).toEqual({
      kind: 'note',
      id: 'n1',
      title: 'SDOH',
      label: 'From SDOH',
    });
  });

  it('falls back to the deck, then to the group', () => {
    expect(deriveTestSource({ deckId: 'd1', deckName: 'Anatomy' })?.kind).toBe('deck');
    expect(deriveTestSource({ groupId: 'g1', groupName: 'Year 2' })).toEqual({
      kind: 'group',
      id: 'g1',
      title: 'Year 2',
      label: 'From Year 2',
    });
  });

  it('reads the source out of the test title when nothing else knows', () => {
    // The whole point: a note test carries its note in its own name and had no
    // chip at all before, because nothing could be linked (F1).
    expect(deriveTestSource({ testTitle: 'Test · SDOH' })).toEqual({
      kind: 'note',
      id: null,
      title: 'SDOH',
      label: 'From SDOH',
    });
    expect(deriveTestSource({ testTitle: 'Quiz from Cell Biology' })?.label).toBe(
      'From Cell Biology'
    );
  });

  it('never invents a source out of a title the student typed', () => {
    expect(deriveTestSource({ testTitle: 'Cell Biology mock' })).toBeNull();
    expect(deriveTestSource({ testTitle: 'Test' })).toBeNull();
    expect(deriveTestSource({})).toBeNull();
  });

  it('resolves on a NAME alone, with no id to open', () => {
    // A chip that says where the questions came from beats no chip; the caller
    // renders text rather than a link when `id` is null.
    expect(deriveTestSource({ noteTitle: 'SDOH' })).toEqual({
      kind: 'note',
      id: null,
      title: 'SDOH',
      label: 'From SDOH',
    });
  });

  it('strips a stored title prefix off whichever name it uses', () => {
    expect(deriveTestSource({ noteId: 'n1', noteTitle: 'Quiz · SDOH' })?.label).toBe('From SDOH');
    expect(deriveTestSource({ groupId: 'g1', groupName: 'Test · Year 2' })?.title).toBe('Year 2');
  });

  it('lets a linkable group win over a name-only "deck" that is really the group', () => {
    // The tests list folds a group's name into `deckName` when the row has no
    // deck (D3): without this the hero chip on a group test read the right
    // words but as plain text, and the thread it could open was never linked.
    expect(
      deriveTestSource({ deckName: 'Year 2', groupId: 'g1', groupName: 'Year 2' })
    ).toEqual({ kind: 'group', id: 'g1', title: 'Year 2', label: 'From Year 2' });
  });

  it('names the kind when an id arrives without a name', () => {
    expect(deriveTestSource({ deckId: 'd1' })).toEqual({
      kind: 'deck',
      id: 'd1',
      title: 'this deck',
      label: 'From this deck',
    });
  });
});

describe('planAttemptRow', () => {
  it('gives a practice row the chip and NO pass/fail', () => {
    // T2: practice is untimed and reveals as it goes, so its percentage does
    // not mean what an exam's does. A red ✗ on it is a verdict it never earned.
    expect(planAttemptRow({ mode: 'study', passed: false })).toEqual({
      showPracticeChip: true,
      verdict: null,
    });
    expect(planAttemptRow({ mode: 'study', passed: true })).toEqual({
      showPracticeChip: true,
      verdict: null,
    });
  });

  it('gives an exam row its verdict and no chip', () => {
    expect(planAttemptRow({ mode: 'test', passed: true })).toEqual({
      showPracticeChip: false,
      verdict: 'passed',
    });
    expect(planAttemptRow({ mode: 'test', passed: false })).toEqual({
      showPracticeChip: false,
      verdict: 'notPassed',
    });
  });

  it('says nothing about an attempt that recorded nothing', () => {
    // A row written before the mode existed is "not stated", never "failed".
    expect(planAttemptRow({})).toEqual({ showPracticeChip: false, verdict: null });
    expect(planAttemptRow({ passed: true })).toEqual({
      showPracticeChip: false,
      verdict: 'passed',
    });
  });
});
