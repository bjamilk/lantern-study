import {
  mergeResumeActivities,
  primaryHomeAction,
  resumeGreeting,
  resumeKindPresentation,
  type StudyResumeKind,
} from './studyResume';
import { WORKSPACE_ACTIVITIES } from './courseWorkspace';
import { dueReviewPlan } from './dueReview';

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

  /**
   * The live defect: Home said "Study all 68 due" from the store's aggregate
   * and the session it opened dealt 78, because the plan also deals each
   * deck's new-card allowance. The label must come off the plan.
   */
  describe('the button counts what the session deals', () => {
    const DECKS = [
      { id: 'd1', name: 'Pharmacology' },
      { id: 'd2', name: 'Fluids' },
    ];
    // Per deck: cards the session will actually deal (due + newly introduced).
    const PLANNED: Record<string, string[]> = {
      d1: ['a', 'b', 'c', 'd', 'e'],
      d2: ['f', 'g', 'h'],
    };
    // What a store aggregate that counts only due-by-date would report.
    const STORE_AGGREGATE = 5;

    it('labels from the plan total, not the store aggregate', () => {
      const plan = dueReviewPlan(DECKS, (deckId) => PLANNED[deckId] ?? []);
      expect(plan.totalDue).toBe(8);
      expect(plan.totalDue).not.toBe(STORE_AGGREGATE);

      const action = primaryHomeAction({
        dueCardsCount: STORE_AGGREGATE,
        reviewPlan: plan,
        lastActivity: null,
      });
      expect(action.kind).toBe('review');
      expect(action.label).toBe(plan.queueLabel);
      expect(action.label).toContain('8');
      expect(action.label).not.toContain('5');
    });

    it('offers a resume when the plan is empty even though the store still counts cards', () => {
      const plan = dueReviewPlan(DECKS, () => []);
      const action = primaryHomeAction({
        dueCardsCount: STORE_AGGREGATE,
        reviewPlan: plan,
        lastActivity: {
          kind: 'cards',
          title: 'AI deck',
          studySetId: 's',
          href: '/study/sets/s/cards',
          at: '2026-09-11T00:00:00.000Z',
        },
      });
      expect(action).toEqual({ kind: 'continue', label: 'Continue', href: '/study/sets/s/cards' });
    });

    it('falls back to the store count when no plan is passed', () => {
      const action = primaryHomeAction({ dueCardsCount: STORE_AGGREGATE, lastActivity: null });
      expect(action.kind).toBe('review');
      expect(action.label).toContain('5');
    });
  });
});
