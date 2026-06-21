import React, { useCallback, useEffect, useState } from 'react';

import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { CommonActions, useNavigation } from '@react-navigation/native';

import type { CompositeNavigationProp } from '@react-navigation/native';

import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { buildCurrentGameUser } from '../../utils/currentGameUser';

import { useGameStore } from '../../stores/gameStore';

import { fetchNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '../../services/api';

import { useTheme } from '../../theme';

import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

import { navigateToChallengesInbox, navigateToGameResult } from '../../navigation/navigationRef';



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



function parseNotificationLink(link?: string, n?: AppNotification) {

  if (link?.startsWith('challenge:')) {

    return { type: 'challenge', id: link.replace('challenge:', '') };

  }

  if (n?.type?.startsWith('challenge')) {

    const challengeId =

      (n.data?.challengeId as string) ||

      (typeof n.data?.data === 'object' ? (n.data?.data as Record<string, unknown>)?.challengeId as string : undefined) ||

      link?.replace('challenge:', '');

    if (challengeId) return { type: 'challenge', id: challengeId };

  }

  if (!link) return null;

  const parts = link.split(':');

  if (parts[0] !== 'marketplace' || parts.length < 3) return null;

  return { type: parts[1], id: parts[2] };

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

      setUnread(list.filter(n => !((n as AppNotification).read ?? (n as AppNotification).is_read)).length);

    } catch {

      setItems([]);

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



  const markRead = useCallback(async (id: string) => {

    try {

      await markNotificationAsRead(id);

      setItems(prev => {
        const target = prev.find(n => n.id === id);
        const wasUnread = target && !(target.read ?? target.is_read);
        if (wasUnread) {
          decrementUnread();
        }
        return prev.map(n => (n.id === id ? { ...n, read: true, is_read: true } : n));
      });

    } catch {

      /* ignore */

    }

  }, [decrementUnread]);



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



      if (parsed.type === 'listing') {

        navigateToMarket('ListingDetail', { listingId: parsed.id });

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

    [markRead, navigation, navigateToMarket, startChallengePlay, user]

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



  const unread = items.filter(n => !(n.read ?? n.is_read)).length;

  const showCloseButton = navigation.canGoBack();



  return (

    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>

      <View className="flex-row items-center px-4 py-2 border-b border-slate-200 dark:border-slate-700">

        {showCloseButton ? (
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2">
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View className="w-10" />
        )}

        <Text style={{ color: colors.text }} className="flex-1 text-lg font-bold ml-1">

          Notifications

        </Text>

        {unread > 0 ? (

          <Pressable onPress={() => void markAllRead()}>

            <Text className="text-indigo-600 text-sm font-medium">Mark all read</Text>

          </Pressable>

        ) : null}

      </View>



      {loading ? (

        <View className="flex-1 items-center justify-center">

          <ActivityIndicator color="#6366f1" />

        </View>

      ) : (

        <FlatList

          data={items}

          keyExtractor={item => item.id}

          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}

          contentContainerClassName="px-4 py-3 pb-8"

          ListEmptyComponent={

            <View className="items-center py-16">

              <Ionicons name="notifications-off-outline" size={48} color="#94a3b8" />

              <Text style={{ color: colors.textSecondary }} className="mt-3 text-base">

                No notifications yet

              </Text>

            </View>

          }

          renderItem={({ item }) => {

            const isRead = item.read ?? item.is_read;

            const label = item.message || item.body || item.title || 'Notification';

            const when = item.date || item.created_at;

            return (

              <Pressable

                onPress={() => void handleNotificationPress(item)}

                className={`mb-2 p-4 rounded-2xl border ${

                  isRead

                    ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'

                    : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800'

                }`}

              >

                <Text style={{ color: colors.text }} className={`text-sm ${isRead ? '' : 'font-semibold'}`}>

                  {label}

                </Text>

                {when ? (

                  <Text style={{ color: colors.textTertiary }} className="text-xs mt-1">

                    {new Date(when).toLocaleString()}

                  </Text>

                ) : null}

              </Pressable>

            );

          }}

        />

      )}

    </SafeAreaView>

  );

}


