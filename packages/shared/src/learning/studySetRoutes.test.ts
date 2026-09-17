import {
  buildStudySetPath,
  formatStudySetTypeChips,
  isSetRoomFocus,
  isSetRoomFocusPath,
  parseStudySetPath,
  sortStudySets,
  studySetRootPath,
  STUDY_SET_PATH_ACTIVITIES,
  workspaceActivityFromPath,
} from './studySetRoutes';

describe('study set nested paths', () => {
  it('round-trips the set home and each tool', () => {
    expect(studySetRootPath('set-a')).toBe('/study/sets/set-a');
    expect(parseStudySetPath('/study/sets/set-a')).toEqual({
      studySetId: 'set-a',
      activity: 'home',
    });
    expect(buildStudySetPath({ studySetId: 'set-a', activity: 'quiz' })).toBe(
      '/study/sets/set-a/quiz'
    );
    expect(parseStudySetPath('/study/sets/set-a/cards/deck-1/match')).toEqual({
      studySetId: 'set-a',
      activity: 'cards',
      deckId: 'deck-1',
    });
    expect(parseStudySetPath('/study/sets/set-a/cards/deck-1/review')).toEqual({
      studySetId: 'set-a',
      activity: 'cards',
      deckId: 'deck-1',
      cardSession: 'review',
    });
    expect(parseStudySetPath('/study/sets/set-a/play/match')).toEqual({
      studySetId: 'set-a',
      activity: 'play',
      playSession: 'match',
    });
    expect(parseStudySetPath('/study/sets/set-a/test/new')).toEqual({
      studySetId: 'set-a',
      activity: 'test',
      createNew: true,
    });
    expect(parseStudySetPath('/study/sets/set-a/notes/n1')).toEqual({
      studySetId: 'set-a',
      activity: 'notes',
      noteId: 'n1',
    });
    expect(parseStudySetPath('/study/sets/set-a/lesson/new')).toEqual({
      studySetId: 'set-a',
      activity: 'lesson',
      createNew: true,
    });
    expect(buildStudySetPath({ studySetId: 'set-a', activity: 'recap', createNew: true })).toBe(
      '/study/sets/set-a/recap/new'
    );
  });

  it('maps path activities onto workspace studios', () => {
    expect(workspaceActivityFromPath('home')).toBe('home');
    expect(workspaceActivityFromPath('calendar')).toBe('plan');
    expect(workspaceActivityFromPath('read')).toBe('walkthrough');
    expect(workspaceActivityFromPath('quiz')).toBe('quiz');
  });

  it('sorts last-opened first when sorting by last accessed', () => {
    const sets = [
      { id: 'a', title: 'Zoo', updatedAt: '2026-01-01', lastStudiedAt: null },
      { id: 'b', title: 'Alpha', updatedAt: '2026-02-01', lastStudiedAt: '2026-03-01' },
    ];
    expect(sortStudySets(sets, 'alphaAsc').map((s) => s.id)).toEqual(['b', 'a']);
    expect(sortStudySets(sets, 'lastAccessed', 'a').map((s) => s.id)[0]).toBe('a');
  });

  it('formats type chips like the StudyFetch set card', () => {
    expect(
      formatStudySetTypeChips({
        materials: 8,
        notes: 3,
        lectures: 4,
        quizzes: 2,
        cards: 3,
      })
    ).toEqual(['8 materials', '4', '3', '2', '3']);
  });
});

describe('set room focus', () => {
  it('keeps the set home and the add flow out of focus', () => {
    expect(isSetRoomFocus('home', { activity: 'home' })).toBe(false);
    expect(isSetRoomFocus('add', { activity: 'add' })).toBe(false);
    expect(isSetRoomFocus(undefined)).toBe(false);
    expect(isSetRoomFocus(null)).toBe(false);
  });

  it('puts every studio in focus', () => {
    for (const activity of ['walkthrough', 'cards', 'quiz', 'test', 'lecture', 'lesson', 'recap', 'play', 'plan', 'essay'] as const) {
      expect(isSetRoomFocus(activity, { activity })).toBe(true);
    }
  });

  it('treats a notes list as browsing and an open note as studying', () => {
    expect(isSetRoomFocus('notes', { activity: 'notes' })).toBe(false);
    expect(isSetRoomFocus('notes', { activity: 'notes', noteId: 'n1' })).toBe(true);
    expect(isSetRoomFocus('notes', { activity: 'notes', createNew: true })).toBe(true);
  });

  it('answers the same question from a parsed path', () => {
    expect(isSetRoomFocusPath(parseStudySetPath('/study/sets/s/quiz'))).toBe(true);
    // `calendar` and `read` are aliases; the alias must not fall out of focus.
    expect(isSetRoomFocusPath(parseStudySetPath('/study/sets/s/calendar'))).toBe(true);
    expect(isSetRoomFocusPath(parseStudySetPath('/study/sets/s/read'))).toBe(true);
    expect(isSetRoomFocusPath(parseStudySetPath('/study/sets/s'))).toBe(false);
    expect(isSetRoomFocusPath(parseStudySetPath('/study/sets/s/notes'))).toBe(false);
    expect(isSetRoomFocusPath(parseStudySetPath('/study/sets/s/notes/n1'))).toBe(true);
    expect(isSetRoomFocusPath(null)).toBe(false);
  });

  it('has an answer for every path activity in the vocabulary', () => {
    // A tool added to STUDY_SET_PATH_ACTIVITIES without a decision here would
    // silently inherit "focus", which is the safe default — but the assertion
    // exists so the two lists are read together.
    const browsing = new Set(['home', 'add', 'notes']);
    for (const activity of STUDY_SET_PATH_ACTIVITIES) {
      expect(isSetRoomFocusPath({ activity })).toBe(!browsing.has(activity));
    }
  });
});
