export type { BadgeMetric, BadgeDefinition } from '@lantern/shared/utils';
export {
    BADGE_DEFINITIONS,
    getNextBadgeLevel,
    getCurrentBadgeLevel,
    checkBadgeProgress,
    createBadge,
    calculateTotalBadgePoints,
    getBadgeProgress,
} from '@lantern/shared/utils';

export type { XPLevel } from '@lantern/shared/utils';
export { XP_LEVELS, getXPLevel } from '@lantern/shared/utils';

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
