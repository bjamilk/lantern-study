import { mergeResumeActivities, resumeGreeting } from './studyResume';

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
