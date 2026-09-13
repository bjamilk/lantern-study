import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  Text,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarketplaceStore, useAuthStore, getCategoryInfo } from '../../stores';
import {
  fetchSellerAnalytics,
  fetchSellerOnboarding,
  fetchSellerPreferences,
} from '../../services/api';
import { ActionSheet, Button, type ActionSheetItem } from '../../components/ui';
import { formatPrice, ListingImage } from './marketplaceHelpers';
import { SellerOnboardingModal } from './modals/SellerOnboardingModal';
import { SellerCouponsModal } from './modals/SellerCouponsModal';
import { CreateBundleModal } from './modals/CreateBundleModal';
import { SellerCampaignModal } from './modals/SellerCampaignModal';
import { SellerInsightsModal } from './modals/SellerInsightsModal';
import { SellerNeedsYouStrip } from './components/SellerNeedsYouStrip';
import { useShopBadges } from '../../hooks/useShopBadges';
import { SellerToolsRow } from './components/SellerToolsRow';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import type { SellerAnalytics, SellerOnboardingStatus } from '@lantern/shared/types';
import {
  canSellerSetListingStatus,
  isMarketplaceListingModerated,
  MARKETPLACE_LISTING_STATUS_LABELS,
  marketplaceListingModerationNotice,
} from '@lantern/shared/marketplace';
import type { MarketplaceListingStatus } from '@lantern/shared/marketplace';
import { SUPPORT_EMAIL } from '@lantern/shared/contactForm';
import { LISTING_APPEAL_STATUS_LABELS } from '@lantern/shared/moderation';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { ListingTakedownNotice } from '../../components/moderation/ListingTakedownNotice';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

type StatusTab = 'active' | 'sold' | 'inactive';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>, options?: { pop?: boolean }) => void;
};

// Per user: a second seller on the same phone still gets the walkthrough.
const onboardingDismissedKey = (userId: string) => `lantern_seller_onboarding_dismissed_${userId}`;

export function MyListingsScreen({
  navigation,
}: {
  navigation: NavigationProp;
}) {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const { user } = useAuthStore();
  const { myListings, sellerStats, isLoading, fetchMyListings, fetchSellerStats, updateListing, deleteListing } =
    useMarketplaceStore();
  // The strip reads the same counts the You badge does, so the two never
  // disagree about what needs the seller. Inquiry unread is real DM unread
  // (joined with groupStore in the hook), not "open" status.
  const badges = useShopBadges();
  const fetchShopSummary = useMarketplaceStore(s => s.fetchShopSummary);
  const [activeTab, setActiveTab] = useState<StatusTab>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState<SellerAnalytics | null>(null);
  const [boostCredits, setBoostCredits] = useState<number | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<SellerOnboardingStatus | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCoupons, setShowCoupons] = useState(false);
  const [showBundle, setShowBundle] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  // The row "..." menu. Alert.alert cannot hold it: Android caps a native
  // dialog at three buttons and silently drops the rest, so Reactivate and
  // Delete were unreachable there.
  const [listingActions, setListingActions] = useState<{ title: string; items: ActionSheetItem[] } | null>(null);
  const [requirePaymentConfirmation, setRequirePaymentConfirmation] = useState(false);
  const [hallDropoffEnabled, setHallDropoffEnabled] = useState(false);
  const [hallDropoffMin, setHallDropoffMin] = useState('');
  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [shippingFee, setShippingFee] = useState('');
  const [shippingFreeOver, setShippingFreeOver] = useState('');
  const [shipsFromCity, setShipsFromCity] = useState('');

  const load = useCallback(async () => {
    if (!user?.id) return;
    await fetchMyListings(user.id);
    await fetchSellerStats();
    // TTL-cached: free when arriving from Shop home, which just fetched it.
    void fetchShopSummary();
    try {
      setAnalytics(await fetchSellerAnalytics());
    } catch {
      setAnalytics(null);
    }
    try {
      const prefs = await fetchSellerPreferences();
      if (prefs) {
        setRequirePaymentConfirmation(!!prefs.require_payment_confirmation);
        setHallDropoffEnabled(!!prefs.hall_dropoff_enabled);
        setHallDropoffMin(prefs.hall_dropoff_min_amount != null ? String(prefs.hall_dropoff_min_amount) : '');
        setShippingEnabled(!!prefs.shipping_enabled);
        setShippingFee(prefs.shipping_fee_naira != null ? String(prefs.shipping_fee_naira) : '');
        setShippingFreeOver(prefs.shipping_free_over_naira != null ? String(prefs.shipping_free_over_naira) : '');
        setShipsFromCity(prefs.ships_from_city || '');
        if (prefs.boost_credits != null) setBoostCredits(prefs.boost_credits);
      }
    } catch {
      /* optional */
    }
    try {
      const onboarding = await fetchSellerOnboarding();
      if (onboarding) {
        setOnboardingStatus(onboarding);
        setBoostCredits(onboarding.boostCredits);
        if (onboarding.needsOnboarding) {
          // "Later" used to last one mount: the server still says
          // needsOnboarding, so the modal came back on every focus.
          const dismissed = await AsyncStorage.getItem(onboardingDismissedKey(user.id)).catch(() => null);
          if (!dismissed) setShowOnboarding(true);
        }
      }
    } catch {
      /* optional */
    }
  }, [fetchMyListings, fetchSellerStats, fetchShopSummary, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const filtered = useMemo(
    () =>
      myListings.filter(l =>
        activeTab === 'active'
          ? l.status === 'active' || l.status === 'reserved'
          : activeTab === 'inactive'
            ? // Takedowns sit on the Inactive shelf (read-only) instead of vanishing.
              l.status === 'inactive' || isMarketplaceListingModerated(l.status)
            : l.status === activeTab
      ),
    [myListings, activeTab]
  );

  const tabCounts = useMemo(
    () => ({
      active: sellerStats?.active_listings ?? 0,
      sold: sellerStats?.sold_listings ?? 0,
      inactive: Math.max(
        0,
        (sellerStats?.total_listings ?? 0) -
          (sellerStats?.active_listings ?? 0) -
          (sellerStats?.sold_listings ?? 0)
      ),
    }),
    [sellerStats]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    // A pull is the seller asking "what changed?" — skip the summary TTL too.
    await Promise.all([load(), fetchShopSummary({ force: true })]);
    setRefreshing(false);
  };

  const handleStatusChange = async (listingId: string, status: StatusTab) => {
    if (!user?.id) return;
    try {
      await updateListing(listingId, { status }, user.id);
    } catch (e) {
      // The store already rolled the optimistic row back; surface the API's
      // seller-facing refusal (moderated / reserved / archived) instead of nothing.
      appAlert(
        'Could not update listing',
        e instanceof Error && e.message ? e.message : 'Failed to update listing.'
      );
    } finally {
      await load();
    }
  };

  const handleDelete = (listingId: string, title: string) => {
    if (!user?.id) return;
    appAlert('Delete listing', `Remove "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteListing(listingId, user.id);
          await load();
        },
      },
    ]);
  };

  const openListingActions = (item: (typeof filtered)[number]) => {
    if (item.status === 'reserved') {
      appAlert(item.title, 'Sale in progress', [
        { text: 'View orders', onPress: () => navigation.navigate('Orders', { role: 'seller' }) },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    if (isMarketplaceListingModerated(item.status)) {
      // Moderation outcomes are read-only for the seller: no edit, no relist,
      // no delete (the record backs the report trail). The row itself carries
      // the takedown reason + the one-shot Appeal link (ListingTakedownNotice).
      const appealLine =
        item.appeal_status && item.appeal_status !== 'none'
          ? ` ${LISTING_APPEAL_STATUS_LABELS[item.appeal_status]}.`
          : ' You can appeal once from the listing row.';
      appAlert(
        MARKETPLACE_LISTING_STATUS_LABELS[item.status],
        `${marketplaceListingModerationNotice(item.status)}${
          item.takedown_reason ? ` Reason: ${item.takedown_reason}.` : ''
        }${appealLine} Contact ${SUPPORT_EMAIL} if you think this is a mistake.`,
        [
          { text: 'View listing', onPress: () => navigation.navigate('ListingDetail', { listingId: item.id }) },
          { text: 'OK', style: 'cancel' },
        ]
      );
      return;
    }
    // Offer only the moves the shared lifecycle table lets a seller make, so
    // the sheet and the API can never disagree.
    const offers = (to: MarketplaceListingStatus) =>
      item.status !== to && canSellerSetListingStatus(item.status, to);
    const actions: ActionSheetItem[] = [
      { label: 'Edit', icon: 'create', onPress: () => navigation.navigate('EditListing', { listingId: item.id }) },
    ];
    if (offers('sold')) {
      actions.push({ label: 'Mark sold', icon: 'checkmark-done', onPress: () => void handleStatusChange(item.id, 'sold') });
    }
    if (offers('inactive')) {
      actions.push({ label: 'Deactivate', icon: 'eye-off', onPress: () => void handleStatusChange(item.id, 'inactive') });
    }
    if (offers('active')) {
      actions.push({ label: 'Reactivate', icon: 'refresh', onPress: () => void handleStatusChange(item.id, 'active') });
    }
    actions.push({
      label: 'Delete',
      icon: 'trash',
      destructive: true,
      onPress: () => handleDelete(item.id, item.title),
    });
    setListingActions({ title: item.title, items: actions });
  };

  const tabs: { id: StatusTab; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'sold', label: 'Sold' },
    { id: 'inactive', label: 'Inactive' },
  ];

  const listHeader = (
    <View>
      <SellerNeedsYouStrip
        handOver={badges.sellerActionOrders}
        offers={badges.offersAwaitingMe}
        inquiries={badges.unreadSellerInquiries}
        openInquiries={badges.openInquiries}
        awaitingBuyerPayment={badges.sellerAwaitingBuyerPayment}
        onNavigate={(screen, params) => navigation.navigate(screen, params, { pop: true })}
      />

      <Text className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary mb-1.5">
        Performance
      </Text>
      <View className="flex-row flex-wrap gap-2 mb-3">
        <Kpi label="Active" value={String(tabCounts.active)} />
        <Kpi label="Views" value={String(sellerStats?.total_views ?? 0)} />
        <Kpi label="Inquiries" value={String(sellerStats?.total_inquiries ?? 0)} />
        <Kpi
          label="Revenue 30d"
          value={analytics ? formatPrice(analytics.revenue30d) : '—'}
          accent
        />
      </View>

      <View className="flex-row mb-2">
        {tabs.map(tab => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 items-center border-b-2 ${
              activeTab === tab.id ? 'border-lantern-primary' : 'border-transparent'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                activeTab === tab.id ? 'text-lantern-primary-text' : 'text-lantern-text-secondary'
              }`}
            >
              {tab.label} ({tabCounts[tab.id]})
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-2 gap-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 min-w-0">
            <Pressable hitSlop={10}
              onPress={() => navigation.goBack()}
              className="p-2 -ml-2 mr-1 min-w-[44px] min-h-[44px] justify-center"
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <AppIcon name="arrow-back" size={24} color="#64748b" />
            </Pressable>
            <View className="flex-1 min-w-0">
              <Text className="text-xl font-bold text-lantern-text">Your Listings</Text>
              {boostCredits != null ? (
                <Text className="text-xs text-amber-700 dark:text-amber-400">
                  {boostCredits} boost credit{boostCredits === 1 ? '' : 's'}
                </Text>
              ) : (
                <Text className="text-xs text-lantern-text-secondary">Manage your listings</Text>
              )}
            </View>
          </View>
          <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
          {user?.id ? (
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => navigation.navigate('SellerProfile', { sellerId: user.id })}
                className="px-2.5 py-1.5 rounded-lg border border-lantern-border"
                accessibilityRole="button"
                accessibilityLabel="View my shop"
              >
                <AppIcon name="storefront" size={18} color={brand.text} />
              </Pressable>
              <Pressable
                onPress={() =>
                  void Share.share({
                    message: `Check out my shop on Lantern: https://lanternstudy.com/marketplace/seller/${user.id}`,
                  })
                }
                className="px-2.5 py-1.5 rounded-lg border border-lantern-border"
                accessibilityRole="button"
                accessibilityLabel="Share my shop"
              >
                <AppIcon name="share" size={18} color="#64748b" />
              </Pressable>
            </View>
          ) : null}
        </View>

        <SellerToolsRow
          onNavigate={(screen, params) => navigation.navigate(screen, params, { pop: true })}
          onOpenTool={tool => {
            if (tool === 'coupons') setShowCoupons(true);
            else if (tool === 'bundles') setShowBundle(true);
            else if (tool === 'campaign') setShowCampaign(true);
            else setShowInsights(true);
          }}
          onNew={() => navigation.navigate('CreateListing')}
        />
      </View>

      {isLoading && !filtered.length && !myListings.length ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={brand.text} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabBarClearance }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={brand.text} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AppIcon name="storefront" size={48} color="#cbd5e1" />
              <Text className="text-lg font-semibold text-lantern-text mt-4">
                No {activeTab} listings
              </Text>
              <Button className="mt-6" onPress={() => navigation.navigate('CreateListing')}>
                Create Listing
              </Button>
            </View>
          }
          renderItem={({ item }) => {
            const category = getCategoryInfo(item.category);
            return (
              <Pressable
                onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
                className="flex-row bg-lantern-surface rounded-2xl border border-lantern-border overflow-hidden mb-2.5"
              >
                <View className="w-20 h-20">
                  <ListingImage uri={item.images?.[0]} className="w-full h-full" />
                </View>
                <View className="flex-1 p-2.5 pr-1">
                  <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text className="text-sm font-bold text-lantern-primary-text mt-0.5">
                    {formatPrice(item.price)}
                  </Text>
                  <Text className="text-[11px] text-lantern-text-secondary mt-0.5">
                    {category.name} · {item.views_count ?? 0} views
                  </Text>
                  {isMarketplaceListingModerated(item.status) ? (
                    // Takedown reason + appeal state + one-shot Appeal (Phase 1 · E).
                    <ListingTakedownNotice listing={item} compact />
                  ) : null}
                  {item.status === 'reserved' ? (
                    <Pressable onPress={() => navigation.navigate('Orders', { role: 'seller' })} className="mt-1 self-start">
                      <Text className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                        Sale in progress · View orders
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  onPress={e => {
                    e.stopPropagation?.();
                    openListingActions(item);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Actions for ${item.title}`}
                  className="px-3 justify-center min-w-[44px] min-h-[44px]"
                >
                  <AppIcon name="ellipsis-vertical" size={18} color="#64748b" />
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}

      {onboardingStatus ? (
        <SellerOnboardingModal
          visible={showOnboarding}
          status={onboardingStatus}
          onComplete={async () => {
            setShowOnboarding(false);
            const onboarding = await fetchSellerOnboarding();
            if (onboarding) {
              setOnboardingStatus(onboarding);
              setBoostCredits(onboarding.boostCredits);
            }
          }}
          onDismiss={() => {
            setShowOnboarding(false);
            if (user?.id) {
              AsyncStorage.setItem(onboardingDismissedKey(user.id), '1').catch(() => {});
            }
          }}
        />
      ) : null}
      <ActionSheet
        visible={listingActions != null}
        title={listingActions?.title}
        items={listingActions?.items ?? []}
        onClose={() => setListingActions(null)}
      />
      <SellerCouponsModal visible={showCoupons} onClose={() => setShowCoupons(false)} />
      <CreateBundleModal
        visible={showBundle}
        listings={myListings}
        onClose={() => setShowBundle(false)}
        onCreated={() => void load()}
      />
      <SellerCampaignModal visible={showCampaign} onClose={() => setShowCampaign(false)} />
      <SellerInsightsModal
        visible={showInsights}
        onClose={() => setShowInsights(false)}
        analytics={analytics}
        requirePaymentConfirmation={requirePaymentConfirmation}
        hallDropoffEnabled={hallDropoffEnabled}
        hallDropoffMin={hallDropoffMin}
        shippingEnabled={shippingEnabled}
        shippingFee={shippingFee}
        shippingFreeOver={shippingFreeOver}
        shipsFromCity={shipsFromCity}
        onRequirePaymentConfirmationChange={setRequirePaymentConfirmation}
        onHallDropoffEnabledChange={setHallDropoffEnabled}
        onHallDropoffMinChange={setHallDropoffMin}
        onShippingEnabledChange={setShippingEnabled}
        onShippingFeeChange={setShippingFee}
        onShippingFreeOverChange={setShippingFreeOver}
        onShipsFromCityChange={setShipsFromCity}
      />
    </SafeAreaView>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View className="px-3 py-2 rounded-lg bg-lantern-surface border border-lantern-border min-w-[45%] flex-1">
      <Text className="text-[11px] text-lantern-text-secondary">{label}</Text>
      <Text className={`font-bold ${accent ? 'text-lantern-primary-text' : 'text-lantern-text'}`}>{value}</Text>
    </View>
  );
}

export default MyListingsScreen;
