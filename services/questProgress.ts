import { incrementQuestProgress } from './gamificationStreak';

export type QuestType = 'review_cards' | 'answer_questions' | 'create_note' | 'complete_test';

export function trackQuestProgress(questType: QuestType, increment = 1): void {
  incrementQuestProgress(questType, increment).catch(() => {
    // Non-fatal — quests may not be migrated yet
  });
}
