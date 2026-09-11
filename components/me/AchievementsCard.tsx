import React, { useMemo } from 'react';
import type { Badge, User } from '../../types';
import { BADGE_DEFINITIONS } from '../../gamification';
import { AppIcon } from '../ui/AppIcon';

interface AchievementsCardProps {
  currentUser: User;
}

export const AchievementsCard: React.FC<AchievementsCardProps> = ({ currentUser }) => {
  const highestLevelBadges = useMemo(() => {
    const badgeMap = new Map<string, Badge>();
    (currentUser.badges || []).forEach((badge) => {
      const existing = badgeMap.get(badge.id);
      if (!existing || badge.level > existing.level) {
        badgeMap.set(badge.id, badge);
      }
    });
    return Object.values(BADGE_DEFINITIONS)
      .map((def) => ({
        definition: def,
        userBadge: badgeMap.get(def.id),
      }))
      .sort((a, b) => {
        const aEarned = !!a.userBadge;
        const bEarned = !!b.userBadge;
        if (aEarned && !bEarned) return -1;
        if (!aEarned && bEarned) return 1;
        return 0;
      });
  }, [currentUser.badges]);

  return (
    <div className="rounded-2xl border border-lantern-border bg-lantern-surface">
      <div className="p-4 md:p-5 border-b border-lantern-border">
        <h2 className="text-heading font-semibold text-lantern-text flex items-center">
          <AppIcon name="trophy" size={20} className="mr-2 text-yellow-500" />
          Achievements
        </h2>
      </div>
      <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
        {highestLevelBadges.map(({ definition, userBadge }) => {
          const currentLevel = userBadge?.level || 0;
          const nextLevelInfo = definition.levels.find((l) => l.level === currentLevel + 1);
          const isRisingStar = definition.id === 'RISING_STAR';

          let progress = 0;
          let progressText = '0 / 0';
          if (nextLevelInfo && definition.metric !== 'question_upvotes') {
            const metric = definition.metric;
            const currentStatValue = currentUser.stats[metric] || 0;
            const startOfLevel = definition.levels.find((l) => l.level === currentLevel)?.threshold || 0;
            progress = ((currentStatValue - startOfLevel) / (nextLevelInfo.threshold - startOfLevel)) * 100;
            progressText = `${currentStatValue} / ${nextLevelInfo.threshold}`;
          } else if (!nextLevelInfo) {
            progress = 100;
            progressText = 'Max Level!';
          }

          return (
            <div key={definition.id} className="flex items-center gap-3 p-3 bg-lantern-background-secondary rounded-lg">
              <span className="text-title flex-shrink-0 leading-none">{definition.icon}</span>
              <div className="flex-grow min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-body text-lantern-text truncate">
                    {userBadge ? userBadge.name : definition.baseName}
                  </p>
                  {userBadge && (
                    <span className="text-caption bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ml-2">
                      Lv.{userBadge.level}
                    </span>
                  )}
                </div>
                {isRisingStar ? (
                  nextLevelInfo ? (
                    <p className="text-caption text-lantern-text-secondary mt-0.5">
                      Goal: {nextLevelInfo.threshold} upvotes on one question
                    </p>
                  ) : (
                    <p className="text-caption text-green-500 font-semibold mt-0.5">Max Level!</p>
                  )
                ) : (
                  <div className="mt-1.5">
                    <div className="flex justify-between text-caption text-lantern-text-secondary mb-0.5">
                      <span>{progressText}</span>
                    </div>
                    <div className="w-full bg-lantern-background-secondary rounded-full h-1.5">
                      <div
                        className="bg-lantern-primary-fill h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AchievementsCard;
