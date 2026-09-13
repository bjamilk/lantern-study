/**
 * The study plan drawn as a timeline: one rail, units on it, topics inside.
 *
 * WHY THIS FILE. `studySetPlanProgress` answers "how much of the whole set is
 * done" and `topicsInUnit` answers "which topics are in this unit", but the
 * plan page needs a third thing neither gives it: the per-unit arc, and what
 * each topic row is FOR right now — the one you are being sent to, the ones you
 * have finished, the ones still ahead. Computing that inline in the panel put
 * three different strike-through rules in three branches of one JSX tree the
 * first time it was tried, so it lives here, pure and tested.
 *
 * It is additive. Nothing here replaces a `learning/studySetPlan` export; every
 * function takes the same `StudySetTopic` rows those produce.
 */
import type {
  StudySetTopic,
  StudySetUnit,
} from '../learning/studySetPlan';

/**
 * What a topic row is, in the one frame the timeline cares about.
 *
 * `next` is deliberately a state of its own rather than a boolean beside the
 * status: exactly one row on the page carries the `Continue` pill, and letting
 * the row state say so is what stops two rows claiming it when a unit is
 * re-sorted.
 */
export type PlanTopicState = 'done' | 'covered' | 'next' | 'todo';

export interface PlanTopicRow {
  topic: StudySetTopic;
  state: PlanTopicState;
}

export interface PlanRing {
  /** Topics in this unit. */
  total: number;
  /** Read at least once — `covered` and `mastered` both count. */
  covered: number;
  /** Proved, not just seen. */
  mastered: number;
  /** 0-100, the arc to paint. */
  percent: number;
}

export interface PlanTimelineUnit {
  unit: StudySetUnit;
  ring: PlanRing;
  rows: PlanTopicRow[];
}

/**
 * The arc for a stretch of plan.
 *
 * Mastery is weighted double the way `studySetProgressPercent` weights it, so
 * the unit arcs and the sidebar's `Your progress` can never disagree about what
 * a percent means. A topic read once fills half its share; proving it fills the
 * rest. An empty unit is 0%, not NaN.
 */
export function planRing(topics: readonly StudySetTopic[]): PlanRing {
  const total = topics.length;
  const covered = topics.filter(
    (topic) => topic.status === 'covered' || topic.status === 'mastered'
  ).length;
  const mastered = topics.filter((topic) => topic.status === 'mastered').length;
  const percent = total === 0 ? 0 : Math.round(((covered + mastered) / (total * 2)) * 100);
  return { total, covered, mastered, percent };
}

/**
 * Is this topic finished?
 *
 * Only `mastered` strikes a row through. `covered` is "you have read it", which
 * is not the same claim, and a struck-through row you have not proved is the
 * plan lying to a student the night before an exam.
 */
export function isPlanTopicDone(topic: StudySetTopic): boolean {
  return topic.status === 'mastered';
}

export function planTopicState(
  topic: StudySetTopic,
  nextTopicId: string | null | undefined
): PlanTopicState {
  if (isPlanTopicDone(topic)) return 'done';
  // The recommendation wins over `covered`: a half-done topic you are being
  // sent back to needs the pill more than it needs the half-done tint.
  if (nextTopicId && topic.id === nextTopicId) return 'next';
  if (topic.status === 'covered') return 'covered';
  return 'todo';
}

/**
 * Every door `Continue` is allowed to open — each one an activity the room
 * actually has a chip and a route for.
 *
 * `read` is deliberately NOT a member. It was, and it was the bug: `read` is a
 * URL the room maps onto the WALKTHROUGH chip, so a topic whose note carried no
 * PDF was sent to `/read`, lit `Walkthrough`, and landed on "Select a note with
 * a PDF or slides attached." — a black `Continue` that opens an empty room. The
 * rule now names the chip, and the caller navigates to that chip's own route,
 * so the two cannot disagree again.
 */
export type PlanTopicActivity = 'notes' | 'walkthrough' | 'quiz' | 'cards' | 'lesson';

/** What the caller knows about the topic's first source note. */
export interface PlanTopicSource {
  /**
   * The source note carries a PDF or slides (`isWalkableAttachment`). Only then
   * does the walkthrough have a document to page through.
   */
  hasWalkableSource?: boolean;
}

/**
 * Which door `Continue` should open for a topic.
 *
 * The room's rule, stated once: a topic you have never seen is something to
 * READ, a topic you have read is something to be QUIZZED on, and a topic you
 * have proved is something to keep in memory with CARDS. A topic with no source
 * material cannot be read, so it starts at the tutor instead of opening an
 * empty reader — the one case where the rule bends, and it bends towards a
 * screen that has something on it.
 *
 * Reading splits by what the source IS: a note with a PDF or slides is read in
 * the walkthrough, page by page; a plain note is read in the notes studio. A
 * caller that cannot tell gets the studio, because a note always opens there
 * and the walkthrough only opens for some.
 */
export function planTopicActivity(
  topic: StudySetTopic,
  source?: PlanTopicSource
): PlanTopicActivity {
  if (topic.status === 'mastered') return 'cards';
  if (topic.status === 'covered') return 'quiz';
  if (topic.sourceNoteIds.length === 0) return 'lesson';
  return source?.hasWalkableSource ? 'walkthrough' : 'notes';
}

/**
 * The verb on the pill, so the panel and its test cannot drift apart.
 *
 * Both reading doors say `Read`: which one opens is a fact about the material,
 * not a different promise to the student, and the pill stays stable when a PDF
 * is attached to a note it already points at.
 */
export function planTopicActivityLabel(
  topic: StudySetTopic,
  source?: PlanTopicSource
): string {
  const kind = planTopicActivity(topic, source);
  if (kind === 'notes' || kind === 'walkthrough') return 'Read';
  if (kind === 'quiz') return 'Quiz';
  if (kind === 'cards') return 'Cards';
  return 'Tutor';
}

/**
 * Units in plan order, each with its arc and its rows.
 *
 * Units the caller passed that hold no topics are kept: an empty unit is a
 * stretch of the course with nothing filed under it yet, which is information a
 * student can act on, and dropping it silently renumbers everything after it.
 */
export function planTimeline(
  units: readonly StudySetUnit[],
  topics: readonly StudySetTopic[],
  nextTopicId: string | null | undefined
): PlanTimelineUnit[] {
  return [...units]
    .sort((a, b) => a.position - b.position)
    .map((unit) => {
      const unitTopics = topics
        .filter((topic) => topic.unitId === unit.id)
        .sort((a, b) => a.position - b.position);
      return {
        unit,
        ring: planRing(unitTopics),
        rows: unitTopics.map((topic) => ({
          topic,
          state: planTopicState(topic, nextTopicId),
        })),
      };
    });
}

/**
 * Which unit should be open when the page loads.
 *
 * The one holding the recommendation, so a student landing on the plan sees the
 * `Continue` pill without opening anything. Falls back to the first unit rather
 * than to none: a page of shut drawers is not a plan.
 */
export function initialOpenUnitId(
  timeline: readonly PlanTimelineUnit[]
): string | null {
  const withNext = timeline.find((entry) => entry.rows.some((row) => row.state === 'next'));
  return (withNext ?? timeline[0])?.unit.id ?? null;
}
