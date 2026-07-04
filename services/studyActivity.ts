import type { ActivityType } from '@lantern/shared';
import { recordStudyActivity, fetchStudyActivity } from './gamificationStreak';
import { useTestStore } from '../stores/testStore';
import { useBudgetStore } from '../stores/budgetStore';

export function trackStudyActivity(type: ActivityType, amount = 1): void {
  recordStudyActivity(type, amount)
    .then((result) => {
      if (result && typeof result.walletBalance === 'number') {
        useBudgetStore.getState().setWalletBalance(result.walletBalance);
        if (typeof result.awarded === 'number' && result.awarded > 0) {
          console.info(`[Wallet] +${result.awarded} coins (balance ${result.walletBalance})`);
        }
      }
      return fetchStudyActivity();
    })
    .then((days) => {
      if (Array.isArray(days)) {
        useTestStore.getState().setStudyActivityDays(days);
      }
    })
    .catch((err) => {
      console.warn('[StudyActivity] track failed:', err);
    });
}
