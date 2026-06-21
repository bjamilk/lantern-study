// ===========================================
// Lantern Study - Gamification System
// ===========================================
// This is shared between web and mobile apps

import type { UserStats, BadgeId, Badge } from '../types';

// --- GAMIFICATION DEFINITIONS ---
export type BadgeMetric = keyof UserStats | 'question_upvotes';

interface BadgeLevel {
    level: number;
    threshold: number;
    points: number;
}

export interface BadgeDefinition {
    id: BadgeId;
    baseName: string;
    baseDescription: (threshold: number) => string;
    icon: string;
    metric: BadgeMetric;
    levels: BadgeLevel[];
}

export const BADGE_DEFINITIONS: Record<BadgeId, BadgeDefinition> = {
    GROUP_FOUNDER: {
        id: 'GROUP_FOUNDER',
        baseName: 'Group Founder',
        baseDescription: (threshold) => `Create ${threshold} study group(s).`,
        icon: '🚀',
        metric: 'groupsCreated',
        levels: [
            { level: 1, threshold: 1, points: 50 },
            { level: 2, threshold: 3, points: 150 },
            { level: 3, threshold: 5, points: 300 },
            { level: 4, threshold: 10, points: 600 },
            { level: 5, threshold: 15, points: 1000 },
            { level: 6, threshold: 25, points: 1500 },
            { level: 7, threshold: 40, points: 2200 },
            { level: 8, threshold: 60, points: 3000 },
            { level: 9, threshold: 80, points: 4000 },
            { level: 10, threshold: 100, points: 5000 },
        ],
    },
    QUESTION_ASKER: {
        id: 'QUESTION_ASKER',
        baseName: 'Question Asker',
        baseDescription: (threshold) => `Submit ${threshold} question(s).`,
        icon: '❓',
        metric: 'questionsCreated',
        levels: [
            { level: 1, threshold: 5, points: 25 },
            { level: 2, threshold: 25, points: 125 },
            { level: 3, threshold: 50, points: 250 },
            { level: 4, threshold: 100, points: 500 },
            { level: 5, threshold: 200, points: 1000 },
            { level: 6, threshold: 350, points: 1750 },
            { level: 7, threshold: 500, points: 2500 },
            { level: 8, threshold: 750, points: 3750 },
            { level: 9, threshold: 1000, points: 5000 },
            { level: 10, threshold: 1500, points: 7500 },
        ],
    },
    RISING_STAR: {
        id: 'RISING_STAR',
        baseName: 'Rising Star',
        baseDescription: (threshold) => `Receive ${threshold} upvotes on a single question.`,
        icon: '🌟',
        metric: 'question_upvotes',
        levels: [
            { level: 1, threshold: 10, points: 100 },
            { level: 2, threshold: 25, points: 250 },
            { level: 3, threshold: 50, points: 500 },
            { level: 4, threshold: 75, points: 750 },
            { level: 5, threshold: 100, points: 1000 },
            { level: 6, threshold: 150, points: 1500 },
            { level: 7, threshold: 200, points: 2000 },
            { level: 8, threshold: 300, points: 3000 },
            { level: 9, threshold: 400, points: 4000 },
            { level: 10, threshold: 500, points: 5000 },
        ],
    },
    TEST_TAKER: {
        id: 'TEST_TAKER',
        baseName: 'Test Taker',
        baseDescription: (threshold) => `Complete ${threshold} test(s).`,
        icon: '📝',
        metric: 'testsCompleted',
        levels: [
            { level: 1, threshold: 5, points: 50 },
            { level: 2, threshold: 15, points: 150 },
            { level: 3, threshold: 30, points: 300 },
            { level: 4, threshold: 50, points: 500 },
            { level: 5, threshold: 75, points: 750 },
            { level: 6, threshold: 100, points: 1000 },
            { level: 7, threshold: 150, points: 1500 },
            { level: 8, threshold: 200, points: 2000 },
            { level: 9, threshold: 250, points: 2500 },
            { level: 10, threshold: 500, points: 5000 },
        ],
    },
    HIGH_SCORER: {
        id: 'HIGH_SCORER',
        baseName: 'High Scorer',
        baseDescription: (threshold) => `Score 80% or higher on ${threshold} test(s).`,
        icon: '🎯',
        metric: 'highScoreTests',
        levels: [
            { level: 1, threshold: 3, points: 75 },
            { level: 2, threshold: 10, points: 250 },
            { level: 3, threshold: 20, points: 500 },
            { level: 4, threshold: 35, points: 875 },
            { level: 5, threshold: 50, points: 1250 },
            { level: 6, threshold: 75, points: 1875 },
            { level: 7, threshold: 100, points: 2500 },
            { level: 8, threshold: 150, points: 3750 },
            { level: 9, threshold: 200, points: 5000 },
            { level: 10, threshold: 300, points: 7500 },
        ],
    },
    PERFECTIONIST: {
        id: 'PERFECTIONIST',
        baseName: 'Perfectionist',
        baseDescription: (threshold) => `Achieve a perfect 100% score on ${threshold} test(s).`,
        icon: '🏆',
        metric: 'perfectScoreTests',
        levels: [
            { level: 1, threshold: 1, points: 150 },
            { level: 2, threshold: 3, points: 450 },
            { level: 3, threshold: 5, points: 750 },
            { level: 4, threshold: 10, points: 1500 },
            { level: 5, threshold: 15, points: 2250 },
            { level: 6, threshold: 25, points: 3750 },
            { level: 7, threshold: 35, points: 5250 },
            { level: 8, threshold: 50, points: 7500 },
            { level: 9, threshold: 75, points: 11250 },
            { level: 10, threshold: 100, points: 15000 },
        ],
    },
    DUELIST: {
        id: 'DUELIST',
        baseName: 'Duelist',
        baseDescription: (threshold) => `Win ${threshold} head-to-head game(s).`,
        icon: '⚔️',
        metric: 'gamesWon',
        levels: [
            { level: 1, threshold: 3, points: 75 },
            { level: 2, threshold: 10, points: 250 },
            { level: 3, threshold: 20, points: 500 },
            { level: 4, threshold: 35, points: 875 },
            { level: 5, threshold: 50, points: 1250 },
            { level: 6, threshold: 75, points: 1875 },
            { level: 7, threshold: 100, points: 2500 },
            { level: 8, threshold: 150, points: 3750 },
            { level: 9, threshold: 200, points: 5000 },
            { level: 10, threshold: 300, points: 7500 },
        ],
    },
    MARKETPLACE_SELLER: {
        id: 'MARKETPLACE_SELLER',
        baseName: 'Marketplace Seller',
        baseDescription: (threshold) => `Create ${threshold} marketplace listing(s).`,
        icon: '💰',
        metric: 'listingsCreated',
        levels: [
            { level: 1, threshold: 1, points: 25 },
            { level: 2, threshold: 5, points: 100 },
            { level: 3, threshold: 10, points: 250 },
            { level: 4, threshold: 20, points: 500 },
            { level: 5, threshold: 35, points: 875 },
            { level: 6, threshold: 50, points: 1250 },
            { level: 7, threshold: 75, points: 1875 },
            { level: 8, threshold: 100, points: 2500 },
            { level: 9, threshold: 150, points: 3750 },
            { level: 10, threshold: 200, points: 5000 },
        ],
    },
    TRUSTED_SELLER: {
        id: 'TRUSTED_SELLER',
        baseName: 'Trusted Seller',
        baseDescription: (threshold) => `Receive ${threshold} five-star review(s) on listings.`,
        icon: '⭐',
        metric: 'fiveStarReviews',
        levels: [
            { level: 1, threshold: 1, points: 50 },
            { level: 2, threshold: 5, points: 200 },
            { level: 3, threshold: 10, points: 400 },
            { level: 4, threshold: 20, points: 800 },
            { level: 5, threshold: 35, points: 1400 },
            { level: 6, threshold: 50, points: 2000 },
            { level: 7, threshold: 75, points: 3000 },
            { level: 8, threshold: 100, points: 4000 },
            { level: 9, threshold: 150, points: 6000 },
            { level: 10, threshold: 200, points: 8000 },
        ],
    },
    OFFER_MAKER: {
        id: 'OFFER_MAKER',
        baseName: 'Offer Maker',
        baseDescription: (threshold) => `Submit ${threshold} marketplace offer(s).`,
        icon: '🤝',
        metric: 'offersMade',
        levels: [
            { level: 1, threshold: 1, points: 25 },
            { level: 2, threshold: 5, points: 100 },
            { level: 3, threshold: 10, points: 250 },
            { level: 4, threshold: 20, points: 500 },
            { level: 5, threshold: 35, points: 875 },
            { level: 6, threshold: 50, points: 1250 },
            { level: 7, threshold: 75, points: 1875 },
            { level: 8, threshold: 100, points: 2500 },
            { level: 9, threshold: 150, points: 3750 },
            { level: 10, threshold: 200, points: 5000 },
        ],
    },
};

/**
 * Get the next badge level for a given badge and current stat value
 */
export const getNextBadgeLevel = (
    badgeId: BadgeId,
    currentValue: number
): BadgeLevel | null => {
    const definition = BADGE_DEFINITIONS[badgeId];
    if (!definition) return null;

    for (const level of definition.levels) {
        if (currentValue < level.threshold) {
            return level;
        }
    }
    return null; // Already at max level
};

/**
 * Get the current badge level for a given badge and stat value
 */
export const getCurrentBadgeLevel = (
    badgeId: BadgeId,
    currentValue: number
): BadgeLevel | null => {
    const definition = BADGE_DEFINITIONS[badgeId];
    if (!definition) return null;

    let currentLevel: BadgeLevel | null = null;
    for (const level of definition.levels) {
        if (currentValue >= level.threshold) {
            currentLevel = level;
        } else {
            break;
        }
    }
    return currentLevel;
};

/**
 * Check if user has earned a new badge level
 */
export const checkBadgeProgress = (
    badgeId: BadgeId,
    previousValue: number,
    newValue: number
): { earned: boolean; level: BadgeLevel } | null => {
    const previousLevel = getCurrentBadgeLevel(badgeId, previousValue);
    const newLevel = getCurrentBadgeLevel(badgeId, newValue);

    if (!newLevel) return null;
    
    const previousLevelNum = previousLevel?.level ?? 0;
    if (newLevel.level > previousLevelNum) {
        return { earned: true, level: newLevel };
    }
    
    return null;
};

/**
 * Create a badge object from a definition and level
 */
export const createBadge = (badgeId: BadgeId, level: number): Badge => {
    const definition = BADGE_DEFINITIONS[badgeId];
    const badgeLevel = definition.levels.find(l => l.level === level);
    
    return {
        id: badgeId,
        level,
        name: `${definition.baseName} ${getLevelRomanNumeral(level)}`,
        description: definition.baseDescription(badgeLevel?.threshold ?? 0),
        icon: definition.icon,
        dateAwarded: new Date().toISOString(),
    };
};

/**
 * Convert level number to Roman numeral
 */
const getLevelRomanNumeral = (level: number): string => {
    const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return numerals[level - 1] || level.toString();
};

/**
 * Calculate total points from badges
 */
export const calculateTotalBadgePoints = (badges: Badge[]): number => {
    return badges.reduce((total, badge) => {
        const definition = BADGE_DEFINITIONS[badge.id];
        if (!definition) return total;
        
        const level = definition.levels.find(l => l.level === badge.level);
        return total + (level?.points ?? 0);
    }, 0);
};

/**
 * Get progress percentage to next badge level
 */
export const getBadgeProgress = (
    badgeId: BadgeId,
    currentValue: number
): { progress: number; current: number; target: number } | null => {
    const currentLevel = getCurrentBadgeLevel(badgeId, currentValue);
    const nextLevel = getNextBadgeLevel(badgeId, currentValue);
    
    if (!nextLevel) {
        // Already at max level
        return { progress: 100, current: currentValue, target: currentValue };
    }
    
    const previousThreshold = currentLevel?.threshold ?? 0;
    const range = nextLevel.threshold - previousThreshold;
    const progress = ((currentValue - previousThreshold) / range) * 100;
    
    return {
        progress: Math.min(100, Math.max(0, progress)),
        current: currentValue,
        target: nextLevel.threshold,
    };
};
