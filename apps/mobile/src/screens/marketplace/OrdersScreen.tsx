import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { fetchMarketplaceOrders, resumeMarketplaceOrderCheckout } from '../../services/api';
import type { MarketplaceOrder } from '@lantern/shared/types';
import { Button } from '../../components/ui';
import { formatPrice } from './marketplaceHelpers';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

/** Paystack-payable: a checkout session exists and the money hasn't moved yet. */
const isPayable = (order: MarketplaceOrder): boolean =>
  order.status === 'awaiting_payment' ||
  (order.status === 'pending_payment' && Boolean(order.payment_id));

export function OrdersScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { role?: 'buyer' | 'seller' } };
}) {
  // The You hub's "Orders to Hand Over" is a seller destination; without this
  // it landed on the buyer's purchase history and the seller had to notice the
  // toggle. Buyer stays the default for every other entry.
  const [role, setRole] = useState<'buyer' | 'seller'>(route?.params?.role ?? 'buyer');
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await fetchMarketplaceOrders(role));
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleBuyAgain = (order: MarketplaceOrder) => {
    const listing = order.listing;
    const listingId = listing?.id || order.listing_id;
    if (!listingId) {
      Alert.alert('Unavailable', 'Listing is no longer available.');
      return;
    }
    if (listing?.status && listing.status !== 'active') {
      Alert.alert('Sold out', 'This listing is sold out or unavailable.');
      return;
    }
    if (listing?.quantity != null && listing.quantity <= 0) {
      Alert.alert('Sold out', 'This listing is sold out.');
      return;
    }
    const lastQty = Math.max(1, Number(order.quantity) || 1);
    const prefQty =
      listing?.quantity == null
        ? 1
        : Math.min(lastQty, Math.max(1, Number(listing.quantity)));
    navigation.navigate('ListingDetail', { listingId, quantity: prefQty });
  };

  const handlePayNow = async (order: MarketplaceOrder) => {
    setPayingId(order.id);
    try {
      const session = await resumeMarketplaceOrderCheckout(order.id);
      if (session?.authorizationUrl) {
        await WebBrowser.openBrowserAsync(session.authorizationUrl);
        await load();
        return;
      }
      // No hosted-checkout URL: fall back to the order detail to finish payment.
      navigation.navigate('OrderDetail', { orderId: order.id });
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not open checkout');
    } finally {
      setPayingId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold text-lantern-text ml-2">
          {role === 'buyer' ? 'Purchase history' : 'Orders'}
        </Text>
      </View>
      <View className="flex-row gap-2 px-4 mb-3">
        {(['buyer', 'seller'] as const).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRole(r)}
            className={`px-4 py-2 rounded-full ${role === r ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface'}`}
          >
            <Text className={role === r ? 'text-white font-semibold' : 'text-lantern-text-secondary'}>
              {r === 'buyer' ? 'Purchase history' : 'Selling'}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            <Text className="text-center text-lantern-text-secondary mt-12">
              {role === 'buyer' ? 'No purchases yet' : 'No orders yet'}
            </Text>
          }
          renderItem={({ item }) => (
            <View className="p-4 rounded-xl bg-lantern-surface border border-lantern-border">
              <Pressable onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}>
                <Text className="font-semibold text-lantern-text" numberOfLines={1}>
                  {item.listing?.title || 'Listing'}
                </Text>
                <Text className="text-sm text-lantern-text-secondary mt-1 capitalize">
                  {item.status.replace(/_/g, ' ')}
                </Text>
                {(item.quantity || 1) > 1 ? (
                  <Text className="text-xs text-lantern-text-tertiary mt-0.5">
                    Qty {item.quantity}
                  </Text>
                ) : null}
                <Text className="text-lantern-primary font-bold mt-2">
                  {formatPrice(Number(item.amount))}
                </Text>
              </Pressable>
              {role === 'buyer' && isPayable(item) ? (
                <View className="mt-3 pt-3 border-t border-lantern-border">
                  <Button
                    size="sm"
                    loading={payingId === item.id}
                    onPress={() => void handlePayNow(item)}
                  >
                    Pay now
                  </Button>
                </View>
              ) : null}
              {role === 'buyer' && item.status === 'completed' ? (
                <View className="mt-3 pt-3 border-t border-lantern-border">
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => handleBuyAgain(item)}
                  >
                    Buy again
                  </Button>
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
