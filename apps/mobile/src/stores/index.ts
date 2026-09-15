/**
 * Store exports
 *
 * Barrel for the zustand stores and the value/type helpers screens import
 * alongside them. It is deliberately partial: stores such as jobsStore,
 * boardStore, notesStore, communityStore and the small UI stores
 * (toast/confirm/featureTip) are imported from their own modules.
 *
 * Gotchas: a few names here are re-exported from elsewhere, not from a store —
 * the dashboard-stats types come from ../types/dashboardStats and the game
 * question-type/answer-record aliases from @lantern/shared/types.
 */
export { useAuthStore } from './authStore';
export { useFlashcardStore } from './flashcardStore';
export type { Deck, Flashcard } from './flashcardStore';
export { useGroupStore } from './groupStore';
export type { Group, GroupMember, Message } from './groupStore';
export { useTestStore } from './testStore';
export type { Test, TestQuestion, TestAttempt, ActiveTest } from './testStore';
export { useStatsStore, LEVEL_THRESHOLDS, calculateUserLevel } from './statsStore';
export type { 
  TimePeriod, 
  Badge, 
  TopicPerformance, 
  GroupPerformance, 
  RecentTest, 
  TroublesomeQuestion, 
  DashboardStats,
  UserLevel,
} from '../types/dashboardStats';
export {
  useMarketplaceStore,
  getCategoryInfo,
  mapRemoteListing,
  ACADEMIC_CATEGORIES,
  STUDENT_LIFE_CATEGORIES,
  CATEGORIES_BY_DEPARTMENT,
  ALL_BROWSE_CATEGORIES,
  categoriesForTab,
  MARKETPLACE_TABS,
  MARKETPLACE_DEPARTMENTS,
  marketplaceTabLabel,
  EMPTY_SHOP_SUMMARY,
  BUYER_ACTION_ORDER_STATUSES,
  orderNeedsSeller,
  orderAwaitsBuyerPayment,
  offerAwaitsUser,
  sumUnread,
} from './marketplaceStore';
export type { 
  ShopSummary,

  MarketplaceListing, 
  MarketplaceListingCampus,
  RemoteListing,
  MarketplaceReview, 
  MarketplaceInquiry,
  MarketplaceOffer,
  MarketplaceCategory, 
  MarketplaceTab 
} from './marketplaceStore';
export { useBudgetStore, TransactionType, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './budgetStore';
export { useGameStore } from './gameStore';
export type {
  GameSession,
  GameQuestion,
  GameUser,
  GameConfig,
} from './gameStore';
// Game sessions use the shared question-type enum and answer records.
export { QuestionType as GameQuestionType } from '@lantern/shared/types';
export type { UserAnswerRecord as GameAnswerRecord } from '@lantern/shared/types';
export type { Transaction, Budget } from './budgetStore';
export { useSettingsStore, DEFAULT_SETTINGS, useNotificationSettings, useStudySettings, useAppearanceSettings, usePrivacySettings, useAccessibilitySettings, useSyncSettings } from './settingsStore';
export type { UserSettings, NotificationSettings, StudySettings, AppearanceSettings, PrivacySettings, AccessibilitySettings, SyncSettings } from './settingsStore';
export { useOfflineStore } from './offlineStore';
export type { OfflineTest, OfflineQuestion, PendingResult, DownloadOptions } from './offlineStore';
export { useCompanionStore } from './companionStore';
export { useStudyGoalsStore } from './studyGoalsStore';
export { useNotificationStore } from './notificationStore';
export { useChatWallpaperStore } from './chatWallpaperStore';
export { useUIStore } from './uiStore';
export type { LibraryTab } from './uiStore';
