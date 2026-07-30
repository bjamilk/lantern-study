/**
 * Realtime Subscriptions Hook
 * Manages Supabase realtime subscriptions for authenticated users.
 *
 * Lean channel model (cost-conscious):
 * - notifications:{userId} — always on while subscribed
 * - group-messages-all:{userId} — one channel for all groups (RLS + client filter)
 * - dm-messages-all:{userId} — one channel for all DMs (RLS + client filter)
 * - user_settings:{userId} — foreground only
 *
 * Background (lean): keep notifications only; drop message/DM/settings feeds.
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore, Message, type DirectMessage } from '../stores/groupStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useNotificationStore } from '../stores/notificationStore';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ============================================
// Types
// ============================================

export interface RealtimeSubscriptionStatus {
  notifications: 'connecting' | 'connected' | 'disconnected' | 'error';
  groupMessages: 'connecting' | 'connected' | 'disconnected' | 'error';
  dmMessages: 'connecting' | 'connected' | 'disconnected' | 'error';
  settings: 'connecting' | 'connected' | 'disconnected' | 'error';
}

interface RawDmMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  text: string;
  timestamp: string;
  edited_at?: string;
  removed_at?: string;
  reply_to_message_id?: string;
  thread_root_id?: string;
  client_message_id?: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'group_invite' | 'message' | 'badge_unlock' | 'study_reminder' | 'test_result' | 'system'
    | 'challenge_invite' | 'challenge_accepted' | 'challenge_declined' | 'challenge_result' | 'challenge_opponent_finished';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

type NotificationCallback = (notification: Notification) => void;
type MessageCallback = (message: Message) => void;
type DirectMessageCallback = (message: DirectMessage) => void;
type SettingsCallback = (settings: Record<string, unknown>) => void;

export type RealtimeSubscribeMode = 'full' | 'lean';

const CHANNEL = {
  notifications: (userId: string) => `notifications:${userId}`,
  groupMessages: (userId: string) => `group-messages-all:${userId}`,
  dmMessages: (userId: string) => `dm-messages-all:${userId}`,
  settings: (userId: string) => `user_settings:${userId}`,
} as const;

// ============================================
// Subscription Manager
// ============================================

class RealtimeSubscriptionManager {
  private channels: Map<string, RealtimeChannel> = new Map();
  private notificationCallbacks: Set<NotificationCallback> = new Set();
  private messageCallbacks: Set<MessageCallback> = new Set();
  private dmMessageCallbacks: Set<DirectMessageCallback> = new Set();
  private settingsCallbacks: Set<SettingsCallback> = new Set();
  private isSubscribed = false;
  private userId: string | null = null;
  private mode: RealtimeSubscribeMode = 'full';
  private groupIds = new Set<string>();
  private dmThreadIds = new Set<string>();

  /**
   * Subscribe with a fixed lean channel set (not one channel per group/DM).
   */
  async subscribe(
    userId: string,
    groupIds: string[] = [],
    dmThreadIds: string[] = [],
    mode: RealtimeSubscribeMode = 'full'
  ): Promise<void> {
    if (this.isSubscribed && this.userId && this.userId !== userId) {
      await this.unsubscribe();
    }

    const sameUser = this.isSubscribed && this.userId === userId;
    this.userId = userId;
    this.groupIds = new Set(groupIds);
    this.dmThreadIds = new Set(dmThreadIds);

    // Membership-only update — keep existing channels.
    if (sameUser && this.mode === mode && this.channels.size > 0) {
      return;
    }

    this.isSubscribed = true;
    console.log(`[Realtime] Starting ${mode} subscriptions for user:`, userId);
    await this.applyMode(mode);
  }

  /** Update which groups/threads we accept without recreating channels. */
  setMembership(groupIds: string[], dmThreadIds: string[]): void {
    this.groupIds = new Set(groupIds);
    this.dmThreadIds = new Set(dmThreadIds);
  }

  async setMode(mode: RealtimeSubscribeMode): Promise<void> {
    if (!this.userId || !this.isSubscribed) return;
    if (this.mode === mode) return;
    console.log(`[Realtime] Switching mode: ${this.mode} → ${mode}`);
    await this.applyMode(mode);
  }

  private async applyMode(mode: RealtimeSubscribeMode): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    this.mode = mode;

    this.subscribeToNotifications(userId);

    if (mode === 'full') {
      this.subscribeToAllGroupMessages(userId);
      this.subscribeToAllDmMessages(userId);
      this.subscribeToSettings(userId);
    } else {
      await this.removeChannels([
        CHANNEL.groupMessages(userId),
        CHANNEL.dmMessages(userId),
        CHANNEL.settings(userId),
      ]);
    }
  }

  async unsubscribe(): Promise<void> {
    console.log('[Realtime] Unsubscribing from all channels');

    for (const [name, channel] of this.channels) {
      await supabase.removeChannel(channel);
      console.log(`[Realtime] Removed channel: ${name}`);
    }

    this.channels.clear();
    this.isSubscribed = false;
    this.userId = null;
    this.mode = 'full';
    this.groupIds.clear();
    this.dmThreadIds.clear();
  }

  private async removeChannels(names: string[]): Promise<void> {
    for (const name of names) {
      const channel = this.channels.get(name);
      if (!channel) continue;
      await supabase.removeChannel(channel);
      this.channels.delete(name);
      console.log(`[Realtime] Removed channel: ${name}`);
    }
  }

  private subscribeToNotifications(userId: string): void {
    const channelName = CHANNEL.notifications(userId);
    if (this.channels.has(channelName)) return;

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
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as Record<string, unknown>;
          const notification = {
            id: String(row.id ?? ''),
            userId: String(row.user_id ?? ''),
            type: (row.type as Notification['type']) || 'system',
            title: String(row.message ?? ''),
            body: String(row.message ?? ''),
            message: String(row.message ?? ''),
            link: row.link as string | undefined,
            data: (row.data as Record<string, unknown>) ?? {},
            isRead: Boolean(row.read),
            createdAt: String(row.date ?? new Date().toISOString()),
          } as Notification & { message?: string; link?: string };
          this.notificationCallbacks.forEach(cb => cb(notification as Notification));
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
          const notification = payload.new as Notification;
          this.notificationCallbacks.forEach(cb => cb(notification));
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Notifications channel status: ${status}`);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void this.recoverChannel(channelName, () => this.subscribeToNotifications(userId));
        }
      });

    this.channels.set(channelName, channel);
  }

  private async recoverChannel(channelName: string, recreate: () => void): Promise<void> {
    const existing = this.channels.get(channelName);
    if (existing) {
      await supabase.removeChannel(existing);
      this.channels.delete(channelName);
    }
    recreate();
  }

  /** Single channel for all group messages (RLS scopes rows; client filters by membership). */
  private subscribeToAllGroupMessages(userId: string): void {
    const channelName = CHANNEL.groupMessages(userId);
    if (this.channels.has(channelName)) return;

    const emit = (payload: RealtimePostgresChangesPayload<Message>, isUpdate: boolean) => {
      const raw = payload.new as Message & { group_id?: string; groupId?: string };
      const groupId = raw.group_id || raw.groupId;
      if (!groupId) return;
      // If membership list is loaded, ignore unknown groups; if empty (still loading), accept RLS-filtered events.
      if (this.groupIds.size > 0 && !this.groupIds.has(groupId)) return;
      const message = isUpdate
        ? ({ ...raw, __realtimeEvent: 'UPDATE' } as Message)
        : raw;
      this.messageCallbacks.forEach(cb => cb(message));
    };

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => emit(payload as RealtimePostgresChangesPayload<Message>, false)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => emit(payload as RealtimePostgresChangesPayload<Message>, true)
      )
      .subscribe((status) => {
        console.log(`[Realtime] Group messages (all) status: ${status}`);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void this.recoverChannel(channelName, () => this.subscribeToAllGroupMessages(userId));
        }
      });

    this.channels.set(channelName, channel);
  }

  /** Single channel for all DM messages. */
  private subscribeToAllDmMessages(userId: string): void {
    const channelName = CHANNEL.dmMessages(userId);
    if (this.channels.has(channelName)) return;

    const emitDmMessage = (
      payload: RealtimePostgresChangesPayload<RawDmMessage>,
      isUpdate: boolean
    ) => {
      const raw = payload.new as RawDmMessage;
      if (!raw?.thread_id) return;
      if (this.dmThreadIds.size > 0 && !this.dmThreadIds.has(raw.thread_id)) return;

      const message: DirectMessage = {
        id: raw.id,
        threadId: raw.thread_id,
        senderId: raw.sender_id,
        text: raw.removed_at ? '' : raw.text,
        timestamp: raw.timestamp,
        editedAt: raw.edited_at,
        removedAt: raw.removed_at,
        isRemoved: !!raw.removed_at,
        replyToMessageId: raw.reply_to_message_id,
        threadRootId: raw.thread_root_id,
        clientMessageId: raw.client_message_id,
        ...(isUpdate ? { __realtimeEvent: 'UPDATE' } : {}),
      };
      this.dmMessageCallbacks.forEach(cb => cb(message));
    };

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages' },
        (payload) =>
          emitDmMessage(payload as RealtimePostgresChangesPayload<RawDmMessage>, false)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_messages' },
        (payload) =>
          emitDmMessage(payload as RealtimePostgresChangesPayload<RawDmMessage>, true)
      )
      .subscribe((status) => {
        console.log(`[Realtime] DM messages (all) status: ${status}`);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void this.recoverChannel(channelName, () => this.subscribeToAllDmMessages(userId));
        }
      });

    this.channels.set(channelName, channel);
  }

  private subscribeToSettings(userId: string): void {
    const channelName = CHANNEL.settings(userId);
    if (this.channels.has(channelName)) return;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<{ settings: Record<string, unknown> }>) => {
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

  onNotification(callback: NotificationCallback): () => void {
    this.notificationCallbacks.add(callback);
    return () => this.notificationCallbacks.delete(callback);
  }

  onMessage(callback: MessageCallback): () => void {
    this.messageCallbacks.add(callback);
    return () => this.messageCallbacks.delete(callback);
  }

  onDirectMessage(callback: DirectMessageCallback): () => void {
    this.dmMessageCallbacks.add(callback);
    return () => this.dmMessageCallbacks.delete(callback);
  }

  onSettings(callback: SettingsCallback): () => void {
    this.settingsCallbacks.add(callback);
    return () => this.settingsCallbacks.delete(callback);
  }

  getStatus(): { isSubscribed: boolean; channelCount: number; mode: RealtimeSubscribeMode } {
    return {
      isSubscribed: this.isSubscribed,
      channelCount: this.channels.size,
      mode: this.mode,
    };
  }
}

const subscriptionManager = new RealtimeSubscriptionManager();

// ============================================
// Hook: useRealtimeSubscriptions
// ============================================

export interface UseRealtimeSubscriptionsOptions {
  onNotification?: NotificationCallback;
  onMessage?: MessageCallback;
  onDirectMessage?: DirectMessageCallback;
  onSettingsUpdate?: SettingsCallback;
  autoSubscribe?: boolean;
}

export interface UseRealtimeSubscriptionsResult {
  isSubscribed: boolean;
  channelCount: number;
  mode: RealtimeSubscribeMode;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function useRealtimeSubscriptions(
  options: UseRealtimeSubscriptionsOptions = {}
): UseRealtimeSubscriptionsResult {
  const {
    onNotification,
    onMessage,
    onDirectMessage,
    onSettingsUpdate,
    autoSubscribe = true,
  } = options;

  const { user } = useAuthStore();
  const {
    groups,
    dmThreads,
    addDirectMessage,
    mergeDirectMessage,
    appendGroupMessage,
    mergeGroupMessage,
  } = useGroupStore();
  const { loadSettings } = useSettingsStore();

  const isSubscribedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const groupIds = groups.map(g => g.id);
  const dmThreadIds = dmThreads.map(t => t.id);
  const groupIdsKey = groupIds.slice().sort().join(',');
  const dmThreadIdsKey = dmThreadIds.slice().sort().join(',');

  const handleNotification = useCallback((notification: Notification) => {
    const { increment, loadUnreadCount } = useNotificationStore.getState();
    if (!notification.isRead) {
      increment();
    } else if (user?.id) {
      void loadUnreadCount(user.id);
    }
    onNotification?.(notification);
  }, [onNotification, user?.id]);

  const handleMessage = useCallback((raw: Message) => {
    const groupId = (raw as { group_id?: string; groupId?: string }).group_id
      || raw.groupId;
    if (!groupId) return;

    const senderId =
      (raw as { sender_id?: string; senderId?: string }).sender_id
      || raw.senderId
      || (raw as { sender?: { id?: string } }).sender?.id;
    const clientMessageId =
      (raw as { client_message_id?: string; clientMessageId?: string }).client_message_id
      || (raw as { clientMessageId?: string }).clientMessageId;
    const isUpdate =
      (raw as Message & { __realtimeEvent?: string }).__realtimeEvent === 'UPDATE';

    const cached = useGroupStore.getState().messagesCache[groupId] || [];
    if (isUpdate) {
      mergeGroupMessage(groupId, raw);
      return;
    }
    if (cached.some(m => m.id === raw.id)) {
      mergeGroupMessage(groupId, raw);
      return;
    }

    if (senderId && senderId === user?.id) {
      if (clientMessageId && cached.some((message) => message.id === clientMessageId)) {
        mergeGroupMessage(groupId, raw);
        return;
      }
      const rawContent =
        (raw as { content?: string; text?: string }).content
        || (raw as { text?: string }).text
        || '';
      const hasOptimistic = cached.some(
        (message) =>
          message.id.startsWith('msg-')
          && message.senderId === senderId
          && message.text === rawContent
      );
      if (hasOptimistic) {
        return;
      }
    }

    appendGroupMessage(groupId, raw);
    onMessage?.(raw);
  }, [onMessage, appendGroupMessage, mergeGroupMessage, user?.id]);

  const handleDirectMessage = useCallback((message: DirectMessage) => {
    const isUpdate =
      (message as DirectMessage & { __realtimeEvent?: string }).__realtimeEvent === 'UPDATE';
    const existing = useGroupStore.getState().directMessages[message.threadId] || [];
    if (isUpdate) {
      mergeDirectMessage(message.threadId, message);
      return;
    }
    if (existing.some((candidate) => candidate.id === message.id)) {
      mergeDirectMessage(message.threadId, message);
      onDirectMessage?.(message);
      return;
    }

    // REL-03: reconcile optimistic self-send; append unknown self messages (other devices).
    if (message.senderId === user?.id) {
      const clientMessageId = message.clientMessageId;
      if (clientMessageId && existing.some((candidate) => candidate.id === clientMessageId)) {
        mergeDirectMessage(message.threadId, message);
        onDirectMessage?.(message);
        return;
      }
      addDirectMessage(message.threadId, message);
      onDirectMessage?.(message);
      return;
    }

    addDirectMessage(message.threadId, message);
    onDirectMessage?.(message);
  }, [onDirectMessage, addDirectMessage, mergeDirectMessage, user?.id]);

  const handleSettingsUpdate = useCallback(async (settings: Record<string, unknown>) => {
    onSettingsUpdate?.(settings);
    if (user?.id) {
      try {
        await loadSettings(user.id);
      } catch (error) {
        console.error('[useRealtimeSubscriptions] Failed to reload settings:', error);
      }
    }
  }, [onSettingsUpdate, loadSettings, user?.id]);

  const refetchOpenChat = useCallback(async () => {
    const store = useGroupStore.getState();
    const activeGroupId = store.activeGroupId;
    if (activeGroupId) {
      try {
        // refresh:false merges by id so optimistic/realtime rows are not wiped.
        await store.fetchMessages(activeGroupId, { page: 1, refresh: false, limit: 50 });
      } catch (error) {
        console.warn('[useRealtimeSubscriptions] Group refetch failed:', error);
      }
    }
    const activeDm = store.dmThreads.find(
      (thread) => (store.directMessages[thread.id] || []).length > 0
    );
    // Prefer the thread currently loaded in the DM screen if present.
    const dmThreadId =
      Object.keys(store.directMessages).find((id) => (store.directMessages[id] || []).length > 0) ||
      activeDm?.id;
    if (dmThreadId && user?.id) {
      const thread = store.dmThreads.find((t) => t.id === dmThreadId);
      const otherUserId = thread?.participantIds?.find((id) => id !== user.id);
      if (otherUserId) {
        try {
          await store.fetchDirectMessagesForThread(user.id, otherUserId, dmThreadId);
        } catch (error) {
          console.warn('[useRealtimeSubscriptions] DM refetch failed:', error);
        }
      }
    }
  }, [user?.id]);

  const subscribe = useCallback(async () => {
    if (!user?.id) return;
    // Ensure the Supabase client has a session JWT before postgres_changes (RLS).
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) {
        await supabase.auth.refreshSession();
      }
    } catch (error) {
      console.warn('[useRealtimeSubscriptions] Session check failed:', error);
    }
    const mode: RealtimeSubscribeMode =
      appStateRef.current === 'active' ? 'full' : 'lean';
    const gIds = useGroupStore.getState().groups.map(g => g.id);
    const dIds = useGroupStore.getState().dmThreads.map(t => t.id);
    await subscriptionManager.subscribe(user.id, gIds, dIds, mode);
    isSubscribedRef.current = true;
  }, [user?.id]);

  const unsubscribe = useCallback(async () => {
    await subscriptionManager.unsubscribe();
    isSubscribedRef.current = false;
  }, []);

  useEffect(() => {
    const unsubNotification = subscriptionManager.onNotification(handleNotification);
    const unsubMessage = subscriptionManager.onMessage(handleMessage);
    const unsubDm = subscriptionManager.onDirectMessage(handleDirectMessage);
    const unsubSettings = subscriptionManager.onSettings(handleSettingsUpdate);

    return () => {
      unsubNotification();
      unsubMessage();
      unsubDm();
      unsubSettings();
    };
  }, [handleNotification, handleMessage, handleDirectMessage, handleSettingsUpdate]);

  useEffect(() => {
    if (!autoSubscribe) return;
    if (user?.id) {
      void subscribe();
    } else {
      void unsubscribe();
    }
  }, [user?.id, autoSubscribe, subscribe, unsubscribe]);

  // Membership changes update filters only — no per-group channel churn.
  useEffect(() => {
    if (!user?.id || !isSubscribedRef.current) return;
    subscriptionManager.setMembership(groupIds, dmThreadIds);
  }, [user?.id, groupIds, dmThreadIds, groupIdsKey, dmThreadIdsKey]);

  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[useRealtimeSubscriptions] App resumed — full realtime + refetch');
        if (user?.id && autoSubscribe) {
          const gIds = useGroupStore.getState().groups.map(g => g.id);
          const dIds = useGroupStore.getState().dmThreads.map(t => t.id);
          subscriptionManager.setMembership(gIds, dIds);
          // Force channel recreate after background (lean dropped message feeds).
          await subscriptionManager.unsubscribe();
          await subscribe();
          await refetchOpenChat();
        }
      } else if (nextAppState === 'background') {
        // Lean only on true background (not iOS inactive / control center).
        console.log('[useRealtimeSubscriptions] App backgrounded — lean realtime');
        if (user?.id && autoSubscribe) {
          await subscriptionManager.setMode('lean');
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [user?.id, autoSubscribe, subscribe, refetchOpenChat]);

  const status = subscriptionManager.getStatus();

  return {
    isSubscribed: status.isSubscribed,
    channelCount: status.channelCount,
    mode: status.mode,
    subscribe,
    unsubscribe,
  };
}

export function useNotificationSubscription(
  onNotification: NotificationCallback
): { isSubscribed: boolean } {
  const result = useRealtimeSubscriptions({
    onNotification,
    autoSubscribe: true,
  });
  return { isSubscribed: result.isSubscribed };
}

export function useGroupMessageSubscription(
  onMessage: MessageCallback
): { isSubscribed: boolean } {
  const result = useRealtimeSubscriptions({
    onMessage,
    autoSubscribe: true,
  });
  return { isSubscribed: result.isSubscribed };
}

export { subscriptionManager };
export default useRealtimeSubscriptions;
