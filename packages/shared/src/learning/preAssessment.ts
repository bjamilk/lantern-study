/**
 * The per-unit pre-assessment: "See what you already know".
 *
 * WHAT IT IS. A short diagnostic test scoped to ONE unit's topics. The student
 * answers it once, and the result is allowed to move that unit's topics forward
 * on the plan so the plan stops sending them to material they already hold.
 *
 * WHY THE RULES LIVE HERE AND NOT IN THE SCORER. Two very different callers ask
 * the same question. The API maps a submitted test's per-question results onto
 * topic statuses; the web panel decides whether a unit's card says `Continue`
 * or `Retake`, and has to agree with the server about what "finished" means.
 * When those two rules were written twice, a unit could show `Retake` for a
 * test the server still considered unfinished.
 *
 * CONSUMERS: apps/api-server (the pre-assessment route and its data module) and
 * web's plan panel. Reached as `@lantern/shared/learning` — the api tsconfig
 * maps that index but NOT `learning/*`, so everything here must be re-exported
 * from `./index` or the API cannot see it.
 *
 * GOTCHAS: `packages/shared` is consumed BUILT — run `npm run build` in
 * packages/shared before typechecking web/mobile/api, or consumers resolve a
 * stale `dist/`. The web turbo build compiles with `noUncheckedIndexedAccess`.
 */
import type { StudySetTopic, StudySetTopicStatus } from './studySetPlan';

/**
 * How many questions a pre-assessment asks.
 *
 * Ten, because the card promises "takes 3 minutes" and ten mixed questions is
 * what three minutes buys. The generator is asked for this many and may return
 * fewer (a unit with two thin topics cannot fill ten); the card's promise is
 * written from the count that came BACK, never from this constant.
 */
export const PRE_ASSESSMENT_QUESTION_TARGET = 10;

/** Minutes the card promises. Derived from the target, not guessed at twice. */
export const PRE_ASSESSMENT_MINUTES = 3;

/**
 * The two thresholds, as ratios of a topic's own questions.
 *
 * Deliberately asymmetric and deliberately generous at the bottom: half right
 * on a diagnostic is evidence a student has MET the material, which is all
 * `covered` claims. `mastered` claims they proved it, so it takes 80%.
 */
export const PRE_ASSESSMENT_MASTERED_RATIO = 0.8;
export const PRE_ASSESSMENT_COVERED_RATIO = 0.5;

/** One topic's tally out of a submitted pre-assessment. */
export interface PreAssessmentTopicScore {
  topicId: string;
  /** Questions attributed to this topic that were answered at all. */
  answered: number;
  /** How many of those were right. */
  correct: number;
}

/** A status change the caller should persist. Only ever a move FORWARD. */
export interface PreAssessmentStatusUpdate {
  topicId: string;
  status: StudySetTopicStatus;
}

/**
 * What a single topic's tally earns, on its own.
 *
 * `null` means "this result says nothing" — leave the topic exactly as it was.
 * A topic with no answered questions returns null rather than `unseen`: a
 * diagnostic that skipped a topic has not discovered that the student does not
 * know it, and writing `unseen` over a `mastered` topic because the generator
 * happened not to cover it is the plan forgetting work the student did.
 *
 * Boundaries are INCLUSIVE at both thresholds: 4/5 is mastered, 1/2 is covered.
 */
export function preAssessmentTopicStatus(
  score: PreAssessmentTopicScore
): StudySetTopicStatus | null {
  if (score.answered <= 0) return null;
  const ratio = score.correct / score.answered;
  if (ratio >= PRE_ASSESSMENT_MASTERED_RATIO) return 'mastered';
  if (ratio >= PRE_ASSESSMENT_COVERED_RATIO) return 'covered';
  return null;
}

/** Rank used to refuse a downgrade. Higher is further along. */
const STATUS_RANK: Record<StudySetTopicStatus, number> = {
  unseen: 0,
  covered: 1,
  mastered: 2,
};

/**
 * The writes a submitted pre-assessment earns, against the topics as they stand.
 *
 * THE RULE THAT MATTERS: this never moves a topic BACKWARDS. A student who has
 * already mastered a topic and then scores 60% on a ten-question diagnostic
 * keeps their mastery — the diagnostic is one noisy sample, and the honest
 * reading of a worse result on less evidence is "no new information", not "you
 * have forgotten this". Downgrading is what a review schedule is for.
 *
 * Scores for topics that are not in `topics` are dropped rather than written
 * blind: the caller is about to issue an ownership-checked write per topic, and
 * a topic id that is not in this unit's plan has no business being one of them.
 *
 * Returns only the topics that actually CHANGE, so a caller that issues one
 * request per update does not spend a round trip re-writing a status.
 */
export function preAssessmentStatusUpdates(
  scores: readonly PreAssessmentTopicScore[],
  topics: readonly StudySetTopic[]
): PreAssessmentStatusUpdate[] {
  const current = new Map(topics.map((topic) => [topic.id, topic.status]));
  const updates: PreAssessmentStatusUpdate[] = [];
  const seen = new Set<string>();
  for (const score of scores) {
    const was = current.get(score.topicId);
    if (was === undefined) continue;
    if (seen.has(score.topicId)) continue;
    seen.add(score.topicId);
    const earned = preAssessmentTopicStatus(score);
    if (!earned) continue;
    if (STATUS_RANK[earned] <= STATUS_RANK[was]) continue;
    updates.push({ topicId: score.topicId, status: earned });
  }
  return updates;
}

/**
 * Tally a flat list of graded answers into per-topic scores.
 *
 * The scorer hands back one row per QUESTION and each question knows which
 * topic it was written for; the thresholds want one row per TOPIC. An answer
 * carrying no topic id is counted nowhere rather than into a bucket of its own,
 * because a question the generator could not attribute cannot move a plan row.
 */
export function tallyPreAssessment(
  answers: readonly { topicId?: string | null; correct?: boolean | null }[]
): PreAssessmentTopicScore[] {
  const byTopic = new Map<string, PreAssessmentTopicScore>();
  for (const answer of answers) {
    const topicId = (answer.topicId || '').trim();
    if (!topicId) continue;
    const row = byTopic.get(topicId) ?? { topicId, answered: 0, correct: 0 };
    row.answered += 1;
    if (answer.correct === true) row.correct += 1;
    byTopic.set(topicId, row);
  }
  return [...byTopic.values()];
}

/**
 * What the unit's pre-assessment card should offer.
 *
 * `start` — never taken. `resume` — a test exists and is not finished, so
 * `Continue` must reopen THAT test rather than generate (and charge for) a
 * second one. `retake` — finished; the offer is honest about being a repeat.
 */
export type PreAssessmentCardAction = 'start' | 'resume' | 'retake';

export function preAssessmentCardAction(
  existing: { id?: string | null; completedAt?: string | null } | null | undefined
): PreAssessmentCardAction {
  if (!existing?.id) return 'start';
  return existing.completedAt ? 'retake' : 'resume';
}

/** The pill's verb, so panel and test cannot drift apart. */
export function preAssessmentCardLabel(action: PreAssessmentCardAction): string {
  if (action === 'resume') return 'Resume';
  if (action === 'retake') return 'Retake';
  return 'Continue';
}
