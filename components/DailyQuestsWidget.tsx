import React from 'react';
import { CheckCircleIcon, FireIcon } from '@heroicons/react/24/outline';

export interface DailyQuest {
  id: string;
  questType: string;
  targetCount: number;
  progressCount: number;
  completed: boolean;
  rewardXp: number;
}

interface DailyQuestsWidgetProps {
  quests: DailyQuest[];
  streak: number;
  streakFreezes?: number;
  walletBalance?: number;
  onPurchaseStreakFreeze?: () => void;
  questsLoaded?: boolean;
  onRefresh?: () => void;
  theme?: 'light' | 'dark';
  className?: string;
}

const QUEST_LABELS: Record<string, string> = {
  review_cards: 'Review flashcards',
  answer_questions: 'Answer group questions',
  create_note: 'Create or edit a note',
  complete_test: 'Complete a practice test',
};

export const DailyQuestsWidget: React.FC<DailyQuestsWidgetProps> = ({
  quests = [],
  streak,
  streakFreezes = 0,
  walletBalance = 0,
  onPurchaseStreakFreeze,
  questsLoaded = false,
  onRefresh,
  theme = 'light',
  className = '',
}) => {
  const isDark = theme === 'dark';
  const boxClass = `rounded-xl border p-4 h-full ${className} ${isDark ? 'bg-lantern-surface border-lantern-border' : 'bg-lantern-surface border-lantern-border shadow-sm'}`;

  if (!questsLoaded) {
    return (
      <div className={`animate-pulse ${boxClass}`}>
        <div className="h-5 w-32 bg-lantern-background-secondary rounded mb-3" />
        <div className="space-y-2">
          <div className="h-8 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded" />
          <div className="h-8 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded" />
          <div className="h-8 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded" />
        </div>
      </div>
    );
  }

  const completedCount = quests.filter((q) => q.completed).length;

  if (quests.length === 0) {
    return (
      <div className={boxClass}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-lantern-text">Daily Quests</h3>
          <div className="flex items-center gap-2 text-sm">
            <FireIcon className="w-4 h-4 text-orange-500" />
            <span className="font-bold text-orange-600">{streak} day streak</span>
          </div>
        </div>
        <p className="text-sm text-lantern-text-secondary mb-3">Quests unavailable right now.</p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="text-sm text-lantern-primary hover:underline"
          >
            Refresh quests
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={boxClass}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lantern-text">Daily Quests</h3>
        <div className="flex items-center gap-2 text-sm">
          <FireIcon className="w-4 h-4 text-orange-500" />
          <span className="font-bold text-orange-600">{streak} day streak</span>
          {streakFreezes > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-lantern-primary" title="Streak freezes available">
              ❄ {streakFreezes}
            </span>
          )}
          {onPurchaseStreakFreeze && streakFreezes === 0 && (
            <button
              onClick={onPurchaseStreakFreeze}
              className="text-caption px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-lantern-warning"
              title="Buy streak freeze for 50 coins"
            >
              Buy freeze (50🪙)
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-lantern-text-secondary mb-3">{completedCount}/{quests.length} completed today</p>
      <div className="space-y-2">
        {quests.map((quest) => {
          const pct = Math.min(100, (quest.progressCount / quest.targetCount) * 100);
          return (
            <div key={quest.id} className="flex items-center gap-3">
              {quest.completed ? (
                <CheckCircleIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-lantern-border flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-sm mb-0.5">
                  <span className={quest.completed ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text'}>
                    {QUEST_LABELS[quest.questType] || quest.questType}
                  </span>
                  <span className="text-xs text-lantern-text-tertiary">{quest.progressCount}/{quest.targetCount}</span>
                </div>
                <div className="h-1.5 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${quest.completed ? 'bg-emerald-500' : 'bg-lantern-primary'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="text-xs text-amber-600 font-medium">+{quest.rewardXp} XP</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DailyQuestsWidget;
