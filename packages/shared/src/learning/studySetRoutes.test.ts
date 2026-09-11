import {
  buildStudySetPath,
  formatStudySetTypeChips,
  parseStudySetPath,
  sortStudySets,
  studySetRootPath,
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
