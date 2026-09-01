import React, { useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useMarketplaceStore } from '../../stores';
import { Badge } from '../../components/ui';
import { useTheme } from '../../theme';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { SellerPayoutSetup } from './SellerPayoutSetup';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

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
 */
export function ShopAccountScreen({ navigation }: { navigation: NavigationProp }) {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(16);
  const user = useAuthStore(s => s.user);
  // The auth user is Supabase's; the display name rides in user_metadata, the
  // same place the profile drawer reads it from.
  const fullName = (user?.user_metadata?.name as string | undefined)?.trim();
  const firstName = fullName ? fullName.split(' ')[0] : undefined;
  const summary = useMarketplaceStore(s => s.shopSummary);
  const savedCount = useMarketplaceStore(s => s.favorites.size);
  const fetchShopSummary = useMarketplaceStore(s => s.fetchShopSummary);
  const fetchServerFavorites = useMarketplaceStore(s => s.fetchServerFavorites);

  useFocusEffect(
    useCallback(() => {
      void fetchShopSummary({ force: true });
      if (user?.id) void fetchServerFavorites();
    }, [fetchShopSummary, fetchServerFavorites, user?.id]),
  );

  const go = (screen: string, params?: Record<string, unknown>) => () =>
    navigation.navigate(screen, params);

  const buying: Row[] = [
    {
      key: 'orders',
      label: 'Your Orders',
      detail: summary.buyerActionOrders > 0 ? 'Payment or pickup waiting on you' : 'Track, pay, buy again',
      icon: 'receipt-outline',
      badge: summary.buyerActionOrders,
      onPress: go('Orders'),
    },
    {
      key: 'cart',
      label: 'Cart',
      detail: summary.cartCount > 0 ? `${summary.cartCount} item${summary.cartCount === 1 ? '' : 's'} ready to check out` : 'Nothing in it yet',
      icon: 'cart-outline',
      badge: summary.cartCount,
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
      detail: savedCount > 0 ? `${savedCount} saved` : 'Tap ♡ on any listing',
      icon: 'heart-outline',
      onPress: go('Favorites'),
    },
    {
      key: 'offers-made',
      label: 'Offers You Made',
      detail: 'Counter-offers and replies from sellers',
      icon: 'pricetag-outline',
      onPress: go('Offers'),
    },
    {
      key: 'messages',
      label: 'Messages to Sellers',
      detail: 'Questions you asked about listings',
      icon: 'chatbubble-ellipses-outline',
      onPress: go('Inquiries'),
    },
  ];

  const selling: Row[] = [
    {
      key: 'listings',
      label: 'Your Listings',
      detail: summary.activeListings > 0 ? `${summary.activeListings} live` : 'Nothing listed yet',
      icon: 'storefront-outline',
      onPress: go('MyListings'),
    },
    {
      key: 'fulfil',
      label: 'Orders to Hand Over',
      detail: summary.sellerActionOrders > 0 ? 'Paid and waiting for you' : 'No paid orders waiting',
      icon: 'cube-outline',
      badge: summary.sellerActionOrders,
      onPress: go('Orders'),
    },
    {
      key: 'offers-received',
      label: 'Offers Received',
      detail: summary.pendingOffersReceived > 0 ? 'Accept, counter or decline' : 'No open offers',
      icon: 'pricetags-outline',
      badge: summary.pendingOffersReceived,
      onPress: go('Offers'),
    },
    {
      key: 'inquiries',
      label: 'Buyer Questions',
      detail: summary.openInquiries > 0 ? 'Conversations still open' : 'All answered',
      icon: 'chatbubbles-outline',
      badge: summary.openInquiries,
      onPress: go('Inquiries'),
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

      <ScrollView contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        {sectionTitle('Buying')}
        <View className="bg-lantern-surface border-t border-lantern-border">{buying.map(renderRow)}</View>

        {sectionTitle('Selling')}
        <View className="bg-lantern-surface border-t border-lantern-border">{selling.map(renderRow)}</View>

        {/* Payout setup used to live three taps deep inside the Insights modal;
            a seller who cannot get paid is the one thing this hub must surface. */}
        {sectionTitle('Getting paid')}
        <View className="px-4 pb-2">
          <SellerPayoutSetup />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
