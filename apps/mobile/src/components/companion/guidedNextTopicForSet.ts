/**
 * The `Continue learning:` topic for a study set, derived from its SAVED PLAN.
 *
 * WHY THIS EXISTS. The Guided picker's `Continue learning:` row was wired to an
 * optional `guidedNextTopic` that only `CourseRoomScreen` ever passed, so the
 * row appeared through exactly one door and was missing from the one students
 * actually use — the set bar's `Ask`, which calls `openForScope({ scopeId,
 * label })` and states no topic (SF5a device pass, check 1: a set with a saved
 * plan whose next topic is `02 Imported Notes` offered `Start learning:` only).
 *
 * So the derivation moves to where every door already passes through: the
 * store. This module is the arithmetic it runs, kept pure and separate so it
 * can be tested without a renderer and without a store.
 *
 * Same two pieces the room used — `buildStudyPlanModel` picks the topic and the
 * shared `guidedNextTopicFromPlan` guards and trims it — so the picker and the
 * plan spine can never name different topics for the same set. A host that
 * knows better (the room, which can also derive topics from raw notes) still
 * passes its own, and that one wins.
 *
 * Null means NO row: no plan, no topics, or a plan whose next topic came back
 * `mastered` — which is what a finished plan returns. An invented `Continue`
 * is worse than none.
 */
import { guidedNextTopicFromPlan } from '@lantern/shared/study/planTimeline';
import type { GuidedNextTopic } from '@lantern/shared/api/companion';
import type { StudySetMode, StudySetTopic, StudySetUnit } from '@lantern/shared/learning';
import { buildStudyPlanModel } from '../study/studyPlanPresentation';

export interface GuidedPlanInput {
  units?: readonly StudySetUnit[];
  topics?: readonly StudySetTopic[];
}

export function guidedNextTopicForSet(
  plan: GuidedPlanInput | null | undefined,
  mode?: StudySetMode | null
): GuidedNextTopic | null {
  const topics = plan?.topics ?? [];
  if (topics.length === 0) return null;
  const model = buildStudyPlanModel({
    units: plan?.units ?? [],
    topics,
    // The store holds no note list. Materials only ever SPLIT a flat plan into
    // per-source units, so their absence can change which unit is NAMED beside
    // the topic, never which topic is next.
    materials: [],
    mode: mode ?? 'standard',
  });
  return guidedNextTopicFromPlan(
    model.nextTopic,
    model.units.find((unit) => unit.holdsNext)?.title
  );
}
