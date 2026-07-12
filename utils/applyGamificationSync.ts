import type { User, Badge } from '../types';
import { BADGE_DEFINITIONS } from '../gamification';
import type { GamificationSyncResult } from '../services/gamificationStreak';

export function applyGamificationSync(
  currentUser: User,
  synced: GamificationSyncResult | null | undefined,
  setCurrentUser: (user: User) => void,
  addNotification?: (message: string) => void | Promise<void>
): void {
  if (!synced || !currentUser) return;

  setCurrentUser({
    ...currentUser,
    points: synced.points ?? currentUser.points,
    badges: synced.badges ?? currentUser.badges,
    stats: synced.stats ?? currentUser.stats,
  });

  (synced.awardedBadges || []).forEach((badge: Badge) => {
    const badgeDef = BADGE_DEFINITIONS[badge.id];
    const levelInfo = badgeDef?.levels.find((l) => l.level === badge.level);
    const points = levelInfo?.points || 0;
    void addNotification?.(`Badge Unlocked: ${badge.name}! You've earned ${points} points.`);
  });
}
