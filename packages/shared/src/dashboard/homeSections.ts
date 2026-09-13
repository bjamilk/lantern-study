/**
 * The one Home spine, shared by web and mobile.
 *
 * Home used to be two different products: the web dashboard led with cards and
 * a rail, the mobile dashboard led with progress telemetry, and neither agreed
 * on what a student sees first. This module is the single answer. It describes
 * the whole page — which regions exist, in what order, what each is called,
 * which ones may collapse — so a student who learns Home on one device already
 * knows Home on the other.
 *
 * It also builds the `Recent activities` feed: given whatever the client
 * already has in memory (decks, tests, lecture notes, companion threads), it
 * returns the handful of rows worth resuming, newest first.
 *
 * Nothing here touches React, a store or the network. Each client supplies the
 * data and performs the navigation.
 */

/* ------------------------------------------------------------------ *
 * Regions
 * ------------------------------------------------------------------ */

/** Every region of Home, in spine order. */
export type HomeRegionId =
  | 'greeting'
  | 'studySets'
  | 'recentMaterials'
  | 'recentActivities'
  | 'upcomingExam'
  | 'quickActions'
  | 'joinClass'
  | 'progress';

/** Which client is drawing Home. */
export type HomePlatform = 'web' | 'mobile';

export interface HomeRegion {
  id: HomeRegionId;
  /** Section heading. `greeting` has none — it renders the student's name. */
  label?: string;
  /** One line under the heading, when the region earns an explanation. */
  sublabel?: string;
  /** Whether the student may fold this region away. */
  collapsible: boolean;
  /**
   * True when the region is a door to another screen rather than content in
   * place. Mobile's progress telemetry is the only one.
   */
  door?: boolean;
}

export interface HomeRegionsInput {
  platform: HomePlatform;
  /** Number of cards due across every set right now. */
  dueCount?: number;
  /** Whether the student has an upcoming exam date recorded. */
  hasExamDate?: boolean;
  /**
   * How many study sets the student has. Accepted so a client can pass its
   * whole Home state in one object, but it deliberately does NOT change the
   * spine: a student with no sets still gets every region, because each
   * region's empty state is the invitation to fill it. A Home that grows and
   * shrinks its own outline teaches nobody where anything lives.
   */
  studySetCount?: number;
}

/**
 * The greeting's call to action. `Study all N due` is the whole point of Home
 * when work is waiting; with nothing due the greeting stays a greeting.
 */
export function dueCallToActionLabel(dueCount: number | undefined): string | undefined {
  if (!dueCount || dueCount <= 0) return undefined;
  return `Study all ${dueCount} due`;
}

/**
 * The spine. Both platforms render these regions in this order; only the
 * mobile-only `progress` door and the exam sublabel differ.
 */
export function homeRegions(input: HomeRegionsInput): HomeRegion[] {
  const { platform, dueCount, hasExamDate } = input;
  const regions: HomeRegion[] = [
    {
      id: 'greeting',
      sublabel: dueCallToActionLabel(dueCount),
      collapsible: false,
    },
    {
      id: 'studySets',
      label: 'Your study sets',
      sublabel: 'Pick up where you left off',
      collapsible: true,
    },
    {
      id: 'recentMaterials',
      label: 'Recent materials',
      sublabel: 'Notes, slides and readings you opened lately',
      collapsible: true,
    },
    {
      id: 'recentActivities',
      label: 'Recent activities',
      sublabel: 'Resume anything you were in the middle of',
      collapsible: true,
    },
    {
      id: 'upcomingExam',
      label: hasExamDate ? 'Upcoming exam' : 'Exam readiness',
      sublabel: hasExamDate
        ? undefined
        : 'Add an exam date to see how ready you are',
      collapsible: true,
    },
    {
      id: 'quickActions',
      label: 'Quick actions',
      collapsible: false,
    },
  ];

  // Mobile's progress telemetry is a door, not a wall of numbers on Home; web
  // keeps the streak in the right rail instead.
  if (platform === 'mobile') {
    regions.push({
      id: 'progress',
      label: 'Your progress',
      sublabel: 'Streak, mastery and study time',
      collapsible: false,
      door: true,
    });
  }

  regions.push({
    id: 'joinClass',
    label: 'Join a class',
    sublabel: 'Study with the people taking the same course',
    collapsible: false,
  });

  return regions;
}

/* ------------------------------------------------------------------ *
 * Quick actions
 * ------------------------------------------------------------------ */

export type HomeQuickActionId =
  | 'import'
  | 'createQuiz'
  | 'askLantern'
  | 'tutor'
  | 'recordLecture'
  | 'openStudy';

export interface HomeQuickAction {
  id: HomeQuickActionId;
  /** The label both platforms print. Identical wording is the point. */
  label: string;
  /** Icon name each client maps to its own icon set. */
  icon: string;
  /** Web path. Mobile maps the id to its own route. */
  targetRoute: string;
}

/** Six doors, same words on both platforms, same order. */
export const HOME_QUICK_ACTIONS: readonly HomeQuickAction[] = [
  { id: 'import', label: 'Import materials', icon: 'upload', targetRoute: '/study?import=1' },
  { id: 'createQuiz', label: 'Create a quiz', icon: 'help-circle', targetRoute: '/study?create=quiz' },
  { id: 'askLantern', label: 'Ask Lantern', icon: 'message-circle', targetRoute: '/chat' },
  { id: 'tutor', label: 'Tutor', icon: 'graduation-cap', targetRoute: '/tutor' },
  { id: 'recordLecture', label: 'Record a lecture', icon: 'mic', targetRoute: '/study?record=1' },
  { id: 'openStudy', label: 'Open Study', icon: 'layers', targetRoute: '/study' },
];

/** Tiles per row: 2-up on a phone, 3-up on a wide screen. */
export function quickActionColumns(platform: HomePlatform): 2 | 3 {
  return platform === 'mobile' ? 2 : 3;
}

/* ------------------------------------------------------------------ *
 * Recent activities
 * ------------------------------------------------------------------ */

export type RecentActivityKind =
  | 'flashcards'
  | 'test'
  | 'material'
  | 'lecture'
  | 'companion';

export interface RecentActivity {
  kind: RecentActivityKind;
  /** Past-tense verb line, greyed above the title. */
  verb: string;
  title: string;
  subtitle?: string;
  /** Web path; mobile maps `kind` + `id` to its own route. */
  targetRoute: string;
  /** ISO timestamp of the last touch. */
  at: string;
  /** Source entity id, so a client can route without re-parsing the path. */
  id: string;
}

/** StudyFetch-style verbs — what you did, not what the row is. */
export const RECENT_ACTIVITY_VERBS: Record<RecentActivityKind, string> = {
  flashcards: 'Practiced Flashcards',
  test: 'Took Test',
  material: 'Studied Material',
  lecture: 'Listened To Lecture',
  companion: 'Asked Lantern',
};

/** A deck the student has studied at least once. */
export interface RecentActivityDeck {
  id: string;
  title?: string | null;
  setId?: string | null;
  setTitle?: string | null;
  lastStudiedAt?: string | null;
  /**
   * Where this row resumes, when the client knows a more exact path than
   * the set's activity root — a paused deck session, say. Omitted, the model
   * routes to the activity itself.
   */
  targetRoute?: string | null;
}

/** A test or quiz with at least one attempt. */
export interface RecentActivityTest {
  id: string;
  title?: string | null;
  setId?: string | null;
  setTitle?: string | null;
  lastAttemptAt?: string | null;
  /** Percent score of the last attempt, when the client has it. */
  lastScore?: number | null;
  /** `quiz` rows say Took Test too — the student took a test either way. */
  kind?: 'test' | 'quiz';
  /**
   * Where this row resumes, when the client knows a more exact path than
   * the set's activity root — a paused deck session, say. Omitted, the model
   * routes to the activity itself.
   */
  targetRoute?: string | null;
}

/** A note or uploaded material. Lecture recordings set `isLecture`. */
export interface RecentActivityNote {
  id: string;
  title?: string | null;
  setId?: string | null;
  setTitle?: string | null;
  lastOpenedAt?: string | null;
  isLecture?: boolean;
  /**
   * Where this row resumes, when the client knows a more exact path than
   * the set's activity root — a paused deck session, say. Omitted, the model
   * routes to the activity itself.
   */
  targetRoute?: string | null;
}

/** A companion conversation. */
export interface RecentActivityConversation {
  id: string;
  title?: string | null;
  lastMessageAt?: string | null;
  /** Preview of the last message, trimmed by the caller if long. */
  lastMessagePreview?: string | null;
  /**
   * Where this row resumes, when the client knows a more exact path than
   * the set's activity root — a paused deck session, say. Omitted, the model
   * routes to the activity itself.
   */
  targetRoute?: string | null;
}

export interface RecentActivitiesInput {
  decks?: readonly RecentActivityDeck[];
  tests?: readonly RecentActivityTest[];
  notes?: readonly RecentActivityNote[];
  conversations?: readonly RecentActivityConversation[];
  /** How many rows Home shows. Defaults to six. */
  limit?: number;
}

/** Home shows at most this many rows. */
export const RECENT_ACTIVITIES_LIMIT = 6;

function timestamp(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return trimmed;
}

/**
 * The set's root path. Spelled the same way `buildStudySetPath` spells it, so
 * a row's href and the router agree about an id with a slash in it.
 */
function setRoot(setId: string): string {
  return `/study/sets/${encodeURIComponent(setId)}`;
}

function text(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The feed. A source the client does not have simply contributes nothing —
 * Home would rather show four honest rows than six with two invented.
 */
export function recentActivities(input: RecentActivitiesInput): RecentActivity[] {
  const rows: RecentActivity[] = [];

  for (const deck of input.decks ?? []) {
    const at = timestamp(deck.lastStudiedAt);
    if (!at) continue;
    rows.push({
      kind: 'flashcards',
      verb: RECENT_ACTIVITY_VERBS.flashcards,
      title: text(deck.title) ?? 'Untitled deck',
      subtitle: text(deck.setTitle),
      targetRoute:
        text(deck.targetRoute) ??
        (deck.setId
          ? `${setRoot(deck.setId)}/cards`
          : `/study/decks/${encodeURIComponent(deck.id)}`),
      at,
      id: deck.id,
    });
  }

  for (const test of input.tests ?? []) {
    const at = timestamp(test.lastAttemptAt);
    if (!at) continue;
    const score =
      typeof test.lastScore === 'number' && Number.isFinite(test.lastScore)
        ? `${Math.round(test.lastScore)}%`
        : undefined;
    const setTitle = text(test.setTitle);
    rows.push({
      kind: 'test',
      verb: RECENT_ACTIVITY_VERBS.test,
      title: text(test.title) ?? 'Untitled test',
      subtitle: [setTitle, score].filter(Boolean).join(' · ') || undefined,
      targetRoute:
        text(test.targetRoute) ??
        (test.setId
          ? `${setRoot(test.setId)}/${test.kind === 'quiz' ? 'quiz' : 'test'}`
          : `/study/tests/${encodeURIComponent(test.id)}`),
      at,
      id: test.id,
    });
  }

  for (const note of input.notes ?? []) {
    const at = timestamp(note.lastOpenedAt);
    if (!at) continue;
    const lecture = note.isLecture === true;
    rows.push({
      kind: lecture ? 'lecture' : 'material',
      verb: lecture ? RECENT_ACTIVITY_VERBS.lecture : RECENT_ACTIVITY_VERBS.material,
      title: text(note.title) ?? (lecture ? 'Untitled lecture' : 'Untitled material'),
      subtitle: text(note.setTitle),
      targetRoute:
        text(note.targetRoute) ??
        (note.setId
          ? `${setRoot(note.setId)}/${lecture ? 'lecture' : 'notes'}`
          : `/notes/${encodeURIComponent(note.id)}`),
      at,
      id: note.id,
    });
  }

  for (const conversation of input.conversations ?? []) {
    const at = timestamp(conversation.lastMessageAt);
    if (!at) continue;
    rows.push({
      kind: 'companion',
      verb: RECENT_ACTIVITY_VERBS.companion,
      title: text(conversation.title) ?? 'Lantern conversation',
      subtitle: text(conversation.lastMessagePreview),
      targetRoute:
        text(conversation.targetRoute) ??
        `/chat?conversation=${encodeURIComponent(conversation.id)}`,
      at,
      id: conversation.id,
    });
  }

  const limit =
    typeof input.limit === 'number' && input.limit > 0
      ? Math.floor(input.limit)
      : RECENT_ACTIVITIES_LIMIT;

  // Newest first; ties resolve by kind then id so the order never flickers
  // between two renders of the same data.
  rows.sort((a, b) => {
    const delta = Date.parse(b.at) - Date.parse(a.at);
    if (delta !== 0) return delta;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return rows.slice(0, limit);
}

/**
 * `2h ago`, `Yesterday`, `3d ago`. Short enough to sit at the end of a row
 * without pushing the title out of the way.
 */
export function relativeActivityTime(at: string, now: Date = new Date()): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
