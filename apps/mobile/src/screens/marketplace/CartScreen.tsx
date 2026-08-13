import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  checkoutMarketplaceCart,
  fetchMarketplaceCart,
  removeMarketplaceCartItem,
  updateMarketplaceCartItem,
} from '../../services/api';
import type { MarketplaceCartItem } from '@lantern/shared/types';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import { Button } from '../../components/ui';
import { formatPrice } from './marketplaceHelpers';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function CartScreen({ navigation }: { navigation: NavigationProp }) {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const [items, setItems] = useState<MarketplaceCartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchMarketplaceCart());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lineTotal = (item: MarketplaceCartItem) => {
    if (!item.listing) return 0;
    return resolveListingDisplayPrice(item.listing).effective * item.quantity;
  };

  const cartTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);

  const handleCheckout = async () => {
    setCheckingOut(true);
    try {
      const result = await checkoutMarketplaceCart();
      const orderCount = result?.orders?.length || 0;
      const failCount = result?.failures?.length || 0;
      const firstOrderId = result?.orders?.[0]?.id;

      if (failCount > 0) {
        Alert.alert(
          'Partial checkout',
          `${orderCount} order(s) created; ${failCount} item(s) failed.`
        );
      }
      if (orderCount === 1 && firstOrderId) {
        navigation.navigate('OrderDetail', { orderId: firstOrderId });
      } else {
        navigation.navigate('Orders');
      }
    } catch (e: unknown) {
      Alert.alert('Checkout failed', e instanceof Error ? e.message : 'Try again');
      await load();
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold text-lantern-text ml-2">Cart</Text>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabBarClearance + 160 }}
          ListEmptyComponent={
            <Text className="text-center text-lantern-text-secondary mt-12">
              Your cart is empty
            </Text>
          }
          renderItem={({ item }) => {
            const stock = item.listing?.quantity;
            const maxQty = stock == null ? 1 : Math.max(1, Number(stock));
            return (
              <View className="p-4 rounded-xl bg-lantern-surface border border-lantern-border">
                <Pressable
                  onPress={() =>
                    navigation.navigate('ListingDetail', { listingId: item.listing_id })
                  }
                >
                  <Text className="font-semibold text-lantern-text" numberOfLines={2}>
                    {item.listing?.title || 'Listing'}
                  </Text>
                  <Text className="text-lantern-primary font-bold mt-1">
                    {formatPrice(lineTotal(item))}
                  </Text>
                </Pressable>
                <View className="flex-row items-center justify-between mt-3">
                  {stock != null ? (
                    <View className="flex-row items-center rounded-lg border border-lantern-border overflow-hidden">
                      <Pressable
                        className="px-3 py-2"
                        onPress={() =>
                          void updateMarketplaceCartItem(item.listing_id, item.quantity - 1).then(
                            load
                          )
                        }
                      >
                        <Text className="text-lantern-text">−</Text>
                      </Pressable>
                      <Text className="px-3 py-2 font-semibold text-lantern-text">
                        {item.quantity}
                      </Text>
                      <Pressable
                        className="px-3 py-2"
                        disabled={item.quantity >= maxQty}
                        onPress={() =>
                          void updateMarketplaceCartItem(item.listing_id, item.quantity + 1).then(
                            load
                          )
                        }
                      >
                        <Text className="text-lantern-text">+</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text className="text-xs text-lantern-text-secondary">Qty 1</Text>
                  )}
                  <Pressable
                    onPress={() =>
                      void removeMarketplaceCartItem(item.listing_id).then(load)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.listing?.title ?? 'item'} from cart`}
                    className="p-2"
                  >
                    <Ionicons name="trash-outline" size={20} color="#ef4444" />
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      {items.length > 0 ? (
        <View className="absolute bottom-0 left-0 right-0 px-4 pt-3 bg-lantern-surface border-t border-lantern-border"
          // pb-8 left the Pay button underneath the tab bar, which swallowed the tap.
          style={{ paddingBottom: tabBarClearance }}>
          <View className="flex-row justify-between mb-2">
            <Text className="font-medium text-lantern-text">Total</Text>
            <Text className="font-bold text-lantern-primary">{formatPrice(cartTotal)}</Text>
          </View>
          <Text className="text-xs text-lantern-text-tertiary mb-3">
            Placing the order notifies the seller (one order per seller). You pay the seller
            directly — Lantern does not process the payment or hold your money.
          </Text>
          <Button loading={checkingOut} onPress={() => void handleCheckout()}>
            Place order
          </Button>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
