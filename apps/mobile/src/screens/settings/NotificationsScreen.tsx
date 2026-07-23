import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import {
  parseNotificationLink,
  getNotificationMessage,
  isNotificationRead,
  getNotificationDate,
} from '@lantern/shared';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { buildCurrentGameUser } from '../../utils/currentGameUser';
import { useGameStore } from '../../stores/gameStore';
import {
  fetchNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  acceptGroupInvite,
  declineGroupInvite,
} from '../../services/api';
import { useTheme } from '../../theme';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';
import { navigateToChallengesInbox, navigateToGameResult } from '../../navigation/navigationRef';
import { NotificationRow } from '../../components/ui';

interface AppNotification {
  id: string;
  message?: string;
  body?: string;
  title?: string;
  date?: string;
  created_at?: string;
  read?: boolean;
  is_read?: boolean;
  type?: string;
  link?: string;
  data?: Record<string, unknown>;
}

type NotificationsNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'NotificationsTab'>,
  import('@react-navigation/native').NavigationProp<RootStackParamList>
>;

export default function NotificationsScreen() {
  const navigation = useNavigation<NotificationsNavigationProp>();
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const profileName = useAuthStore(s => s.profileName);
  const { startChallengePlay } = useGameStore();
  const decrementUnread = useNotificationStore(s => s.decrement);
  const setUnread = useNotificationStore(s => s.setUnread);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await fetchNotifications(user.id);
      const list = Array.isArray(data) ? data : [];
      setItems(list as AppNotification[]);
      setUnread(list.filter(n => !isNotificationRead(n as AppNotification)).length);
    } catch {
      // Keep existing list on transient errors
    } finally {
      setLoading(false);
    }
  }, [user?.id, setUnread]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const markRead = useCallback(
    async (id: string) => {
      try {
        await markNotificationAsRead(id);
        setItems(prev => {
          const target = prev.find(n => n.id === id);
          const wasUnread = target && !isNotificationRead(target);
          if (wasUnread) decrementUnread();
          return prev.map(n => (n.id === id ? { ...n, read: true, is_read: true } : n));
        });
      } catch {
        /* ignore */
      }
    },
    [decrementUnread]
  );

  const navigateToMarket = useCallback(
    (screen: 'Inquiries' | 'ListingDetail', params?: Record<string, string>) => {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'Main',
          params: {
            screen: 'MarketTab',
            params: params ? { screen, params } : { screen },
          },
        })
      );
    },
    [navigation]
  );

  const handleNotificationPress = useCallback(
    async (item: AppNotification) => {
      await markRead(item.id);
      const parsed = parseNotificationLink(item.link, item);
      if (!parsed) return;

      if (parsed.type === 'offer' || parsed.type === 'inquiry') {
        navigateToMarket('Inquiries');
        return;
      }
      if (parsed.type === 'listing' && parsed.id) {
        navigateToMarket('ListingDetail', { listingId: parsed.id });
        return;
      }
      if (parsed.type === 'dm' && parsed.id) {
        navigation.dispatch(
          CommonActions.navigate({
            name: 'Main',
            params: {
              screen: 'ChatTab',
              params: {
                screen: 'DirectMessage',
                params: { userId: parsed.id, threadId: parsed.threadId },
              },
            },
          })
        );
        return;
      }
      if (parsed.type === 'group_invite' && parsed.id) {
        Alert.alert(
          'Group invite',
          'Accept this invite to join the group chat?',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Decline',
              style: 'destructive',
              onPress: () => {
                void declineGroupInvite(parsed.id!).catch(() => {
                  Alert.alert('Error', 'Could not decline invite');
                });
              },
            },
            {
              text: 'Accept',
              onPress: () => {
                void acceptGroupInvite(parsed.id!)
                  .then(() => {
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: 'Main',
                        params: {
                          screen: 'ChatTab',
                          params: {
                            screen: 'GroupChat',
                            params: { groupId: parsed.id },
                          },
                        },
                      })
                    );
                  })
                  .catch(() => {
                    Alert.alert('Error', 'Could not accept invite');
                  });
              },
            },
          ]
        );
        return;
      }
      if (parsed.type === 'group' && parsed.id) {
        navigation.dispatch(
          CommonActions.navigate({
            name: 'Main',
            params: {
              screen: 'ChatTab',
              params: {
                screen: 'GroupChat',
                params: { groupId: parsed.id },
              },
            },
          })
        );
        return;
      }
      if (parsed.type === 'challenge' && user?.id) {
        const currentUser = buildCurrentGameUser(user, profileName);
        if (item.type === 'challenge_result') {
          try {
            const session = await startChallengePlay(parsed.id, currentUser);
            navigateToGameResult(session, currentUser);
          } catch {
            navigateToChallengesInbox();
          }
          return;
        }
        navigateToChallengesInbox();
      }
    },
    [markRead, navigation, navigateToMarket, startChallengePlay, user, profileName]
  );

  const markAllRead = async () => {
    if (!user?.id) return;
    try {
      await markAllNotificationsAsRead(user.id);
      setItems(prev => prev.map(n => ({ ...n, read: true, is_read: true })));
      setUnread(0);
    } catch {
      /* ignore */
    }
  };

  const unread = items.filter(n => !isNotificationRead(n)).length;
  const showCloseButton = navigation.canGoBack();

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="flex-row items-center px-4 py-2 border-b border-lantern-border bg-lantern-surface">
        {showCloseButton ? (
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 min-w-[44px] min-h-[44px] items-center justify-center">
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View className="w-10" />
        )}
        <Text className="flex-1 text-lg font-bold text-lantern-text ml-1">Notifications</Text>
        {unread > 0 ? (
          <Pressable onPress={() => void markAllRead()} className="min-h-[44px] justify-center px-2">
            <Text className="text-lantern-primary text-sm font-medium">Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerClassName="px-4 py-3 pb-8"
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <View className="w-14 h-14 rounded-full bg-lantern-primary-background items-center justify-center">
                <Ionicons name="notifications-outline" size={28} color={colors.primary} />
              </View>
              <Text className="mt-4 text-sm font-medium text-lantern-text">No notifications yet</Text>
              <Text className="mt-1 text-xs text-lantern-text-secondary text-center">
                You&apos;re all caught up — we&apos;ll let you know when something needs your attention.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <NotificationRow
              message={getNotificationMessage(item)}
              date={getNotificationDate(item)}
              read={isNotificationRead(item)}
              link={item.link}
              type={item.type}
              data={item.data}
              onPress={() => void handleNotificationPress(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
