/**
 * The study plan, read against the class syllabus.
 *
 * WHAT THIS IS FOR. #142 gave a set a `syllabus_summary` — the week-by-week
 * schedule the student's own course publishes — and deliberately did NOT wire
 * it into the study plan, for a reason worth repeating in full because it is
 * the constraint every function below is shaped by:
 *
 *   > The plan builder derives topics from MATERIALS. A set with a syllabus and
 *   > no materials has no content behind any week, so turning week titles into
 *   > plan topics would produce a plan whose every topic opens nothing — the
 *   > dead-door pattern this repo keeps finding and deleting.
 *
 * That is still true, and nothing here breaks it. A syllabus week becomes a
 * UNIT only when a real unit — one built from the student's own materials, with
 * topics that open something — is matched to it. What the week supplies is the
 * unit's NAME, its PLACE IN THE ORDER, and the exam markers between units. A
 * week nothing matched is never turned into a unit, a topic or a door; it is
 * listed, as text, under the plan, with one door for the thing that would fix
 * it (adding materials).
 *
 * WHY THE MATCH IS DETERMINISTIC. #142's follow-up note called matching "fuzzy
 * work needing its own model call". It does not need one, and it must not have
 * one: a plan whose ORDER depends on a model call would reorder itself between
 * two loads of the same page for no reason the student could see, and it would
 * cost a credit to look at a plan. So the whole matcher is token overlap plus
 * date proximity, which is stable, free, offline, and testable — and when it is
 * wrong it is wrong the same way twice, which is the property that lets a
 * student learn to read it.
 *
 * WHERE THE MAPPING LIVES. Nowhere. It is computed on read, from the units the
 * caller is about to draw and the summary already stored on the set. There is
 * no new table and no new column: a stored mapping would be a third copy of a
 * fact already implied by two others, and it would go stale the moment a unit
 * is renamed, a material is added, or the plan is regenerated — all of which
 * happen more often than a syllabus is uploaded.
 *
 * NOTHING HERE RUNS WITHOUT A SUMMARY. `buildPlanSyllabusView(null, …)` is
 * `null`, and every consumer draws exactly what it drew before this file
 * existed. That is the contract the "no summary" tests pin.
 */
import type { PlanSortKey } from './planTimeline';
import type { SyllabusSummary, SyllabusWeek } from './syllabusSummary';

// ---------------------------------------------------------------------------
// The thresholds, in one place
// ---------------------------------------------------------------------------

/**
 * Dice coefficient over normalised title tokens, at or above which a week and a
 * unit are THE SAME THING.
 *
 * 0.5 means "half the words the two titles use are shared", counting each title
 * once — `Enzyme kinetics` vs `Kinetics of enzymes` is 1.0 after stopwords,
 * `Enzymes` vs `Enzyme inhibition and regulation` is 0.5, and `Enzymes` vs
 * `Glycolysis` is 0. Lower than this and one shared word out of six starts
 * naming units after weeks they have nothing to do with, which is worse than
 * leaving the unit where it was: a MISmatch renames a unit AND moves it, and
 * the student has no way to see why.
 */
export const PLAN_SYLLABUS_TITLE_MATCH = 0.5;

/**
 * The weakest title overlap a DATE is allowed to promote into a match.
 *
 * Deliberately not zero. A date alone never matches: the only date a unit has
 * is the day its material was uploaded, which is when the student got round to
 * it and not when the course taught it, so "uploaded in the same week" is
 * evidence and never proof. One shared content word plus the right week is; no
 * shared word and the right week is a coincidence this refuses to act on.
 */
export const PLAN_SYLLABUS_TITLE_ASSIST = 0.25;

/**
 * How far a unit's date may sit from a week's date and still assist, in days.
 *
 * Seven, because the unit of a syllabus is a week: a lecture dated the Friday
 * of week 3 and a week 3 dated the Monday are the same week of the same course.
 */
export const PLAN_SYLLABUS_DATE_ASSIST_DAYS = 7;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * A unit as the matcher reads it.
 *
 * `StudySetUnit` satisfies this structurally, so callers pass their units
 * straight in. `date` is optional and usually absent — see
 * `PLAN_SYLLABUS_TITLE_ASSIST` for what it is and is not allowed to do.
 */
export interface PlanSyllabusUnitInput {
  id: string;
  title: string;
  position: number;
  /** `YYYY-MM-DD` — the source material's own date, when the caller has one. */
  date?: string | null;
}

/** One unit, and the syllabus week it turned out to be. */
export interface PlanSyllabusMatch {
  unitId: string;
  /** The week number the syllabus gave. Not an index: weeks can be sparse. */
  week: number;
  /** The week's title — what the unit is now NAMED. */
  weekTitle: string;
  /** `YYYY-MM-DD` or null, from the week (never from the unit). */
  date: string | null;
  examLabel: string | null;
  /** Which rule fired. Carried for the tests and for `matchedBy === 'date'` UI. */
  matchedBy: 'title' | 'date';
  /** The title similarity that produced it, 0..1. */
  score: number;
}

/** A syllabus week with no material behind it. Text, never a door. */
export interface PlanComingUpWeek {
  week: number;
  title: string;
  date: string | null;
  examLabel: string | null;
}

/** `Exam 1 · 10 Oct` — a marker between two units, not a unit. */
export interface PlanExamDivider {
  /** Stable within one view: `exam-<n>`. */
  id: string;
  /** `Midterm`, or `Exam 1` when the syllabus named no label. */
  name: string;
  /** `YYYY-MM-DD`, or null when the syllabus placed the exam by week only. */
  date: string | null;
  /** `Exam 1 · 10 Oct` — the whole line, so both clients draw one string. */
  label: string;
  /**
   * The unit this divider sits AFTER, or null for "before everything".
   * An id absent from the rendered order drops the divider rather than
   * floating it somewhere it does not mean anything.
   */
  afterUnitId: string | null;
}

/** Everything the syllabus has to say about one plan. */
export interface PlanSyllabusView {
  /** Unit ids: syllabus-matched in week order first, then the rest as they were. */
  syllabusOrder: string[];
  /** The matches, in week order. */
  matches: PlanSyllabusMatch[];
  /** Weeks nothing matched, in week order. */
  comingUp: PlanComingUpWeek[];
  examDividers: PlanExamDivider[];
}

// ---------------------------------------------------------------------------
// Title similarity
// ---------------------------------------------------------------------------

/**
 * Words that carry no subject matter, plus the scaffolding a syllabus row and a
 * lecture file both wear: `Week 4`, `Lecture 2`, `Topic 3`, `Part I`.
 *
 * Dropping these is the difference between `Week 4 — Enzymes` matching
 * `Lecture 4: Enzymes` on ONE word (the real one) and matching `Week 4 —
 * Glycolysis` on one word that means nothing at all.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from',
  'by', 'at', 'as', 'is', 'are', 'be', 'its', 'it', 'this', 'that', 'into',
  'week', 'weeks', 'lecture', 'lectures', 'lesson', 'lessons', 'class',
  'classes', 'session', 'sessions', 'topic', 'topics', 'unit', 'units',
  'chapter', 'chapters', 'module', 'modules', 'part', 'notes', 'note', 'pdf',
  'slides', 'reading', 'readings',
]);

/**
 * A title, reduced to the words worth comparing.
 *
 * Lower-cased, punctuation-split, stopwords dropped, and BARE NUMBERS dropped —
 * `Week 4` and `Lecture 4` share the digit and nothing else, and letting a
 * digit count as a shared word is how `Week 4` came to match `Chapter 4` of a
 * different subject in the first draft of this file. Roman numerals up to xii
 * go the same way, for the same reason. Duplicates collapse: a title that says
 * "enzymes" twice is not twice as much about enzymes.
 *
 * ONE STEMMING RULE, and only one: a trailing `s` comes off words of four
 * letters or more. A syllabus writes `Enzymes` where the lecture file is called
 * `Enzyme`, and refusing to see those as the same word was the single largest
 * source of missed matches while this was being written. It is deliberately not
 * a stemmer — `glycolysis` becomes `glycolysi`, which is not a word and does
 * not need to be, because both sides are reduced the same way and nothing but
 * the comparison ever reads these tokens. The four-letter floor keeps `gas`,
 * `bus` and `its` intact.
 */
export function planTitleTokens(title: string): string[] {
  const words = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const kept = new Set<string>();
  for (const word of words) {
    if (word.length < 2) continue;
    if (STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    if (/^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii)$/.test(word)) continue;
    kept.add(word.length >= 4 && word.endsWith('s') ? word.slice(0, -1) : word);
  }
  return [...kept];
}

/**
 * Dice coefficient over those tokens: `2 · |shared| / (|a| + |b|)`, 0..1.
 *
 * Dice rather than the overlap coefficient, which scores `Enzymes` against
 * `Enzymes, kinetics, inhibition, regulation and assay design` a perfect 1.0
 * because the short side is fully contained. A one-word week title is exactly
 * the case a syllabus is full of, so that bias would have matched the first
 * week to whichever unit happened to mention its word.
 *
 * Two titles with no comparable words at all score 0, never NaN.
 */
export function planTitleSimilarity(a: string, b: string): number {
  const left = planTitleTokens(a);
  const right = planTitleTokens(b);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of left) if (rightSet.has(token)) shared += 1;
  return (2 * shared) / (left.length + right.length);
}

/** Whole days between two `YYYY-MM-DD` days, or null when either is unusable. */
function dayGap(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.abs(Math.round((left - right) / 86_400_000));
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

interface Candidate {
  unitIndex: number;
  weekIndex: number;
  score: number;
  matchedBy: 'title' | 'date';
}

/**
 * Which unit is which week.
 *
 * GREEDY, ONE-TO-ONE AND STABLE. Every (unit, week) pair is scored, the
 * qualifying ones are sorted best-first, and each is taken unless its unit or
 * its week has already been claimed. A unit belongs to at most one week and a
 * week to at most one unit: a course teaches a thing once, and letting two
 * units share a week would put the same name on both and leave the order
 * between them undefined.
 *
 * TIES BREAK TOWARDS THE SYLLABUS. Equal scores are ordered by week number and
 * then by the unit's own plan position — both ascending, both total — so the
 * result is the same on every machine and every reload, and a run of
 * identically-scored weeks is claimed in the order the course teaches them
 * rather than in whatever order the arrays arrived in.
 *
 * Two rules produce a candidate:
 *   - TITLE: similarity ≥ `PLAN_SYLLABUS_TITLE_MATCH`.
 *   - DATE-ASSISTED: similarity ≥ `PLAN_SYLLABUS_TITLE_ASSIST` AND the unit's
 *     date is within `PLAN_SYLLABUS_DATE_ASSIST_DAYS` of the week's.
 * There is no third rule. In particular there is no date-only match — see
 * `PLAN_SYLLABUS_TITLE_ASSIST`.
 */
export function matchSyllabusWeeks(
  weeks: readonly SyllabusWeek[],
  units: readonly PlanSyllabusUnitInput[]
): PlanSyllabusMatch[] {
  const orderedWeeks = [...weeks].sort((a, b) => a.week - b.week);
  const orderedUnits = [...units].sort((a, b) => a.position - b.position);

  const candidates: Candidate[] = [];
  for (const [unitIndex, unit] of orderedUnits.entries()) {
    for (const [weekIndex, week] of orderedWeeks.entries()) {
      const score = planTitleSimilarity(unit.title, week.title);
      if (score >= PLAN_SYLLABUS_TITLE_MATCH) {
        candidates.push({ unitIndex, weekIndex, score, matchedBy: 'title' });
        continue;
      }
      if (score < PLAN_SYLLABUS_TITLE_ASSIST) continue;
      const gap = dayGap(unit.date, week.date);
      if (gap === null || gap > PLAN_SYLLABUS_DATE_ASSIST_DAYS) continue;
      candidates.push({ unitIndex, weekIndex, score, matchedBy: 'date' });
    }
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // A title match outranks a date-assisted one of the same strength: it
    // stands on the words alone and does not depend on an upload timestamp.
    if (a.matchedBy !== b.matchedBy) return a.matchedBy === 'title' ? -1 : 1;
    if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
    return a.unitIndex - b.unitIndex;
  });

  const takenUnits = new Set<number>();
  const takenWeeks = new Set<number>();
  const matches: PlanSyllabusMatch[] = [];
  for (const candidate of candidates) {
    if (takenUnits.has(candidate.unitIndex) || takenWeeks.has(candidate.weekIndex)) continue;
    const unit = orderedUnits[candidate.unitIndex];
    const week = orderedWeeks[candidate.weekIndex];
    if (!unit || !week) continue;
    takenUnits.add(candidate.unitIndex);
    takenWeeks.add(candidate.weekIndex);
    matches.push({
      unitId: unit.id,
      week: week.week,
      weekTitle: week.title,
      date: week.date,
      examLabel: week.examLabel,
      matchedBy: candidate.matchedBy,
      score: candidate.score,
    });
  }
  return matches.sort((a, b) => a.week - b.week);
}

// ---------------------------------------------------------------------------
// Dates, spelled for a divider
// ---------------------------------------------------------------------------

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * `2026-10-10` → `10 Oct`.
 *
 * No year: a divider sits inside one term, and the year is noise there. No
 * `Date` either — `new Date('2026-10-10')` is UTC midnight printed in the
 * device's zone, which west of Greenwich prints the 9th, and an exam date is a
 * calendar fact rather than an instant. An unparseable value comes back
 * unchanged rather than becoming `NaN undefined`.
 */
export function formatPlanSyllabusDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date || '').trim());
  if (!match) return (date || '').trim();
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return (date || '').trim();
  return `${Number(match[3])} ${month}`;
}

/** `Week 3 · 10 Oct`, or `Week 3` — the eyebrow over a syllabus-named unit. */
export function planSyllabusUnitEyebrow(match: PlanSyllabusMatch): string {
  const week = `Week ${match.week}`;
  return match.date ? `${week} · ${formatPlanSyllabusDate(match.date)}` : week;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

interface ExamSeed {
  name: string | null;
  date: string | null;
  /** The week number this exam sits AT: everything before it comes first. */
  boundary: number;
}

/**
 * Where the exams fall, as week boundaries.
 *
 * Two sources, folded together because `normalizeSyllabusSummary` already folds
 * them the other way: a week flagged as an exam, and a bare date in
 * `examDates`. A bare date is placed by asking which weeks have already
 * happened by then — the last week dated on or before it — so an exam dated
 * after week 5's date sits after week 5's unit. A date no week can be compared
 * to lands at boundary 1, before everything, which is where an unplaceable
 * marker is least misleading: it claims nothing about what it comes after.
 */
function examSeeds(summary: SyllabusSummary): ExamSeed[] {
  const seeds: ExamSeed[] = [];
  const weekExamDates = new Set<string>();
  for (const week of summary.weeks) {
    if (!week.examLabel) continue;
    seeds.push({ name: week.examLabel, date: week.date, boundary: week.week });
    if (week.date) weekExamDates.add(week.date);
  }
  for (const date of summary.examDates) {
    if (weekExamDates.has(date)) continue;
    let boundary = 1;
    for (const week of summary.weeks) {
      if (week.date && week.date <= date) boundary = Math.max(boundary, week.week + 1);
    }
    seeds.push({ name: null, date, boundary });
  }
  return seeds.sort((a, b) => {
    if (a.boundary !== b.boundary) return a.boundary - b.boundary;
    return (a.date ?? '').localeCompare(b.date ?? '');
  });
}

/**
 * Everything the syllabus says about this plan, or null when it says nothing.
 *
 * Null for: no summary at all (the capability probe is off, the migration is
 * unapplied, nothing was ever uploaded), or a summary with no weeks. Both mean
 * the same thing to every caller — draw the plan exactly as it drew before —
 * and collapsing them here is what keeps that branch to one `if` on each of
 * the four surfaces rather than three.
 */
export function buildPlanSyllabusView(
  summary: SyllabusSummary | null | undefined,
  units: readonly PlanSyllabusUnitInput[]
): PlanSyllabusView | null {
  if (!summary || summary.weeks.length === 0) return null;

  const matches = matchSyllabusWeeks(summary.weeks, units);
  const matchedUnitIds = new Set(matches.map((match) => match.unitId));
  const matchedWeeks = new Set(matches.map((match) => match.week));

  // Matched units in week order, then everything else EXACTLY as it came in.
  // The second half is the promise in rule 2: a material the syllabus never
  // mentions keeps the place today's plan gives it rather than being sorted
  // into a course it is not part of.
  const rest = [...units]
    .sort((a, b) => a.position - b.position)
    .filter((unit) => !matchedUnitIds.has(unit.id))
    .map((unit) => unit.id);
  const syllabusOrder = [...matches.map((match) => match.unitId), ...rest];

  // A week with no unit is NOT a unit, not a topic and not a door. It is a
  // line of text under the plan. Past weeks are kept alongside future ones:
  // most weeks carry no date at all, and a rule that can only be applied to
  // some rows produces a list whose omissions the student cannot account for.
  const comingUp: PlanComingUpWeek[] = summary.weeks
    .filter((week) => !matchedWeeks.has(week.week))
    .map((week) => ({
      week: week.week,
      title: week.title,
      date: week.date,
      examLabel: week.examLabel,
    }));

  const examDividers: PlanExamDivider[] = examSeeds(summary).map((seed, index) => {
    // The last matched unit the exam comes AFTER. Matches are in week order,
    // so this is a scan rather than a search.
    let afterUnitId: string | null = null;
    for (const match of matches) {
      if (match.week < seed.boundary) afterUnitId = match.unitId;
    }
    const name = seed.name ?? `Exam ${index + 1}`;
    return {
      id: `exam-${index + 1}`,
      name,
      date: seed.date,
      label: seed.date ? `${name} · ${formatPlanSyllabusDate(seed.date)}` : name,
      afterUnitId,
    };
  });

  return { syllabusOrder, matches, comingUp, examDividers };
}

/**
 * Reorder the caller's unit ids into syllabus order.
 *
 * Total and non-destructive: every id that went in comes out exactly once, and
 * an id the view has never heard of (a unit added since, a locally regrouped
 * plan) keeps its relative place at the back rather than vanishing. That
 * property is what makes it safe to run this against a client's own units when
 * the view was computed against the server's.
 */
export function orderUnitIdsBySyllabus(
  unitIds: readonly string[],
  view: PlanSyllabusView | null
): string[] {
  if (!view) return [...unitIds];
  const present = new Set(unitIds);
  const ordered = view.syllabusOrder.filter((id) => present.has(id));
  const known = new Set(ordered);
  return [...ordered, ...unitIds.filter((id) => !known.has(id))];
}

/** A rendered row of the plan spine: a unit, or an exam marker between units. */
export type PlanSyllabusRow =
  | { kind: 'unit'; unitId: string }
  | { kind: 'exam'; divider: PlanExamDivider };

/**
 * The spine, with the exam markers dropped in.
 *
 * SORT-AWARE, and this is the honesty rule of the whole feature. A divider says
 * "everything above this is what the midterm covers". That sentence is only
 * true while the list is in course order, so `weakest` — the one sort that
 * fully re-ranks the units by how little of each is done — gets NO dividers at
 * all rather than dividers that have quietly stopped meaning anything.
 * `recommended` keeps them: it lifts exactly one unit to the top and leaves
 * every other unit in course order behind it.
 *
 * A divider whose anchor unit is not on screen is dropped for the same reason.
 */
export function planSyllabusRows(
  unitIds: readonly string[],
  view: PlanSyllabusView | null,
  sort: PlanSortKey
): PlanSyllabusRow[] {
  const rows: PlanSyllabusRow[] = unitIds.map((unitId) => ({ kind: 'unit', unitId }));
  if (!view || sort === 'weakest' || view.examDividers.length === 0) return rows;

  const out: PlanSyllabusRow[] = [];
  for (const divider of view.examDividers) {
    if (divider.afterUnitId === null) out.push({ kind: 'exam', divider });
  }
  for (const row of rows) {
    out.push(row);
    if (row.kind !== 'unit') continue;
    for (const divider of view.examDividers) {
      if (divider.afterUnitId === row.unitId) out.push({ kind: 'exam', divider });
    }
  }
  // A divider anchored to a unit that is not being drawn never gets pushed:
  // dropped, deliberately.
  return out;
}

/**
 * The name a unit takes from the syllabus, or the one it already had.
 *
 * The week title REPLACES the unit's own, it does not decorate it: the unit was
 * named after the material it was built from ("Lecture 3.pdf"), and the whole
 * point of a syllabus is that the course has a better name for that. The
 * material's name is not lost — `unitSources` suppresses a single-material chip
 * only while the unit repeats its title, so renaming the unit is exactly what
 * makes that chip appear underneath it.
 */
export function planSyllabusUnitTitle(
  fallback: string,
  match: PlanSyllabusMatch | null | undefined
): string {
  const title = (match?.weekTitle || '').trim();
  return title || fallback;
}

/** The match for one unit, or null. A map, because both clients want it per row. */
export function planSyllabusMatchesByUnit(
  view: PlanSyllabusView | null
): Map<string, PlanSyllabusMatch> {
  const map = new Map<string, PlanSyllabusMatch>();
  if (!view) return map;
  for (const match of view.matches) map.set(match.unitId, match);
  return map;
}

/**
 * The view to draw: the one the server already computed, or a fresh one.
 *
 * `GET /study-sets/:id/plan` computes the view against the units IT holds, and
 * a client usually draws exactly those. Sometimes it does not: a set whose plan
 * was never saved draws units derived locally from its materials
 * (`unitsFromSourceMaterials`), whose ids the server has never seen. Handing
 * that client the server's view would order it by ids none of its rows carry.
 *
 * So: use the payload's view when it names at least one unit on screen,
 * recompute otherwise. Both paths run the same function over the same summary,
 * so they cannot disagree about anything except which units existed.
 */
export function planSyllabusViewFor(input: {
  payload: PlanSyllabusView | null | undefined;
  summary: SyllabusSummary | null | undefined;
  units: readonly PlanSyllabusUnitInput[];
}): PlanSyllabusView | null {
  const { payload, summary, units } = input;
  if (payload) {
    const present = new Set(units.map((unit) => unit.id));
    if (payload.syllabusOrder.some((id) => present.has(id))) return payload;
  }
  return buildPlanSyllabusView(summary, units);
}

/**
 * What `GET /study-sets/:id/plan` carries when — and only when — the set has a
 * stored syllabus summary.
 *
 * The summary rides along with the view so a client needs no second request to
 * recompute against its own units (see `planSyllabusViewFor`). The whole object
 * is ABSENT, not empty, when there is no summary: an empty view and no syllabus
 * are different states, and a client that can tell them apart can stop drawing
 * the "Coming up" heading over nothing.
 */
export interface StudySetPlanSyllabus extends PlanSyllabusView {
  summary: SyllabusSummary;
}
