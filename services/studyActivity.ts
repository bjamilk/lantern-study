import type { ActivityType } from '@lantern/shared';
import { recordStudyActivity } from './gamificationStreak';

export function trackStudyActivity(type: ActivityType, amount = 1): void {
  recordStudyActivity(type, amount).catch(() => {
    // Non-fatal — table may not be migrated yet
  });
}
