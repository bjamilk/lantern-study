import type { StudySet } from '@lantern/shared/types';
import { primaryHomeAction, type StudyResumeActivity } from '@lantern/shared/learning';
import type { HomeRegionsInput } from '@lantern/shared/dashboard';
import {
  HOME_DOOR_MIN_WIDTH,
  HOME_QUICK_ACTIONS,
  RECENT_ACTIVITIES_LIMIT,
  homeQuickActionGrid,
  homeRegions,
  progressSummaryLine,
  recentActivitiesFromResume,
  recentActivityRoute,
  type HomeRegionId,
  type RecentActivity,
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

describe('homeRegions — the shared spine, as the phone draws it', () => {
  // Not a re-test of the shared helper: these are the two facts the SCREEN
  // depends on. It renders a fixed list of JSX in a fixed order, so if the
  // spine ever grows a region or reorders one, this fails rather than the
  // phone quietly drawing the old order.
  const mobile = (patch: Partial<HomeRegionsInput> = {}): HomeRegionId[] =>
    homeRegions({ platform: 'mobile', ...patch }).map((region) => region.id);

  it('is the eight regions DashboardScreen renders, in that order', () => {
    expect(mobile({ dueCount: 12, hasExamDate: true })).toEqual([
      'greeting',
      'studySets',
      'recentMaterials',
      'recentActivities',
      'upcomingExam',
      'quickActions',
      'progress',
      'joinClass',
    ]);
  });

  it('keeps the spine whole for a student with nothing yet', () => {
    // No sets, no exam, nothing due: every region still has its place, because
    // each one's empty state is the invitation to fill it.
    expect(mobile()).toEqual(mobile({ dueCount: 40, hasExamDate: true }));
  });

  it('gives the phone a progress DOOR — web renders the figures instead', () => {
    const progress = homeRegions({ platform: 'mobile' }).find((r) => r.id === 'progress');
    expect(progress?.door).toBe(true);
    expect(homeRegions({ platform: 'web' }).some((r) => r.id === 'progress')).toBe(false);
  });

  it('labels the exam slot by whether a date is known', () => {
    const slot = (hasExamDate: boolean) =>
      homeRegions({ platform: 'mobile', hasExamDate }).find((r) => r.id === 'upcomingExam');
    expect(slot(true)?.label).toBe('Upcoming exam');
    // No date: the phone draws CourseReadinessCard in this slot, and the
    // heading has to say readiness rather than promise an exam.
    expect(slot(false)?.label).toBe('Exam readiness');
  });
});

describe('recentActivitiesFromResume', () => {
  it('gives every row a past-tense verb that matches its kind', () => {
    const rows = recentActivitiesFromResume([
      { kind: 'cards', title: 'Pharm deck', studySetId: 's1', href: '/study/sets/s1/cards', at: '2026-09-12T09:00:00Z' },
      { kind: 'quiz', title: 'Week 4 quiz', studySetId: 's1', href: '/study/sets/s1/quiz', at: '2026-09-12T08:00:00Z' },
      { kind: 'lecture', title: 'Lecture 9', studySetId: 's1', href: '/study/sets/s1/lecture', at: '2026-09-12T07:00:00Z' },
    ]);
    expect(rows.map((r) => [r.kind, r.verb])).toEqual([
      ['flashcards', 'Practiced Flashcards'],
      ['test', 'Took Test'],
      ['lecture', 'Listened To Lecture'],
    ]);
  });

  it('folds the made-from-material kinds onto the material verb', () => {
    // Five honest verbs beat nine that each appear once.
    const kinds = ['recap', 'lesson', 'play', 'essay', 'note'] as const;
    const rows = recentActivitiesFromResume(
      kinds.map((kind) => ({
        kind,
        title: kind,
        studySetId: 's1',
        href: `/study/sets/s1/${kind}`,
        at: '2026-09-12T09:00:00Z',
      }))
    );
    expect(rows.every((r) => r.kind === 'material' && r.verb === 'Studied Material')).toBe(true);
  });

  it('never hands Home more rows than the shared limit', () => {
    const rows = recentActivitiesFromResume(
      Array.from({ length: 20 }, (_, i) => ({
        kind: 'note' as const,
        title: `n${i}`,
        studySetId: 's1',
        href: `/study/sets/s1/notes/n${i}`,
        at: '2026-09-12T09:00:00Z',
      }))
    );
    expect(rows).toHaveLength(RECENT_ACTIVITIES_LIMIT);
  });
});

describe('recentActivityRoute — tap resumes the ACTIVITY, not its set', () => {
  const row = (patch: Partial<RecentActivity>): RecentActivity => ({
    kind: 'material',
    verb: 'Studied Material',
    title: 'Chapter 3',
    targetRoute: '/study/sets/s1/notes/n1',
    at: '2026-09-12T09:00:00Z',
    id: 'n1',
    ...patch,
  });

  it('translates a study-set path to its studio', () => {
    expect(recentActivityRoute(row({ targetRoute: '/study/sets/s1/quiz' }))).toEqual({
      screen: 'AdaptiveQuiz',
      params: { studySetId: 's1' },
    });
  });

  it('falls back to the row s own id when it has no set', () => {
    // `/study/decks/d9` is not a set path, so the deck id on the row is the
    // only thing that can name a screen.
    expect(
      recentActivityRoute(row({ kind: 'flashcards', targetRoute: '/study/decks/d9', id: 'd9' }))
    ).toEqual({ screen: 'DeckDetail', params: { deckId: 'd9' } });
    expect(
      recentActivityRoute(row({ kind: 'material', targetRoute: '/notes/n9', id: 'n9' }))
    ).toEqual({ screen: 'NoteEditor', params: { noteId: 'n9' } });
  });

  it('returns null for a companion row rather than inventing a screen', () => {
    // The Study stack has no conversation screen; the caller opens the
    // companion instead of navigating somewhere arbitrary.
    expect(
      recentActivityRoute(row({ kind: 'companion', targetRoute: '/chat?conversation=c1', id: 'c1' }))
    ).toBeNull();
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

  it('prints the shared labels, so the phone and web name a door the same', () => {
    // The reviewer's wording, and web's: "Import" and "Record" used to be the
    // phone's own shorter labels, which made the same door two things.
    expect(HOME_QUICK_ACTIONS.map((action) => action.label)).toEqual([
      'Import materials',
      'Create a quiz',
      'Ask Lantern',
      'Tutor',
      'Record a lecture',
      'Open Study',
    ]);
  });
});

describe('progressSummaryLine — the door s one claim', () => {
  const known = { streak: 12, level: { level: 4, name: 'Scholar' }, points: 1280 };

  it('names the three facts in order', () => {
    expect(progressSummaryLine({ ...known, known: true, pending: false })).toBe(
      '12 day streak · Level 4 Scholar · 1,280 XP'
    );
  });

  it('says it does not know rather than printing zeros', () => {
    // Offline with nothing cached. "0 day streak · Level 1 · 0 XP" at a
    // student who has studied for a month is the exact defect the greeting
    // card was fixed for; the door must not bring it back.
    const line = progressSummaryLine({ ...known, known: false, pending: false });
    expect(line).not.toMatch(/\d/);
    expect(line).toMatch(/reconnect/);
  });

  it('says it is still loading for the beat before hydration', () => {
    const line = progressSummaryLine({ streak: 0, level: null, points: 0, known: true, pending: true });
    expect(line).not.toMatch(/0 day streak/);
    expect(line).toMatch(/Loading/);
  });

  it('falls back to Level 1 rather than dropping the field', () => {
    // A real account whose level has not arrived still gets three fields, so
    // the line does not change shape between two renders of the same card.
    expect(progressSummaryLine({ streak: 3, level: null, points: 40, known: true, pending: false }))
      .toBe('3 day streak · Level 1 · 40 XP');
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
