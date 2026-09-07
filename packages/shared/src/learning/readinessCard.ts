/**
 * What the Exam readiness card actually shows for one course — decided here,
 * once, so mobile and web cannot disagree and so every rule is testable
 * without a renderer.
 *
 * Four things come out of a course's readiness:
 *
 *  1. the days-left line (`examCountdownLabel`), or — when no exam date is set
 *     — the exam-date prompt that takes its place. A card that invents
 *     "0 days" is worse than a card that asks.
 *  2. up to three weakest-topic chips,
 *  3. exactly ONE next action, whose label says where the button goes,
 *  4. one plain sentence saying why that action and not another.
 *
 * The one-action rule is the point. A readiness card that offers four doors
 * has answered "how ready am I" with "you decide", which is the question the
 * student came with.
 *
 * WHICH action is not decided here. `planNextBestAction` in
 * `@lantern/shared/network` owns the ladder and owns the copy, so the server,
 * the web card and this card can never name different things — this module
 * only maps the chosen `NextBestAction` onto a navigation target, and supplies
 * a degraded ladder for a payload that predates the field (an app talking to
 * an older API must still show a button, not a blank).
 *
 * Lives in `packages/shared` because BOTH cards render it: mobile's
 * `components/dashboard/readinessCardModel.ts` re-exports this module, and
 * web's card imports it directly. Two copies of these rules would be two
 * cards that quietly stop agreeing.
 */
import {
  examCountdownLabel,
  masteryBand,
  type MasteryBand,
  type NextBestAction,
} from '../network';

/**
 * Everything the card needs from one course. Structural on purpose: a
 * `CourseReadiness` from `@lantern/shared/network` satisfies it, and so does a
 * fixture, and so does a payload from a server that has not shipped
 * `nextAction` yet.
 */
export interface ReadinessCourseInput {
  courseId: string;
  courseCode: string | null;
  examDate: string | null;
  daysUntil: number | null;
  outlineTotal: number;
  coveredCount: number;
  coveragePct: number | null;
  averageMastery: number | null;
  readinessScore: number | null;
  nextTopic: { topicId: string; title: string } | null;
  weakestTopics: string[];
  /** The shared planner's answer. Absent on a pre-`nextAction` payload. */
  nextAction?: NextBestAction | null;
}

/**
 * Where the card's one button goes. Deliberately a plain description rather
 * than a navigation call: the planner is pure, and each client maps these to
 * its own stack helpers (mobile) or router (web).
 */
export type ReadinessNavTarget =
  | { kind: 'deck'; deckId: string }
  | { kind: 'note'; noteId: string }
  | { kind: 'test'; courseId: string }
  | { kind: 'topics'; courseId: string; courseLabel?: string }
  | { kind: 'examDate'; courseId: string };

export interface ReadinessNextActionPlan {
  /** The button's visible text. Says exactly where it goes. */
  label: string;
  /** The one sentence under it, saying why this and not something else. */
  reason: string;
  /** Spoken label — the visible text plus the reason, which it has no room for. */
  accessibilityLabel: string;
  target: ReadinessNavTarget;
}

/** The countdown's stand-in when no exam date is set. Never a second action. */
export interface ExamDatePrompt {
  label: string;
  reason: string;
  target: { kind: 'examDate'; courseId: string };
}

export interface ReadinessCardRow {
  courseId: string;
  /** Course code, or the honest fallback when a course has none. */
  courseLabel: string;
  /** `examCountdownLabel(daysUntil)`, or null when no exam date is set. */
  daysLeftLabel: string | null;
  /** Shown in the countdown's place, and only there — null once a date exists. */
  examDatePrompt: ExamDatePrompt | null;
  /** 0-100 headline, or null when the evidence is too thin to score. */
  readinessScore: number | null;
  /** Bar fill: the score, else syllabus coverage, else null (draw nothing). */
  barPct: number | null;
  band: MasteryBand;
  /** The one sentence under the bar. Never "0%" for "no data". */
  statusLine: string;
  /** Up to three weakest topics, weakest first. */
  weakestChips: string[];
  nextAction: ReadinessNextActionPlan;
}

const COURSE_FALLBACK = 'this course';

const trimmed = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
};

/**
 * The status line. The honesty rule from the mastery graph: a course with no
 * performance evidence says so, and coverage alone never becomes a score.
 */
export function readinessStatusLine(course: ReadinessCourseInput): string {
  if (course.readinessScore != null) return `Readiness ${course.readinessScore}%`;
  if (course.coveragePct != null) {
    return `${course.coveredCount} of ${course.outlineTotal} topics started`;
  }
  if (course.averageMastery != null) return `Average mastery ${course.averageMastery}%`;
  return 'Not enough evidence yet';
}

/**
 * A `NextBestAction` kind → where the button goes.
 *
 * `targetId` is a deck id, a note id or the course id depending on the kind, so
 * the mapping is the only place that knows which. An action whose targetId is
 * missing returns null and the caller degrades, rather than dispatching a
 * navigate at `undefined` and landing the student on an empty screen.
 */
export function navTargetForAction(
  action: NextBestAction,
  course: Pick<ReadinessCourseInput, 'courseId' | 'courseCode'>
): ReadinessNavTarget | null {
  const targetId = trimmed(action.targetId);
  switch (action.kind) {
    case 'review-deck':
      return targetId ? { kind: 'deck', deckId: targetId } : null;
    case 'study-topic-note':
      return targetId ? { kind: 'note', noteId: targetId } : null;
    case 'take-test':
      return { kind: 'test', courseId: targetId ?? course.courseId };
    case 'add-topics':
      return {
        kind: 'topics',
        courseId: targetId ?? course.courseId,
        ...(trimmed(course.courseCode) ? { courseLabel: trimmed(course.courseCode) as string } : {}),
      };
    case 'set-exam-date':
      return { kind: 'examDate', courseId: targetId ?? course.courseId };
    default:
      return null;
  }
}

/**
 * The degraded ladder, used only when the payload carries no `nextAction` —
 * an older API, or a fixture. It mirrors the shared planner's ORDER (no
 * outline first, then a course-level test) but never claims a deck or a note,
 * because without the server's evidence map this client cannot know one
 * exists, and "Review deck" pointing at nothing is worse than a plain test.
 */
function fallbackAction(course: ReadinessCourseInput): ReadinessNextActionPlan {
  const courseLabel = trimmed(course.courseCode) ?? COURSE_FALLBACK;
  if (course.outlineTotal === 0) {
    return withSpokenLabel({
      label: 'Add your course topics',
      reason: `We cannot say how ready you are for ${courseLabel} until its topics are in.`,
      target: {
        kind: 'topics',
        courseId: course.courseId,
        ...(trimmed(course.courseCode) ? { courseLabel: trimmed(course.courseCode) as string } : {}),
      },
    });
  }
  const pointer = trimmed(course.nextTopic?.title) ?? trimmed(course.weakestTopics?.[0]);
  return withSpokenLabel({
    label: `Take a test on ${courseLabel}`,
    reason: pointer
      ? `Nothing of yours is filed under ${pointer} yet — a short test shows where you stand.`
      : 'A short test is the quickest way to find out where you stand.',
    target: { kind: 'test', courseId: course.courseId },
  });
}

const withSpokenLabel = (
  plan: Omit<ReadinessNextActionPlan, 'accessibilityLabel'>
): ReadinessNextActionPlan => ({
  ...plan,
  accessibilityLabel: `${plan.label}. ${plan.reason}`,
});

/** The one next action: the shared planner's, or the degraded ladder's. */
export function planNextAction(course: ReadinessCourseInput): ReadinessNextActionPlan {
  const action = course.nextAction;
  if (action && trimmed(action.label)) {
    const target = navTargetForAction(action, course);
    if (target) {
      return withSpokenLabel({
        label: action.label.trim(),
        reason: trimmed(action.reason) ?? '',
        target,
      });
    }
  }
  return fallbackAction(course);
}

/**
 * The exam-date prompt, which stands in for the countdown rather than adding a
 * second button. The shared planner attaches it as `suggestion` at every rung;
 * a payload without one still gets the prompt whenever the date is missing, so
 * the card's quietest state is never a dead corner.
 */
export function planExamDatePrompt(course: ReadinessCourseInput): ExamDatePrompt | null {
  if (trimmed(course.examDate)) return null;
  const suggested = course.nextAction?.suggestion ?? null;
  return {
    label: trimmed(suggested?.label) ?? 'Add your exam date',
    reason:
      trimmed(suggested?.reason) ??
      'Set it and we will remind you a week before, the day before, and on the morning.',
    target: { kind: 'examDate', courseId: trimmed(suggested?.targetId) ?? course.courseId },
  };
}

/** One course → one card row. */
export function buildReadinessRow(course: ReadinessCourseInput): ReadinessCardRow {
  return {
    courseId: course.courseId,
    courseLabel: trimmed(course.courseCode) ?? 'Course',
    daysLeftLabel: course.daysUntil != null ? examCountdownLabel(course.daysUntil) : null,
    examDatePrompt: planExamDatePrompt(course),
    readinessScore: course.readinessScore,
    barPct: course.readinessScore ?? course.coveragePct ?? null,
    band: masteryBand(course.readinessScore),
    statusLine: readinessStatusLine(course),
    weakestChips: (course.weakestTopics ?? []).slice(0, 3),
    nextAction: planNextAction(course),
  };
}

export function buildReadinessRows(
  courses: ReadonlyArray<ReadinessCourseInput>,
  limit?: number
): ReadinessCardRow[] {
  const rows = courses.map(buildReadinessRow);
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}

/**
 * The "Unmatched tags" affordance on the course topics screen: tags found on
 * the student's own decks and notes that no outline topic covers.
 *
 * The server lane owns the endpoint that finds them. Until it answers, the
 * client passes `null` and this returns `visible: false` — an empty
 * "Unmatched tags (0)" header is a promise the app cannot keep, and a student
 * who taps into nothing learns that the section is decoration.
 */
/** One row of GET /mastery/unmatched-tags. */
export interface UnmatchedTag {
  tag: string;
  /** How much of the student's work carries it — the ordering signal. */
  count: number;
  /** Where it was found ('cards', 'tests'), for the row's subtitle. */
  sources: string[];
}

export interface UnmatchedTagsResponse {
  courseId: string;
  outlineTotal: number;
  tags: UnmatchedTag[];
}

export interface UnmatchedTagsPlan {
  visible: boolean;
  tags: UnmatchedTag[];
}

export function planUnmatchedTags(
  tags: ReadonlyArray<UnmatchedTag | string> | null | undefined
): UnmatchedTagsPlan {
  // `null` is "not asked yet / could not be read", and it hides the section
  // rather than showing an empty one. Undecided is not the same as none.
  if (!tags) return { visible: false, tags: [] };
  const seen = new Set<string>();
  const cleaned: UnmatchedTag[] = [];
  for (const raw of tags) {
    const row: UnmatchedTag =
      typeof raw === 'string'
        ? { tag: raw, count: 0, sources: [] }
        : { tag: raw?.tag ?? '', count: raw?.count ?? 0, sources: raw?.sources ?? [] };
    const tag = trimmed(row.tag);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ ...row, tag });
  }
  // Heaviest first: the tag on nine decks is the topic worth adding, and the
  // one on a single card can wait.
  cleaned.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { visible: cleaned.length > 0, tags: cleaned };
}

/** "on 3 decks" / "on 2 notes and 1 deck" — the row's one line of evidence. */
export function unmatchedTagSubtitle(row: UnmatchedTag): string {
  const sources = (row.sources ?? []).filter((s) => trimmed(s));
  const where = sources.length ? sources.join(', ') : 'your work';
  return row.count > 0 ? `${row.count} on ${where}` : `On ${where}`;
}
