/**
 * What Home shows, and where each region's taps land — the arithmetic half of
 * the phone's Home screen, with no React in it.
 *
 * Web's Home rework (`components/DashboardScreen.tsx`) is the functional
 * reference: greeting → your study sets → recent materials → upcoming exam →
 * quick actions. Web can act on a resume record's `href` directly, because on
 * web a route IS a path. The phone cannot: it navigates by screen name and
 * params, so the same `href` has to be translated. That translation is the
 * reason this file exists and is tested — a "Continue" button whose label and
 * destination disagree is exactly the defect `primaryHomeAction` was written
 * to prevent, and it would come straight back if the mapping lived inline in a
 * 1,500-line screen.
 *
 * Pure and node-testable: nothing here imports react-native. The shared
 * imports are SUBPATHS (`@lantern/shared/learning`, not `@lantern/shared`),
 * because mobile's jest maps subpaths and leaves the bare package unmapped.
 */
import {
  parseStudySetPath,
  studySetLabel,
  studySetProgressPercent,
  type StudySetPlanProgress,
} from '@lantern/shared/learning';
import { pluralize } from '@lantern/shared/utils/plural';
import type { FeatureKey, IllustrationName } from '@lantern/shared/design';
import type { StudySet } from '@lantern/shared/types';
// Type-only, so the node test never loads AppIcon's react-native subtree.
import type { AppIconName } from '../ui/AppIcon';

/** The regions of Home, in the order web renders them. */
export type HomeRegionId =
  | 'greeting'
  | 'studySets'
  | 'recentMaterials'
  | 'upcomingExam'
  | 'readiness'
  | 'quickActions'
  | 'streak'
  | 'joinClass';

/* ------------------------------------------------------------------ *
 * 1. Quick actions
 * ------------------------------------------------------------------ */

export type HomeQuickActionId =
  | 'import'
  | 'quiz'
  | 'companion'
  | 'tutor'
  | 'record'
  | 'study';

export interface HomeQuickActionSpec {
  id: HomeQuickActionId;
  /** The door's name, one line, in its white footer. */
  label: string;
  /** The footer glyph, and the panel drawing when there is no illustration. */
  icon: AppIconName;
  /** Hue. Identity, never state. */
  feature: FeatureKey;
  /** The panel's line drawing, for the two doors that have an asset. */
  illustration?: IllustrationName;
}

/**
 * Six doors, six glyphs, six hues.
 *
 * Web's own registry reuses `ai` for both Chat and Tutor and `notes` for both
 * Import and Open Study, which on a 2-up phone grid puts two identically
 * coloured pastels side by side and makes the grid read as three doors drawn
 * twice. On the phone each door takes a hue no sibling has: Tutor moves to
 * `campus` (it is a taught thing, not the companion) and Open Study to `sets`
 * (the hub is the sets' own place, and `STUDY_SET_TILE` already paints a set
 * in that teal).
 */
export const HOME_QUICK_ACTIONS: readonly HomeQuickActionSpec[] = [
  {
    id: 'import',
    label: 'Import',
    icon: 'cloud-upload',
    feature: 'notes',
    illustration: 'import-tray',
  },
  { id: 'quiz', label: 'Create a quiz', icon: 'clipboard-check', feature: 'tests' },
  { id: 'companion', label: 'Ask Lantern', icon: 'sparkles', feature: 'ai' },
  { id: 'tutor', label: 'Tutor', icon: 'school', feature: 'campus' },
  {
    id: 'record',
    label: 'Record',
    icon: 'mic',
    feature: 'recording',
    illustration: 'mic-wave',
  },
  { id: 'study', label: 'Open Study', icon: 'library', feature: 'sets' },
];

/* ------------------------------------------------------------------ *
 * 2. Resume href → a screen on the Study stack
 * ------------------------------------------------------------------ */

/**
 * A route on the Study stack, named so `toTab(screen, params)` can carry it
 * into a nested navigate. Split by param shape rather than collapsed to
 * `Record<string, unknown>` so a caller cannot hand `StudyCalendar` a deck id.
 */
export type ResumeRoute =
  | { screen: 'NoteEditor'; params: { noteId: string } }
  | { screen: 'DeckDetail'; params: { deckId: string } }
  | {
      screen:
        | 'CourseRoom'
        | 'AdaptiveQuiz'
        | 'LectureStudio'
        | 'LessonStudio'
        | 'RecapStudio'
        | 'EssayStudio'
        | 'PlayStudio'
        | 'StudyCalendar';
      params: { studySetId: string };
    };

/**
 * Translate a web resume `href` into the phone's nearest equivalent screen.
 *
 * Every activity that has its own studio on the Study stack goes there; the
 * rest land in the set's own room, which is where the activity lives anyway.
 * An href that is not a study-set path (or is nonsense) returns `null` so the
 * caller can fall back rather than navigate somewhere arbitrary.
 *
 * `test` deliberately falls to the room: `TestsList` is not scoped to a set,
 * so sending "continue your test" to a global list would be a worse lie than
 * sending it to the set the test is in.
 */
export function resumeRouteForHref(href: string | null | undefined): ResumeRoute | null {
  const path = typeof href === 'string' ? href.trim() : '';
  if (!path) return null;
  const parsed = parseStudySetPath(path);
  if (!parsed) return null;
  const { studySetId } = parsed;
  if (!studySetId) return null;

  switch (parsed.activity) {
    case 'notes':
      return parsed.noteId
        ? { screen: 'NoteEditor', params: { noteId: parsed.noteId } }
        : { screen: 'CourseRoom', params: { studySetId } };
    case 'cards':
      return parsed.deckId
        ? { screen: 'DeckDetail', params: { deckId: parsed.deckId } }
        : { screen: 'CourseRoom', params: { studySetId } };
    case 'quiz':
      return { screen: 'AdaptiveQuiz', params: { studySetId } };
    case 'lecture':
      return { screen: 'LectureStudio', params: { studySetId } };
    case 'lesson':
      return { screen: 'LessonStudio', params: { studySetId } };
    case 'recap':
      return { screen: 'RecapStudio', params: { studySetId } };
    case 'essay':
      return { screen: 'EssayStudio', params: { studySetId } };
    case 'play':
      return { screen: 'PlayStudio', params: { studySetId } };
    case 'plan':
    case 'calendar':
      return { screen: 'StudyCalendar', params: { studySetId } };
    default:
      return { screen: 'CourseRoom', params: { studySetId } };
  }
}

/* ------------------------------------------------------------------ *
 * 3. Upcoming exam
 * ------------------------------------------------------------------ */

export interface UpcomingExam {
  studySetId: string;
  /** The SET's name — a student wrote it, unlike a generated "Plan — …". */
  title: string;
  /** "YYYY-MM-DD". */
  examDate: string;
}

/**
 * The nearest exam a study set knows about, today or later.
 *
 * Dates are "YYYY-MM-DD" strings, so a lexical compare IS a chronological one
 * and no `Date` is constructed — which also means no timezone can move an
 * exam a day either way.
 */
export function nearestUpcomingExam(
  sets: readonly StudySet[],
  today: string
): UpcomingExam | null {
  const upcoming = sets
    .map((set) => {
      const examDate = (set.examDate || '').trim();
      if (!examDate || examDate < today) return null;
      return { studySetId: set.id, title: studySetLabel(set), examDate };
    })
    .filter((row): row is UpcomingExam => row != null)
    .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.title.localeCompare(b.title));
  return upcoming[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * 4. A study set's line of counts, and its progress
 * ------------------------------------------------------------------ */

export interface StudySetCounts {
  materials: number;
  lectures: number;
  decks: number;
}

/**
 * "1 material · 2 decks", never "1 materials · 2 cards".
 *
 * The old string hard-coded the plural `s` and called a deck a card, so a set
 * with one note and one deck read "1 materials · 1 cards" and a student
 * counting cards found one deck. Everything goes through the shared
 * `pluralize`, and a deck is called a deck.
 */
export function studySetCountsLabel(counts: StudySetCounts): string {
  const parts: string[] = [pluralize(counts.materials, 'material')];
  if (counts.lectures > 0) parts.push(pluralize(counts.lectures, 'lecture'));
  if (counts.decks > 0) parts.push(pluralize(counts.decks, 'deck'));
  return parts.join(' · ');
}

export interface StudySetProgress {
  percent: number;
  /**
   * `plan` — real coverage/mastery over the set's own topics.
   * `counts` — the fallback below, which is set-up progress and NOT mastery.
   * The caller labels the bar from this, so a 67% that means "three of the
   * four things a set needs are there" never gets read as "two thirds learnt".
   */
  basis: 'plan' | 'counts';
}

/**
 * How far along a set is.
 *
 * With a plan loaded this is `studySetProgressPercent` — the one definition of
 * set progress, shared with web. Mobile has no plan store yet, so the fallback
 * is honest about being something else: how much of a set EXISTS (materials,
 * decks, an exam date) and whether it has ever been studied. Four steps, so
 * the numbers a student sees are 0 / 25 / 50 / 75 / 100 rather than a
 * continuous figure that looks measured.
 */
export function studySetProgress(input: {
  plan?: StudySetPlanProgress | null;
  counts: StudySetCounts;
  hasExamDate?: boolean;
  studied?: boolean;
}): StudySetProgress {
  if (input.plan) {
    return { percent: clampPercent(studySetProgressPercent(input.plan)), basis: 'plan' };
  }
  const steps = [
    input.counts.materials > 0,
    input.counts.decks > 0,
    Boolean(input.hasExamDate),
    Boolean(input.studied),
  ];
  const done = steps.filter(Boolean).length;
  return { percent: Math.round((done / steps.length) * 100), basis: 'counts' };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/* ------------------------------------------------------------------ *
 * 5. Which regions render
 * ------------------------------------------------------------------ */

export interface HomeRegionsInput {
  studySetCount: number;
  /** Rows the resume endpoint returned (or the cached notes standing in). */
  recentMaterialCount: number;
  hasUpcomingExam: boolean;
}

/**
 * The regions Home draws, top to bottom.
 *
 * Greeting, quick actions, streak and Join a class are unconditional: they are
 * the screen's spine and a student with nothing yet still needs a way in.
 * "Your study sets" is unconditional too, because its empty state is the
 * invitation to make one. Recent materials hides when there is nothing recent
 * — an empty "Recent materials" heading is a heading over nothing. The exam
 * region always draws; without a date it falls back to readiness, which is
 * why both ids can appear.
 */
export function homeRegions(input: HomeRegionsInput): HomeRegionId[] {
  const regions: HomeRegionId[] = ['greeting', 'studySets'];
  if (input.recentMaterialCount > 0) regions.push('recentMaterials');
  regions.push(input.hasUpcomingExam ? 'upcomingExam' : 'readiness');
  regions.push('quickActions', 'streak', 'joinClass');
  return regions;
}

/* ------------------------------------------------------------------ *
 * 6. The quick-action grid's geometry
 * ------------------------------------------------------------------ */

export interface HomeQuickActionGrid {
  /** Doors per row. */
  columns: number;
  /** The width one door is told to draw itself at. */
  tileWidth: number;
  /** The gap between two doors in a row, echoed back for the container. */
  gutter: number;
}

/** Below this a 2-up row stops being two targets and becomes two slivers. */
export const HOME_DOOR_MIN_WIDTH = 128;

/**
 * How wide one Home door is, and how many fit in a row.
 *
 * WHY THIS EXISTS RATHER THAN `doorTileColumnWidth`. That helper divides the
 * WHOLE screen minus the door spec's own 13 dp page margin, but Home's scroll
 * view already pays 16 dp of horizontal padding, and the grid's gap is 12 dp
 * (`gap-3`), not the spec's 11. Two doors plus the gap therefore measured
 * `screenWidth - 25` inside a `screenWidth - 32` box: three pixels too wide,
 * so Yoga wrapped every door onto its own row at half width, and six doors
 * became four screens of scrolling (Wave P device pass, defect 5). The same
 * tile is correct in the set room because that grid is not padded twice.
 *
 * So the width is computed from the box the doors are actually in, and the
 * gutter the container actually draws — told, not hoped for. Falls to one
 * column only when two would each be narrower than
 * {@link HOME_DOOR_MIN_WIDTH}, which is a phone narrower than any shipping
 * device rather than a routine case.
 */
export function homeQuickActionGrid({
  screenWidth,
  horizontalPadding = 16,
  gutter = 12,
  maxColumns = 2,
}: {
  screenWidth: number;
  horizontalPadding?: number;
  gutter?: number;
  maxColumns?: number;
}): HomeQuickActionGrid {
  const available = Math.max(0, screenWidth - horizontalPadding * 2);
  const wanted = Math.max(1, Math.floor(maxColumns));
  const columns =
    wanted > 1 && (available - gutter * (wanted - 1)) / wanted < HOME_DOOR_MIN_WIDTH ? 1 : wanted;
  // Floor, never round: a rounded-up width of 179.5 is 359 in a 358 box, which
  // is the wrap this function exists to prevent.
  const tileWidth = Math.max(0, Math.floor((available - gutter * (columns - 1)) / columns));
  return { columns, tileWidth, gutter };
}

/* ------------------------------------------------------------------ *
 * 8. "Last studied …" on a set card
 * ------------------------------------------------------------------ */

/**
 * Is the cached set list old enough to be worth refetching on Home focus?
 *
 * Home renders sets from the store's cached list, so a set touched elsewhere
 * (the room stamps `lastStudiedAt` when it opens) leaves Home showing the
 * stamp it loaded with. Rather than reach into the store — another lane owns
 * it — Home refetches when it comes back into focus and the list is older
 * than `maxAgeMs`. Never synced at all counts as stale; a clock that has gone
 * backwards (`syncedAt` in the future) does not, so a device with a bad clock
 * refetches on every focus instead of never.
 */
export function shouldRefetchSets({
  syncedAt,
  now,
  maxAgeMs = 30_000,
}: {
  syncedAt: string | null | undefined;
  now: number;
  maxAgeMs?: number;
}): boolean {
  const stamp = typeof syncedAt === 'string' ? Date.parse(syncedAt) : NaN;
  if (!Number.isFinite(stamp)) return true;
  return now - stamp >= maxAgeMs;
}

/**
 * "Last studied 2h ago" — or null when the set has never been studied.
 *
 * Coarse on purpose: a set card is a glance, so the grain goes minutes →
 * hours → days → the date itself after a week. A stamp in the future (clock
 * skew, or a server stamping ahead) reads as "just now" rather than
 * "in -3 minutes".
 */
export function lastStudiedLabel(
  lastStudiedAt: string | null | undefined,
  now: number
): string | null {
  const stamp = typeof lastStudiedAt === 'string' ? Date.parse(lastStudiedAt) : NaN;
  if (!Number.isFinite(stamp)) return null;
  const minutes = Math.floor((now - stamp) / 60_000);
  if (minutes < 1) return 'Last studied just now';
  if (minutes < 60) return `Last studied ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last studied ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Last studied yesterday';
  if (days < 7) return `Last studied ${days}d ago`;
  return `Last studied ${new Date(stamp).toISOString().slice(0, 10)}`;
}
