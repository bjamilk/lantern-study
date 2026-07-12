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
  { level: 1,  title: 'Newcomer',       icon: '🌱', minPoints: 0,      maxPoints: 199,    color: 'from-lantern-border to-lantern-text-tertiary' },
  { level: 2,  title: 'Student',        icon: '📖', minPoints: 200,    maxPoints: 499,    color: 'from-green-400 to-green-500' },
  { level: 3,  title: 'Scholar',        icon: '🎓', minPoints: 500,    maxPoints: 999,    color: 'from-teal-400 to-teal-500' },
  { level: 4,  title: 'Apprentice',     icon: '⚗️', minPoints: 1000,   maxPoints: 1999,   color: 'from-blue-400 to-blue-500' },
  { level: 5,  title: 'Practitioner',   icon: '🔬', minPoints: 2000,   maxPoints: 3499,   color: 'from-lantern-primary-light to-lantern-primary' },
  { level: 6,  title: 'Expert',         icon: '🏅', minPoints: 3500,   maxPoints: 5999,   color: 'from-violet-400 to-violet-500' },
  { level: 7,  title: 'Master',         icon: '⭐', minPoints: 6000,   maxPoints: 9999,   color: 'from-purple-400 to-purple-600' },
  { level: 8,  title: 'Grandmaster',    icon: '🌟', minPoints: 10000,  maxPoints: 14999,  color: 'from-yellow-400 to-orange-400' },
  { level: 9,  title: 'Champion',       icon: '🏆', minPoints: 15000,  maxPoints: 24999,  color: 'from-orange-400 to-red-500' },
  { level: 10, title: 'Legend',         icon: '👑', minPoints: 25000,  maxPoints: -1,     color: 'from-yellow-300 to-yellow-500' },
];

export function getXPLevel(points: number): XPLevel & { progressPercent: number; pointsIntoLevel: number; pointsToNextLevel: number } {
  const found = [...XP_LEVELS].reverse().find(l => points >= l.minPoints);
  const level: XPLevel = found ?? XP_LEVELS[0]!;
  const isMaxLevel = level.maxPoints === -1;
  const pointsIntoLevel = points - level.minPoints;
  const levelSpan = isMaxLevel ? 1 : level.maxPoints - level.minPoints + 1;
  const progressPercent = isMaxLevel ? 100 : Math.min(100, Math.round((pointsIntoLevel / levelSpan) * 100));
  const pointsToNextLevel = isMaxLevel ? 0 : level.maxPoints + 1 - points;
  return { ...level, progressPercent, pointsIntoLevel, pointsToNextLevel };
}
