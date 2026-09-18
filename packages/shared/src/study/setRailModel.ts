/**
 * The set-scoped section of the left rail.
 *
 * The reference product keeps every set section in the rail, not in a tab row
 * or a card grid: while you are inside a set, the rail *is* the set. This
 * module is the pure half of that — given the set, its activities, its notes
 * and the current path, it returns exactly the rows to draw and which one is
 * lit. Both the expanded and the collapsed rail render from the same model, so
 * an icon-only rail can never disagree with the labelled one about what is
 * active.
 *
 * Nothing here touches React, a store or the network. The web component
 * (`components/study/SetRail.tsx`) supplies the data and performs the
 * navigation.
 */
import {
  WORKSPACE_ACTIVITIES,
  type WorkspaceActivity,
  type WorkspaceActivityId,
  type WorkspaceIconName,
} from '../learning/courseWorkspace';
import {
  buildStudySetPath,
  parseStudySetPath,
  studySetRootPath,
  type StudySetPathActivity,
} from '../learning/studySetRoutes';

/** A note as the rail needs it — the fields every client already has. */
export interface SetRailNote {
  id: string;
  title?: string | null;
  folderId?: string | null;
}

/** A note folder as the rail needs it. */
export interface SetRailFolder {
  id: string;
  name?: string | null;
}

/**
 * How a row acts. `path` navigates; `companion` toggles the docked AI panel,
 * which is already scoped to the open set — Chat has no URL of its own, and
 * inventing one would be a second, lying route.
 */
export type SetRailAction =
  | { kind: 'path'; path: string }
  | { kind: 'companion' };

export interface SetRailLink {
  /** Stable id for keys and tests. */
  id: string;
  label: string;
  icon: WorkspaceIconName;
  action: SetRailAction;
  active: boolean;
}

export interface SetRailNoteNode {
  id: string;
  label: string;
  path: string;
  active: boolean;
}

export interface SetRailFolderNode {
  id: string;
  label: string;
  notes: SetRailNoteNode[];
  /** True when the open note lives in this folder — the folder opens itself. */
  active: boolean;
}

export interface SetRailMaterials {
  folders: SetRailFolderNode[];
  /** Notes in this set that are in no folder. */
  unfiled: SetRailNoteNode[];
  /** Every note in the set, folders and unfiled together. */
  total: number;
  /**
   * `View all`. The Library has no per-set filter — its only scopes are course
   * and topic — so "all the materials in this set" is the set's own Notes
   * route, which is the screen that actually filters to the set.
   */
  viewAllPath: string;
}

export interface SetRailPracticeGroup {
  id: 'practice';
  label: string;
  items: SetRailLink[];
  /** The group auto-opens when one of its children is the open activity. */
  hasActive: boolean;
}

export interface SetRailModel {
  setId: string;
  setTitle: string;
  /** The switcher pill: the set's own name, and where a click lands. */
  switcher: { label: string; fallbackPath: string };
  primary: SetRailLink[];
  practice: SetRailPracticeGroup;
  upload: SetRailLink;
  materials: SetRailMaterials;
}

export interface SetRailInput {
  setId: string;
  setTitle?: string | null;
  /** Defaults to `WORKSPACE_ACTIVITIES`; injectable so tests stay honest. */
  activities?: readonly WorkspaceActivity[];
  notes?: readonly SetRailNote[];
  folders?: readonly SetRailFolder[];
  /** `location.pathname`. Anything outside this set lights nothing. */
  activeRoute?: string | null;
}

/** Rows above the fold, in the reference's order. */
const PRIMARY_IDS: readonly WorkspaceActivityId[] = ['plan', 'lesson', 'lecture'];

/**
 * The practice drawer, in the reference's order. `walkthrough` is the
 * explainer and `recap` the listen-through; both keep their own Lantern names
 * so a student never meets two words for one door.
 */
const PRACTICE_IDS: readonly WorkspaceActivityId[] = [
  'quiz',
  'test',
  'cards',
  'play',
  'essay',
  'recap',
  // Re-measured 2026-09-17: the reference's drawer ends at Recap. Walkthrough
  // is Lantern's own door and it stays, at the end, because the set-home wall
  // no longer draws it — `OwnWayGrid.test.ts` asserts against this list that
  // nothing the wall dropped became unreachable.
  'walkthrough',
];

/**
 * Where the rail's wording differs from the activity list's. Both spellings
 * already ship in Lantern's own copy (the set room's grid says "Create
 * flashcards" and "Launch arcade"); the rail uses the longer, unambiguous one
 * because a rail row has no description under it.
 */
const RAIL_LABELS: Partial<Record<WorkspaceActivityId, string>> = {
  plan: 'Study plan',
  lecture: 'Record lecture',
  cards: 'Flashcards',
  // `play` had an override to 'Arcade' here while the activity registry, the
  // focus bar's tool menu and the studio header all said 'Play'. One door, two
  // words, and the rail was the odd one out — so the override is gone rather
  // than the other three being changed to match it.
};

/** Path activities that should light the row for a given activity id. */
const PATH_ALIASES: Partial<Record<WorkspaceActivityId, readonly StudySetPathActivity[]>> = {
  plan: ['plan', 'calendar'],
  walkthrough: ['walkthrough', 'read'],
};

function titleOf(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

/**
 * The open activity and note *within this set*. A path belonging to another
 * set (or to no set) lights nothing, which is what keeps the rail truthful
 * while a background navigation is mid-flight.
 */
function resolveActive(
  setId: string,
  activeRoute: string | null | undefined
): { activity: StudySetPathActivity | null; noteId: string | null } {
  if (!activeRoute) return { activity: null, noteId: null };
  const parsed = parseStudySetPath(activeRoute);
  if (!parsed || parsed.studySetId !== setId) return { activity: null, noteId: null };
  return { activity: parsed.activity, noteId: parsed.noteId ?? null };
}

function buildLink(
  activity: WorkspaceActivity,
  setId: string,
  activePathActivity: StudySetPathActivity | null
): SetRailLink {
  const pathActivity = activity.id as StudySetPathActivity;
  const aliases = PATH_ALIASES[activity.id] ?? [pathActivity];
  return {
    id: activity.id,
    label: RAIL_LABELS[activity.id] ?? activity.label,
    icon: activity.icon,
    action: { kind: 'path', path: buildStudySetPath({ studySetId: setId, activity: pathActivity }) },
    active: activePathActivity != null && aliases.includes(activePathActivity),
  };
}

function noteNodes(
  notes: readonly SetRailNote[],
  setId: string,
  activeNoteId: string | null
): SetRailNoteNode[] {
  // The caller's order is kept as given — it is the order the Library and the
  // set room already show, and a rail that re-sorts would disagree with both.
  return notes.map((note) => ({
    id: note.id,
    label: titleOf(note.title, 'Untitled note'),
    path: buildStudySetPath({ studySetId: setId, activity: 'notes', noteId: note.id }),
    active: activeNoteId != null && activeNoteId === note.id,
  }));
}

/**
 * Build the whole set section. Pure: same inputs, same rows, every time.
 */
export function buildSetRailModel(input: SetRailInput): SetRailModel {
  const setId = input.setId;
  const activities = input.activities ?? WORKSPACE_ACTIVITIES;
  const byId = new Map<WorkspaceActivityId, WorkspaceActivity>(
    activities.map((activity) => [activity.id, activity])
  );
  const { activity: activePathActivity, noteId: activeNoteId } = resolveActive(
    setId,
    input.activeRoute
  );

  const planLink = byId.get('plan');
  const tutorLink = byId.get('lesson');
  const lectureLink = byId.get('lecture');

  const primary: SetRailLink[] = [];
  if (planLink) primary.push(buildLink(planLink, setId, activePathActivity));
  // Chat sits second, as in the reference — it is the row students reach for
  // most, and it is the one row that opens a panel rather than a page.
  primary.push({
    id: 'chat',
    label: 'Chat',
    icon: 'sparkles',
    action: { kind: 'companion' },
    active: false,
  });
  if (tutorLink) primary.push(buildLink(tutorLink, setId, activePathActivity));
  if (lectureLink) primary.push(buildLink(lectureLink, setId, activePathActivity));
  // Any primary id we did not name explicitly keeps its place at the end
  // rather than vanishing, so a new activity is never silently unreachable.
  for (const id of PRIMARY_IDS) {
    if (id === 'plan' || id === 'lesson' || id === 'lecture') continue;
    const activity = byId.get(id);
    if (activity) primary.push(buildLink(activity, setId, activePathActivity));
  }

  const practiceItems = PRACTICE_IDS.map((id) => byId.get(id))
    .filter((activity): activity is WorkspaceActivity => Boolean(activity))
    .map((activity) => buildLink(activity, setId, activePathActivity));

  const notes = input.notes ?? [];
  const folders = input.folders ?? [];
  const folderNames = new Map(folders.map((folder) => [folder.id, titleOf(folder.name, 'Folder')]));

  const grouped = new Map<string, SetRailNote[]>();
  const unfiled: SetRailNote[] = [];
  for (const note of notes) {
    const folderId = note.folderId;
    // A note whose folder is not in `folders` (a folder still loading, or one
    // shared from elsewhere) is shown as unfiled rather than dropped — losing
    // a note from the tree is worse than filing it loosely.
    if (folderId && folderNames.has(folderId)) {
      const bucket = grouped.get(folderId);
      if (bucket) bucket.push(note);
      else grouped.set(folderId, [note]);
    } else {
      unfiled.push(note);
    }
  }

  const folderNodes: SetRailFolderNode[] = folders
    .filter((folder) => grouped.has(folder.id))
    .map((folder) => {
      const children = noteNodes(grouped.get(folder.id) ?? [], setId, activeNoteId);
      return {
        id: folder.id,
        label: folderNames.get(folder.id) ?? 'Folder',
        notes: children,
        active: children.some((note) => note.active),
      };
    });

  return {
    setId,
    setTitle: titleOf(input.setTitle, 'Study set'),
    switcher: { label: titleOf(input.setTitle, 'Study set'), fallbackPath: '/study' },
    primary,
    practice: {
      id: 'practice',
      label: 'Practice & activities',
      items: practiceItems,
      hasActive: practiceItems.some((item) => item.active),
    },
    upload: {
      id: 'upload',
      label: 'Upload',
      icon: 'cloud-upload',
      action: { kind: 'path', path: buildStudySetPath({ studySetId: setId, activity: 'add' }) },
      active: activePathActivity === 'add',
    },
    materials: {
      folders: folderNodes,
      unfiled: noteNodes(unfiled, setId, activeNoteId),
      total: notes.length,
      viewAllPath: buildStudySetPath({ studySetId: setId, activity: 'notes' }),
    },
  };
}

/** The set the given path is inside, or `null`. The one "inside a set" test. */
export function studySetIdForRoute(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  return parseStudySetPath(pathname)?.studySetId ?? null;
}

export { studySetRootPath };
