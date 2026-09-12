import type { StudySet } from '@lantern/shared/types';
import { primaryHomeAction, type StudyResumeActivity } from '@lantern/shared/learning';
import {
  HOME_DOOR_MIN_WIDTH,
  HOME_QUICK_ACTIONS,
  homeQuickActionGrid,
  homeRegions,
  lastStudiedLabel,
  shouldRefetchSets,
  nearestUpcomingExam,
  resumeRouteForHref,
  studySetCountsLabel,
  studySetProgress,
} from './homeSections';

function makeSet(patch: Partial<StudySet> & { id: string }): StudySet {
  return {
    userId: 'u1',
    title: `Set ${patch.id}`,
    ...patch,
  } as StudySet;
}

function activity(href: string): StudyResumeActivity {
  return { kind: 'note', title: 'Chapter 3', studySetId: 's1', href, at: '2026-09-10T09:00:00Z' };
}

describe('homeRegions', () => {
  const cases: { name: string; sets: number; materials: number; exam: boolean }[] = [
    { name: 'no sets, nothing recent', sets: 0, materials: 0, exam: false },
    { name: 'one set, nothing recent', sets: 1, materials: 0, exam: false },
    { name: 'many sets with materials', sets: 7, materials: 4, exam: true },
  ];

  it.each(cases)('always draws the spine ($name)', ({ sets, materials, exam }) => {
    const regions = homeRegions({
      studySetCount: sets,
      recentMaterialCount: materials,
      hasUpcomingExam: exam,
    });
    // The screen's spine: a student with nothing yet still gets a way in, and
    // "Your study sets" is what invites the first one.
    expect(regions).toEqual(
      expect.arrayContaining(['greeting', 'studySets', 'quickActions', 'streak', 'joinClass'])
    );
  });

  it('hides Recent materials rather than heading an empty region', () => {
    expect(
      homeRegions({ studySetCount: 3, recentMaterialCount: 0, hasUpcomingExam: false })
    ).not.toContain('recentMaterials');
    expect(
      homeRegions({ studySetCount: 3, recentMaterialCount: 1, hasUpcomingExam: false })
    ).toContain('recentMaterials');
  });

  it('falls back to readiness when no set names an exam', () => {
    const withExam = homeRegions({
      studySetCount: 2,
      recentMaterialCount: 2,
      hasUpcomingExam: true,
    });
    const without = homeRegions({
      studySetCount: 2,
      recentMaterialCount: 2,
      hasUpcomingExam: false,
    });
    expect(withExam).toContain('upcomingExam');
    expect(withExam).not.toContain('readiness');
    expect(without).toContain('readiness');
    expect(without).not.toContain('upcomingExam');
  });

  it('keeps web order: sets before materials before the exam before the doors', () => {
    const regions = homeRegions({
      studySetCount: 2,
      recentMaterialCount: 3,
      hasUpcomingExam: true,
    });
    expect(regions).toEqual([
      'greeting',
      'studySets',
      'recentMaterials',
      'upcomingExam',
      'quickActions',
      'streak',
      'joinClass',
    ]);
  });
});

describe('the greeting button agrees with itself', () => {
  // Not a re-test of the shared helper: this is the pairing the phone has to
  // honour — whatever `primaryHomeAction` labels the button, the phone must
  // have somewhere to send it.
  it('due cards win over a resume', () => {
    const action = primaryHomeAction({
      dueCardsCount: 12,
      lastActivity: activity('/study/sets/s1/quiz'),
    });
    expect(action.kind).toBe('review');
    expect(action.href).toBeUndefined();
  });

  it('a continue label always resolves to a screen', () => {
    const action = primaryHomeAction({
      dueCardsCount: 0,
      lastActivity: activity('/study/sets/s1/lesson'),
    });
    expect(action.kind).toBe('continue');
    expect(resumeRouteForHref(action.href)).toEqual({
      screen: 'LessonStudio',
      params: { studySetId: 's1' },
    });
  });

  it('with neither, the button offers the import it can actually open', () => {
    expect(primaryHomeAction({ dueCardsCount: 0, lastActivity: null }).kind).toBe('import');
  });
});

describe('resumeRouteForHref', () => {
  it('sends each activity to its own studio', () => {
    expect(resumeRouteForHref('/study/sets/s1/lecture')).toEqual({
      screen: 'LectureStudio',
      params: { studySetId: 's1' },
    });
    expect(resumeRouteForHref('/study/sets/s1/recap')).toEqual({
      screen: 'RecapStudio',
      params: { studySetId: 's1' },
    });
    expect(resumeRouteForHref('/study/sets/s1/play/match')).toEqual({
      screen: 'PlayStudio',
      params: { studySetId: 's1' },
    });
    expect(resumeRouteForHref('/study/sets/s1/calendar')).toEqual({
      screen: 'StudyCalendar',
      params: { studySetId: 's1' },
    });
  });

  it('opens a named note and a named deck directly', () => {
    expect(resumeRouteForHref('/study/sets/s1/notes/n9')).toEqual({
      screen: 'NoteEditor',
      params: { noteId: 'n9' },
    });
    expect(resumeRouteForHref('/study/sets/s1/cards/d4/review')).toEqual({
      screen: 'DeckDetail',
      params: { deckId: 'd4' },
    });
  });

  it('falls back to the set room for anything the phone has no screen for', () => {
    // `test` has no set-scoped list on the phone, and the room is where the
    // test lives — better than a global history that is not this set's.
    expect(resumeRouteForHref('/study/sets/s1/test/t2')).toEqual({
      screen: 'CourseRoom',
      params: { studySetId: 's1' },
    });
    expect(resumeRouteForHref('/study/sets/s1')).toEqual({
      screen: 'CourseRoom',
      params: { studySetId: 's1' },
    });
  });

  it('returns null rather than guessing at a path it does not own', () => {
    expect(resumeRouteForHref('/marketplace/listing/9')).toBeNull();
    expect(resumeRouteForHref('')).toBeNull();
    expect(resumeRouteForHref(undefined)).toBeNull();
  });
});

describe('nearestUpcomingExam', () => {
  const today = '2026-09-12';

  it('picks the nearest future date and names the set', () => {
    const exam = nearestUpcomingExam(
      [
        makeSet({ id: 'a', title: 'Pharmacology', examDate: '2026-12-01' }),
        makeSet({ id: 'b', title: 'Anatomy', examDate: '2026-10-03' }),
        makeSet({ id: 'c', title: 'Physics', examDate: '2026-11-20' }),
      ],
      today
    );
    expect(exam).toEqual({ studySetId: 'b', title: 'Anatomy', examDate: '2026-10-03' });
  });

  it('ignores exams that have already happened', () => {
    expect(
      nearestUpcomingExam([makeSet({ id: 'a', examDate: '2026-09-11' })], today)
    ).toBeNull();
  });

  it("counts today's exam as upcoming", () => {
    expect(nearestUpcomingExam([makeSet({ id: 'a', examDate: today })], today)?.examDate).toBe(
      today
    );
  });

  it('is null when no set carries a date, so the readiness card takes over', () => {
    expect(nearestUpcomingExam([makeSet({ id: 'a' }), makeSet({ id: 'b', examDate: '  ' })], today)).toBeNull();
    expect(nearestUpcomingExam([], today)).toBeNull();
  });
});

describe('studySetCountsLabel', () => {
  it('pluralises, and calls a deck a deck', () => {
    expect(studySetCountsLabel({ materials: 1, lectures: 0, decks: 1 })).toBe('1 material · 1 deck');
    expect(studySetCountsLabel({ materials: 3, lectures: 2, decks: 4 })).toBe(
      '3 materials · 2 lectures · 4 decks'
    );
  });

  it('keeps the zero material case honest instead of dropping the line', () => {
    expect(studySetCountsLabel({ materials: 0, lectures: 0, decks: 0 })).toBe('0 materials');
  });
});

describe('studySetProgress', () => {
  it('uses the shared plan percentage when a plan is loaded', () => {
    expect(
      studySetProgress({
        plan: { topics: 4, covered: 2, mastered: 2 },
        counts: { materials: 0, lectures: 0, decks: 0 },
      })
    ).toEqual({ percent: 50, basis: 'plan' });
  });

  it('falls back to set-up steps, and says so', () => {
    expect(
      studySetProgress({
        counts: { materials: 2, lectures: 0, decks: 1 },
        hasExamDate: true,
        studied: false,
      })
    ).toEqual({ percent: 75, basis: 'counts' });
    expect(
      studySetProgress({ counts: { materials: 0, lectures: 0, decks: 0 } })
    ).toEqual({ percent: 0, basis: 'counts' });
  });
});

describe('HOME_QUICK_ACTIONS', () => {
  it('is six doors', () => {
    expect(HOME_QUICK_ACTIONS).toHaveLength(6);
  });

  it('gives every door its own glyph', () => {
    const glyphs = HOME_QUICK_ACTIONS.map((action) => action.icon);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('gives every door its own hue, so no two pastels sit side by side alike', () => {
    const hues = HOME_QUICK_ACTIONS.map((action) => action.feature);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('has a unique id per door', () => {
    const ids = HOME_QUICK_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('homeQuickActionGrid', () => {
  // The defect this function exists for: two doors plus the gap must FIT the
  // padded row. On build 189 they were three pixels too wide and every door
  // wrapped onto its own line.
  const widths = [360, 375, 390, 393, 412, 428, 480, 768];

  it.each(widths)('fits two doors and a gutter inside the padded row at %i dp', (screenWidth) => {
    const { columns, tileWidth, gutter } = homeQuickActionGrid({ screenWidth });
    const available = screenWidth - 16 * 2;
    expect(columns).toBe(2);
    expect(tileWidth * columns + gutter * (columns - 1)).toBeLessThanOrEqual(available);
  });

  it('uses the row it is given, not the whole screen', () => {
    // 412 dp phone: 380 usable, minus a 12 gutter, halved = 184.
    expect(homeQuickActionGrid({ screenWidth: 412 })).toEqual({
      columns: 2,
      tileWidth: 184,
      gutter: 12,
    });
  });

  it('honours a caller that pays different padding or draws a different gap', () => {
    const grid = homeQuickActionGrid({ screenWidth: 400, horizontalPadding: 0, gutter: 20 });
    expect(grid).toEqual({ columns: 2, tileWidth: 190, gutter: 20 });
  });

  it('drops to one column rather than draw two slivers', () => {
    const grid = homeQuickActionGrid({ screenWidth: 240 });
    expect(grid.columns).toBe(1);
    expect(grid.tileWidth).toBeGreaterThanOrEqual(HOME_DOOR_MIN_WIDTH);
  });

  it('never returns a negative width on an absurd screen', () => {
    expect(homeQuickActionGrid({ screenWidth: 0 }).tileWidth).toBe(0);
  });
});

describe('shouldRefetchSets', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');

  it('refetches when the list has never been synced', () => {
    expect(shouldRefetchSets({ syncedAt: null, now })).toBe(true);
    expect(shouldRefetchSets({ syncedAt: 'not a date', now })).toBe(true);
  });

  it('refetches once the cached list is older than the window', () => {
    expect(shouldRefetchSets({ syncedAt: '2026-09-12T11:59:00Z', now })).toBe(true);
  });

  it('leaves a fresh list alone, so tab-flicking is not a fetch per tap', () => {
    expect(shouldRefetchSets({ syncedAt: '2026-09-12T11:59:50Z', now })).toBe(false);
  });

  it('refetches rather than never on a clock that has gone backwards', () => {
    expect(shouldRefetchSets({ syncedAt: '2026-09-12T13:00:00Z', now })).toBe(false);
  });
});

describe('lastStudiedLabel', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');

  it('says nothing for a set that has never been studied', () => {
    expect(lastStudiedLabel(null, now)).toBeNull();
    expect(lastStudiedLabel(undefined, now)).toBeNull();
    expect(lastStudiedLabel('', now)).toBeNull();
  });

  it.each([
    ['2026-09-12T11:59:40Z', 'Last studied just now'],
    ['2026-09-12T11:45:00Z', 'Last studied 15m ago'],
    ['2026-09-12T09:00:00Z', 'Last studied 3h ago'],
    ['2026-09-11T09:00:00Z', 'Last studied yesterday'],
    ['2026-09-09T09:00:00Z', 'Last studied 3d ago'],
    ['2026-08-01T09:00:00Z', 'Last studied 2026-08-01'],
  ])('reads %s as %s', (stamp, expected) => {
    expect(lastStudiedLabel(stamp, now)).toBe(expected);
  });

  it('reads a future stamp as just now rather than negative minutes', () => {
    expect(lastStudiedLabel('2026-09-12T12:05:00Z', now)).toBe('Last studied just now');
  });
});
