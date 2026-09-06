/**
 * Mobile Hooks
 * Centralized exports for all custom React hooks
 */

export {
  useNetworkStatus,
  useSyncStatus,
  usePendingWork,
  useSync,
  useOnlineEffect,
  useAutoSync,
} from './useSync';

export type {
  NetworkStatus,
  SyncStatus,
  UsePendingWorkResult,
  UseSyncResult,
} from './useSync';

export {
  useRealtimeSubscriptions,
  useNotificationSubscription,
  useGroupMessageSubscription,
  subscriptionManager,
} from './useRealtimeSubscriptions';

export type {
  RealtimeSubscriptionStatus,
  RealtimeSubscribeMode,
  Notification,
  UseRealtimeSubscriptionsOptions,
  UseRealtimeSubscriptionsResult,
} from './useRealtimeSubscriptions';

export { useAIHandlers } from './useAIHandlers';
export { useGroupHandlers } from './useGroupHandlers';
export { useLowDataMode } from './useLowDataMode';
export { useConfirmBeforeExit } from './useConfirmBeforeExit';
export type { ConfirmBeforeExitOptions } from './useConfirmBeforeExit';
export { usePlatformAdmin } from './usePlatformAdmin';
export { useShopBadges } from './useShopBadges';
export type { ShopBadges } from './useShopBadges';
