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

export function unitsForTopics(
  units: readonly StudySetUnit[],
  topics: readonly StudySetTopic[]
): StudySetUnit[] {
  if (units.length > 0) {
    return [...units].sort((a, b) => a.position - b.position);
  }
  const seen = new Map<string, StudySetUnit>();
  for (const topic of topics) {
    if (seen.has(topic.unitId)) continue;
    seen.set(topic.unitId, {
      id: topic.unitId,
      studySetId: topic.studySetId,
      title: 'Your materials',
      position: topic.position,
    });
  }
  return [...seen.values()];
}

export function topicsInUnit(
  topics: readonly StudySetTopic[],
  unitId: string
): StudySetTopic[] {
  return topics.filter((topic) => topic.unitId === unitId).sort((a, b) => a.position - b.position);
}

/**
 * "Topic 2 of 3 from AI Foundations" — the plan band's one line.
 *
 * WHY THIS EXISTS BESIDE `topicIndexLabel`. That function answers "where am I
 * in this unit" and stops there, which on a set with four units told the
 * student `Topic 1 of 4` four different times and never once said which stretch
 * of the course they were standing in. The unit name is the half that makes the
 * number mean anything, and it is only knowable here, where the units are.
 *
 * The unit name is appended, never substituted: a plan whose units were never
 * named (or a topic whose unit has been deleted out from under it) falls back
 * to the bare index rather than rendering `from undefined`.
 */
export function topicUnitLabel(
  topics: readonly StudySetTopic[],
  units: readonly StudySetUnit[],
  topic: StudySetTopic
): string {
  const base = topicIndexLabel(topics, topic);
  const unit = units.find((row) => row.id === topic.unitId);
  const name = (unit?.title || '').trim();
  return name ? `${base} from ${name}` : base;
}

/**
 * Group topics into one unit per SOURCE MATERIAL, naming each unit after the
 * note it came from.
 *
 * `topicsFromReadingNotes` — the local fallback a set uses before the server
 * has a plan — files every topic under a single unit called "Your materials".
 * That is honest but flat: the plan band's numbered `01`–`0N` pills have
 * exactly one pill to draw, so a student with six lectures sees no structure at
 * all until a server plan arrives.
 *
 * This derives the missing level from the only grouping the local data actually
 * has: which material a topic was read out of. A topic with several sources is
 * filed under its first (the note it was generated from); a topic with none
 * keeps whatever unit it already had, because inventing a unit for it would be
 * worse than leaving it where it is.
 *
 * ADDITIVE. Nothing calls this instead of `unitsForTopics`; it runs before it,
 * and only when the stored plan has fewer than two units.
 */
export function unitsFromSourceMaterials(
  topics: readonly StudySetTopic[],
  materials: readonly { id: string; title?: string | null }[]
): { units: StudySetUnit[]; topics: StudySetTopic[] } {
  const titleFor = new Map(materials.map((row) => [row.id, (row.title || '').trim()]));
  const units = new Map<string, StudySetUnit>();
  const next: StudySetTopic[] = [];
  for (const topic of topics) {
    const sourceId = topic.sourceNoteIds[0];
    const title = sourceId ? titleFor.get(sourceId) : undefined;
    if (!sourceId || !title) {
      next.push(topic);
      continue;
    }
    const unitId = `${topic.studySetId}-material-${sourceId}`;
    if (!units.has(unitId)) {
      units.set(unitId, {
        id: unitId,
        studySetId: topic.studySetId,
        // Position by first appearance, so the pills run in the order the
        // topics already run in rather than alphabetically by note title.
        position: (units.size + 1) * 10,
        title,
      });
    }
    next.push({ ...topic, unitId });
  }
  // Every topic kept its original unit: nothing was grouped, so report no
  // derived units rather than a half-built list the caller has to re-check.
  if (units.size === 0) return { units: [], topics: [...topics] };
  return { units: [...units.values()], topics: next };
}
