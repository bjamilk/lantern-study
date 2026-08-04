// ===========================================
// Lantern Study - SRS (Spaced Repetition System) Algorithm
// ===========================================
// This is shared between web and mobile apps

import { SrsData } from '../types';

const INITIAL_EASE_FACTOR = 2.5;

export type PerformanceRating = 'again' | 'hard' | 'good' | 'easy';

export interface SrsCalculationOptions {
    maxInterval?: number;
}

/**
 * Normalize legacy snake_case / mixed SRS payloads from JSONB or raw API rows
 * into the canonical camelCase SrsData shape used by isCardDue and FSRS.
 */
export function normalizeSrsData(raw: unknown): SrsData | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const data = raw as Record<string, unknown>;
    const nextReviewDate =
        (typeof data.nextReviewDate === 'string' && data.nextReviewDate) ||
        (typeof data.next_review_date === 'string' && data.next_review_date) ||
        (typeof data.next_review === 'string' && data.next_review) ||
        // The API server's own copy of this check also accepted `nextReview`;
        // included here so that server can use this normalizer without changing
        // which rows it considers scheduled.
        (typeof data.nextReview === 'string' && data.nextReview) ||
        undefined;
    const intervalRaw = data.interval;
    const repetitionsRaw = data.repetitions;
    const hasScheduleFields =
        intervalRaw !== undefined ||
        repetitionsRaw !== undefined ||
        nextReviewDate !== undefined ||
        data.easeFactor !== undefined ||
        data.ease_factor !== undefined;
    if (!hasScheduleFields) return undefined;

    const interval = typeof intervalRaw === 'number' ? intervalRaw : Number(intervalRaw) || 0;
    const repetitions =
        typeof repetitionsRaw === 'number' ? repetitionsRaw : Number(repetitionsRaw) || 0;
    const easeRaw = data.easeFactor ?? data.ease_factor;
    const easeFactor =
        typeof easeRaw === 'number' ? easeRaw : Number(easeRaw) || INITIAL_EASE_FACTOR;
    const failedRaw = data.failedAttempts ?? data.failed_attempts;
    const failedAttempts =
        typeof failedRaw === 'number' ? failedRaw : Number(failedRaw) || 0;

    return {
        interval,
        easeFactor,
        repetitions,
        nextReviewDate: nextReviewDate || '',
        failedAttempts,
        isLeech: Boolean(data.isLeech ?? data.is_leech ?? false),
        ...(data.scheduler === 'fsrs' || data.scheduler === 'sm2'
            ? { scheduler: data.scheduler }
            : {}),
        ...(typeof data.difficulty === 'number' ? { difficulty: data.difficulty } : {}),
        ...(typeof data.stability === 'number' ? { stability: data.stability } : {}),
    };
}

export const calculateSrsData = (
    currentSrsData: SrsData | undefined,
    performanceRating: PerformanceRating,
    options?: SrsCalculationOptions
): SrsData => {
    const maxInterval = Math.max(1, options?.maxInterval ?? 365);
    const today = new Date();
    currentSrsData = normalizeSrsData(currentSrsData) ?? currentSrsData;
    
    // If it's a new card or srsData is empty/incomplete, treat as new
    if (!currentSrsData || currentSrsData.interval === undefined || currentSrsData.repetitions === undefined) {
        let interval = 1;
        if (performanceRating === 'good') interval = 3;
        if (performanceRating === 'easy') interval = 5;
        
        const nextReviewDate = new Date(today);
        nextReviewDate.setDate(today.getDate() + interval);
        
        return {
            interval: interval,
            easeFactor: INITIAL_EASE_FACTOR,
            repetitions: 1,
            nextReviewDate: nextReviewDate.toISOString(),
            failedAttempts: performanceRating === 'again' ? 1 : 0,
            isLeech: false,
        };
    }

    let { interval, easeFactor, repetitions, failedAttempts = 0, isLeech = false } = currentSrsData;
    
    // Ensure we have valid numbers with defaults
    interval = typeof interval === 'number' ? interval : 1;
    easeFactor = typeof easeFactor === 'number' ? easeFactor : INITIAL_EASE_FACTOR;
    repetitions = typeof repetitions === 'number' ? repetitions : 0;
    
    let newInterval: number;

    // Adjust ease factor based on performance
    if (performanceRating === 'again') {
        repetitions = 0;
        newInterval = 1;
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        failedAttempts += 1;
        if (failedAttempts >= 5) isLeech = true;
    } else {
        repetitions += 1;
        if (performanceRating === 'hard') {
            newInterval = Math.round(interval * 1.2);
            easeFactor = Math.max(1.3, easeFactor - 0.15);
        } else if (performanceRating === 'good') {
            if (repetitions <= 1) {
                newInterval = 1;
            } else if (repetitions === 2) {
                newInterval = 6;
            } else {
                newInterval = Math.round(interval * easeFactor);
            }
        } else { // 'easy'
            if (repetitions <= 1) {
                newInterval = 4;
            } else {
                newInterval = Math.round(interval * easeFactor * 1.3);
            }
            easeFactor += 0.15;
        }
        // Reset failed attempts on success
        failedAttempts = 0;
        isLeech = false;
    }
    
    // Cap ease factor
    easeFactor = Math.min(easeFactor, 2.5);
    
    // Prevent interval from exceeding user-configured max
    newInterval = Math.min(newInterval, maxInterval);
    // Ensure interval is at least 1 day
    newInterval = Math.max(1, newInterval);

    const nextReviewDate = new Date(today);

    // Validate that nextReviewDate is a valid Date object
    if (isNaN(nextReviewDate.getTime())) {
        console.error("Invalid 'today' value provided, resulting in an invalid date.");
        throw new Error("Invalid 'today' value for SRS calculation.");
    }

    nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);

    return {
        interval: newInterval,
        easeFactor,
        repetitions,
        nextReviewDate: nextReviewDate.toISOString(),
        failedAttempts,
        isLeech,
    };
};

/**
 * True when a scheduled card is ready for review.
 * New / never-scheduled cards are NOT due — they enter via the daily new-card budget.
 * Learning cards with repetitions but a missing/invalid date are treated as due.
 *
 * Accepts camelCase or legacy snake_case SRS blobs so a raw API assign cannot
 * leave reviewed cards stuck "due" until the next full remap/refresh.
 */
export const isCardDue = (srsData: SrsData | undefined | Record<string, unknown>): boolean => {
    const normalized = normalizeSrsData(srsData);
    if (!normalized) return false;

    if (!normalized.nextReviewDate) {
        return (normalized.repetitions ?? 0) > 0;
    }

    const nextReview = new Date(normalized.nextReviewDate);
    if (Number.isNaN(nextReview.getTime())) {
        return (normalized.repetitions ?? 0) > 0;
    }

    return Date.now() >= nextReview.getTime();
};

/**
 * Get cards due for review from a list
 */
export const getCardsDue = <T extends { srsData?: SrsData }>(cards: T[]): T[] => {
    return cards.filter(card => isCardDue(card.srsData));
};

/**
 * Sort cards by due date (most overdue first)
 */
export const sortCardsByDueDate = <T extends { srsData?: SrsData }>(cards: T[]): T[] => {
    return [...cards].sort((a, b) => {
        const dateA = a.srsData?.nextReviewDate ? new Date(a.srsData.nextReviewDate).getTime() : 0;
        const dateB = b.srsData?.nextReviewDate ? new Date(b.srsData.nextReviewDate).getTime() : 0;
        return dateA - dateB;
    });
};
