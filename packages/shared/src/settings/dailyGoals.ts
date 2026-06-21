import type { StudyActivityDay } from '../types';
import type { StudySettings } from './userSettings';
import { getTodayStudyCounts } from './studySession';

export interface DailyGoalProgress {
  cardGoal: number;
  cardsDone: number;
  cardsRemaining: number;
  cardProgressPercent: number;
  cardGoalMet: boolean;
  testGoal: number;
  testsDone: number;
  testsRemaining: number;
  testProgressPercent: number;
  testGoalMet: boolean;
  goalsMet: boolean;
}

export function getDailyGoalProgress(
  study: Pick<StudySettings, 'dailyCardGoal' | 'dailyTestGoal'>,
  activityDays: StudyActivityDay[]
): DailyGoalProgress {
  const today = getTodayStudyCounts(activityDays);
  const cardGoal = Math.max(0, study.dailyCardGoal);
  const testGoal = Math.max(0, study.dailyTestGoal);
  const cardsDone = today.flashcards;
  const testsDone = today.tests;

  const cardsRemaining = Math.max(0, cardGoal - cardsDone);
  const testsRemaining = Math.max(0, testGoal - testsDone);
  const cardProgressPercent =
    cardGoal > 0 ? Math.min(100, Math.round((cardsDone / cardGoal) * 100)) : 100;
  const testProgressPercent =
    testGoal > 0 ? Math.min(100, Math.round((testsDone / testGoal) * 100)) : 100;

  const cardGoalMet = cardGoal === 0 || cardsDone >= cardGoal;
  const testGoalMet = testGoal === 0 || testsDone >= testGoal;

  return {
    cardGoal,
    cardsDone,
    cardsRemaining,
    cardProgressPercent,
    cardGoalMet,
    testGoal,
    testsDone,
    testsRemaining,
    testProgressPercent,
    testGoalMet,
    goalsMet: cardGoalMet && testGoalMet,
  };
}
