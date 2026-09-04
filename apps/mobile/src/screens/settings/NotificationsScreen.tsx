import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  CommonActions,
  useFocusEffect,
  useNavigation,
} from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  parseNotificationLink,
  getNotificationMessage,
  isNotificationRead,
  getNotificationDate,
} from "@lantern/shared";
import { Screen, useScreenBottomPadding } from "../../components/layout";
import { useAuthStore } from "../../stores/authStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { buildCurrentGameUser } from "../../utils/currentGameUser";
import { useGameStore } from "../../stores/gameStore";
import {
  fetchNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  acceptGroupInvite,
  declineGroupInvite,
} from "../../services/api";
import { useTheme } from "../../theme";
import type {
  MainTabParamList,
  RootStackParamList,
} from "../../navigation/types";
import {
  navigateToChallengesInbox,
  navigateToGameResult,
} from "../../navigation/navigationRef";
import { NotificationRow } from "../../components/ui";
import { AcademicFeedPanel } from "../../components/AcademicFeedPanel";
import { useChrome } from '../../components/layout/ChromeContext';

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
  BottomTabNavigationProp<MainTabParamList, "NotificationsTab">,
  import("@react-navigation/native").NavigationProp<RootStackParamList>
>;

export default function NotificationsScreen() {
  const { onScroll: chromeOnScroll } = useChrome();
  const bottomPadding = useScreenBottomPadding();
  const navigation = useNavigation<NotificationsNavigationProp>();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);
  const profileName = useAuthStore((s) => s.profileName);
  const { startChallengePlay } = useGameStore();
  const decrementUnread = useNotificationStore((s) => s.decrement);
  const setUnread = useNotificationStore((s) => s.setUnread);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await fetchNotifications(user.id);
      const list = Array.isArray(data) ? data : [];
      setItems(list as AppNotification[]);
      setUnread(
        list.filter((n) => !isNotificationRead(n as AppNotification)).length,
      );
    } catch {
      // Keep existing list on transient errors
    } finally {
      setLoading(false);
    }
  }, [user?.id, setUnread]);

  // The screen stays mounted inside the navigator, so a mount effect would only
  // ever run once: re-opening Notifications would show the list (and the badge)
  // as it was on first visit, ignoring anything read on another device since.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const markRead = useCallback(
    async (id: string) => {
      try {
        await markNotificationAsRead(id);
        setItems((prev) => {
          const target = prev.find((n) => n.id === id);
          const wasUnread = target && !isNotificationRead(target);
          if (wasUnread) decrementUnread();
          return prev.map((n) =>
            n.id === id ? { ...n, read: true, is_read: true } : n,
          );
        });
      } catch {
        /* ignore */
      }
    },
    [decrementUnread],
  );

  const navigateToMarket = useCallback(
    (
      screen:
        | "Inquiries"
        | "ListingDetail"
        | "JobDetail"
        | "MyJobApplications"
        | "JobApplicants" | "Offers" | "OrderDetail",
      params?: Record<string, string>,
    ) => {
      navigation.dispatch(
        CommonActions.navigate({
          name: "Main",
          params: {
            screen: "MarketTab",
            params: params ? { screen, params } : { screen },
          },
        }),
      );
    },
    [navigation],
  );

  // Jobs moved to its own bottom-tab stack, so a job notification dispatched
  // into MarketTab reaches no navigator and the tap does nothing.
  const navigateToJobs = useCallback(
    (screen: string, params?: Record<string, string>) => {
      navigation.dispatch(
        CommonActions.navigate({
          name: "Main",
          params: {
            screen: "JobsTab",
            params: params ? { screen, params } : { screen },
          },
        }),
      );
    },
    [navigation],
  );

  const handleNotificationPress = useCallback(
    async (item: AppNotification) => {
      await markRead(item.id);
      const parsed = parseNotificationLink(item.link, item);
      if (!parsed) return;

      // An offer notification used to open Inquiries, which has no offers view;
      // the seller landed on the wrong list and had to find Offers themselves.
      if (parsed.type === "offer") {
        // The server sends the same link to whichever side must respond, so the
        // tab has to come from who the viewer is: an offer notification you did
        // not make is one you received (seller tab); one on your own offer is a
        // counter you must answer (buyer tab). The data carries the buyer id.
        const buyerId = (item.data?.buyerId ?? item.data?.buyer_id) as string | undefined;
        const meId = useAuthStore.getState().user?.id;
        const tab = buyerId && meId && buyerId === meId ? "buyer" : "seller";
        navigateToMarket("Offers", { tab });
        return;
      }
      if (parsed.type === "inquiry") {
        // Same rule as offers: a question on YOUR listing is the seller tab; a
        // reply to a question you asked is the buyer tab.
        const buyerId = (item.data?.buyerId ?? item.data?.buyer_id) as string | undefined;
        const meId = useAuthStore.getState().user?.id;
        navigateToMarket("Inquiries", { tab: buyerId && meId && buyerId === meId ? "buyer" : "seller" });
        return;
      }
      // Order updates parsed as `generic` and no branch handled them, so a
      // "your order is ready" notification was a dead tap.
      if (parsed.type === "order" && parsed.id) {
        navigateToMarket("OrderDetail", { orderId: parsed.id });
        return;
      }
      if (parsed.type === "listing" && parsed.id) {
        navigateToMarket("ListingDetail", { listingId: parsed.id });
        return;
      }
      if (parsed.type === "job" && parsed.id) {
        navigateToJobs("JobDetail", { jobId: parsed.id });
        return;
      }
      if (parsed.type === "job_applications") {
        navigateToJobs("MyJobApplications");
        return;
      }
      if (parsed.type === "job_applicants" && parsed.id) {
        navigateToJobs("JobApplicants", { jobId: parsed.id });
        return;
      }
      if (parsed.type === "dm" && parsed.id) {
        navigation.dispatch(
          CommonActions.navigate({
            name: "Main",
            params: {
              screen: "ChatTab",
              params: {
                screen: "DirectMessage",
                params: { userId: parsed.id, threadId: parsed.threadId },
                // Keep the chat list beneath, so back reaches it.
                initial: false,
              },
            },
          }),
        );
        return;
      }
      if (parsed.type === "group_invite" && parsed.id) {
        Alert.alert(
          "Group invite",
          "Accept this invite to join the group chat?",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Decline",
              style: "destructive",
              onPress: () => {
                void declineGroupInvite(parsed.id!).catch(() => {
                  Alert.alert("Error", "Could not decline invite");
                });
              },
            },
            {
              text: "Accept",
              onPress: () => {
                void acceptGroupInvite(parsed.id!)
                  .then(() => {
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: "Main",
                        params: {
                          screen: "ChatTab",
                          params: {
                            screen: "GroupChat",
                            params: { groupId: parsed.id },
                            initial: false,
                          },
                        },
                      }),
                    );
                  })
                  .catch(() => {
                    Alert.alert("Error", "Could not accept invite");
                  });
              },
            },
          ],
        );
        return;
      }
      if (parsed.type === "group" && parsed.id) {
        navigation.dispatch(
          CommonActions.navigate({
            name: "Main",
            params: {
              screen: "ChatTab",
              params: {
                screen: "GroupChat",
                params: { groupId: parsed.id },
                initial: false,
              },
            },
          }),
        );
        return;
      }
      if (parsed.type === "challenge" && user?.id) {
        const currentUser = buildCurrentGameUser(user, profileName);
        if (item.type === "challenge_result" && parsed.id) {
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
    [
      markRead,
      navigation,
      navigateToMarket,
      startChallengePlay,
      user,
      profileName,
    ],
  );

  const markAllRead = async () => {
    if (!user?.id) return;
    try {
      await markAllNotificationsAsRead(user.id);
      setItems((prev) =>
        prev.map((n) => ({ ...n, read: true, is_read: true })),
      );
      setUnread(0);
    } catch {
      /* ignore */
    }
  };

  const unread = items.filter((n) => !isNotificationRead(n)).length;
  const showCloseButton = navigation.canGoBack();

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-2 border-b border-lantern-border bg-lantern-surface">
        {showCloseButton ? (
          <Pressable
            onPress={() => navigation.goBack()}
            className="p-2 -ml-2 min-w-[44px] min-h-[44px] items-center justify-center"
          >
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View className="w-10" />
        )}
        <Text className="flex-1 text-lg font-bold text-lantern-text ml-1">
          Notifications
        </Text>
        {unread > 0 ? (
          <Pressable
            onPress={() => void markAllRead()}
            className="min-h-[44px] justify-center px-2"
          >
            <Text className="text-lantern-primary text-sm font-medium">
              Mark all read
            </Text>
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
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerClassName="px-4 pt-3"
          // NotificationsTab is a real tab, so the absolute bottom bar overlays
          // the list: the last row needs its clearance, not `pb-8` (28px).
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          ListHeaderComponent={
            <AcademicFeedPanel
              limit={6}
              className="mb-4 rounded-2xl border border-lantern-border bg-lantern-surface p-4"
              onOpenFeed={() =>
                navigation.dispatch(
                  CommonActions.navigate({
                    name: "Main",
                    params: {
                      screen: "MarketTab",
                      params: { screen: "Feed" },
                    },
                  }),
                )
              }
            />
          }
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <View className="w-14 h-14 rounded-full bg-lantern-primary-background items-center justify-center">
                <Ionicons
                  name="notifications-outline"
                  size={28}
                  color={colors.primary}
                />
              </View>
              <Text className="mt-4 text-sm font-medium text-lantern-text">
                No notifications yet
              </Text>
              <Text className="mt-1 text-xs text-lantern-text-secondary text-center">
                You&apos;re all caught up — we&apos;ll let you know when
                something needs your attention.
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
    </Screen>
  );
}
