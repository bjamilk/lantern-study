/**
 * Realtime Subscriptions Hook
 * Manages Supabase realtime subscriptions for authenticated users
 * 
 * Channels:
 * - Notifications: Listens for new notifications for the current user
 * - Group Messages: Listens for new messages in user's groups
 * - Profile/Settings Updates: Listens for settings changes synced from other devices
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore, Message } from '../stores/groupStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ============================================
// Types
// ============================================

export interface RealtimeSubscriptionStatus {
  notifications: 'connecting' | 'connected' | 'disconnected' | 'error';
  groupMessages: 'connecting' | 'connected' | 'disconnected' | 'error';
  settings: 'connecting' | 'connected' | 'disconnected' | 'error';
}

export interface Notification {
  id: string;
  userId: string;
  type: 'group_invite' | 'message' | 'badge_unlock' | 'study_reminder' | 'test_result' | 'system';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

// Callback types for subscription events
type NotificationCallback = (notification: Notification) => void;
type MessageCallback = (message: Message) => void;
type SettingsCallback = (settings: Record<string, unknown>) => void;

// ============================================
// Subscription Manager
// ============================================

class RealtimeSubscriptionManager {
  private channels: Map<string, RealtimeChannel> = new Map();
  private notificationCallbacks: Set<NotificationCallback> = new Set();
  private messageCallbacks: Set<MessageCallback> = new Set();
  private settingsCallbacks: Set<SettingsCallback> = new Set();
  private isSubscribed = false;
  private userId: string | null = null;
  private groupIds: string[] = [];

  /**
   * Subscribe to all realtime channels for a user
   */
  async subscribe(userId: string, groupIds: string[] = []): Promise<void> {
    if (this.isSubscribed && this.userId === userId) {
      // Update group subscriptions if groups changed
      if (JSON.stringify(this.groupIds) !== JSON.stringify(groupIds)) {
        await this.updateGroupSubscriptions(groupIds);
      }
      return;
    }

    this.userId = userId;
    this.groupIds = groupIds;
    this.isSubscribed = true;

    console.log('[Realtime] Starting subscriptions for user:', userId);

    // Subscribe to notifications
    this.subscribeToNotifications(userId);

    // Subscribe to group messages
    for (const groupId of groupIds) {
      this.subscribeToGroupMessages(groupId);
    }

    // Subscribe to user settings
    this.subscribeToSettings(userId);
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribe(): Promise<void> {
    console.log('[Realtime] Unsubscribing from all channels');

    for (const [name, channel] of this.channels) {
      await supabase.removeChannel(channel);
      console.log(`[Realtime] Removed channel: ${name}`);
    }

    this.channels.clear();
    this.isSubscribed = false;
    this.userId = null;
    this.groupIds = [];
  }

  /**
   * Update group message subscriptions when groups change
   */
  private async updateGroupSubscriptions(newGroupIds: string[]): Promise<void> {
    const currentGroupIds = new Set(this.groupIds);
    const newGroupIdsSet = new Set(newGroupIds);

    // Unsubscribe from removed groups
    for (const groupId of currentGroupIds) {
      if (!newGroupIdsSet.has(groupId)) {
        const channelName = `messages:${groupId}`;
        const channel = this.channels.get(channelName);
        if (channel) {
          await supabase.removeChannel(channel);
          this.channels.delete(channelName);
          console.log(`[Realtime] Unsubscribed from group: ${groupId}`);
        }
      }
    }

    // Subscribe to new groups
    for (const groupId of newGroupIdsSet) {
      if (!currentGroupIds.has(groupId)) {
        this.subscribeToGroupMessages(groupId);
      }
    }

    this.groupIds = newGroupIds;
  }

  /**
   * Subscribe to notifications channel
   */
  private subscribeToNotifications(userId: string): void {
    const channelName = `notifications:${userId}`;

    if (this.channels.has(channelName)) {
      return;
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<Notification>) => {
          console.log('[Realtime] New notification:', payload);
          const notification = payload.new as Notification;
          this.notificationCallbacks.forEach(cb => cb(notification));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<Notification>) => {
          console.log('[Realtime] Notification updated:', payload);
          const notification = payload.new as Notification;
          this.notificationCallbacks.forEach(cb => cb(notification));
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Notifications channel status: ${status}`);
      });

    this.channels.set(channelName, channel);
  }

  /**
   * Subscribe to messages for a specific group
   */
  private subscribeToGroupMessages(groupId: string): void {
    const channelName = `messages:${groupId}`;

    if (this.channels.has(channelName)) {
      return;
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload: RealtimePostgresChangesPayload<Message>) => {
          console.log('[Realtime] New message in group:', groupId, payload);
          const message = payload.new as Message;
          this.messageCallbacks.forEach(cb => cb(message));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload: RealtimePostgresChangesPayload<Message>) => {
          console.log('[Realtime] Message updated in group:', groupId, payload);
          const message = payload.new as Message;
          this.messageCallbacks.forEach(cb => cb(message));
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Messages channel (${groupId}) status: ${status}`);
      });

    this.channels.set(channelName, channel);
  }

  /**
   * Subscribe to user settings updates
   */
  private subscribeToSettings(userId: string): void {
    const channelName = `user_settings:${userId}`;

    if (this.channels.has(channelName)) {
      return;
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_settings',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<{ settings: Record<string, unknown> }>) => {
          console.log('[Realtime] Settings updated:', payload);
          const settings = (payload.new as { settings: Record<string, unknown> })?.settings;
          if (settings) {
            this.settingsCallbacks.forEach(cb => cb(settings));
          }
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Settings channel status: ${status}`);
      });

    this.channels.set(channelName, channel);
  }

  /**
   * Add a callback for notification events
   */
  onNotification(callback: NotificationCallback): () => void {
    this.notificationCallbacks.add(callback);
    return () => this.notificationCallbacks.delete(callback);
  }

  /**
   * Add a callback for message events
   */
  onMessage(callback: MessageCallback): () => void {
    this.messageCallbacks.add(callback);
    return () => this.messageCallbacks.delete(callback);
  }

  /**
   * Add a callback for settings events
   */
  onSettings(callback: SettingsCallback): () => void {
    this.settingsCallbacks.add(callback);
    return () => this.settingsCallbacks.delete(callback);
  }

  /**
   * Get subscription status
   */
  getStatus(): { isSubscribed: boolean; channelCount: number } {
    return {
      isSubscribed: this.isSubscribed,
      channelCount: this.channels.size,
    };
  }
}

// Singleton instance
const subscriptionManager = new RealtimeSubscriptionManager();

// ============================================
// Hook: useRealtimeSubscriptions
// ============================================

export interface UseRealtimeSubscriptionsOptions {
  /** Called when a new notification is received */
  onNotification?: NotificationCallback;
  /** Called when a new group message is received */
  onMessage?: MessageCallback;
  /** Called when settings are updated from another device */
  onSettingsUpdate?: SettingsCallback;
  /** Whether to automatically subscribe when authenticated */
  autoSubscribe?: boolean;
}

export interface UseRealtimeSubscriptionsResult {
  /** Whether realtime subscriptions are active */
  isSubscribed: boolean;
  /** Number of active channels */
  channelCount: number;
  /** Manually trigger subscription (usually not needed) */
  subscribe: () => Promise<void>;
  /** Manually trigger unsubscription (usually not needed) */
  unsubscribe: () => Promise<void>;
}

export function useRealtimeSubscriptions(
  options: UseRealtimeSubscriptionsOptions = {}
): UseRealtimeSubscriptionsResult {
  const { 
    onNotification, 
    onMessage, 
    onSettingsUpdate,
    autoSubscribe = true 
  } = options;

  const { user } = useAuthStore();
  const { groups } = useGroupStore();
  const { loadSettings } = useSettingsStore();
  
  const isSubscribedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Get group IDs the user belongs to
  const groupIds = groups.map(g => g.id);

  // Handle notification received
  const handleNotification = useCallback((notification: Notification) => {
    console.log('[useRealtimeSubscriptions] Notification received:', notification.title);
    onNotification?.(notification);
  }, [onNotification]);

  // Handle message received
  const handleMessage = useCallback((message: Message) => {
    console.log('[useRealtimeSubscriptions] Message received in group:', message.groupId);
    onMessage?.(message);
    
    // The groupStore should handle updating its state
    // This could trigger a refresh of the messages list
  }, [onMessage]);

  // Handle settings update
  const handleSettingsUpdate = useCallback(async (settings: Record<string, unknown>) => {
    console.log('[useRealtimeSubscriptions] Settings updated from remote');
    onSettingsUpdate?.(settings);
    
    // Reload settings from remote to ensure consistency
    if (user?.id) {
      try {
        await loadSettings(user.id);
      } catch (error) {
        console.error('[useRealtimeSubscriptions] Failed to reload settings:', error);
      }
    }
  }, [onSettingsUpdate, loadSettings, user?.id]);

  // Subscribe to realtime updates
  const subscribe = useCallback(async () => {
    if (!user?.id) {
      console.log('[useRealtimeSubscriptions] No user, skipping subscription');
      return;
    }

    await subscriptionManager.subscribe(user.id, groupIds);
    isSubscribedRef.current = true;
  }, [user?.id, groupIds]);

  // Unsubscribe from realtime updates
  const unsubscribe = useCallback(async () => {
    await subscriptionManager.unsubscribe();
    isSubscribedRef.current = false;
  }, []);

  // Register callbacks
  useEffect(() => {
    const unsubNotification = subscriptionManager.onNotification(handleNotification);
    const unsubMessage = subscriptionManager.onMessage(handleMessage);
    const unsubSettings = subscriptionManager.onSettings(handleSettingsUpdate);

    return () => {
      unsubNotification();
      unsubMessage();
      unsubSettings();
    };
  }, [handleNotification, handleMessage, handleSettingsUpdate]);

  // Auto-subscribe when authenticated
  useEffect(() => {
    if (!autoSubscribe) return;

    if (user?.id) {
      subscribe();
    } else {
      unsubscribe();
    }
  }, [user?.id, autoSubscribe, subscribe, unsubscribe]);

  // Update group subscriptions when groups change
  useEffect(() => {
    if (user?.id && isSubscribedRef.current) {
      subscriptionManager.subscribe(user.id, groupIds);
    }
  }, [user?.id, groupIds]);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to foreground - reconnect subscriptions
        console.log('[useRealtimeSubscriptions] App resumed, reconnecting...');
        if (user?.id && autoSubscribe) {
          await subscribe();
        }
      } else if (nextAppState.match(/inactive|background/)) {
        // App going to background - optionally disconnect to save battery
        // For now, we keep subscriptions active
        console.log('[useRealtimeSubscriptions] App going to background');
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [user?.id, autoSubscribe, subscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't unsubscribe on unmount - let the manager persist
      // This prevents re-subscribing when navigating between screens
    };
  }, []);

  const status = subscriptionManager.getStatus();

  return {
    isSubscribed: status.isSubscribed,
    channelCount: status.channelCount,
    subscribe,
    unsubscribe,
  };
}

// ============================================
// Hook: useNotificationSubscription
// ============================================

/**
 * Simplified hook for just notification subscriptions
 */
export function useNotificationSubscription(
  onNotification: NotificationCallback
): { isSubscribed: boolean } {
  const result = useRealtimeSubscriptions({
    onNotification,
    autoSubscribe: true,
  });

  return { isSubscribed: result.isSubscribed };
}

// ============================================
// Hook: useGroupMessageSubscription
// ============================================

/**
 * Simplified hook for group message subscriptions
 */
export function useGroupMessageSubscription(
  onMessage: MessageCallback
): { isSubscribed: boolean } {
  const result = useRealtimeSubscriptions({
    onMessage,
    autoSubscribe: true,
  });

  return { isSubscribed: result.isSubscribed };
}

// ============================================
// Exports
// ============================================

export { subscriptionManager };
export default useRealtimeSubscriptions;
