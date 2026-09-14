import {
  WORKSPACE_ACTIVITIES,
  TURN_INTO_TARGETS,
  TURN_INTO_COST,
  formatTurnIntoCost,
  courseWorkspaceLabel,
  isLectureNote,
  isWalkableAttachment,
  formatCourseMaterialCounts,
  materialsForCourse,
  testsFiledInCourse,
  upsertWorkspaceRecent,
  scopeNoun,
  workspaceActivityPromise,
  scopedCopy,
  formatStudySetCardCounts,
  type WorkspaceIconName,
} from './courseWorkspace';

describe('course workspace helpers', () => {
  it('lists eleven activities and Waves A–I as ready', () => {
    expect(WORKSPACE_ACTIVITIES.map((a) => a.id)).toEqual([
      'notes',
      'walkthrough',
      'cards',
      'quiz',
      'test',
      'lecture',
      'lesson',
      'recap',
      'play',
      'plan',
      'essay',
    ]);
    const ready = WORKSPACE_ACTIVITIES.filter((a) => a.status === 'ready').map((a) => a.id);
    expect(ready).toEqual([
      'notes',
      'walkthrough',
      'cards',
      'quiz',
      'test',
      'lecture',
      'lesson',
      'recap',
      'play',
      'plan',
      'essay',
    ]);
  });

  it('offers eight Turn into targets that all land on a real activity', () => {
    expect(TURN_INTO_TARGETS.map((t) => t.id)).toEqual([
      'cards',
      'quiz',
      'test',
      'notes',
      'lesson',
      'recap',
      'essay',
      'play',
    ]);
    const activityIds = new Set(WORKSPACE_ACTIVITIES.map((a) => a.id));
    for (const target of TURN_INTO_TARGETS) {
      expect(activityIds.has(target.id)).toBe(true);
    }
  });

  it('gives every Turn into target an icon both clients draw', () => {
    const icons = new Set(WORKSPACE_ACTIVITIES.map((a) => a.icon));
    for (const target of TURN_INTO_TARGETS) {
      expect(icons.has(target.icon)).toBe(true);
    }
  });

  it('prices every Turn into target, and play for free', () => {
    for (const target of TURN_INTO_TARGETS) {
      expect(TURN_INTO_COST[target.id]).toBeGreaterThanOrEqual(0);
      expect(typeof TURN_INTO_COST[target.id]).toBe('number');
    }
    expect(Object.keys(TURN_INTO_COST).sort()).toEqual(
      TURN_INTO_TARGETS.map((t) => t.id).sort()
    );
    expect(TURN_INTO_COST.play).toBe(0);
    expect(formatTurnIntoCost('play')).toBe('no AI use');
    expect(formatTurnIntoCost('cards')).toBe('1 AI use');
  });

  it('keeps recents newest-first, unique, and capped', () => {
    const first = upsertWorkspaceRecent([], 'bio', 10);
    const second = upsertWorkspaceRecent(first, 'csc', 20);
    const again = upsertWorkspaceRecent(second, 'bio', 30);
    expect(again.map((r) => r.courseId)).toEqual(['bio', 'csc']);
    const capped = upsertWorkspaceRecent(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => ({ courseId: id, openedAt: i })),
      'z',
      99,
      8
    );
    expect(capped).toHaveLength(8);
    expect(capped[0]).toEqual({ courseId: 'z', openedAt: 99 });
  });

  it('filters materials by course id, including the mobile snake_case field', () => {
    const notes = [
      { id: '1', courseId: 'bio' },
      { id: '2', courseId: 'csc' },
      { id: '3', courseId: null },
      { id: '4', course_id: 'bio' },
    ];
    expect(materialsForCourse(notes, 'bio').map((n) => n.id)).toEqual(['1', '4']);
  });

  it('summarises what is filed in a course', () => {
    expect(formatCourseMaterialCounts({ notes: 0, decks: 0 })).toBe(
      'No materials yet — import or open to add some'
    );
    expect(formatCourseMaterialCounts({ notes: 1, decks: 2, tests: 3 })).toBe(
      '1 note · 2 decks · 3 tests'
    );
  });

  it('files tests by course, source note, or source deck', () => {
    const noteIds = new Set(['n1']);
    const deckIds = new Set(['d1']);
    const tests = [
      { id: 'a', courseId: 'bio' },
      { id: 'b', sourceNoteId: 'n1' },
      { id: 'c', sourceDeckId: 'd1' },
      { id: 'd', deckId: 'other' },
    ];
    expect(testsFiledInCourse(tests, 'bio', noteIds, deckIds).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('recognises lecture notes by title or audio source', () => {
    expect(isLectureNote({ title: 'Lecture — 6 Sep' })).toBe(true);
    expect(isLectureNote({ title: 'Week 3', sourceType: 'audio' })).toBe(true);
    expect(isLectureNote({ title: 'Week 3', sourceType: 'typed' })).toBe(false);
  });

  it('labels a course as code · title', () => {
    expect(courseWorkspaceLabel({ code: 'BIO 201', title: 'Cell Biology' })).toBe(
      'BIO 201 · Cell Biology'
    );
    expect(courseWorkspaceLabel({ code: 'BIO 201', title: 'BIO 201' })).toBe('BIO 201');
  });

  it('only walks uploaded documents', () => {
    expect(isWalkableAttachment({ id: 'a', type: 'pdf' })).toBe(true);
    expect(isWalkableAttachment({ id: 'a', type: 'photos' })).toBe(false);
    expect(isWalkableAttachment({ type: 'pdf' })).toBe(false);
  });
});

describe('scopeNoun', () => {
  it('names a set when one is open, and the course otherwise', () => {
    expect(scopeNoun('set-1', 'course-1')).toBe('set');
    expect(scopeNoun(null, 'course-1')).toBe('course');
    expect(scopeNoun('   ', 'course-1')).toBe('course');
    expect(scopeNoun(undefined, undefined)).toBe('course');
  });

  it('rewrites only the promises that name a container', () => {
    const play = WORKSPACE_ACTIVITIES.find((item) => item.id === 'play');
    expect(workspaceActivityPromise('play', play?.promise ?? '', 'set')).toContain('this set');
    expect(workspaceActivityPromise('play', play?.promise ?? '', 'course')).toBe(play?.promise);
    const quiz = WORKSPACE_ACTIVITIES.find((item) => item.id === 'quiz');
    expect(workspaceActivityPromise('quiz', quiz?.promise ?? '', 'set')).toBe(quiz?.promise);
  });
});

/**
 * Every glyph the two registries name, as a value.
 *
 * `Record<WorkspaceIconName, true>` makes this exhaustive at COMPILE time: a
 * name added to the union and forgotten here is a type error, and a name here
 * that is not in the union is one too. The test below then walks the registry
 * rows at RUN time, which is the half a type cannot do on its own — the union
 * says which glyphs are legal, not which ones a row actually reaches for.
 *
 * WHAT THIS CATCHES, and why it is not redundant with `icon: WorkspaceIconName`
 * on the row type: the union is the contract that both AppIcon maps
 * (`components/ui/appIconMap.ts` and `apps/mobile/src/components/ui/
 * appIconMap.ts`) promise to satisfy. A name reaching a registry row without
 * passing through this list is a name nobody checked either map for, and the
 * failure mode is a blank square on one platform only — exactly the shape of
 * bug that reaches a phone and not a reviewer.
 */
const WORKSPACE_ICON_NAMES: Record<WorkspaceIconName, true> = {
  'document-text': true,
  book: true,
  layers: true,
  'help-circle': true,
  clipboard: true,
  'clipboard-check': true,
  mic: true,
  school: true,
  'volume-medium': true,
  headphones: true,
  'game-controller': true,
  calendar: true,
  document: true,
  'cloud-upload': true,
  'git-branch': true,
  sparkles: true,
  library: true,
  albums: true,
};

describe('workspace icons', () => {
  it('draws every activity and turn-into row with a glyph in the union', () => {
    const legal = Object.keys(WORKSPACE_ICON_NAMES);
    // Reported as a pair of lists rather than a loop of bare `toContain`s:
    // jest's `expect` takes no message argument, so a loop would say only
    // "expected array to contain string" without naming the row.
    const stray = (rows: readonly { id: string; icon: string }[]) =>
      rows.filter((row) => !legal.includes(row.icon)).map((row) => `${row.id}:${row.icon}`);
    expect(stray(WORKSPACE_ACTIVITIES)).toEqual([]);
    expect(stray(TURN_INTO_TARGETS)).toEqual([]);
  });

  it('gives a test its own glyph, distinct from a quiz and from a plan', () => {
    // A test is the one activity that ends in a mark. It shared `clipboard`
    // with the quiz and the plan until 2026-09-11, which made three different
    // objects the same shape in a list of eleven.
    const byId = (id: string) => WORKSPACE_ACTIVITIES.find((row) => row.id === id)?.icon;
    expect(byId('test')).toBe('clipboard-check');
    expect(byId('quiz')).toBe('help-circle');
    expect(byId('test')).not.toBe(byId('quiz'));
    expect(byId('test')).not.toBe(byId('plan'));
  });
});

describe('scopedCopy', () => {
  it('names the container the student is actually standing in', () => {
    expect(scopedCopy('notesEmpty', 'set')).toBe('No notes in this set yet');
    expect(scopedCopy('notesEmpty', 'course')).toBe('No notes in this course yet');
    expect(scopedCopy('importAction', 'set')).toBe('Import into this set');
    expect(scopedCopy('importAction', 'course')).toBe('Import into this course');
  });

  it('defaults to the course wording, so an un-passed scope is the old behaviour', () => {
    expect(scopedCopy('decksEmpty')).toBe(scopedCopy('decksEmpty', 'course'));
  });

  it('never leaves the other container’s noun in a line', () => {
    const keys = [
      'notesEmpty',
      'testsEmpty',
      'decksEmpty',
      'importAction',
      'testsFromDecks',
      'buildingCards',
      'buildingTest',
      'lessonSourceEmpty',
      'recapSourceEmpty',
      'essayPhotoImport',
    ] as const;
    for (const key of keys) {
      expect(scopedCopy(key, 'set')).not.toMatch(/\bcourse\b/);
      expect(scopedCopy(key, 'course')).not.toMatch(/\bset\b/);
    }
  });

  it('reads the scope off a study set id', () => {
    expect(scopeNoun('set-1', null)).toBe('set');
    expect(scopeNoun('  ', 'course-1')).toBe('course');
    expect(scopeNoun(null, 'course-1')).toBe('course');
  });

  it('scopes an activity promise without touching the unscoped ones', () => {
    expect(workspaceActivityPromise('notes', 'x', 'set')).toBe('Read and edit this set’s notes');
    expect(workspaceActivityPromise('notes', 'x', 'course')).toBe('Read and edit this course’s notes');
    expect(workspaceActivityPromise('plan', 'Study calendar and syllabus outline', 'set')).toBe(
      'Study calendar and syllabus outline'
    );
  });
});

describe('counts', () => {
  it('never says "1 notes" or "1 decks"', () => {
    expect(formatCourseMaterialCounts({ notes: 1, decks: 1, tests: 1 })).toBe('1 note · 1 deck · 1 test');
    expect(formatCourseMaterialCounts({ notes: 0, decks: 2 })).toBe('0 notes · 2 decks');
  });

  it('counts decks as decks on the set card, and drops the empty parts', () => {
    // The Home set card said "1 materials", printed the note count twice, and
    // labelled a count of DECKS "cards".
    expect(formatStudySetCardCounts({ notes: 1, decks: 0 })).toBe('1 note');
    expect(formatStudySetCardCounts({ notes: 4, decks: 3, lectures: 1 })).toBe(
      '4 notes · 1 lecture · 3 decks'
    );
    expect(formatStudySetCardCounts({ notes: 0, decks: 0 })).toBe('No materials yet');
  });
});

describe('the tutor door has one name', () => {
  it('names the feature Tutor wherever a door is named', () => {
    expect(WORKSPACE_ACTIVITIES.find((row) => row.id === 'lesson')?.label).toBe('Tutor');
  });

  it('still calls the artefact it produces a lesson', () => {
    expect(TURN_INTO_TARGETS.find((row) => row.id === 'lesson')?.label).toBe('Lesson');
  });
});
