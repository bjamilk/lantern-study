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

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------
// The reference's `Sort By` menu. It reorders the UNITS on the page and never
// the topics inside one: a unit's topics run in the order the course teaches
// them, and shuffling those would make "Topic 2 of 3" name a different row
// depending on a menu.

export type PlanSortKey = 'recommended' | 'unit' | 'weakest';

/**
 * The menu, in menu order, with the default first.
 *
 * Three real orders, not one. The plan panel shipped with no sort control at
 * all and a comment arguing that a menu with a single option is furniture —
 * that argument was right, and it is answered by giving the menu something to
 * do rather than by drawing it empty.
 */
export const PLAN_SORT_OPTIONS: readonly { id: PlanSortKey; label: string; promise: string }[] = [
  { id: 'recommended', label: 'Recommended', promise: 'The unit you are in first' },
  { id: 'unit', label: 'Unit order', promise: 'The order the course teaches them' },
  { id: 'weakest', label: 'Weakest first', promise: 'Least covered at the top' },
];

export const DEFAULT_PLAN_SORT: PlanSortKey = 'recommended';

/** Read an unknown (a persisted value, a URL) as a sort key. */
export function asPlanSortKey(value: unknown): PlanSortKey {
  return PLAN_SORT_OPTIONS.some((option) => option.id === value)
    ? (value as PlanSortKey)
    : DEFAULT_PLAN_SORT;
}

/**
 * Reorder the timeline's units for the `Sort By` menu.
 *
 * PURE AND TOTAL. Every unit that went in comes out exactly once, whatever the
 * key — a sort that can drop a unit is a sort that can hide a student's work.
 * The input array is not mutated.
 *
 * - `unit` returns plan order, which is what `planTimeline` already built.
 * - `recommended` lifts the unit carrying the `Continue` pill to the top and
 *   leaves everything else in plan order behind it. It does NOT sort by
 *   progress: the recommendation already encodes the mode's rule about where
 *   you should be, and re-ranking the rest would argue with it.
 * - `weakest` is ascending by arc. Ties break on plan position so the order is
 *   stable frame to frame; EMPTY units (no topics, so 0%) sort last rather than
 *   first, because "nothing filed here yet" is not the weakest thing you know —
 *   it is the absence of anything to know.
 */
export function sortPlanTimeline<T extends PlanTimelineUnit>(
  timeline: readonly T[],
  sort: PlanSortKey
): T[] {
  const rows = [...timeline];
  if (sort === 'unit') return rows;
  if (sort === 'recommended') {
    const index = rows.findIndex((entry) => entry.rows.some((row) => row.state === 'next'));
    if (index <= 0) return rows;
    const [picked] = rows.splice(index, 1);
    return picked ? [picked, ...rows] : rows;
  }
  return rows
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aEmpty = a.entry.ring.total === 0 ? 1 : 0;
      const bEmpty = b.entry.ring.total === 0 ? 1 : 0;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty;
      if (a.entry.ring.percent !== b.entry.ring.percent) {
        return a.entry.ring.percent - b.entry.ring.percent;
      }
      return a.index - b.index;
    })
    .map((row) => row.entry);
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

/**
 * The plan's next topic, as the Guided picker needs it.
 *
 * Deliberately takes the topic the CALLER already picked rather than picking
 * one itself: web's spine recommends with `pickRecommendedTopic` and mobile's
 * with `buildStudyPlanModel`, and a helper that chose for them would make the
 * picker name a different topic from the `Continue` pill sitting right next to
 * it. What is shared is everything after the choice — the honesty guard, the
 * trim, and the shape the picker reads.
 *
 * Null means NO `Continue learning:` row: nothing was picked, the title is
 * blank, or the pick came back `mastered`, which is what a recommender returns
 * when a plan is finished and there is nothing left to continue.
 *
 * THE SOURCE RIDES ALONG. The unit is a GROUPING ("Imported Notes"), not a
 * document, and a first guided turn that named only the unit made the model
 * answer "which imported note would you like to continue with?" — a credit
 * spent asking instead of teaching (AH release smoke 1.0.57, observation B).
 * So the topic's first source note comes back too: its id, so the client can
 * attach the note as this turn's context, and its title when the caller can
 * resolve one, so the seed sentence can name the actual material.
 */
export function guidedNextTopicFromPlan(
  /**
   * Either shape a recommender hands back: a raw `StudySetTopic`, which carries
   * every source as `sourceNoteIds`, or a presentation row that has already
   * picked the first one as `sourceNoteId`. Reading both is what lets web's
   * spine and the phone's plan model feed the same helper.
   */
  next:
    | {
        title?: string | null;
        status?: StudySetTopic['status'];
        sourceNoteIds?: readonly string[] | null;
        sourceNoteId?: string | null;
      }
    | null
    | undefined,
  unitTitle?: string | null,
  sourceTitle?: string | null
): {
  title: string;
  unit: string | null;
  sourceNoteId: string | null;
  sourceTitle: string | null;
} | null {
  if (!next || next.status === 'mastered') return null;
  const title = (next.title || '').trim();
  if (!title) return null;
  const unit = (unitTitle || '').trim();
  const sourceNoteId = [...(next.sourceNoteIds ?? []), next.sourceNoteId]
    .map((id) => (id || '').trim())
    .find(Boolean);
  const source = (sourceTitle || '').trim();
  return {
    title,
    unit: unit || null,
    sourceNoteId: sourceNoteId || null,
    sourceTitle: source || null,
  };
}
