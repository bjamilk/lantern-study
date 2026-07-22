import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Switch,
  Text,
  TextInput,
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
  updateSellerPreferences,
} from '../../services/api';
import { Button } from '../../components/ui';
import { formatPrice, ListingImage } from './marketplaceHelpers';
import { SellerOnboardingModal } from './modals/SellerOnboardingModal';
import { SellerCouponsModal } from './modals/SellerCouponsModal';
import { CreateBundleModal } from './modals/CreateBundleModal';
import { SellerCampaignModal } from './modals/SellerCampaignModal';
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
  const [requirePaymentConfirmation, setRequirePaymentConfirmation] = useState(false);
  const [hallDropoffEnabled, setHallDropoffEnabled] = useState(false);
  const [hallDropoffMin, setHallDropoffMin] = useState('');
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(true);

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
    () => myListings.filter(l => l.status === activeTab),
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

  const savePreferences = async () => {
    setSavingPrefs(true);
    try {
      await updateSellerPreferences({
        requirePaymentConfirmation,
        hallDropoffEnabled,
        hallDropoffMinAmount: hallDropoffMin.trim() ? Number(hallDropoffMin) : undefined,
      });
      Alert.alert('Saved', 'Seller preferences updated.');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not save preferences.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const tabs: { id: StatusTab; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'sold', label: 'Sold' },
    { id: 'inactive', label: 'Inactive' },
  ];

  const weeklyMax = analytics?.salesByWeek?.length
    ? Math.max(...analytics.salesByWeek.map(w => w.revenue), 1)
    : 1;

  const listHeader = (
    <View>
      <View className="px-4 pb-2 flex-row flex-wrap gap-2">
        {sellerStats ? (
          <>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Sold listings</Text>
              <Text className="font-bold">{sellerStats.sold_listings ?? 0}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Completed sales</Text>
              <Text className="font-bold">
                {sellerStats.completed_orders ?? analytics?.completedSalesCount ?? 0}
              </Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Views</Text>
              <Text className="font-bold">{sellerStats.total_views ?? 0}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Inquiries</Text>
              <Text className="font-bold">{sellerStats.total_inquiries ?? 0}</Text>
            </View>
          </>
        ) : null}
        {analytics ? (
          <>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Revenue (30d)</Text>
              <Text className="font-bold text-lantern-primary">{formatPrice(analytics.revenue30d)}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Total revenue</Text>
              <Text className="font-bold">{formatPrice(analytics.totalRevenue)}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Avg sale</Text>
              <Text className="font-bold">{formatPrice(analytics.avgSalePrice)}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Days to sell</Text>
              <Text className="font-bold">{analytics.avgTimeToSellDays}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">
                {analytics.conversionRate30d != null ? 'View-to-sale (30d)' : 'View-to-sale'}
              </Text>
              <Text className="font-bold">
                {analytics.conversionRate30d != null ? analytics.conversionRate30d : analytics.conversionRate}%
              </Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Pending orders</Text>
              <Text className="font-bold">{analytics.pendingOrders}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Offer accept rate</Text>
              <Text className="font-bold">{analytics.offerAcceptRate}%</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-lantern-surface">
              <Text className="text-xs text-lantern-text-secondary">Discounts given</Text>
              <Text className="font-bold">{formatPrice(analytics.discountsGiven)}</Text>
            </View>
          </>
        ) : null}
      </View>

      <View className="px-4 pb-2 flex-row flex-wrap gap-2">
        {boostCredits != null ? (
          <View className="px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40">
            <Text className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {boostCredits} boost credit{boostCredits === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}
        <Pressable onPress={() => navigation.navigate('Orders')} className="px-3 py-1.5 rounded-lg bg-lantern-primary-background">
          <Text className="text-xs font-semibold text-lantern-primary">Orders</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Inquiries')} className="px-3 py-1.5 rounded-lg bg-lantern-primary-background">
          <Text className="text-xs font-semibold text-lantern-primary">Inquiries</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('SellerCustomers')} className="px-3 py-1.5 rounded-lg bg-lantern-primary-background">
          <Text className="text-xs font-semibold text-lantern-primary">Customers</Text>
        </Pressable>
        <Pressable onPress={() => setShowCoupons(true)} className="px-3 py-1.5 rounded-lg border border-lantern-border">
          <Text className="text-xs font-semibold text-lantern-text">Coupons</Text>
        </Pressable>
        <Pressable onPress={() => setShowBundle(true)} className="px-3 py-1.5 rounded-lg border border-lantern-border">
          <Text className="text-xs font-semibold text-lantern-text">Bundle</Text>
        </Pressable>
        <Pressable onPress={() => setShowCampaign(true)} className="px-3 py-1.5 rounded-lg border border-lantern-border">
          <Text className="text-xs font-semibold text-lantern-text">Campaign</Text>
        </Pressable>
      </View>

      {analytics && showAnalytics ? (
        <View className="px-4 pb-3">
          {analytics.funnel30d ? (
            <View className="p-3 mb-2 rounded-xl bg-lantern-surface border border-lantern-border">
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Funnel (30d)</Text>
              <Text className="text-xs text-lantern-text-secondary">
                {analytics.funnel30d.impressions} impressions → {analytics.funnel30d.views} views →{' '}
                {analytics.funnel30d.inquiries} inquiries → {analytics.funnel30d.offers} offers →{' '}
                {analytics.funnel30d.sales} sales
              </Text>
            </View>
          ) : null}

          {analytics.viewsByDay && analytics.viewsByDay.some(d => d.views > 0) ? (
            <View className="p-3 mb-2 rounded-xl bg-lantern-surface border border-lantern-border">
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Listing views (30d)</Text>
              <View className="flex-row items-end gap-0.5 h-14">
                {analytics.viewsByDay.map(day => {
                  const max = Math.max(...analytics.viewsByDay!.map(d => d.views), 1);
                  const height = Math.max(2, (day.views / max) * 100);
                  return (
                    <View
                      key={day.date}
                      className="flex-1 bg-emerald-500/80 rounded-t"
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </View>
            </View>
          ) : null}

          {analytics.salesByWeek.length > 0 ? (
            <View className="p-3 mb-2 rounded-xl bg-lantern-surface border border-lantern-border">
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Weekly sales</Text>
              <View className="flex-row items-end gap-1 h-16">
                {analytics.salesByWeek.map(week => {
                  const height = Math.max(4, (week.revenue / weeklyMax) * 100);
                  return (
                    <View
                      key={week.weekStart}
                      className="flex-1 bg-lantern-primary/80 rounded-t"
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </View>
            </View>
          ) : null}

          {analytics.inquiryToSaleRate != null ? (
            <View className="p-3 mb-2 rounded-xl bg-lantern-surface border border-lantern-border">
              <Text className="text-xs text-lantern-text-secondary">Inquiry → sale rate</Text>
              <Text className="text-lg font-bold">{analytics.inquiryToSaleRate}%</Text>
            </View>
          ) : null}

          {analytics.salesBySource && analytics.salesBySource.length > 0 ? (
            <View className="p-3 mb-2 rounded-xl bg-lantern-surface border border-lantern-border">
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Sales by channel</Text>
              {analytics.salesBySource.map(row => (
                <View key={row.source} className="flex-row justify-between mb-1">
                  <Text className="text-sm text-lantern-text capitalize">
                    {row.source.replace(/_/g, ' ')}
                  </Text>
                  <Text className="text-sm text-lantern-text-secondary">
                    {row.count} · {formatPrice(row.revenue)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {analytics.topListings && analytics.topListings.length > 0 ? (
            <View className="p-3 mb-2 rounded-xl bg-lantern-surface border border-lantern-border">
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Top listings</Text>
              {analytics.topListings.slice(0, 6).map(l => (
                <View key={l.id} className="mb-2 pb-2 border-b border-lantern-border/60 last:border-0 last:mb-0 last:pb-0">
                  <Text className="text-sm text-lantern-text" numberOfLines={1}>
                    {l.title}{l.sold ? ' · sold' : ''}
                  </Text>
                  <Text className="text-xs text-lantern-text-secondary">
                    {l.views} views · {l.inquiries} inquiries · {l.offers} offers · {formatPrice(l.revenue)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {(analytics.staleListings?.length || analytics.highViewsLowEngagement?.length) ? (
            <View className="p-3 mb-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
              <Text className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">Listing insights</Text>
              {analytics.highViewsLowEngagement?.slice(0, 3).map(l => (
                <Text key={l.id} className="text-xs text-amber-900 dark:text-amber-200 mb-1">
                  "{l.title}" — {l.views} views, no inquiries.
                </Text>
              ))}
              {analytics.staleListings?.slice(0, 3).map(l => (
                <Text key={l.id} className="text-xs text-amber-900 dark:text-amber-200 mb-1">
                  "{l.title}" — {l.daysListed} days listed with low activity.
                </Text>
              ))}
            </View>
          ) : null}

          {analytics.favoriteHighlights && analytics.favoriteHighlights.length > 0 ? (
            <View className="p-3 mb-2 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-900/40">
              <Text className="text-xs font-semibold text-pink-800 dark:text-pink-300 mb-2">Favorite highlights</Text>
              {analytics.favoriteHighlights.map(l => (
                <Text key={l.id} className="text-xs text-pink-900 dark:text-pink-200 mb-1">
                  "{l.title}" — {l.favoritesCount} favorite{l.favoritesCount === 1 ? '' : 's'}.
                </Text>
              ))}
            </View>
          ) : null}

          <View className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
            <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Seller preferences</Text>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm text-lantern-text flex-1 mr-2">
                Require payment proof before marking paid
              </Text>
              <Switch value={requirePaymentConfirmation} onValueChange={setRequirePaymentConfirmation} />
            </View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm text-lantern-text flex-1 mr-2">Offer hall dropoff</Text>
              <Switch value={hallDropoffEnabled} onValueChange={setHallDropoffEnabled} />
            </View>
            <TextInput
              value={hallDropoffMin}
              onChangeText={setHallDropoffMin}
              placeholder="Hall dropoff min amount (₦)"
              keyboardType="numeric"
              placeholderTextColor="#94a3b8"
              className="border border-lantern-border rounded-xl px-3 py-2 mb-2 text-lantern-text"
            />
            <Button loading={savingPrefs} onPress={() => void savePreferences()}>
              Save preferences
            </Button>
          </View>
        </View>
      ) : null}

      <Pressable onPress={() => setShowAnalytics(v => !v)} className="px-4 pb-2">
        <Text className="text-xs font-semibold text-lantern-primary">
          {showAnalytics ? 'Hide analytics' : 'Show analytics & preferences'}
        </Text>
      </Pressable>

      <View className="flex-row px-4 mb-2">
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
                activeTab === tab.id
                  ? 'text-lantern-primary'
                  : 'text-lantern-text-secondary'
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
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
            <Ionicons name="arrow-back" size={22} color="#64748b" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-xl font-bold text-lantern-text">My Listings</Text>
            {boostCredits != null ? (
              <Text className="text-xs text-amber-700 dark:text-amber-400">{boostCredits} boost credits</Text>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={() => navigation.navigate('CreateListing')}
          className="p-2 rounded-xl bg-lantern-primary"
        >
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
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
                className="flex-row bg-lantern-surface rounded-2xl border border-lantern-border overflow-hidden mb-3"
              >
                <View className="w-24 h-24">
                  <ListingImage uri={item.images?.[0]} className="w-full h-full" />
                </View>
                <View className="flex-1 p-3">
                  <Text className="text-sm font-semibold text-lantern-text" numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text className="text-sm font-bold text-lantern-primary mt-1">
                    {formatPrice(item.price)}
                  </Text>
                  <Text className="text-xs text-lantern-text-secondary mt-0.5">{category.name}</Text>
                  <View className="flex-row items-center flex-wrap gap-2 mt-2">
                    <Text className="text-xs text-lantern-text-tertiary">{item.views_count ?? 0} views</Text>
                    <Pressable
                      onPress={e => {
                        e.stopPropagation?.();
                        navigation.navigate('EditListing', { listingId: item.id });
                      }}
                    >
                      <Text className="text-xs font-medium text-lantern-primary">Edit</Text>
                    </Pressable>
                    {activeTab === 'active' ? (
                      <>
                        <Pressable
                          onPress={e => {
                            e.stopPropagation?.();
                            void handleStatusChange(item.id, 'sold');
                          }}
                        >
                          <Text className="text-xs font-medium text-emerald-600">Mark sold</Text>
                        </Pressable>
                        <Pressable
                          onPress={e => {
                            e.stopPropagation?.();
                            void handleStatusChange(item.id, 'inactive');
                          }}
                        >
                          <Text className="text-xs font-medium text-lantern-text-secondary">Deactivate</Text>
                        </Pressable>
                      </>
                    ) : null}
                    {activeTab === 'inactive' ? (
                      <Pressable
                        onPress={e => {
                          e.stopPropagation?.();
                          void handleStatusChange(item.id, 'active');
                        }}
                      >
                        <Text className="text-xs font-medium text-emerald-600">Reactivate</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={e => {
                        e.stopPropagation?.();
                        handleDelete(item.id, item.title);
                      }}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ef4444" />
                    </Pressable>
                  </View>
                </View>
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
    </SafeAreaView>
  );
}
