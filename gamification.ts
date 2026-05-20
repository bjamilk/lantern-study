import type { UserStats, BadgeId } from './types';

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
    RISING_STAR: { // This is the special one handled differently
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

// ─── XP Level System ──────────────────────────────────────────────────────────

export interface XPLevel {
  level: number;
  title: string;
  icon: string;
  minPoints: number;
  maxPoints: number; // -1 = no cap (max level)
  color: string; // Tailwind color class for the badge
}

export const XP_LEVELS: XPLevel[] = [
  { level: 1,  title: 'Newcomer',       icon: '🌱', minPoints: 0,      maxPoints: 199,    color: 'from-gray-400 to-gray-500' },
  { level: 2,  title: 'Student',        icon: '📖', minPoints: 200,    maxPoints: 499,    color: 'from-green-400 to-green-500' },
  { level: 3,  title: 'Scholar',        icon: '🎓', minPoints: 500,    maxPoints: 999,    color: 'from-teal-400 to-teal-500' },
  { level: 4,  title: 'Apprentice',     icon: '⚗️', minPoints: 1000,   maxPoints: 1999,   color: 'from-blue-400 to-blue-500' },
  { level: 5,  title: 'Practitioner',   icon: '🔬', minPoints: 2000,   maxPoints: 3499,   color: 'from-indigo-400 to-indigo-500' },
  { level: 6,  title: 'Expert',         icon: '🏅', minPoints: 3500,   maxPoints: 5999,   color: 'from-violet-400 to-violet-500' },
  { level: 7,  title: 'Master',         icon: '⭐', minPoints: 6000,   maxPoints: 9999,   color: 'from-purple-400 to-purple-600' },
  { level: 8,  title: 'Grandmaster',    icon: '🌟', minPoints: 10000,  maxPoints: 14999,  color: 'from-yellow-400 to-orange-400' },
  { level: 9,  title: 'Champion',       icon: '🏆', minPoints: 15000,  maxPoints: 24999,  color: 'from-orange-400 to-red-500' },
  { level: 10, title: 'Legend',         icon: '👑', minPoints: 25000,  maxPoints: -1,     color: 'from-yellow-300 to-yellow-500' },
];

export function getXPLevel(points: number): XPLevel & { progressPercent: number; pointsIntoLevel: number; pointsToNextLevel: number } {
  const level = [...XP_LEVELS].reverse().find(l => points >= l.minPoints) ?? XP_LEVELS[0];
  const isMaxLevel = level.maxPoints === -1;
  const pointsIntoLevel = points - level.minPoints;
  const levelSpan = isMaxLevel ? 1 : level.maxPoints - level.minPoints + 1;
  const progressPercent = isMaxLevel ? 100 : Math.min(100, Math.round((pointsIntoLevel / levelSpan) * 100));
  const pointsToNextLevel = isMaxLevel ? 0 : level.maxPoints + 1 - points;
  return { ...level, progressPercent, pointsIntoLevel, pointsToNextLevel };
}

// ─── Daily Login Streak ────────────────────────────────────────────────────────

const STREAK_KEY = 'lantern_login_streak';

export interface LoginStreakData {
  streak: number;
  longestStreak: number;
  lastLoginDate: string | null; // YYYY-MM-DD
  bonusClaimedDate: string | null; // YYYY-MM-DD — prevents double-claiming
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function loadLoginStreak(): LoginStreakData {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { streak: 1, longestStreak: 1, lastLoginDate: todayStr(), bonusClaimedDate: null };
}

export function recordLoginAndGetStreak(): { data: LoginStreakData; isNewDay: boolean; bonusXP: number } {
  const today = todayStr();
  const prev = loadLoginStreak();

  if (prev.lastLoginDate === today) {
    // Already logged in today — no change, check if bonus was claimed
    return { data: prev, isNewDay: false, bonusXP: 0 };
  }

  // Compute yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const continued = prev.lastLoginDate === yStr;
  const newStreak = continued ? prev.streak + 1 : 1;
  const newLongest = Math.max(prev.longestStreak, newStreak);

  // XP bonus: escalates with streak milestone
  let bonusXP = 10;
  if (newStreak >= 30) bonusXP = 500;
  else if (newStreak >= 14) bonusXP = 200;
  else if (newStreak >= 7) bonusXP = 100;
  else if (newStreak >= 3) bonusXP = 30;

  const data: LoginStreakData = {
    streak: newStreak,
    longestStreak: newLongest,
    lastLoginDate: today,
    bonusClaimedDate: null,
  };

  try { localStorage.setItem(STREAK_KEY, JSON.stringify(data)); } catch {}
  return { data, isNewDay: true, bonusXP };
}

export function claimLoginBonus(data: LoginStreakData): LoginStreakData {
  const updated = { ...data, bonusClaimedDate: todayStr() };
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}