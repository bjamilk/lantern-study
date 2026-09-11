/**
 * Essay studio — Wave H of the academic replica.
 *
 * Practice feedback on a student draft, with or without a rubric. This is not
 * an official grade. Persist on a course note with a fence — no essay_attempts
 * table. Asking the companion is a separate credit.
 */
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '../utils/aiCredits';
import { hasEnoughNoteStudyContent } from '../utils/noteStudyContent';
import { isLectureNote } from './courseWorkspace';

export const ESSAY_FENCE = 'lantern-essay';
export const ESSAY_DRAFT_MIN = 50;
export const ESSAY_CRITERION_MAX = 8;
export const ESSAY_CRITERION_SCORE_MAX = 5;
export const ESSAY_FEEDBACK_MAX = 600;
export const ESSAY_COMMENT_MAX = 140;
export const ESSAY_DISCLAIMER = 'Practice feedback, not an official grade.';

export const DEFAULT_ESSAY_CRITERIA: readonly { id: string; label: string; max: number }[] = [
  { id: 'structure', label: 'Structure', max: ESSAY_CRITERION_SCORE_MAX },
  { id: 'coverage', label: 'Coverage of the topic', max: ESSAY_CRITERION_SCORE_MAX },
  { id: 'clarity', label: 'Clarity', max: ESSAY_CRITERION_SCORE_MAX },
];

export interface EssayCriterion {
  id: string;
  label: string;
  max: number;
}

export interface EssayScore {
  criterionId: string;
  label: string;
  score: number;
  max: number;
  comment: string;
}

export interface EssayAttempt {
  id: string;
  prompt: string;
  body: string;
  rubric: EssayCriterion[];
  scores: EssayScore[];
  overall: number;
  feedback: string;
  createdAt: string;
}

export interface EssaySession {
  sourceNoteId: string;
  sourceTitle: string;
  prompt: string;
  draft: string;
  rubricText: string;
  attempts: EssayAttempt[];
  currentIndex: number;
}

export type EssayStudioDecision = { action: 'resume'; noteId: string } | { action: 'start' };

export function essayStudioPriceLine(): string {
  return `Grading costs ${formatCreditCost(AI_FEATURE_CREDIT_COST)}. Regrading costs another. Asking the companion is separate. ${ESSAY_DISCLAIMER}`;
}

export function newEssayNoteTitle(sourceTitle?: string): string {
  const src = sourceTitle?.trim() || 'Draft';
  return `Essay — ${src}`;
}

export function isEssayNote(note: { title?: string | null; body?: string | null }): boolean {
  if (/^Essay — /.test(note.title ?? '')) return true;
  return (note.body ?? '').includes(ESSAY_FENCE);
}

function isOtherStudioNote(note: { title?: string | null; body?: string | null }): boolean {
  const title = note.title ?? '';
  const body = note.body ?? '';
  if (/^Lesson — /.test(title) || body.includes('lantern-lesson')) return true;
  if (/^Recap — /.test(title) || body.includes('lantern-recap')) return true;
  if (/^Plan — /.test(title) || body.includes('lantern-calendar')) return true;
  return false;
}

/** Notes whose extracted text can fill a draft. Studio notes are not drafts. */
export function essaySourceNotes<
  T extends { id: string; title?: string | null; body?: string | null; sourceType?: string | null },
>(notes: readonly T[]): T[] {
  return notes
    .filter(
      (note) =>
        !isEssayNote(note) &&
        !isOtherStudioNote(note) &&
        hasEnoughNoteStudyContent({
          ...note,
          body: note.body ?? undefined,
          sourceType: note.sourceType ?? undefined,
        })
    )
    .slice()
    .sort((a, b) => Number(isLectureNote(a)) - Number(isLectureNote(b)));
}

/**
 * True when grade-essay is not on this API. Production 404s often arrive as
 * `{ error: "Error", message: "Not found - /api/v1/ai/grade-essay" }`.
 * 503 must not match — a charged failure must not fall back locally.
 */
export function isEssayGraderMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return typeof error === 'string' && /\(404\)|Not Found|Cannot POST/i.test(error);
  }
  const err = error as {
    status?: number;
    message?: string;
    body?: { message?: string; error?: string };
  };
  if (err.status === 404) return true;
  const text = [err.message, err.body?.message, err.body?.error]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  return /\(404\)|Not Found|Cannot POST/i.test(text);
}

function slugId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clipAtWord(text: string, max: number): string {
  const collapsed = collapseWs(text);
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, Math.max(0, max - 1));
  const bound = cut.lastIndexOf(' ');
  const clipped = (bound > 40 ? cut.slice(0, bound) : cut).trim();
  return clipped ? `${clipped}…` : collapsed.slice(0, max).trim();
}

function tokens(text: string): string[] {
  return collapseWs(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' '))
    .split(' ')
    .filter((word) => word.length >= 4);
}

export function parseRubricText(raw: string | null | undefined): EssayCriterion[] {
  const lines = (raw ?? '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  const criteria: EssayCriterion[] = [];
  for (const line of lines) {
    if (criteria.length >= ESSAY_CRITERION_MAX) break;
    const maxMatch = line.match(/\/\s*(\d+)\s*$/);
    const maxRaw = maxMatch ? Number(maxMatch[1]) : ESSAY_CRITERION_SCORE_MAX;
    const max = Number.isFinite(maxRaw)
      ? Math.min(10, Math.max(1, Math.round(maxRaw)))
      : ESSAY_CRITERION_SCORE_MAX;
    const label = collapseWs(maxMatch ? line.slice(0, maxMatch.index) : line);
    if (!label) continue;
    criteria.push({ id: slugId('c', criteria.length), label, max });
  }
  return criteria;
}

export function rubricToText(criteria: readonly EssayCriterion[]): string {
  return criteria.map((row) => `- ${row.label}`).join('\n');
}

function clampScore(score: number, max: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(max, Math.max(0, Math.round(score)));
}

function scoreCriterion(criterion: EssayCriterion, draft: string): number {
  const keys = tokens(criterion.label);
  const hay = draft.toLowerCase();
  if (keys.length === 0) {
    const n = draft.trim().length;
    if (n >= 800) return criterion.max;
    if (n >= 400) return Math.max(1, Math.round(criterion.max * 0.7));
    if (n >= 150) return Math.max(1, Math.round(criterion.max * 0.5));
    return Math.max(0, Math.round(criterion.max * 0.3));
  }
  const hits = keys.filter((key) => hay.includes(key)).length;
  return clampScore((hits / keys.length) * criterion.max, criterion.max);
}

function criterionComment(criterion: EssayCriterion, score: number): string {
  if (score >= criterion.max) return `Hits ${criterion.label.toLowerCase()}.`;
  if (score === 0) return `Does not yet address ${criterion.label.toLowerCase()}.`;
  return `Partly covers ${criterion.label.toLowerCase()}.`;
}

export function overallFromScores(scores: readonly EssayScore[]): number {
  const max = scores.reduce((sum, row) => sum + row.max, 0);
  if (max <= 0) return 0;
  const got = scores.reduce((sum, row) => sum + row.score, 0);
  return Math.min(100, Math.max(0, Math.round((got / max) * 100)));
}

function localFeedback(scores: readonly EssayScore[], hasRubric: boolean): string {
  const weak = scores.filter((row) => row.score < row.max).map((row) => row.label.toLowerCase());
  const head = hasRubric
    ? 'Marked against the rubric you entered.'
    : 'No rubric was given, so this used structure, coverage, and clarity.';
  const tail =
    weak.length > 0
      ? ` Strengthen ${weak.slice(0, 3).join(', ')} before you treat this as done.`
      : ' The draft meets the practice criteria on this pass.';
  return clipAtWord(`${ESSAY_DISCLAIMER} ${head}${tail}`, ESSAY_FEEDBACK_MAX);
}

/**
 * Local heuristic when grade-essay is not on the API. Scores rubric keywords
 * against the draft. Never dumps the essay into feedback.
 */
export function essayFromMaterial(input: {
  draft: string;
  rubricText?: string;
  prompt?: string;
  sourceNoteId?: string;
  sourceTitle?: string;
  now?: string;
}): {
  overall: number;
  scores: EssayScore[];
  feedback: string;
  provider: string;
} {
  const draft = collapseWs(input.draft);
  const parsed = parseRubricText(input.rubricText);
  const criteria = parsed.length > 0 ? parsed : [...DEFAULT_ESSAY_CRITERIA];
  const scores: EssayScore[] = criteria.map((criterion) => {
    const score = scoreCriterion(criterion, draft);
    return {
      criterionId: criterion.id,
      label: criterion.label,
      score,
      max: criterion.max,
      comment: clipAtWord(criterionComment(criterion, score), ESSAY_COMMENT_MAX),
    };
  });
  const feedback = localFeedback(scores, parsed.length > 0);
  return {
    overall: overallFromScores(scores),
    scores,
    feedback,
    provider: 'local',
  };
}

export function normalizeGeneratedEssayReview(
  raw: unknown,
  input: { draft: string; rubricText?: string }
): {
  overall: number;
  scores: EssayScore[];
  feedback: string;
} {
  const parsed = parseRubricText(input.rubricText);
  const fallback = essayFromMaterial({
    draft: input.draft,
    rubricText: input.rubricText,
  });
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as {
    overall?: unknown;
    scores?: unknown;
    feedback?: unknown;
    criteria?: unknown;
  };
  const criteria = parsed.length > 0 ? parsed : [...DEFAULT_ESSAY_CRITERIA];
  const rawScores = Array.isArray(obj.scores)
    ? obj.scores
    : Array.isArray(obj.criteria)
      ? obj.criteria
      : [];
  const scores: EssayScore[] = criteria.map((criterion, index) => {
    const row =
      rawScores.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          ((item as { criterionId?: string }).criterionId === criterion.id ||
            collapseWs(String((item as { label?: string }).label ?? '')).toLowerCase() ===
              criterion.label.toLowerCase())
      ) ?? rawScores[index];
    const rec = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const score = clampScore(Number(rec.score), criterion.max);
    const comment = clipAtWord(String(rec.comment ?? criterionComment(criterion, score)), ESSAY_COMMENT_MAX);
    return {
      criterionId: criterion.id,
      label: criterion.label,
      score,
      max: criterion.max,
      comment,
    };
  });
  const feedbackRaw = typeof obj.feedback === 'string' ? obj.feedback : fallback.feedback;
  let feedback = clipAtWord(feedbackRaw.replace(/\s+/g, ' ').trim(), ESSAY_FEEDBACK_MAX);
  if (!feedback) feedback = fallback.feedback;
  if (!feedback.includes('not an official grade')) {
    feedback = clipAtWord(`${ESSAY_DISCLAIMER} ${feedback}`, ESSAY_FEEDBACK_MAX);
  }
  const draftSlice = collapseWs(input.draft).slice(0, 80);
  if (draftSlice.length >= 40 && feedback.includes(draftSlice)) {
    feedback = fallback.feedback;
  }
  const overallRaw = Number(obj.overall);
  const overall = Number.isFinite(overallRaw)
    ? Math.min(100, Math.max(0, Math.round(overallRaw)))
    : overallFromScores(scores);
  return { overall, scores, feedback };
}

export function startEssaySession(input: {
  sourceNoteId?: string;
  sourceTitle?: string;
  prompt?: string;
  draft?: string;
  rubricText?: string;
  attempts?: EssayAttempt[];
  currentIndex?: number;
}): EssaySession {
  const attempts = input.attempts ?? [];
  const last = Math.max(0, attempts.length - 1);
  const currentIndex =
    typeof input.currentIndex === 'number' && Number.isFinite(input.currentIndex)
      ? Math.min(last, Math.max(0, Math.round(input.currentIndex)))
      : last;
  return {
    sourceNoteId: input.sourceNoteId?.trim() || '',
    sourceTitle: input.sourceTitle?.trim() || 'Draft',
    prompt: collapseWs(input.prompt ?? ''),
    draft: input.draft?.trim() || '',
    rubricText: input.rubricText?.trim() || '',
    attempts,
    currentIndex,
  };
}

export function appendEssayAttempt(
  session: EssaySession,
  review: { overall: number; scores: EssayScore[]; feedback: string },
  now?: string
): EssaySession {
  const attempt: EssayAttempt = {
    id: slugId('attempt', session.attempts.length),
    prompt: session.prompt,
    body: session.draft,
    rubric: parseRubricText(session.rubricText),
    scores: review.scores,
    overall: review.overall,
    feedback: review.feedback,
    createdAt: now || new Date().toISOString(),
  };
  const attempts = [...session.attempts, attempt];
  return { ...session, attempts, currentIndex: attempts.length - 1 };
}

export function currentEssayAttempt(session: EssaySession): EssayAttempt | null {
  return session.attempts[session.currentIndex] ?? session.attempts[session.attempts.length - 1] ?? null;
}

export function selectEssayAttempt(session: EssaySession, index: number): EssaySession {
  if (session.attempts.length === 0) return session;
  const currentIndex = Math.min(session.attempts.length - 1, Math.max(0, Math.round(index)));
  const attempt = session.attempts[currentIndex];
  if (!attempt) return { ...session, currentIndex };
  return {
    ...session,
    currentIndex,
    prompt: attempt.prompt,
    draft: attempt.body,
    rubricText: attempt.rubric.length ? rubricToText(attempt.rubric) : session.rubricText,
  };
}

export function essayAttemptLabel(attempt: EssayAttempt, index: number): string {
  return `Attempt ${index + 1} · ${attempt.overall}`;
}

export function composeEssayNoteBody(session: EssaySession): string {
  const snapshot = {
    sourceNoteId: session.sourceNoteId,
    sourceTitle: session.sourceTitle,
    prompt: session.prompt,
    draft: session.draft,
    rubricText: session.rubricText,
    attempts: session.attempts,
    currentIndex: session.currentIndex,
  };
  return `${session.sourceTitle}\n\n\`\`\`${ESSAY_FENCE}\n${JSON.stringify(snapshot)}\n\`\`\`\n`;
}

export function parseEssayNoteBody(body: string | null | undefined): EssaySession | null {
  if (!body) return null;
  const fenced = body.match(new RegExp('```' + ESSAY_FENCE + '\\s*([\\s\\S]*?)```'));
  const raw = fenced?.[1]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EssaySession>;
    return startEssaySession({
      sourceNoteId: parsed.sourceNoteId,
      sourceTitle: parsed.sourceTitle,
      prompt: parsed.prompt,
      draft: parsed.draft,
      rubricText: parsed.rubricText,
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      currentIndex: parsed.currentIndex,
    });
  } catch {
    return null;
  }
}

export function resolveEssayStudioNote(input: {
  essays: readonly { id: string }[];
  selectedNoteId?: string | null;
}): EssayStudioDecision {
  if (input.selectedNoteId && input.essays.some((row) => row.id === input.selectedNoteId)) {
    return { action: 'resume', noteId: input.selectedNoteId };
  }
  const first = input.essays[0];
  if (first) return { action: 'resume', noteId: first.id };
  return { action: 'start' };
}

export function essayDraftTooThin(draft: string): boolean {
  return collapseWs(draft).length < ESSAY_DRAFT_MIN;
}
