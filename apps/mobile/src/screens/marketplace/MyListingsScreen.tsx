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
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">Sold listings</Text>
              <Text className="font-bold">{sellerStats.sold_listings ?? 0}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">Completed sales</Text>
              <Text className="font-bold">
                {sellerStats.completed_orders ?? analytics?.completedSalesCount ?? 0}
              </Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">Views</Text>
              <Text className="font-bold">{sellerStats.total_views ?? 0}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">Inquiries</Text>
              <Text className="font-bold">{sellerStats.total_inquiries ?? 0}</Text>
            </View>
          </>
        ) : null}
        {analytics ? (
          <>
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">Revenue (30d)</Text>
              <Text className="font-bold text-indigo-600">{formatPrice(analytics.revenue30d)}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">View-to-sale</Text>
              <Text className="font-bold">{analytics.conversionRate}%</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">Pending orders</Text>
              <Text className="font-bold">{analytics.pendingOrders}</Text>
            </View>
            <View className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800">
              <Text className="text-xs text-slate-500">Offer accept rate</Text>
              <Text className="font-bold">{analytics.offerAcceptRate}%</Text>
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
        <Pressable onPress={() => navigation.navigate('Orders')} className="px-3 py-1.5 rounded-lg bg-indigo-100">
          <Text className="text-xs font-semibold text-indigo-700">Orders</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Inquiries')} className="px-3 py-1.5 rounded-lg bg-indigo-100">
          <Text className="text-xs font-semibold text-indigo-700">Inquiries</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('SellerCustomers')} className="px-3 py-1.5 rounded-lg bg-indigo-100">
          <Text className="text-xs font-semibold text-indigo-700">Customers</Text>
        </Pressable>
        <Pressable onPress={() => setShowCoupons(true)} className="px-3 py-1.5 rounded-lg border border-slate-300">
          <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">Coupons</Text>
        </Pressable>
        <Pressable onPress={() => setShowBundle(true)} className="px-3 py-1.5 rounded-lg border border-slate-300">
          <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">Bundle</Text>
        </Pressable>
        <Pressable onPress={() => setShowCampaign(true)} className="px-3 py-1.5 rounded-lg border border-slate-300">
          <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">Campaign</Text>
        </Pressable>
      </View>

      {analytics && showAnalytics ? (
        <View className="px-4 pb-3">
          {analytics.salesByWeek.length > 0 ? (
            <View className="p-3 mb-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <Text className="text-xs font-semibold text-slate-500 mb-2">Weekly sales</Text>
              <View className="flex-row items-end gap-1 h-16">
                {analytics.salesByWeek.map(week => {
                  const height = Math.max(4, (week.revenue / weeklyMax) * 100);
                  return (
                    <View
                      key={week.weekStart}
                      className="flex-1 bg-indigo-500/80 rounded-t"
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </View>
            </View>
          ) : null}

          {analytics.inquiryToSaleRate != null ? (
            <View className="p-3 mb-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <Text className="text-xs text-slate-500">Inquiry → sale rate</Text>
              <Text className="text-lg font-bold">{analytics.inquiryToSaleRate}%</Text>
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

          <View className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <Text className="text-xs font-semibold text-slate-500 mb-2">Seller preferences</Text>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm text-slate-700 dark:text-slate-300 flex-1 mr-2">
                Require payment proof before marking paid
              </Text>
              <Switch value={requirePaymentConfirmation} onValueChange={setRequirePaymentConfirmation} />
            </View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm text-slate-700 dark:text-slate-300 flex-1 mr-2">Offer hall dropoff</Text>
              <Switch value={hallDropoffEnabled} onValueChange={setHallDropoffEnabled} />
            </View>
            <TextInput
              value={hallDropoffMin}
              onChangeText={setHallDropoffMin}
              placeholder="Hall dropoff min amount (₦)"
              keyboardType="numeric"
              placeholderTextColor="#94a3b8"
              className="border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-2 text-slate-900 dark:text-slate-100"
            />
            <Button loading={savingPrefs} onPress={() => void savePreferences()}>
              Save preferences
            </Button>
          </View>
        </View>
      ) : null}

      <Pressable onPress={() => setShowAnalytics(v => !v)} className="px-4 pb-2">
        <Text className="text-xs font-semibold text-indigo-600">
          {showAnalytics ? 'Hide analytics' : 'Show analytics & preferences'}
        </Text>
      </Pressable>

      <View className="flex-row px-4 mb-2">
        {tabs.map(tab => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 items-center border-b-2 ${
              activeTab === tab.id ? 'border-indigo-600' : 'border-transparent'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                activeTab === tab.id
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-500 dark:text-slate-400'
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
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
            <Ionicons name="arrow-back" size={22} color="#64748b" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-xl font-bold text-slate-900 dark:text-slate-100">My Listings</Text>
            {boostCredits != null ? (
              <Text className="text-xs text-amber-700 dark:text-amber-400">{boostCredits} boost credits</Text>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={() => navigation.navigate('CreateListing')}
          className="p-2 rounded-xl bg-indigo-600"
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
              <Text className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-4">
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
                className="flex-row bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-3"
              >
                <View className="w-24 h-24">
                  <ListingImage uri={item.images?.[0]} className="w-full h-full" />
                </View>
                <View className="flex-1 p-3">
                  <Text className="text-sm font-semibold text-slate-800 dark:text-slate-100" numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                    {formatPrice(item.price)}
                  </Text>
                  <Text className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{category.name}</Text>
                  <View className="flex-row items-center flex-wrap gap-2 mt-2">
                    <Text className="text-xs text-slate-400">{item.views_count ?? 0} views</Text>
                    <Pressable
                      onPress={e => {
                        e.stopPropagation?.();
                        navigation.navigate('EditListing', { listingId: item.id });
                      }}
                    >
                      <Text className="text-xs font-medium text-indigo-600">Edit</Text>
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
                          <Text className="text-xs font-medium text-slate-600">Deactivate</Text>
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
