import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { fetchSellerBuyers } from '../../services/api';
import type { SellerBuyerContact, SellerCustomerSegment } from '@lantern/shared/types';
import { formatPrice } from './marketplaceHelpers';
import { SellerCampaignModal } from './modals/SellerCampaignModal';
import { AppIcon } from '../../components/ui/AppIcon';

const SEGMENT_LABELS: Record<SellerCustomerSegment, string> = {
  repeat_buyer: 'Repeat buyers',
  top_spender: 'Top spenders',
  open_order: 'Open orders',
  open_inquiry: 'Open inquiries',
  lead: 'Leads',
  customer: 'Customers',
};

const SEGMENTS: SellerCustomerSegment[] = [
  'repeat_buyer',
  'top_spender',
  'open_order',
  'open_inquiry',
  'lead',
  'customer',
];

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (name: string, params?: Record<string, unknown>) => void } | undefined;
};

export function SellerCustomersScreen({ navigation }: { navigation: NavigationProp }) {
  const [buyers, setBuyers] = useState<SellerBuyerContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<string>('');
  const [showCampaign, setShowCampaign] = useState(false);
  const [campaignBuyerIds, setCampaignBuyerIds] = useState<string[] | undefined>();
  // The list had no bottom padding at all, so the last customer card and its
  // Message/Campaign actions sat entirely under the absolute bottom tab bar.
  const bottomPadding = useScreenBottomPadding();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBuyers(await fetchSellerBuyers(segment || undefined));
    } catch {
      setBuyers([]);
    } finally {
      setLoading(false);
    }
  }, [segment]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDm = (buyerId: string) => {
    // initial:false so the chat list sits under this DM — see InquiriesScreen.
    navigation.getParent?.()?.navigate('ChatTab', {
      screen: 'DirectMessage',
      params: { recipientId: buyerId },
      initial: false,
    });
  };

  return (
    <Screen bottom="none">
      <View className="px-4 py-3 flex-row items-center">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold ml-2 flex-1">Customers</Text>
        {/* Seller tool: You carries the seller's own badges, Cart would only be clutter here. */}
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} hide={['cart']} />
        <Pressable
          onPress={() => {
            setCampaignBuyerIds(undefined);
            setShowCampaign(true);
          }}
          className="px-3 py-1.5 rounded-lg bg-lantern-primary"
        >
          <Text className="text-xs font-semibold text-white">Campaign</Text>
        </Pressable>
      </View>

      <View className="px-4 pb-2">
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: '', label: 'All' }, ...SEGMENTS.map(s => ({ id: s, label: SEGMENT_LABELS[s] }))]}
          keyExtractor={item => item.id || 'all'}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSegment(item.id)}
              className={`mr-2 px-3 py-1.5 rounded-full ${
                segment === item.id ? 'bg-lantern-primary' : 'bg-lantern-surface border border-lantern-border'
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  segment === item.id ? 'text-white' : 'text-lantern-text-secondary'
                }`}
              >
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {loading ? (
        <ActivityIndicator className="mt-8" color="#6366f1" />
      ) : (
        <FlatList
          data={buyers}
          keyExtractor={item => item.buyerId}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPadding }}
          ListEmptyComponent={<Text className="text-center text-lantern-text-secondary mt-12">No customers yet</Text>}
          renderItem={({ item }) => (
            <View className="p-4 rounded-xl bg-lantern-surface border border-lantern-border">
              <View className="flex-row justify-between items-start">
                <View className="flex-1">
                  <Text className="font-semibold text-lantern-text">{item.name}</Text>
                  <Text className="text-xs text-lantern-text-secondary mt-1">
                    Last active {new Date(item.lastInteractionAt).toLocaleDateString()}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm">{item.completedPurchases} purchases</Text>
                  <Text className="text-sm text-lantern-primary">{formatPrice(item.totalSpent)} spent</Text>
                </View>
              </View>
              {(item.openInquiry || item.openOrder) && (
                <Text className="text-xs text-amber-600 mt-2">
                  {item.openOrder ? 'Open order' : 'Open inquiry'}
                </Text>
              )}
              {item.segments && item.segments.length > 0 ? (
                <View className="flex-row flex-wrap gap-1 mt-2">
                  {item.segments.map(s => (
                    <View key={s} className="px-2 py-0.5 rounded-full bg-lantern-primary-background dark:bg-lantern-primary-background">
                      <Text className="text-[10px] text-lantern-primary">
                        {SEGMENT_LABELS[s as SellerCustomerSegment] || s}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View className="flex-row gap-2 mt-3">
                <Pressable
                  onPress={() => openDm(item.buyerId)}
                  className="flex-1 py-2 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary items-center"
                >
                  <Text className="text-xs font-semibold text-lantern-text">Message</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setCampaignBuyerIds([item.buyerId]);
                    setShowCampaign(true);
                  }}
                  className="flex-1 py-2 rounded-lg bg-lantern-primary-background dark:bg-lantern-primary-background items-center"
                >
                  <Text className="text-xs font-semibold text-lantern-primary">Campaign</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <SellerCampaignModal
        visible={showCampaign}
        defaultBuyerIds={campaignBuyerIds}
        onClose={() => {
          setShowCampaign(false);
          setCampaignBuyerIds(undefined);
        }}
      />
    </Screen>
  );
}
