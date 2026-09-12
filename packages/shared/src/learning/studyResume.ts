/**
 * Home resume feed — last activity, recent materials, recent artifacts.
 */
import type { FeatureKey } from '../design';
import { getStudyAllDueLabel } from '../flashcards/labels';
import {
  WORKSPACE_ACTIVITIES,
  type WorkspaceActivityId,
  type WorkspaceIconName,
} from './courseWorkspace';

export type StudyResumeKind =
  | 'note'
  | 'lecture'
  | 'quiz'
  | 'cards'
  | 'recap'
  | 'lesson'
  | 'play'
  | 'test'
  | 'essay';

export interface StudyResumeActivity {
  kind: StudyResumeKind;
  title: string;
  studySetId: string;
  href: string;
  at: string;
}

export interface StudyResumeMaterial {
  id: string;
  title: string;
  studySetId: string;
  kind: 'note' | 'lecture';
  href: string;
  preview?: string;
  updatedAt: string;
}

export interface StudyResume {
  lastActivity: StudyResumeActivity | null;
  recentMaterials: StudyResumeMaterial[];
  recentActivities: StudyResumeActivity[];
}

export const STUDY_RESUME_STORAGE_KEY = 'lantern.lastStudyActivity';

export function emptyStudyResume(): StudyResume {
  return { lastActivity: null, recentMaterials: [], recentActivities: [] };
}

export function parseStudyResumeActivity(raw: unknown): StudyResumeActivity | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.kind !== 'string' || typeof row.title !== 'string') return null;
  if (typeof row.studySetId !== 'string' || typeof row.href !== 'string') return null;
  if (typeof row.at !== 'string') return null;
  return {
    kind: row.kind as StudyResumeKind,
    title: row.title,
    studySetId: row.studySetId,
    href: row.href,
    at: row.at,
  };
}

export function resumeGreeting(activity: StudyResumeActivity | null, setTitle?: string): string {
  if (!activity) {
    return 'Import something, or open a study set.';
  }
  const where = setTitle?.trim() || 'your study set';
  if (activity.kind === 'cards') {
    return `I was just reviewing flashcards in ${where}. Ready to pick up?`;
  }
  if (activity.kind === 'quiz' || activity.kind === 'test') {
    return `I was just looking at a quiz in ${where}. Ready to pick up?`;
  }
  if (activity.kind === 'lecture') {
    return `We left a lecture in ${where}. Ready to continue?`;
  }
  if (activity.kind === 'recap') {
    return `I was just listening in ${where}. Ready to continue?`;
  }
  return `Continue from ${activity.title} in ${where}.`;
}

export type PrimaryHomeActionKind = 'review' | 'continue' | 'import';

export interface PrimaryHomeAction {
  label: string;
  kind: PrimaryHomeActionKind;
  /** Present only for `continue` — the resume record's own href. */
  href?: string;
}

/**
 * The one button at the top of Home. Label and destination come out of the
 * same call so a button that says "Continue" cannot land on an import screen:
 * the hero renders `label` and the screen acts on `kind`/`href`.
 *
 * Due cards win — a review that is already owed is more urgent than resuming
 * where you left off.
 */
export function primaryHomeAction(input: {
  dueCardsCount: number;
  lastActivity: StudyResumeActivity | null;
}): PrimaryHomeAction {
  const due = Number.isFinite(input.dueCardsCount) ? Math.max(0, Math.trunc(input.dueCardsCount)) : 0;
  if (due > 0) {
    return { kind: 'review', label: getStudyAllDueLabel(due) };
  }
  const href = input.lastActivity?.href?.trim();
  if (href) {
    return { kind: 'continue', label: 'Continue', href };
  }
  return { kind: 'import', label: 'Import & study' };
}

/**
 * A resume row wears the same glyph and hue as the workspace activity it came
 * from, so the same object does not change colour between Home and the set.
 * The kinds are the activity ids modulo `note` → `notes`.
 */
const RESUME_KIND_ACTIVITY: Record<StudyResumeKind, WorkspaceActivityId> = {
  note: 'notes',
  lecture: 'lecture',
  quiz: 'quiz',
  cards: 'cards',
  recap: 'recap',
  lesson: 'lesson',
  play: 'play',
  test: 'test',
  essay: 'essay',
};

export function resumeKindPresentation(kind: StudyResumeKind): {
  icon: WorkspaceIconName;
  feature: FeatureKey;
} {
  const activityId = RESUME_KIND_ACTIVITY[kind] ?? 'notes';
  const row =
    WORKSPACE_ACTIVITIES.find((activity) => activity.id === activityId) ??
    WORKSPACE_ACTIVITIES.find((activity) => activity.id === 'notes')!;
  return { icon: row.icon, feature: row.feature };
}

export function mergeResumeActivities(
  current: StudyResumeActivity | null,
  incoming: StudyResumeActivity,
  existing: StudyResumeActivity[] = []
): { lastActivity: StudyResumeActivity; recentActivities: StudyResumeActivity[] } {
  const next = [incoming, ...existing.filter((row) => row.href !== incoming.href)].slice(0, 12);
  return { lastActivity: incoming, recentActivities: next };
}
