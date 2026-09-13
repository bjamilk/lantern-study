import {
  HOME_QUICK_ACTIONS,
  RECENT_ACTIVITIES_LIMIT,
  dueCallToActionLabel,
  homeRegions,
  quickActionColumns,
  recentActivities,
  relativeActivityTime,
  type HomeRegionId,
} from './homeSections';

const SPINE: HomeRegionId[] = [
  'greeting',
  'studySets',
  'recentMaterials',
  'recentActivities',
  'upcomingExam',
  'quickActions',
  'joinClass',
];

describe('homeRegions', () => {
  it('gives web the shared spine in order, with no progress door', () => {
    const ids = homeRegions({ platform: 'web' }).map((r) => r.id);
    expect(ids).toEqual(SPINE);
  });

  it('adds mobile a progress door before Join a class', () => {
    const ids = homeRegions({ platform: 'mobile' }).map((r) => r.id);
    expect(ids).toEqual([
      'greeting',
      'studySets',
      'recentMaterials',
      'recentActivities',
      'upcomingExam',
      'quickActions',
      'progress',
      'joinClass',
    ]);
    const progress = homeRegions({ platform: 'mobile' }).find((r) => r.id === 'progress');
    expect(progress?.door).toBe(true);
  });

  it('keeps the two platforms identical apart from the progress door', () => {
    const web = homeRegions({ platform: 'web', dueCount: 4, hasExamDate: true });
    const mobile = homeRegions({ platform: 'mobile', dueCount: 4, hasExamDate: true }).filter(
      (r) => r.id !== 'progress'
    );
    expect(mobile).toEqual(web);
  });

  it('puts the due call to action on the greeting only when work is waiting', () => {
    expect(homeRegions({ platform: 'web', dueCount: 12 })[0].sublabel).toBe('Study all 12 due');
    expect(homeRegions({ platform: 'web', dueCount: 0 })[0].sublabel).toBeUndefined();
    expect(homeRegions({ platform: 'web' })[0].sublabel).toBeUndefined();
    expect(dueCallToActionLabel(1)).toBe('Study all 1 due');
    expect(dueCallToActionLabel(undefined)).toBeUndefined();
  });

  it('labels the exam slot readiness until an exam date exists', () => {
    const without = homeRegions({ platform: 'web', hasExamDate: false }).find(
      (r) => r.id === 'upcomingExam'
    );
    expect(without?.label).toBe('Exam readiness');
    expect(without?.sublabel).toContain('Add an exam date');

    const withDate = homeRegions({ platform: 'web', hasExamDate: true }).find(
      (r) => r.id === 'upcomingExam'
    );
    expect(withDate?.label).toBe('Upcoming exam');
    expect(withDate?.sublabel).toBeUndefined();
  });

  it('never lets the greeting or the quick actions be folded away', () => {
    for (const region of homeRegions({ platform: 'mobile' })) {
      if (region.id === 'greeting' || region.id === 'quickActions') {
        expect(region.collapsible).toBe(false);
      }
    }
  });
});

describe('quick actions', () => {
  it('is the same six doors, same words, same order', () => {
    expect(HOME_QUICK_ACTIONS.map((a) => a.label)).toEqual([
      'Import materials',
      'Create a quiz',
      'Ask Lantern',
      'Tutor',
      'Record a lecture',
      'Open Study',
    ]);
  });

  it('gives every door a distinct id and a route', () => {
    const ids = new Set(HOME_QUICK_ACTIONS.map((a) => a.id));
    expect(ids.size).toBe(HOME_QUICK_ACTIONS.length);
    for (const action of HOME_QUICK_ACTIONS) {
      expect(action.targetRoute.startsWith('/')).toBe(true);
      expect(action.icon).toBeTruthy();
    }
  });

  it('is 2-up on a phone and 3-up on a wide screen', () => {
    expect(quickActionColumns('mobile')).toBe(2);
    expect(quickActionColumns('web')).toBe(3);
  });
});

describe('recentActivities', () => {
  const base = {
    decks: [{ id: 'd1', title: 'Krebs cycle', setId: 's1', setTitle: 'Biochem', lastStudiedAt: '2026-09-10T10:00:00.000Z' }],
    tests: [{ id: 't1', title: 'Midterm mock', setId: 's1', setTitle: 'Biochem', lastAttemptAt: '2026-09-11T10:00:00.000Z', lastScore: 82.4 }],
    notes: [
      { id: 'n1', title: 'Lecture 4', setId: 's1', setTitle: 'Biochem', lastOpenedAt: '2026-09-12T10:00:00.000Z', isLecture: true },
      { id: 'n2', title: 'Chapter 3 reading', setId: 's1', lastOpenedAt: '2026-09-09T10:00:00.000Z' },
    ],
    conversations: [{ id: 'c1', title: 'Glycolysis help', lastMessageAt: '2026-09-13T10:00:00.000Z', lastMessagePreview: 'so ATP is...' }],
  };

  it('sorts every kind together, newest first', () => {
    expect(recentActivities(base).map((r) => r.id)).toEqual(['c1', 'n1', 't1', 'd1', 'n2']);
  });

  it('uses the StudyFetch verbs', () => {
    const byId = new Map(recentActivities(base).map((r) => [r.id, r.verb]));
    expect(byId.get('d1')).toBe('Practiced Flashcards');
    expect(byId.get('t1')).toBe('Took Test');
    expect(byId.get('n1')).toBe('Listened To Lecture');
    expect(byId.get('n2')).toBe('Studied Material');
    expect(byId.get('c1')).toBe('Asked Lantern');
  });

  it('routes each row back into the set it came from', () => {
    const byId = new Map(recentActivities(base).map((r) => [r.id, r.targetRoute]));
    expect(byId.get('d1')).toBe('/study/sets/s1/cards');
    expect(byId.get('t1')).toBe('/study/sets/s1/test');
    expect(byId.get('n1')).toBe('/study/sets/s1/lecture');
    expect(byId.get('n2')).toBe('/study/sets/s1/notes');
    expect(byId.get('c1')).toBe('/chat?conversation=c1');
  });

  it('sends a quiz attempt to the quiz path', () => {
    const [row] = recentActivities({
      tests: [{ id: 'q1', title: 'Pop quiz', setId: 's2', lastAttemptAt: '2026-09-11T10:00:00.000Z', kind: 'quiz' }],
    });
    expect(row.targetRoute).toBe('/study/sets/s2/quiz');
  });

  it('shows the last score in the subtitle when there is one', () => {
    const [row] = recentActivities({ tests: base.tests });
    expect(row.subtitle).toBe('Biochem · 82%');
  });

  it('omits rows that were never touched rather than inventing a time', () => {
    const rows = recentActivities({
      decks: [
        { id: 'd1', title: 'Never studied' },
        { id: 'd2', title: 'Bad stamp', lastStudiedAt: 'soon' },
        { id: 'd3', title: 'Real', lastStudiedAt: '2026-09-01T00:00:00.000Z' },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['d3']);
  });

  it('omits a whole kind the client does not have', () => {
    const rows = recentActivities({ decks: base.decks });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('flashcards');
    expect(recentActivities({})).toEqual([]);
  });

  it('caps at six rows by default and honours an explicit limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`,
      title: `Deck ${i}`,
      lastStudiedAt: new Date(Date.UTC(2026, 8, 1, i)).toISOString(),
    }));
    expect(recentActivities({ decks: many })).toHaveLength(RECENT_ACTIVITIES_LIMIT);
    expect(recentActivities({ decks: many, limit: 3 })).toHaveLength(3);
    expect(recentActivities({ decks: many })[0].id).toBe('d11');
  });

  it('orders ties the same way every render', () => {
    const at = '2026-09-01T00:00:00.000Z';
    const once = recentActivities({
      decks: [{ id: 'b', lastStudiedAt: at }, { id: 'a', lastStudiedAt: at }],
      tests: [{ id: 'z', lastAttemptAt: at }],
    });
    const twice = recentActivities({
      tests: [{ id: 'z', lastAttemptAt: at }],
      decks: [{ id: 'a', lastStudiedAt: at }, { id: 'b', lastStudiedAt: at }],
    });
    expect(once.map((r) => r.id)).toEqual(twice.map((r) => r.id));
    expect(once.map((r) => r.id)).toEqual(['a', 'b', 'z']);
  });

  it('falls back to an honest placeholder title', () => {
    const rows = recentActivities({
      decks: [{ id: 'd1', title: '   ', lastStudiedAt: '2026-09-01T00:00:00.000Z' }],
    });
    expect(rows[0].title).toBe('Untitled deck');
  });
});

describe('relativeActivityTime', () => {
  const now = new Date('2026-09-13T12:00:00.000Z');

  it('reads short at every scale', () => {
    expect(relativeActivityTime('2026-09-13T11:59:30.000Z', now)).toBe('Just now');
    expect(relativeActivityTime('2026-09-13T11:40:00.000Z', now)).toBe('20m ago');
    expect(relativeActivityTime('2026-09-13T09:00:00.000Z', now)).toBe('3h ago');
    expect(relativeActivityTime('2026-09-12T09:00:00.000Z', now)).toBe('Yesterday');
    expect(relativeActivityTime('2026-09-09T12:00:00.000Z', now)).toBe('4d ago');
    expect(relativeActivityTime('2026-08-30T12:00:00.000Z', now)).toBe('2w ago');
    expect(relativeActivityTime('2026-06-13T12:00:00.000Z', now)).toBe('3mo ago');
    expect(relativeActivityTime('2024-09-13T12:00:00.000Z', now)).toBe('2y ago');
  });

  it('says nothing rather than NaN for a bad stamp', () => {
    expect(relativeActivityTime('whenever', now)).toBe('');
  });
});

describe('targetRoute override', () => {
  it('keeps the client\'s exact resume path when it has one', () => {
    const [row] = recentActivities({
      decks: [
        {
          id: 'd1',
          title: 'Krebs',
          setId: 's1',
          lastStudiedAt: '2026-09-01T00:00:00.000Z',
          targetRoute: '/study/sets/s1/cards/d1/review',
        },
      ],
    });
    expect(row.targetRoute).toBe('/study/sets/s1/cards/d1/review');
  });

  it('falls back to the activity root when the override is blank', () => {
    const [row] = recentActivities({
      notes: [{ id: 'n1', setId: 's1', lastOpenedAt: '2026-09-01T00:00:00.000Z', targetRoute: '  ' }],
    });
    expect(row.targetRoute).toBe('/study/sets/s1/notes');
  });
});

describe('the spine is fixed', () => {
  it('does not shrink for a student with nothing yet', () => {
    const empty = homeRegions({ platform: 'mobile', studySetCount: 0 });
    const full = homeRegions({
      platform: 'mobile',
      studySetCount: 9,
      dueCount: 40,
      hasExamDate: true,
    });
    expect(empty.map((r) => r.id)).toEqual(full.map((r) => r.id));
  });
});
