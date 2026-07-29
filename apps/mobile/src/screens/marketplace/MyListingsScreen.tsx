import React, { useCallback, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useMarketplaceStore, useAuthStore, getCategoryInfo } from '../../stores';
import {
  fetchSellerAnalytics,
  fetchSellerOnboarding,
  fetchSellerPreferences,
} from '../../services/api';
import { Button } from '../../components/ui';
import { formatPrice, ListingImage } from './marketplaceHelpers';
import { SellerOnboardingModal } from './modals/SellerOnboardingModal';
import { SellerCouponsModal } from './modals/SellerCouponsModal';
import { CreateBundleModal } from './modals/CreateBundleModal';
import { SellerCampaignModal } from './modals/SellerCampaignModal';
import { SellerInsightsModal } from './modals/SellerInsightsModal';
import { MarketplaceWorkspaceBar } from './components/MarketplaceWorkspaceBar';
import type { SellerAnalytics, SellerOnboardingStatus } from '@lantern/shared/types';

type StatusTab = 'active' | 'sold' | 'inactive';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function MyListingsScreen({ navigation }: { navigation: NavigationProp }) {
  const { user } = useAuthStore();
  const { myListings, sellerStats, isLoading, fetchMyListings, fetchSellerStats, updateListing, deleteListing } =
    useMarketplaceStore();
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
  const [requirePaymentConfirmation, setRequirePaymentConfirmation] = useState(false);
  const [hallDropoffEnabled, setHallDropoffEnabled] = useState(false);
  const [hallDropoffMin, setHallDropoffMin] = useState('');

  const load = useCallback(async () => {
    if (!user?.id) return;
    await fetchMyListings(user.id);
    await fetchSellerStats();
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
        if (onboarding.needsOnboarding) setShowOnboarding(true);
      }
    } catch {
      /* optional */
    }
  }, [fetchMyListings, fetchSellerStats, user?.id]);

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
    await load();
    setRefreshing(false);
  };

  const handleStatusChange = async (listingId: string, status: StatusTab) => {
    if (!user?.id) return;
    await updateListing(listingId, { status }, user.id);
    await load();
  };

  const handleDelete = (listingId: string, title: string) => {
    if (!user?.id) return;
    Alert.alert('Delete listing', `Remove "${title}"?`, [
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
      Alert.alert(item.title, 'Sale in progress', [
        { text: 'View orders', onPress: () => navigation.navigate('Orders') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    const options: string[] = ['Edit'];
    if (activeTab === 'active') {
      options.push('Mark sold', 'Deactivate');
    }
    if (activeTab === 'inactive') {
      options.push('Reactivate');
    }
    if (activeTab === 'sold') {
      options.push('Reactivate');
    }
    options.push('Delete', 'Cancel');
    const cancelIndex = options.length - 1;
    const destructiveIndex = options.indexOf('Delete');

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: cancelIndex,
          destructiveButtonIndex: destructiveIndex,
          title: item.title,
        },
        buttonIndex => {
          const choice = options[buttonIndex];
          if (choice === 'Edit') navigation.navigate('EditListing', { listingId: item.id });
          else if (choice === 'Mark sold') void handleStatusChange(item.id, 'sold');
          else if (choice === 'Deactivate') void handleStatusChange(item.id, 'inactive');
          else if (choice === 'Reactivate') void handleStatusChange(item.id, 'active');
          else if (choice === 'Delete') handleDelete(item.id, item.title);
        }
      );
      return;
    }

    Alert.alert(
      item.title,
      'Choose an action',
      [
        { text: 'Edit', onPress: () => navigation.navigate('EditListing', { listingId: item.id }) },
        ...(activeTab === 'active'
          ? [
              { text: 'Mark sold', onPress: () => void handleStatusChange(item.id, 'sold') },
              { text: 'Deactivate', onPress: () => void handleStatusChange(item.id, 'inactive') },
            ]
          : []),
        ...(activeTab !== 'active'
          ? [{ text: 'Reactivate', onPress: () => void handleStatusChange(item.id, 'active') }]
          : []),
        { text: 'Delete', style: 'destructive' as const, onPress: () => handleDelete(item.id, item.title) },
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  };

  const tabs: { id: StatusTab; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'sold', label: 'Sold' },
    { id: 'inactive', label: 'Inactive' },
  ];

  const listHeader = (
    <View>
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

      <Pressable
        onPress={() => setShowInsights(true)}
        className="mb-3 flex-row items-center justify-between px-3 py-2.5 rounded-xl border border-lantern-border bg-lantern-surface"
        accessibilityRole="button"
        accessibilityLabel="Open performance insights"
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name="stats-chart-outline" size={16} color="#6366f1" />
          <Text className="text-xs font-semibold text-lantern-text">Insights & preferences</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
      </Pressable>

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
                activeTab === tab.id ? 'text-lantern-primary' : 'text-lantern-text-secondary'
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
            <Pressable
              onPress={() => navigation.goBack()}
              className="p-2 -ml-2 mr-1 min-w-[44px] min-h-[44px] justify-center"
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="arrow-back" size={22} color="#64748b" />
            </Pressable>
            <View className="flex-1 min-w-0">
              <Text className="text-xl font-bold text-lantern-text">Selling</Text>
              {boostCredits != null ? (
                <Text className="text-xs text-amber-700 dark:text-amber-400">
                  {boostCredits} boost credit{boostCredits === 1 ? '' : 's'}
                </Text>
              ) : (
                <Text className="text-xs text-lantern-text-secondary">Manage your listings</Text>
              )}
            </View>
          </View>
          {user?.id ? (
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => navigation.navigate('SellerProfile', { sellerId: user.id })}
                className="px-2.5 py-1.5 rounded-lg border border-lantern-border"
                accessibilityRole="button"
                accessibilityLabel="View my shop"
              >
                <Ionicons name="storefront-outline" size={18} color="#6366f1" />
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
                <Ionicons name="share-outline" size={18} color="#64748b" />
              </Pressable>
            </View>
          ) : null}
        </View>

        <MarketplaceWorkspaceBar
          active="selling"
          onNavigate={screen => navigation.navigate(screen)}
          onSell={() => navigation.navigate('CreateListing')}
          primaryLabel="New"
          moreItems={[
            {
              id: 'customers',
              label: 'Customers',
              icon: 'people-outline',
              onSelect: () => navigation.navigate('SellerCustomers'),
            },
            {
              id: 'coupons',
              label: 'Coupons',
              icon: 'pricetag-outline',
              onSelect: () => setShowCoupons(true),
            },
            {
              id: 'bundle',
              label: 'Bundle',
              icon: 'layers-outline',
              onSelect: () => setShowBundle(true),
            },
            {
              id: 'campaign',
              label: 'Campaign',
              icon: 'megaphone-outline',
              onSelect: () => setShowCampaign(true),
            },
            {
              id: 'insights',
              label: 'Insights & preferences',
              icon: 'stats-chart-outline',
              onSelect: () => setShowInsights(true),
            },
          ]}
        />
      </View>

      {isLoading && !filtered.length && !myListings.length ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Ionicons name="storefront-outline" size={48} color="#cbd5e1" />
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
                  <Text className="text-sm font-bold text-lantern-primary mt-0.5">
                    {formatPrice(item.price)}
                  </Text>
                  <Text className="text-[11px] text-lantern-text-secondary mt-0.5">
                    {category.name} · {item.views_count ?? 0} views
                  </Text>
                  {item.status === 'reserved' ? (
                    <Pressable onPress={() => navigation.navigate('Orders')} className="mt-1 self-start">
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
                  <Ionicons name="ellipsis-vertical" size={18} color="#64748b" />
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
          onDismiss={() => setShowOnboarding(false)}
        />
      ) : null}
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
        onRequirePaymentConfirmationChange={setRequirePaymentConfirmation}
        onHallDropoffEnabledChange={setHallDropoffEnabled}
        onHallDropoffMinChange={setHallDropoffMin}
      />
    </SafeAreaView>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View className="px-3 py-2 rounded-lg bg-lantern-surface border border-lantern-border min-w-[45%] flex-1">
      <Text className="text-[11px] text-lantern-text-secondary">{label}</Text>
      <Text className={`font-bold ${accent ? 'text-lantern-primary' : 'text-lantern-text'}`}>{value}</Text>
    </View>
  );
}

export default MyListingsScreen;
