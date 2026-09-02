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
import {
  computeMarketplaceCheckoutFees,
  MARKETPLACE_DEFAULT_SERVICE_FEE_BPS,
  koboToNaira,
  nairaToKobo,
} from '@lantern/shared/marketplace';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import { Button } from '../../components/ui';
import { formatPrice, ListingImage } from './marketplaceHelpers';
import { useMarketplaceStore } from '../../stores/marketplaceStore';
import { useMarketplacePaymentsConfig } from '../../hooks/useMarketplacePaymentsConfig';
import { ShopHeaderActions } from './components/ShopHeaderActions';
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
      const rows = await fetchMarketplaceCart();
      setItems(rows);
      // The header badge reads shopSummary.cartCount, which only refreshes on a
      // stale focus; the rows we just loaded are the truth, so push them in. Same
      // quantity-weighted reduce as fetchShopSummary so the two never disagree.
      useMarketplaceStore
        .getState()
        .setCartCount(rows.reduce((n, item) => n + Math.max(1, Number(item.quantity) || 1), 0));
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
  // The buyer pays the list price; Lantern's 5% comes out of the seller's
  // payout, so normally there is no surcharge line. The rate is read from the
  // server (default 0) so the quote stays honest if the knob is ever changed;
  // the server remains the source of truth for what Paystack charges.
  const paymentsConfig = useMarketplacePaymentsConfig();
  const serviceFeeBps = paymentsConfig?.serviceFeeBps ?? MARKETPLACE_DEFAULT_SERVICE_FEE_BPS;
  const fees = computeMarketplaceCheckoutFees(nairaToKobo(cartTotal), serviceFeeBps);
  const serviceFeeNaira = koboToNaira(fees.serviceFeeKobo);
  const payTotalNaira = koboToNaira(fees.totalChargeKobo);
  const showServiceFee = fees.serviceFeeKobo > 0;

  const handleCheckout = async () => {
    setCheckingOut(true);
    try {
      const result = await checkoutMarketplaceCart();
      // Checkout just emptied the cart and created orders; the cached summary
      // still counts both until its TTL lapses, so mark it stale now and the
      // next Shop focus refetches.
      // The cart is empty now; the badge must not keep the old count until the
      // next summary fetch lands.
      useMarketplaceStore.getState().setCartCount(0);
      useMarketplaceStore.getState().invalidateShopSummary();
      const orderCount = result?.orders?.length || 0;
      const failCount = result?.failures?.length || 0;
      const payUrl =
        result?.authorizationUrl ||
        result?.sessions?.find((s) => s?.authorizationUrl)?.authorizationUrl;
      const firstOrderId = result?.orders?.[0]?.id;

      if (payUrl) {
        if (failCount > 0) {
          Alert.alert(
            'Partial checkout',
            `${orderCount} checkout(s) started; ${failCount} item(s) failed. Opening Paystack for the first order.`
          );
        }
        await WebBrowser.openBrowserAsync(payUrl);
        if (firstOrderId) {
          navigation.navigate('OrderDetail', {
            orderId: firstOrderId,
            paymentReturn: true,
          });
        } else {
          navigation.navigate('Orders', { role: 'buyer' });
        }
        return;
      }

      if (failCount > 0) {
        Alert.alert(
          'Partial checkout',
          `${orderCount} order(s) created; ${failCount} item(s) failed.`
        );
      }
      if (orderCount === 1 && firstOrderId) {
        navigation.navigate('OrderDetail', { orderId: firstOrderId });
      } else {
        navigation.navigate('Orders', { role: 'buyer' });
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
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-lantern-text ml-2">Cart</Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} hide={['cart']} />
      </View>

      {loading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabBarClearance + 160 }}
          ListEmptyComponent={
            <View className="mt-12 items-center">
              <Text className="text-center text-lantern-text-secondary">Your cart is empty</Text>
              {/* An empty cart is a dead end without a way back into the shop. */}
              <Button
                variant="secondary"
                className="mt-4"
                onPress={() => navigation.navigate('MarketplaceHome')}
              >
                Continue shopping
              </Button>
              <Pressable
                onPress={() => navigation.navigate('Favorites')}
                accessibilityRole="link"
                hitSlop={8}
                className="mt-3"
              >
                <Text className="text-sm font-semibold text-lantern-primary">See your Saved items</Text>
              </Pressable>
            </View>
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
                  className="flex-row gap-3"
                >
                  {/* ListingImage falls back to the bag icon when the listing has no photo. */}
                  <ListingImage uri={item.listing?.images?.[0]} className="w-16 h-16 rounded-lg" />
                  <View className="flex-1">
                    <Text className="font-semibold text-lantern-text" numberOfLines={2}>
                      {item.listing?.title || 'Listing'}
                    </Text>
                    <Text className="text-lantern-primary font-bold mt-1">
                      {formatPrice(lineTotal(item))}
                    </Text>
                  </View>
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
          <View className="flex-row justify-between mb-1">
            <Text className="text-lantern-text-secondary">Items</Text>
            <Text className="text-lantern-text">{formatPrice(cartTotal)}</Text>
          </View>
          {showServiceFee ? (
            <View className="flex-row justify-between mb-1">
              <Text className="text-lantern-text-secondary">
                Service charge ({serviceFeeBps / 100}%)
              </Text>
              <Text className="text-lantern-text">{formatPrice(serviceFeeNaira)}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-between mb-2">
            <Text className="font-medium text-lantern-text">You pay</Text>
            <Text className="font-bold text-lantern-primary">{formatPrice(payTotalNaira)}</Text>
          </View>
          <Text className="text-xs text-lantern-text-tertiary mb-3">
            One Paystack charge per listing. Multi-item carts open the first payment; finish the rest
            from Orders.
          </Text>
          <Button loading={checkingOut} onPress={() => void handleCheckout()}>
            Pay with Paystack
          </Button>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
