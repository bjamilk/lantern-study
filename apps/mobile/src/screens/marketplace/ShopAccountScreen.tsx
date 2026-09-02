import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useMarketplaceStore } from '../../stores';
import { fetchSellerPayoutProfile } from '../../services/api';
import { Badge } from '../../components/ui';
import { useTheme } from '../../theme';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useShopBadges } from '../../hooks/useShopBadges';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { buildQuickActions, ShopQuickActions, type QuickAction } from './components/ShopQuickActions';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>, options?: { pop?: boolean }) => void;
};

type Side = 'buying' | 'selling';

// Per user: two accounts on one phone must not inherit each other's side.
const sideStorageKey = (userId: string) => `lantern_shop_you_side_${userId}`;

interface Row {
  key: string;
  label: string;
  detail?: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
  onPress: () => void;
}

/**
 * The Shop's "You" hub, modelled on the Amazon app's You tab.
 *
 * One screen where everything that is yours lives — what you are buying and
 * what you are selling — each row carrying the count of things that need you.
 * Before this, orders, cart, saved items, inquiries and offers were behind a
 * "..." overflow that only the seller screens even rendered, so a buyer with
 * an order waiting for payment had no way of knowing.
 *
 * Buying | Selling at the top is a filter, not a second shell: the same hub,
 * same header, same rows, showing one side at a time so a seller's twelve
 * rows do not bury a buyer's four. It is remembered per user because someone
 * who sells opens this screen to sell, every time.
 */
export function ShopAccountScreen({ navigation }: { navigation: NavigationProp }) {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(16);
  const user = useAuthStore(s => s.user);
  // The auth user is Supabase's; the display name rides in user_metadata, the
  // same place the profile drawer reads it from.
  const fullName = (user?.user_metadata?.name as string | undefined)?.trim();
  const firstName = fullName ? fullName.split(' ')[0] : undefined;
  // Every count on this screen comes from one hook so the header icon, the
  // card row and the rows underneath cannot disagree about what needs you.
  const badges = useShopBadges();
  const fetchShopSummary = useMarketplaceStore(s => s.fetchShopSummary);
  const fetchServerFavorites = useMarketplaceStore(s => s.fetchServerFavorites);
  const [side, setSide] = useState<Side>('buying');
  // null = unknown (request failed or not back yet); never nag on unknown.
  const [payoutActive, setPayoutActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    AsyncStorage.getItem(sideStorageKey(user.id))
      .then((v) => {
        if (!cancelled && v === 'selling') setSide('selling');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const chooseSide = (next: Side) => {
    setSide(next);
    if (user?.id) void AsyncStorage.setItem(sideStorageKey(user.id), next).catch(() => {});
  };

  useFocusEffect(
    useCallback(() => {
      void fetchShopSummary({ force: true });
      if (user?.id) void fetchServerFavorites();
      // The same call SellerPayoutSetup makes; re-read on every focus so a
      // seller returning from the Payouts screen sees "Not set up" go away.
      let cancelled = false;
      fetchSellerPayoutProfile()
        .then((p) => {
          if (!cancelled) setPayoutActive(p?.status === 'active');
        })
        .catch(() => {
          if (!cancelled) setPayoutActive(null);
        });
      return () => {
        cancelled = true;
      };
    }, [fetchShopSummary, fetchServerFavorites, user?.id]),
  );

  // React Navigation 7 pushes a fresh copy of a screen that is already in the
  // stack unless told to pop back to it; without `pop` every hub tap stacked a
  // duplicate and the param-sync effects never saw the new params.
  const go = (screen: string, params?: Record<string, unknown>) => () =>
    navigation.navigate(screen, params, { pop: true });

  // Payouts matter only once there is something to be paid for: a buyer who
  // never listed must not see a red "Not set up".
  const payoutMissing = payoutActive === false && badges.activeListings > 0;

  const buying: Row[] = [
    {
      key: 'orders',
      label: 'Your Orders',
      detail: badges.buyerActionOrders > 0 ? 'Payment or pickup waiting on you' : 'Track, pay, buy again',
      icon: 'receipt-outline',
      badge: badges.buyerActionOrders,
      onPress: go('Orders', { role: 'buyer' }),
    },
    {
      key: 'cart',
      label: 'Cart',
      detail: badges.cartCount > 0 ? `${badges.cartCount} item${badges.cartCount === 1 ? '' : 's'} ready to check out` : 'Nothing in it yet',
      icon: 'cart-outline',
      badge: badges.cartCount,
      onPress: go('Cart'),
    },
    {
      key: 'purchases',
      label: 'Your Purchases',
      detail: 'Study packs and question banks you own',
      icon: 'albums-outline',
      onPress: go('Purchases'),
    },
    {
      key: 'saved',
      label: 'Saved Items',
      detail: badges.savedCount > 0 ? `${badges.savedCount} saved` : 'Tap ♡ on any listing',
      icon: 'heart-outline',
      onPress: go('Favorites'),
    },
    {
      key: 'offers-made',
      label: 'Offers You Made',
      detail: badges.offersAwaitingYou > 0 ? 'A seller countered — your move' : 'Counter-offers and replies from sellers',
      icon: 'pricetag-outline',
      badge: badges.offersAwaitingYou,
      onPress: go('Offers', { tab: 'buyer' }),
    },
    {
      key: 'messages',
      label: 'Messages to Sellers',
      detail: badges.unreadBuyerInquiries > 0 ? 'A seller replied' : 'Questions you asked about listings',
      icon: 'chatbubble-ellipses-outline',
      badge: badges.unreadBuyerInquiries,
      onPress: go('Inquiries', { tab: 'buyer' }),
    },
  ];

  const selling: Row[] = [
    {
      key: 'listings',
      label: 'Your Listings',
      detail: badges.activeListings > 0 ? `${badges.activeListings} live` : 'Nothing listed yet',
      icon: 'storefront-outline',
      onPress: go('MyListings'),
    },
    {
      key: 'fulfil',
      label: 'Orders to Hand Over',
      detail: badges.sellerActionOrders > 0 ? 'Confirm payment or hand over' : 'Nothing waiting',
      icon: 'cube-outline',
      badge: badges.sellerActionOrders,
      onPress: go('Orders', { role: 'seller' }),
    },
    {
      key: 'offers-received',
      label: 'Offers Received',
      detail: badges.offersAwaitingMe > 0 ? 'Accept, counter or decline' : 'No offers waiting on you',
      icon: 'pricetags-outline',
      badge: badges.offersAwaitingMe,
      onPress: go('Offers', { tab: 'seller' }),
    },
    {
      key: 'inquiries',
      label: 'Buyer Questions',
      detail:
        badges.unreadSellerInquiries > 0
          ? `${badges.unreadSellerInquiries} unread · ${badges.openInquiries} open`
          : badges.openInquiries > 0
            ? `${badges.openInquiries} open`
            : 'All answered',
      icon: 'chatbubbles-outline',
      badge: badges.unreadSellerInquiries,
      onPress: go('Inquiries', { tab: 'seller' }),
    },
    {
      key: 'customers',
      label: 'Your Customers',
      detail: 'People who have bought from you',
      icon: 'people-outline',
      onPress: go('SellerCustomers'),
    },
    {
      key: 'products',
      label: 'Study Products',
      detail: 'Drafts of packs and question banks',
      icon: 'sparkles-outline',
      onPress: go('StudyProductDrafts'),
    },
    {
      key: 'payouts',
      label: 'Payouts',
      detail:
        payoutActive === true
          ? 'Active — bank on file'
          : payoutMissing
            ? 'Not set up — Buy Now and Cart checkout are off'
            : 'Where your earnings go',
      icon: 'card-outline',
      badge: payoutMissing ? 1 : 0,
      onPress: go('SellerPayout'),
    },
    ...(user?.id
      ? [
          {
            key: 'shop',
            label: 'Your Shop',
            detail: 'View or share your shop page',
            icon: 'storefront-outline' as const,
            onPress: go('SellerProfile', { sellerId: user.id }),
          },
        ]
      : []),
    {
      key: 'semester',
      label: 'Semester Packs',
      detail: 'Turn a semester of notes into packs',
      icon: 'layers-outline',
      onPress: go('SemesterProducts'),
    },
  ];

  // Card rows: the band's own cards for Buying (same hints, same badges), and
  // the seller's four queues for Selling, rendered through the same tile.
  const bandCards = buildQuickActions(badges);
  const buyingCards = ['orders', 'buy-again', 'cart', 'saved']
    .map((key) => bandCards.find((a) => a.key === key))
    .filter((a): a is QuickAction => Boolean(a));
  const sellingCards: QuickAction[] = [
    {
      key: 'hand-over',
      label: 'Hand over',
      hint: badges.sellerActionOrders > 0 ? `${badges.sellerActionOrders} waiting` : 'Nothing waiting',
      icon: 'cube-outline',
      badge: badges.sellerActionOrders,
      screen: 'Orders',
      params: { role: 'seller' },
    },
    {
      key: 'offers-received',
      label: 'Offers',
      hint: badges.offersAwaitingMe > 0 ? `${badges.offersAwaitingMe} to answer` : 'None waiting',
      icon: 'pricetags-outline',
      badge: badges.offersAwaitingMe,
      screen: 'Offers',
      params: { tab: 'seller' },
    },
    {
      key: 'questions',
      label: 'Questions',
      hint:
        badges.unreadSellerInquiries > 0
          ? `${badges.unreadSellerInquiries} unread`
          : badges.openInquiries > 0
            ? `${badges.openInquiries} open`
            : 'All answered',
      icon: 'chatbubbles-outline',
      badge: badges.unreadSellerInquiries,
      screen: 'Inquiries',
      params: { tab: 'seller' },
    },
    {
      key: 'payouts',
      label: 'Payouts',
      hint: payoutActive === true ? 'Bank on file' : payoutMissing ? 'Not set up' : 'Earnings',
      icon: 'card-outline',
      badge: payoutMissing ? 1 : 0,
      screen: 'SellerPayout',
    },
  ];

  const renderRow = (row: Row) => (
    <Pressable
      key={row.key}
      onPress={row.onPress}
      accessibilityRole="button"
      accessibilityLabel={row.badge ? `${row.label}, ${row.badge} need attention` : row.label}
      className="flex-row items-center gap-3 px-4 py-3 border-b border-lantern-border"
      style={{ minHeight: 60 }}
    >
      <View className="w-10 h-10 rounded-xl items-center justify-center bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
        <Ionicons name={row.icon} size={20} color={colors.primary} />
        <Badge count={row.badge ?? 0} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-lantern-text">{row.label}</Text>
        {row.detail ? (
          <Text numberOfLines={1} className="text-xs text-lantern-text-secondary">
            {row.detail}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );

  const sectionTitle = (title: string) => (
    <Text className="px-4 pt-5 pb-2 text-xs font-semibold uppercase text-lantern-text-tertiary">
      {title}
    </Text>
  );

  // The other side's attention count rides on its segment so switching is
  // never a guess: a buyer sees "Selling · 3" and knows something is waiting.
  const sideAttention: Record<Side, number> = {
    buying: badges.buyerActionOrders + badges.offersAwaitingYou + badges.unreadBuyerInquiries,
    // Deliberately the same number the header, band and Your Listings show.
    // Adding the missing payout profile here made the hub disagree with all
    // three; the Payouts row carries its own badge and red text instead.
    selling: badges.sellerAttention,
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable
          hitSlop={10}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="p-2 -ml-2 mr-1"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-lantern-text">
          {firstName ? `Hello, ${firstName}` : 'You'}
        </Text>
        <ShopHeaderActions
          navigate={(screen, params) => navigation.navigate(screen, params, { pop: true })}
          hide={['you']}
        />
        <Pressable
          onPress={go('CreateListing')}
          accessibilityRole="button"
          accessibilityLabel="Sell an item"
          className="flex-row items-center gap-1 px-3 py-2 rounded-lg bg-lantern-primary"
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text className="text-sm font-semibold text-white">Sell</Text>
        </Pressable>
      </View>

      <View className="flex-row mx-4 mb-1 p-1 rounded-xl bg-lantern-background-secondary/70 dark:bg-lantern-surface">
        {(['buying', 'selling'] as Side[]).map((s) => {
          const selected = side === s;
          const n = sideAttention[s];
          return (
            <Pressable
              key={s}
              onPress={() => chooseSide(s)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={n > 0 ? `${s}, ${n} need attention` : s}
              className={`flex-1 py-2 rounded-lg flex-row items-center justify-center gap-1.5 ${
                selected ? 'bg-lantern-surface dark:bg-lantern-surface-secondary' : ''
              }`}
            >
              <Text
                className={`text-sm font-semibold capitalize ${
                  selected ? 'text-lantern-primary' : 'text-lantern-text-secondary'
                }`}
              >
                {s}
              </Text>
              {n > 0 ? (
                <View className="min-w-[18px] h-[18px] px-1 rounded-full bg-lantern-error items-center justify-center">
                  <Text className="text-[10px] font-bold text-white">{n > 99 ? '99+' : n}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        {side === 'buying' ? (
          <>
            <ShopQuickActions
              badges={badges}
              layout="grid"
              actions={buyingCards}
              onNavigate={(screen, params) => navigation.navigate(screen, params, { pop: true })}
            />
            {sectionTitle('Buying')}
            <View className="bg-lantern-surface border-t border-lantern-border">{buying.map(renderRow)}</View>
          </>
        ) : (
          <>
            <ShopQuickActions
              badges={badges}
              layout="grid"
              actions={sellingCards}
              onNavigate={(screen, params) => navigation.navigate(screen, params, { pop: true })}
            />
            {sectionTitle('Your Seller Account')}
            <View className="bg-lantern-surface border-t border-lantern-border">{selling.map(renderRow)}</View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
