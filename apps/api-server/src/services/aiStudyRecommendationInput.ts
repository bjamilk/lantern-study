/**
 * Request normalisation for POST /ai/study-recommendations.
 *
 * The coach prompt describes each field to the model verbatim, so every field
 * has to mean what its name says. Contract (mirrors
 * packages/shared/src/api/ai.ts AIStudyPerformanceData):
 *
 *  - recentScores        required array — per-topic TEST accuracy, 0..100.
 *  - flashcardAccuracy   optional array — per-DECK share of reviewed cards that
 *                        are mature, 0..1. Absent / empty = "no reviewed
 *                        flashcards"; it is never invented server-side.
 *  - studyDaysThisWeek   distinct days with study activity in the last 7 days,
 *                        0..7. Preferred.
 *  - studyHoursThisWeek  LEGACY (one release). Every shipped client filled it
 *                        with its DAY STREAK, never hours, so when only this is
 *                        present it is read as a day count and capped at 7.
 *
 * Malformed entries are dropped rather than rejected so an old build with one
 * odd row still gets advice; a body that cannot be read at all is a 400.
 */

export interface StudyTopicScore {
  topic: string;
  score: number;
  date: string;
}

export interface StudyFlashcardAccuracy {
  topic: string;
  correctRate: number;
}

export interface StudyPerformanceData {
  recentScores: StudyTopicScore[];
  flashcardAccuracy?: StudyFlashcardAccuracy[];
  studyDaysThisWeek: number;
}

export const STUDY_DAYS_WEEK_MAX = 7;
export const STUDY_RECOMMENDATION_MAX_ENTRIES = 40;
const MAX_TOPIC_LEN = 80;
const MAX_DATE_LEN = 40;

export type NormalizedStudyPerformance =
  | { ok: true; data: StudyPerformanceData }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function cleanTopic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
  return trimmed ? trimmed.slice(0, MAX_TOPIC_LEN) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRecentScores(raw: unknown): StudyTopicScore[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StudyTopicScore[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const topic = cleanTopic(entry.topic);
    const score = finiteNumber(entry.score);
    if (!topic || score === null) continue;
    const date = typeof entry.date === 'string' ? entry.date.slice(0, MAX_DATE_LEN) : '';
    out.push({ topic, score: Math.round(clamp(score, 0, 100)), date });
    if (out.length >= STUDY_RECOMMENDATION_MAX_ENTRIES) break;
  }
  return out;
}

function normalizeFlashcardAccuracy(raw: unknown): StudyFlashcardAccuracy[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StudyFlashcardAccuracy[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const topic = cleanTopic(entry.topic);
    const rate = finiteNumber(entry.correctRate);
    if (!topic || rate === null) continue;
    out.push({ topic, correctRate: Math.round(clamp(rate, 0, 1) * 100) / 100 });
    if (out.length >= STUDY_RECOMMENDATION_MAX_ENTRIES) break;
  }
  return out.length > 0 ? out : undefined;
}

function normalizeStudyDays(body: Record<string, unknown>): number | null {
  // Prefer the honest field; fall back to the legacy name for one release.
  const days = finiteNumber(body.studyDaysThisWeek);
  const legacy = finiteNumber(body.studyHoursThisWeek);
  const source = days ?? legacy;
  if (source === null) return null;
  return Math.round(clamp(source, 0, STUDY_DAYS_WEEK_MAX));
}

export function normalizeStudyPerformanceData(raw: unknown): NormalizedStudyPerformance {
  if (!isRecord(raw)) {
    return { ok: false, error: 'Performance data required.' };
  }

  const recentScores = normalizeRecentScores(raw.recentScores);
  if (!recentScores) {
    return { ok: false, error: 'performanceData.recentScores must be an array.' };
  }

  if (raw.flashcardAccuracy !== undefined && raw.flashcardAccuracy !== null && !Array.isArray(raw.flashcardAccuracy)) {
    return { ok: false, error: 'performanceData.flashcardAccuracy must be an array when provided.' };
  }
  const flashcardAccuracy = normalizeFlashcardAccuracy(raw.flashcardAccuracy);

  const studyDaysThisWeek = normalizeStudyDays(raw);
  if (studyDaysThisWeek === null) {
    return { ok: false, error: 'performanceData.studyDaysThisWeek is required.' };
  }

  const data: StudyPerformanceData = { recentScores, studyDaysThisWeek };
  if (flashcardAccuracy) data.flashcardAccuracy = flashcardAccuracy;
  return { ok: true, data };
}
