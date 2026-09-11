/**
 * Topic plan for a study set — units, topics, modes, and the next recommendation.
 */
export type StudySetMode = 'cram' | 'standard' | 'comprehensive';

export type StudySetTopicStatus = 'unseen' | 'covered' | 'mastered';

export interface StudySetUnit {
  id: string;
  studySetId: string;
  title: string;
  position: number;
}

export interface StudySetTopic {
  id: string;
  studySetId: string;
  unitId: string;
  title: string;
  position: number;
  status: StudySetTopicStatus;
  sourceNoteIds: string[];
}

export interface StudySetPlanProgress {
  topics: number;
  covered: number;
  mastered: number;
}

export function studySetPlanProgress(topics: readonly StudySetTopic[]): StudySetPlanProgress {
  return {
    topics: topics.length,
    covered: topics.filter((topic) => topic.status === 'covered' || topic.status === 'mastered').length,
    mastered: topics.filter((topic) => topic.status === 'mastered').length,
  };
}

export function studySetProgressPercent(progress: StudySetPlanProgress): number {
  if (progress.topics === 0) return 0;
  return Math.round(((progress.covered + progress.mastered) / (progress.topics * 2)) * 100);
}

export function pickRecommendedTopic(
  topics: readonly StudySetTopic[],
  mode: StudySetMode = 'standard'
): StudySetTopic | null {
  if (topics.length === 0) return null;
  const ordered = [...topics].sort((a, b) => a.position - b.position);
  if (mode === 'comprehensive') {
    return ordered.find((topic) => topic.status !== 'mastered') ?? ordered[ordered.length - 1] ?? null;
  }
  if (mode === 'cram') {
    return (
      ordered.find((topic) => topic.status === 'unseen') ??
      ordered.find((topic) => topic.status === 'covered') ??
      ordered[0] ??
      null
    );
  }
  return ordered.find((topic) => topic.status === 'unseen') ?? ordered.find((topic) => topic.status !== 'mastered') ?? ordered[0] ?? null;
}

export function topicIndexLabel(topics: readonly StudySetTopic[], topic: StudySetTopic): string {
  const siblings = topics.filter((row) => row.unitId === topic.unitId).sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((row) => row.id === topic.id);
  return `Topic ${index + 1} of ${siblings.length}`;
}

export function topicsFromReadingNotes(
  studySetId: string,
  notes: readonly { id: string; title?: string | null }[],
  unitId = `${studySetId}-unit-1`
): { unit: StudySetUnit; topics: StudySetTopic[] } {
  const unit: StudySetUnit = {
    id: unitId,
    studySetId,
    title: 'Your materials',
    position: 10,
  };
  const topics = notes.map((note, index) => ({
    id: `${studySetId}-topic-${note.id}`,
    studySetId,
    unitId,
    title: (note.title || '').trim() || `Topic ${index + 1}`,
    position: (index + 1) * 10,
    status: 'unseen' as const,
    sourceNoteIds: [note.id],
  }));
  return { unit, topics };
}

export const STUDY_SET_MODES: readonly { id: StudySetMode; label: string; promise: string }[] = [
  { id: 'cram', label: 'Cram', promise: 'Fewer topics, exam-weighted' },
  { id: 'standard', label: 'Standard', promise: 'Next uncovered topic' },
  { id: 'comprehensive', label: 'Comprehensive', promise: 'Mastery required before moving on' },
];
