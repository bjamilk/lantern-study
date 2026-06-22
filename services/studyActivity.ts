import type { ActivityType } from '@lantern/shared';
import { recordStudyActivity, fetchStudyActivity } from './gamificationStreak';
import { useTestStore } from '../stores/testStore';

export function trackStudyActivity(type: ActivityType, amount = 1): void {
  recordStudyActivity(type, amount)
    .then(() => fetchStudyActivity())
    .then((days) => {
      if (Array.isArray(days)) {
        useTestStore.getState().setStudyActivityDays(days);
      }
    })
    .catch((err) => {
      console.warn('[StudyActivity] track failed:', err);
    });
}
