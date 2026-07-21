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

export const calculateSrsData = (
    currentSrsData: SrsData | undefined,
    performanceRating: PerformanceRating,
    options?: SrsCalculationOptions
): SrsData => {
    const maxInterval = Math.max(1, options?.maxInterval ?? 365);
    const today = new Date();
    
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
 */
export const isCardDue = (srsData: SrsData | undefined): boolean => {
    if (!srsData?.nextReviewDate) {
        return (srsData?.repetitions ?? 0) > 0;
    }

    const nextReview = new Date(srsData.nextReviewDate);
    if (Number.isNaN(nextReview.getTime())) {
        return (srsData.repetitions ?? 0) > 0;
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
