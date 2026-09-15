/**
 * `Inquiries` route: the questions asked about listings, on either side —
 * "Buyer questions" (received) or "Messages to sellers" (sent) — with a status
 * filter and seller-only status actions.
 *
 * Exports: InquiriesScreen.
 * Touches: fetchMyInquiries and fetchMarketplaceListing in ../../services/api;
 * useMarketplaceStore.updateInquiryStatus; useAuthStore; opens DMs through
 * navigation.getParent()?.navigate('ChatTab', … initial: false).
 *
 * Gotchas: enrichInquiries fetches each listing separately to get a title and
 * thumbnail, so a page of N inquiries is N+1 requests; a listing that fails
 * shows as "Listing unavailable". The Market stack keeps screens mounted, so
 * the route.params.tab effect is what makes a second navigate here actually
 * switch tabs. `initial: false` on the chat jump is load-bearing: without it
 * DirectMessage becomes the only route in the chat stack.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore, useMarketplaceStore } from '../../stores';
import { fetchMarketplaceListing, fetchMyInquiries } from '../../services/api';
import { ListingImage, timeAgo } from './marketplaceHelpers';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

type InquiryItem = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  dm_thread_id: string;
  initial_message: string;
  status: string;
  created_at: string;
  listingTitle?: string;
  listingImage?: string;
};

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (name: string, params?: Record<string, unknown>) => void } | undefined;
};

type Tab = 'seller' | 'buyer';
type StatusFilter = '' | 'open' | 'negotiating' | 'closed' | 'purchased';

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'negotiating', label: 'Negotiating' },
  { id: 'closed', label: 'Closed' },
  { id: 'purchased', label: 'Purchased' },
];

async function enrichInquiries(raw: Awaited<ReturnType<typeof fetchMyInquiries>>): Promise<InquiryItem[]> {
  const listingCache = new Map<string, { title: string; image?: string }>();
  const enriched = await Promise.all(
    raw.map(async item => {
      let meta = listingCache.get(item.listing_id);
      if (!meta) {
        try {
          const listing = await fetchMarketplaceListing(item.listing_id);
          meta = { title: listing.title, image: listing.images?.[0] };
          listingCache.set(item.listing_id, meta);
        } catch {
          meta = { title: 'Listing unavailable' };
        }
      }
      return {
        id: item.id,
        listing_id: item.listing_id,
        buyer_id: item.buyer_id,
        seller_id: item.seller_id,
        dm_thread_id: item.dm_thread_id,
        initial_message: item.initial_message,
        status: item.status,
        created_at: item.created_at,
        listingTitle: meta.title,
        listingImage: meta.image,
      };
    })
  );
  return enriched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function InquiriesScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { tab?: Tab } };
}) {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const { user } = useAuthStore();
  const { updateInquiryStatus } = useMarketplaceStore();
  // The You hub's "Messages to sellers" is a buyer destination and the seller
  // strip's "Questions" a seller one; seller stays the default for bare entries.
  const [tab, setTab] = useState<Tab>(route?.params?.tab ?? 'seller');
  // The Market stack keeps screens mounted, so navigating here with a param
  // while already open changes the params, not the state the tabs read.
  useEffect(() => {
    if (route?.params?.tab) setTab(route.params.tab);
  }, [route?.params?.tab]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [inquiries, setInquiries] = useState<InquiryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMyInquiries(tab, statusFilter || undefined);
      setInquiries(await enrichInquiries(data));
    } catch {
      setInquiries([]);
    } finally {
      setLoading(false);
    }
  }, [tab, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openChat = (item: InquiryItem) => {
    const recipientId = tab === 'seller' ? item.buyer_id : item.seller_id;
    // initial:false keeps the chat list under this DM. Without it, opening a DM
    // before the Chat tab has been visited makes DirectMessage the only route in
    // that stack — back then exits to the marketplace, and tapping Chat drops
    // you straight back into the same DM with no way to reach the list.
    navigation.getParent?.()?.navigate('ChatTab', {
      screen: 'DirectMessage',
      params: { threadId: item.dm_thread_id, recipientId },
      initial: false,
    });
  };

  const handleStatus = (item: InquiryItem, status: 'negotiating' | 'closed' | 'purchased') => {
    appAlert('Update status', `Mark inquiry as ${status}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            await updateInquiryStatus(item.id, status);
            await load();
          } catch {
            appAlert('Error', 'Could not update status.');
          }
        },
      },
    ]);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
      case 'negotiating':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
      case 'purchased':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
      default:
        return 'bg-lantern-background-secondary text-lantern-text-secondary dark:bg-lantern-surface-secondary dark:text-lantern-text-tertiary';
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-lantern-text">
          {tab === 'seller' ? 'Buyer questions' : 'Messages to sellers'}
        </Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
      </View>

      <View className="flex-row mx-4 mb-3 p-1 rounded-xl bg-lantern-background-secondary/70 dark:bg-lantern-surface">
        {(['seller', 'buyer'] as Tab[]).map(t => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg items-center ${tab === t ? 'bg-lantern-surface dark:bg-lantern-surface-secondary' : ''}`}
          >
            <Text className={`text-sm font-semibold capitalize ${tab === t ? 'text-lantern-primary-text' : 'text-lantern-text-secondary'}`}>
              {t === 'seller' ? 'Received' : 'Sent'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="px-4 pb-2">
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUS_FILTERS}
          keyExtractor={item => item.id || 'all'}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setStatusFilter(item.id)}
              className={`mr-2 px-3 py-1.5 rounded-full ${
                statusFilter === item.id
                  ? 'bg-lantern-primary-fill'
                  : 'bg-lantern-surface border border-lantern-border'
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  statusFilter === item.id ? 'text-white' : 'text-lantern-text-secondary'
                }`}
              >
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {loading && !inquiries.length ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={brand.text} />
        </View>
      ) : (
        <FlatList
          data={inquiries}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={brand.text} />}
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <AppIcon name="chatbubbles" size={48} color="#cbd5e1" />
              <Text className="text-lg font-semibold text-lantern-text mt-4">No inquiries yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openChat(item)}
              className="flex-row bg-lantern-surface rounded-2xl border border-lantern-border overflow-hidden mb-3"
            >
              <View className="w-24 h-24">
                <ListingImage uri={item.listingImage} className="w-full h-full" />
              </View>
              <View className="flex-1 p-3">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-sm font-semibold text-lantern-text flex-1" numberOfLines={1}>
                    {item.listingTitle}
                  </Text>
                  <View className={`px-2 py-0.5 rounded-full ${statusColor(item.status)}`}>
                    <Text className="text-label font-medium capitalize">{item.status}</Text>
                  </View>
                </View>
                <Text className="text-sm text-lantern-text-secondary mt-2" numberOfLines={2}>
                  {item.initial_message}
                </Text>
                <Text className="text-xs text-lantern-text-tertiary mt-2">{timeAgo(item.created_at)}</Text>
                {tab === 'seller' && item.status !== 'purchased' && item.status !== 'closed' ? (
                  <View className="flex-row flex-wrap gap-2 mt-2">
                    {item.status === 'open' ? (
                      <Pressable
                        onPress={e => {
                          e.stopPropagation?.();
                          handleStatus(item, 'negotiating');
                        }}
                        className="px-2 py-1 rounded-md bg-amber-100"
                      >
                        <Text className="text-label font-medium text-amber-800">Negotiating</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={e => {
                        e.stopPropagation?.();
                        handleStatus(item, 'purchased');
                      }}
                      className="px-2 py-1 rounded-md bg-emerald-100"
                    >
                      <Text className="text-label font-medium text-emerald-800">Mark purchased</Text>
                    </Pressable>
                    <Pressable
                      onPress={e => {
                        e.stopPropagation?.();
                        handleStatus(item, 'closed');
                      }}
                      className="px-2 py-1 rounded-md bg-lantern-background-secondary"
                    >
                      <Text className="text-label font-medium text-lantern-text">Close</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              <View className="justify-center pr-3">
                <AppIcon name="chatbubble" size={18} color={brand.text} />
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
