import {
  mergeResumeActivities,
  primaryHomeAction,
  resumeGreeting,
  resumeKindPresentation,
  type StudyResumeKind,
} from './studyResume';
import { WORKSPACE_ACTIVITIES } from './courseWorkspace';

describe('study resume', () => {
  it('writes a flashcards greeting with the set title', () => {
    expect(
      resumeGreeting(
        {
          kind: 'cards',
          title: 'AI deck',
          studySetId: 's',
          href: '/study/sets/s/cards',
          at: '2026-09-11T00:00:00.000Z',
        },
        'My First Study Set'
      )
    ).toBe('I was just reviewing flashcards in My First Study Set. Ready to pick up?');
    expect(resumeGreeting(null)).toBe('Import something, or open a study set.');
  });

  it('dedupes activities by href', () => {
    const first = {
      kind: 'quiz' as const,
      title: 'Quiz',
      studySetId: 's',
      href: '/study/sets/s/quiz/1',
      at: '2026-09-11T00:00:00.000Z',
    };
    const merged = mergeResumeActivities(first, { ...first, title: 'Quiz again' }, [first]);
    expect(merged.recentActivities).toHaveLength(1);
    expect(merged.lastActivity.title).toBe('Quiz again');
  });
});

describe('primaryHomeAction', () => {
  const lastActivity = {
    kind: 'lesson' as const,
    title: 'Lesson',
    studySetId: 's',
    href: '/study/sets/s/lesson',
    at: '2026-09-11T00:00:00.000Z',
  };

  it('reviews due cards before anything else', () => {
    expect(primaryHomeAction({ dueCardsCount: 4, lastActivity })).toEqual({
      kind: 'review',
      label: 'Study all 4 due',
    });
  });

  it('continues to the resume record href', () => {
    expect(primaryHomeAction({ dueCardsCount: 0, lastActivity })).toEqual({
      kind: 'continue',
      label: 'Continue',
      href: '/study/sets/s/lesson',
    });
  });

  it('falls back to import when there is nothing to continue', () => {
    expect(primaryHomeAction({ dueCardsCount: 0, lastActivity: null })).toEqual({
      kind: 'import',
      label: 'Import & study',
    });
    // A resume record with a blank href cannot be navigated to either.
    expect(
      primaryHomeAction({ dueCardsCount: 0, lastActivity: { ...lastActivity, href: '  ' } }).kind
    ).toBe('import');
  });
});

describe('resumeKindPresentation', () => {
  const KINDS: StudyResumeKind[] = [
    'note',
    'lecture',
    'quiz',
    'cards',
    'recap',
    'lesson',
    'play',
    'test',
    'essay',
  ];

  it('maps every kind to a workspace activity row', () => {
    for (const kind of KINDS) {
      const presentation = resumeKindPresentation(kind);
      const row = WORKSPACE_ACTIVITIES.find(
        (activity) => activity.icon === presentation.icon && activity.feature === presentation.feature
      );
      expect(row ? kind : `no workspace row for ${kind}`).toBe(kind);
    }
  });

  it('never falls back to the notes glyph for lesson, play, essay or recap', () => {
    const notes = resumeKindPresentation('note');
    for (const kind of ['lesson', 'play', 'essay', 'recap'] as StudyResumeKind[]) {
      expect(resumeKindPresentation(kind).icon).not.toBe(notes.icon);
    }
    expect(resumeKindPresentation('recap')).toEqual({ icon: 'headphones', feature: 'ai' });
    expect(resumeKindPresentation('lesson')).toEqual({ icon: 'school', feature: 'ai' });
    expect(resumeKindPresentation('play')).toEqual({ icon: 'game-controller', feature: 'flashcards' });
    expect(resumeKindPresentation('essay')).toEqual({ icon: 'document', feature: 'tests' });
  });
});
