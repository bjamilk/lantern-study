/**
 * Nested URLs under `/study/sets/:id`. The set is the place; every tool is a
 * path inside it so Back, refresh and Home resume stay in the set.
 */
import type { WorkspaceActivityId } from './courseWorkspace';

export type StudySetPathActivity =
  | 'home'
  | 'add'
  | 'notes'
  | 'walkthrough'
  | 'cards'
  | 'quiz'
  | 'test'
  | 'lecture'
  | 'lesson'
  | 'recap'
  | 'play'
  | 'plan'
  | 'calendar'
  | 'essay'
  | 'read';

export type StudySetCardSession = 'review' | 'cram' | 'learn';
export type StudySetPlaySession = 'match';

export const STUDY_SET_PATH_ACTIVITIES: readonly StudySetPathActivity[] = [
  'home',
  'add',
  'notes',
  'walkthrough',
  'cards',
  'quiz',
  'test',
  'lecture',
  'lesson',
  'recap',
  'play',
  'plan',
  'calendar',
  'essay',
  'read',
];

const ACTIVITY_SET = new Set<string>(STUDY_SET_PATH_ACTIVITIES);

export function isStudySetPathActivity(value: unknown): value is StudySetPathActivity {
  return typeof value === 'string' && ACTIVITY_SET.has(value);
}

export function workspaceActivityFromPath(
  activity: StudySetPathActivity | undefined
): WorkspaceActivityId | 'home' | 'add' {
  if (!activity || activity === 'home') return 'home';
  if (activity === 'add') return 'add';
  if (activity === 'calendar') return 'plan';
  if (activity === 'read') return 'walkthrough';
  return activity;
}

export interface StudySetPath {
  studySetId: string;
  activity: StudySetPathActivity;
  noteId?: string;
  deckId?: string;
  testId?: string;
  quizId?: string;
  createNew?: boolean;
  cardSession?: StudySetCardSession;
  playSession?: StudySetPlaySession;
}

export function studySetRootPath(studySetId: string): string {
  return `/study/sets/${encodeURIComponent(studySetId)}`;
}

export function buildStudySetPath(input: StudySetPath): string {
  const root = studySetRootPath(input.studySetId);
  if (input.activity === 'home') return root;
  if (input.activity === 'notes' && input.noteId) {
    return `${root}/notes/${encodeURIComponent(input.noteId)}`;
  }
  if (input.activity === 'cards') {
    if (input.createNew) return `${root}/cards/new`;
    if (input.deckId && input.cardSession) {
      return `${root}/cards/${encodeURIComponent(input.deckId)}/${input.cardSession}`;
    }
    if (input.deckId) return `${root}/cards/${encodeURIComponent(input.deckId)}`;
    return `${root}/cards`;
  }
  if (input.activity === 'quiz') {
    if (input.createNew) return `${root}/quiz/new`;
    if (input.quizId) return `${root}/quiz/${encodeURIComponent(input.quizId)}`;
    return `${root}/quiz`;
  }
  if (input.activity === 'test') {
    if (input.createNew) return `${root}/test/new`;
    if (input.testId) return `${root}/test/${encodeURIComponent(input.testId)}`;
    return `${root}/test`;
  }
  if (input.activity === 'play') {
    if (input.createNew) return `${root}/play/new`;
    if (input.playSession === 'match') return `${root}/play/match`;
    return `${root}/play`;
  }
  if (
    input.createNew &&
    (input.activity === 'lesson' ||
      input.activity === 'recap' ||
      input.activity === 'lecture' ||
      input.activity === 'essay' ||
      input.activity === 'notes')
  ) {
    return `${root}/${input.activity}/new`;
  }
  if (
    input.noteId &&
    (input.activity === 'lesson' ||
      input.activity === 'recap' ||
      input.activity === 'lecture' ||
      input.activity === 'essay')
  ) {
    return `${root}/${input.activity}/${encodeURIComponent(input.noteId)}`;
  }
  return `${root}/${input.activity}`;
}

export function parseStudySetPath(pathname: string): StudySetPath | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'study' || parts[1] !== 'sets' || !parts[2]) return null;
  let studySetId = parts[2];
  try {
    studySetId = decodeURIComponent(studySetId);
  } catch {
    return null;
  }
  if (!studySetId) return null;
  if (parts.length === 3) {
    return { studySetId, activity: 'home' };
  }
  const activityRaw = parts[3];
  if (!isStudySetPathActivity(activityRaw) || activityRaw === 'home') {
    return { studySetId, activity: 'home' };
  }
  const rest = parts.slice(4);
  if (activityRaw === 'notes') {
    if (rest[0] === 'new') return { studySetId, activity: 'notes', createNew: true };
    return {
      studySetId,
      activity: 'notes',
      ...(rest[0] ? { noteId: decodeSegment(rest[0]) } : {}),
    };
  }
  if (activityRaw === 'cards') {
    if (rest[0] === 'new') return { studySetId, activity: 'cards', createNew: true };
    if (rest[0]) {
      const deckId = decodeSegment(rest[0]);
      const session = rest[1];
      if (session === 'review' || session === 'cram' || session === 'learn') {
        return { studySetId, activity: 'cards', deckId, cardSession: session };
      }
      return { studySetId, activity: 'cards', deckId };
    }
    return { studySetId, activity: 'cards' };
  }
  if (activityRaw === 'quiz') {
    if (rest[0] === 'new') return { studySetId, activity: 'quiz', createNew: true };
    if (rest[0]) return { studySetId, activity: 'quiz', quizId: decodeSegment(rest[0]) };
    return { studySetId, activity: 'quiz' };
  }
  if (activityRaw === 'test') {
    if (rest[0] === 'new') return { studySetId, activity: 'test', createNew: true };
    if (rest[0]) return { studySetId, activity: 'test', testId: decodeSegment(rest[0]) };
    return { studySetId, activity: 'test' };
  }
  if (activityRaw === 'play') {
    if (rest[0] === 'new') return { studySetId, activity: 'play', createNew: true };
    if (rest[0] === 'match') return { studySetId, activity: 'play', playSession: 'match' };
    return { studySetId, activity: 'play' };
  }
  if (
    activityRaw === 'lesson' ||
    activityRaw === 'recap' ||
    activityRaw === 'lecture' ||
    activityRaw === 'essay'
  ) {
    if (rest[0] === 'new') return { studySetId, activity: activityRaw, createNew: true };
    if (rest[0]) return { studySetId, activity: activityRaw, noteId: decodeSegment(rest[0]) };
    return { studySetId, activity: activityRaw };
  }
  return { studySetId, activity: activityRaw };
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type StudySetSortId =
  | 'lastAccessed'
  | 'recentlyCreated'
  | 'recentlyUpdated'
  | 'alphaAsc'
  | 'alphaDesc';

export const STUDY_SET_SORTS: readonly { id: StudySetSortId; label: string }[] = [
  { id: 'lastAccessed', label: 'Last accessed' },
  { id: 'recentlyCreated', label: 'Recently created' },
  { id: 'recentlyUpdated', label: 'Recently updated' },
  { id: 'alphaAsc', label: 'Alphabetical (A–Z)' },
  { id: 'alphaDesc', label: 'Alphabetical (Z–A)' },
];

export function sortStudySets<
  T extends {
    id: string;
    title: string;
    createdAt?: string;
    updatedAt?: string;
    lastStudiedAt?: string | null;
  },
>(sets: readonly T[], sort: StudySetSortId, lastOpenedId?: string | null): T[] {
  const copy = [...sets];
  const time = (value?: string | null) => (value ? Date.parse(value) || 0 : 0);
  copy.sort((a, b) => {
    if (sort === 'alphaAsc') return a.title.localeCompare(b.title);
    if (sort === 'alphaDesc') return b.title.localeCompare(a.title);
    if (sort === 'recentlyCreated') return time(b.createdAt) - time(a.createdAt);
    if (sort === 'recentlyUpdated') return time(b.updatedAt) - time(a.updatedAt);
    const aLast = time(a.lastStudiedAt) || time(a.updatedAt);
    const bLast = time(b.lastStudiedAt) || time(b.updatedAt);
    if (lastOpenedId && a.id === lastOpenedId) return -1;
    if (lastOpenedId && b.id === lastOpenedId) return 1;
    return bLast - aLast;
  });
  return copy;
}

export interface StudySetTypeCounts {
  materials: number;
  notes: number;
  lectures: number;
  quizzes: number;
  cards: number;
}

export function formatStudySetTypeChips(counts: StudySetTypeCounts): string[] {
  const chips: string[] = [];
  if (counts.materials > 0) chips.push(`${counts.materials} materials`);
  if (counts.lectures > 0) chips.push(`${counts.lectures}`);
  if (counts.notes > 0) chips.push(`${counts.notes}`);
  if (counts.quizzes > 0) chips.push(`${counts.quizzes}`);
  if (counts.cards > 0) chips.push(`${counts.cards}`);
  return chips;
}
