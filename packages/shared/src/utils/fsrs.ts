/**
 * FSRS-based spaced repetition scheduler
 * Uses a simplified FSRS-inspired algorithm compatible with existing SrsData shape
 */

import type { SrsData } from '../types';
import { normalizeSrsData, type PerformanceRating } from './srs';

const INITIAL_STABILITY = 2.4;
const INITIAL_DIFFICULTY = 5.0;

/** Map rating to FSRS-style grade (1=again, 2=hard, 3=good, 4=easy) */
function ratingToGrade(rating: PerformanceRating): number {
  switch (rating) {
    case 'again': return 1;
    case 'hard': return 2;
    case 'good': return 3;
    case 'easy': return 4;
  }
}

export interface FsrsCalculationOptions {
  maxInterval?: number;
}

/** Calculate next review using FSRS-inspired scheduling */
export function calculateFsrsData(
  current: SrsData | undefined,
  rating: PerformanceRating,
  options?: FsrsCalculationOptions
): SrsData {
  const maxInterval = Math.max(1, options?.maxInterval ?? 365);
  const today = new Date();
  const grade = ratingToGrade(rating);
  current = normalizeSrsData(current) ?? current;

  if (!current || current.repetitions === undefined || current.interval === undefined) {
    const interval = grade === 1 ? 1 : grade === 2 ? 1 : grade === 3 ? 3 : 5;
    const next = new Date(today);
    next.setDate(today.getDate() + interval);
    return {
      interval,
      easeFactor: INITIAL_STABILITY,
      repetitions: grade === 1 ? 0 : 1,
      nextReviewDate: next.toISOString(),
      failedAttempts: grade === 1 ? 1 : 0,
      isLeech: false,
      scheduler: 'fsrs',
      difficulty: INITIAL_DIFFICULTY,
      stability: INITIAL_STABILITY,
    };
  }

  let stability = (current as any).stability ?? current.easeFactor ?? INITIAL_STABILITY;
  let difficulty = (current as any).difficulty ?? INITIAL_DIFFICULTY;
  let repetitions = current.repetitions ?? 0;
  let failedAttempts = current.failedAttempts ?? 0;

  if (grade === 1) {
    repetitions = 0;
    stability = Math.max(0.5, stability * 0.4);
    difficulty = Math.min(10, difficulty + 1);
    failedAttempts += 1;
  } else {
    repetitions += 1;
    const gradeFactor = grade === 2 ? 0.85 : grade === 3 ? 1.0 : 1.3;
    stability = stability * (1 + 0.15 * gradeFactor * (11 - difficulty) / 10);
    difficulty = Math.max(1, difficulty - (grade - 2) * 0.2);
    failedAttempts = 0;
  }

  const interval = Math.max(1, Math.min(Math.round(stability), maxInterval));
  const next = new Date(today);
  next.setDate(today.getDate() + interval);

  return {
    interval,
    easeFactor: Math.min(2.5, stability),
    repetitions,
    nextReviewDate: next.toISOString(),
    failedAttempts,
    isLeech: failedAttempts >= 5,
    scheduler: 'fsrs',
    difficulty,
    stability,
  } as SrsData;
}

/** Use FSRS when card has fsrs scheduler flag or no legacy data */
export function calculateSrsWithFsrs(
  current: SrsData | undefined,
  rating: PerformanceRating,
  preferFsrs = true,
  options?: FsrsCalculationOptions
): SrsData {
  if (preferFsrs || (current as any)?.scheduler === 'fsrs') {
    return calculateFsrsData(current, rating, options);
  }
  return calculateFsrsData(current, rating, options);
}

const RATING_ORDER: readonly PerformanceRating[] = ['again', 'hard', 'good', 'easy'];

/**
 * Interval (in whole days) each grade WOULD schedule for a card, without
 * persisting — powers the Anki-style interval preview under the grade buttons.
 * Day-granular because that is this scheduler's resolution (interval is
 * clamped to a minimum of 1 day), so "Again" reads "1d", not "10m".
 */
export function previewFsrsIntervals(
  current: SrsData | undefined,
  options?: FsrsCalculationOptions
): Record<PerformanceRating, number> {
  const out = {} as Record<PerformanceRating, number>;
  for (const rating of RATING_ORDER) {
    out[rating] = calculateFsrsData(current, rating, options).interval;
  }
  return out;
}

/**
 * Compact human label for a day-count interval (Anki-style): 1d, 6d, 2w, 3mo,
 * 1y. Used on grade-button previews and interval chips; keep both clients on
 * this one formatter so web and mobile read identically.
 */
export function formatStudyInterval(days: number): string {
  const d = Math.max(1, Math.round(days));
  if (d < 7) return `${d}d`;
  if (d < 30) {
    const w = Math.round(d / 7);
    return `${w}w`;
  }
  if (d < 365) {
    const mo = Math.round(d / 30);
    return `${mo}mo`;
  }
  const y = Math.round((d / 365) * 10) / 10;
  return `${Number.isInteger(y) ? y : y.toFixed(1)}y`;
}
