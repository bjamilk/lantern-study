import { useEffect, useState } from 'react';
import { recordLoginAndGetStreak, claimLoginBonus, LoginStreakData, loadLoginStreak } from '../gamification';

export interface UseLoginStreakResult {
  streakData: LoginStreakData;
  /** True only on the first load of the day — triggers the bonus banner */
  showDailyBonus: boolean;
  /** XP earned for today's login */
  bonusXP: number;
  /** Call this when the user dismisses the bonus banner */
  dismissBonus: () => void;
}

export function useLoginStreak(): UseLoginStreakResult {
  const [streakData, setStreakData] = useState<LoginStreakData>(loadLoginStreak);
  const [showDailyBonus, setShowDailyBonus] = useState(false);
  const [bonusXP, setBonusXP] = useState(0);

  useEffect(() => {
    const { data, isNewDay, bonusXP: xp } = recordLoginAndGetStreak();
    setStreakData(data);
    // Show bonus banner only if it's a new day AND bonus hasn't been claimed yet
    if (isNewDay && data.bonusClaimedDate !== data.lastLoginDate) {
      setShowDailyBonus(true);
      setBonusXP(xp);
    }
  }, []);

  const dismissBonus = () => {
    const updated = claimLoginBonus(streakData);
    setStreakData(updated);
    setShowDailyBonus(false);
  };

  return { streakData, showDailyBonus, bonusXP, dismissBonus };
}
