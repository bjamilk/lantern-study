/**
 * The Study Plan spine, as data.
 *
 * The plan used to be a band inside `CourseRoomScreen.tsx`: a caption, a row of
 * counts, and a checkbox per topic. Everything that made it readable — which
 * unit you are standing in, how far through it you are, which topic is the NEXT
 * one — was either absent or computed inline three times in JSX. This module is
 * the whole of that arithmetic, so the panel can be a drawing and the rules can
 * be tested without a renderer.
 *
 * WHAT IS AND IS NOT MODELLED HERE. Rows, rings and "which topic is next" are
 * here. Which unit is currently OPEN is not: that is UI state the student
 * changes by tapping, and it belongs to the component. `defaultOpenUnitId` is
 * the seed for it, not the store of it.
 *
 * THE RING SCALE. A topic is worth two ticks, not one — `unseen → covered →
 * mastered` — which is exactly how `studySetProgressPercent` already scores the
 * whole plan. The rings use the same halves so a unit reading "half full" and
 * the header bar reading 50% cannot disagree. A ring is a FRACTION (0..1), not
 * degrees or a dash offset: the renderer owns its own geometry.
 */
import {
  studySetPlanProgress,
  studySetProgressPercent,
  topicsInUnit,
  unitsForTopics,
  unitsFromSourceMaterials,
  STUDY_SET_MODES,
  type StudySetMode,
  type StudySetPlanProgress,
  type StudySetTopic,
  type StudySetTopicStatus,
  type StudySetUnit,
} from '@lantern/shared/learning';
import { unitSources, type UnitSource, type UnitSourceMaterial } from '@lantern/shared/study';

export interface PlanTopicRow {
  id: string;
  title: string;
  status: StudySetTopicStatus;
  /** Covered or mastered — the row is struck through and its dot is filled. */
  done: boolean;
  /** 0, 0.5 or 1. See THE RING SCALE above. */
  ring: number;
  /** The one topic that carries the black `Continue` pill. */
  next: boolean;
  /** What a screen reader hears instead of a struck-through line. */
  accessibilityLabel: string;
  /** The material this topic was read out of, when there is one. */
  sourceNoteId: string | null;
}

export interface PlanUnitRow {
  id: string;
  title: string;
  /** `01 AI Foundations` — the numbered head StudyFetch draws. */
  label: string;
  topics: PlanTopicRow[];
  total: number;
  covered: number;
  mastered: number;
  /** Partial-arc fraction for the unit's ring, 0..1. */
  ring: number;
  /** `2 of 5 covered` — spoken, and drawn under the head when open. */
  progressLabel: string;
  /** True when this unit holds the next topic. */
  holdsNext: boolean;
  /**
   * The materials this unit's topics were generated from — the `Sources:`
   * chips. EMPTY IS THE COMMON CASE and it means "draw nothing": an id that no
   * longer resolves against `materials` is dropped rather than named, and a
   * unit derived from a single material is suppressed because its chip would
   * repeat the unit's own heading. The rule is `unitSources` in
   * `@lantern/shared/study`, shared with web so the two surfaces cannot
   * disagree about where a unit came from.
   */
  sources: UnitSource[];
}

export interface StudyPlanModel {
  units: PlanUnitRow[];
  progress: StudySetPlanProgress;
  /** 0..100, the header bar. */
  percent: number;
  /** `15 Topics · 2 Covered · 0 Mastered` — the Details sheet's one line. */
  detailLabel: string;
  nextTopicId: string | null;
  /** The topic the `Continue` pill opens, whole. */
  nextTopic: PlanTopicRow | null;
  /** `Comprehensive` — the mode chip, from the plan's own mode. */
  modeLabel: string;
  /** True when there is nothing to draw at all. */
  empty: boolean;
}

export function topicRingFraction(status: StudySetTopicStatus): number {
  if (status === 'mastered') return 1;
  if (status === 'covered') return 0.5;
  return 0;
}

/** `unseen → covered → mastered → unseen`, the tap cycle the band already had. */
export function nextTopicStatus(status: StudySetTopicStatus): StudySetTopicStatus {
  if (status === 'unseen') return 'covered';
  if (status === 'covered') return 'mastered';
  return 'unseen';
}

/**
 * Units for the spine, deriving one per source material when the stored plan is
 * flat.
 *
 * `topicsFromReadingNotes` files everything under a single unit called "Your
 * materials", and a spine with one segment is not a spine. `unitsFromSourceMaterials`
 * (shared, Wave 1) recovers the missing level from which note each topic was
 * read out of — but only when the stored plan does not already carry a real
 * structure of its own, which is what `units.length < 2` tests.
 */
export function planUnitsAndTopics(input: {
  units: readonly StudySetUnit[];
  topics: readonly StudySetTopic[];
  materials: readonly { id: string; title?: string | null }[];
}): { units: StudySetUnit[]; topics: StudySetTopic[] } {
  const stored = unitsForTopics(input.units, input.topics);
  if (stored.length >= 2) return { units: stored, topics: [...input.topics] };
  const derived = unitsFromSourceMaterials(input.topics, input.materials);
  if (derived.units.length < 2) return { units: stored, topics: [...input.topics] };
  return {
    units: [...derived.units].sort((a, b) => a.position - b.position),
    topics: derived.topics,
  };
}

/**
 * The next topic: the first one, in plan order, that is not yet mastered.
 *
 * Deliberately NOT `pickRecommendedTopic`. That function answers "what should I
 * study now" and under `cram` will skip a half-done topic to reach an unseen
 * one — correct for a recommendation, wrong for a spine, where `Continue` must
 * sit on the topic the student's eye stops at coming down the list. The mode
 * still reaches the panel: it names the chip.
 */
function findNextTopicId(ordered: readonly StudySetTopic[]): string | null {
  return ordered.find((topic) => topic.status !== 'mastered')?.id ?? null;
}

export function buildStudyPlanModel(input: {
  units: readonly StudySetUnit[];
  topics: readonly StudySetTopic[];
  materials: readonly UnitSourceMaterial[];
  mode?: StudySetMode;
}): StudyPlanModel {
  const grouped = planUnitsAndTopics(input);
  const progress = studySetPlanProgress(grouped.topics);
  const ordered = grouped.units.flatMap((unit) => topicsInUnit(grouped.topics, unit.id));
  const nextTopicId = findNextTopicId(ordered);

  const units: PlanUnitRow[] = grouped.units.map((unit, index) => {
    const rows = topicsInUnit(grouped.topics, unit.id).map<PlanTopicRow>((topic) => {
      const done = topic.status === 'covered' || topic.status === 'mastered';
      return {
        id: topic.id,
        title: topic.title,
        status: topic.status,
        done,
        ring: topicRingFraction(topic.status),
        next: topic.id === nextTopicId,
        // The strike-through is the whole of the "done" signal on screen, and a
        // screen reader is told nothing by `textDecorationLine`. The status is
        // therefore spoken, always.
        accessibilityLabel: `${topic.title}. ${topic.status}`,
        sourceNoteId: topic.sourceNoteIds[0] ?? null,
      };
    });
    const covered = rows.filter((row) => row.done).length;
    const mastered = rows.filter((row) => row.status === 'mastered').length;
    const ring =
      rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.ring, 0) / rows.length;
    return {
      id: unit.id,
      title: unit.title,
      label: `${String(index + 1).padStart(2, '0')} ${unit.title}`,
      topics: rows,
      total: rows.length,
      covered,
      mastered,
      ring,
      progressLabel: `${covered} of ${rows.length} covered`,
      holdsNext: rows.some((row) => row.next),
      sources: unitSources(unit, topicsInUnit(grouped.topics, unit.id), input.materials),
    };
  });

  const nextTopic = units.flatMap((unit) => unit.topics).find((row) => row.next) ?? null;
  const mode = input.mode ?? 'standard';

  return {
    units,
    progress,
    percent: studySetProgressPercent(progress),
    detailLabel: `${progress.topics} Topics · ${progress.covered} Covered · ${progress.mastered} Mastered`,
    nextTopicId,
    nextTopic,
    modeLabel: STUDY_SET_MODES.find((row) => row.id === mode)?.label ?? 'Standard',
    empty: grouped.topics.length === 0,
  };
}

/**
 * Which unit opens on first paint: the one holding the next topic.
 *
 * The band opened unit one unconditionally, which on a plan whose first unit is
 * finished opened the one stretch with nothing left to do and hid the one with
 * the `Continue` pill in it.
 */
export function defaultOpenUnitId(model: StudyPlanModel): string | null {
  return model.units.find((unit) => unit.holdsNext)?.id ?? model.units[0]?.id ?? null;
}

export interface PlanExamRow {
  /** `YYYY-MM-DD`, as stored. */
  date: string;
  /** `20 Sep 2026`. */
  label: string;
  /** Struck through in the Details sheet. */
  past: boolean;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a date-only string without `Date`.
 *
 * `new Date('2026-09-20')` is parsed as UTC midnight and then printed in the
 * device's zone, which west of Greenwich prints the 19th. An exam date is a
 * calendar fact, not an instant, so it is never allowed near a timezone.
 */
export function formatPlanExamDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return date.trim();
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return date.trim();
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/**
 * The Details sheet's exam list. One date today, a list tomorrow — the shape is
 * a list now so adding a second date is not a rewrite of the sheet.
 */
export function planExamRows(
  examDate: string | null | undefined,
  today: string
): PlanExamRow[] {
  const date = (examDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return [{ date, label: formatPlanExamDate(date), past: date < today }];
}

/* ------------------------------------------------------------------------- *
 * The plan-entry self-rating (the web panel's "See what you already know").
 * ------------------------------------------------------------------------- */

export interface PlanSelfRatingRow {
  id: string;
  title: string;
  /** `01 Lecture 3` — the unit head the topic sits under, as the spine draws it. */
  unitLabel: string;
  /** `2 of 7`. The WALK's position, not the plan's — see below. */
  positionLabel: string;
}

/**
 * The topics a self-rating still has to ask about, in plan order.
 *
 * Only `unseen` ones. The web panel walks every topic from index 0 every time
 * the card is tapped, which re-asks a student about work they already ticked —
 * its own comment says the row should be "hidden once it has been worked
 * through", and the condition it ships (`diagnosticIndex === null`) does not do
 * that. The rule here is the one that comment describes: a topic that already
 * carries a status is not un-rated, so it is not in the walk and it is not
 * counted in `2 of 7`. Both surfaces write the same statuses through the same
 * endpoint, so a set rated on the phone offers nothing left to rate on the web.
 */
export function planSelfRatingRows(model: StudyPlanModel): PlanSelfRatingRow[] {
  const pending = model.units.flatMap((unit) =>
    unit.topics
      .filter((row) => row.status === 'unseen')
      .map((row) => ({ row, unitLabel: unit.label }))
  );
  return pending.map((entry, index) => ({
    id: entry.row.id,
    title: entry.row.title,
    unitLabel: entry.unitLabel,
    positionLabel: `${index + 1} of ${pending.length}`,
  }));
}

/**
 * Whether the highlighted card sits above the spine.
 *
 * `usingServerPlan` is in the condition because a plan read off note titles has
 * no server row to tick: the panel's own `onToggleTopic` is a no-op in that
 * state, so offering three minutes of rating there would collect answers and
 * throw them away. The student is offered "Save as my study plan" instead,
 * which is the thing that makes the ratings stick.
 */
export function shouldOfferSelfRating(
  model: StudyPlanModel,
  usingServerPlan: boolean
): boolean {
  return usingServerPlan && !model.empty && planSelfRatingRows(model).length > 0;
}
