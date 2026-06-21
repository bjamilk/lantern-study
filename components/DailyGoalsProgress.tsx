import React from 'react';
import type { StudyActivityDay } from '@lantern/shared';
import { getDailyGoalProgress } from '@lantern/shared/settings';
import type { StudySettings } from '@lantern/shared/settings';

interface Props {
  study: Pick<StudySettings, 'dailyCardGoal' | 'dailyTestGoal'>;
  activityDays: StudyActivityDay[];
}

export function DailyGoalsProgress({ study, activityDays }: Props) {
  const progress = getDailyGoalProgress(study, activityDays);

  if (progress.cardGoal <= 0 && progress.testGoal <= 0) return null;

  return (
    <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-lantern-text">Today&apos;s goals</h3>
        {progress.goalsMet && (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Complete</span>
        )}
      </div>
      {progress.cardGoal > 0 && (
        <div>
          <div className="flex justify-between text-xs text-lantern-text-secondary mb-1">
            <span>Flashcards</span>
            <span>
              {progress.cardsDone}/{progress.cardGoal}
            </span>
          </div>
          <div className="h-2 rounded-full bg-lantern-background-secondary overflow-hidden">
            <div
              className="h-full bg-lantern-primary transition-all"
              style={{ width: `${progress.cardProgressPercent}%` }}
            />
          </div>
        </div>
      )}
      {progress.testGoal > 0 && (
        <div>
          <div className="flex justify-between text-xs text-lantern-text-secondary mb-1">
            <span>Tests</span>
            <span>
              {progress.testsDone}/{progress.testGoal}
            </span>
          </div>
          <div className="h-2 rounded-full bg-lantern-background-secondary overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${progress.testProgressPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
