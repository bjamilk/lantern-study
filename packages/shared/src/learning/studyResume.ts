/**
 * Home resume feed — last activity, recent materials, recent artifacts.
 */
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

export function mergeResumeActivities(
  current: StudyResumeActivity | null,
  incoming: StudyResumeActivity,
  existing: StudyResumeActivity[] = []
): { lastActivity: StudyResumeActivity; recentActivities: StudyResumeActivity[] } {
  const next = [incoming, ...existing.filter((row) => row.href !== incoming.href)].slice(0, 12);
  return { lastActivity: incoming, recentActivities: next };
}
