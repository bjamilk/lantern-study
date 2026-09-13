import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MarketplaceCartItem } from '@lantern/shared/types';
import { groupCartItems } from '@lantern/shared/marketplace';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import {
  fetchMarketplaceCart,
  removeMarketplaceCartItem,
  updateMarketplaceCartItem,
} from '../../services/api';
import { Button } from '../../components/ui';
import { formatPrice, ListingImage } from './marketplaceHelpers';
import { useMarketplaceStore } from '../../stores/marketplaceStore';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function CartScreen({ navigation }: { navigation: NavigationProp }) {
  const tabBarClearance = useTabBarClearance(16);
  const [items, setItems] = useState<MarketplaceCartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchMarketplaceCart();
      setItems(rows);
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

  const groups = useMemo(() => groupCartItems(items), [items]);
  const cartTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-title text-lantern-text ml-2">Cart</Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} hide={['cart']} />
      </View>

      {loading ? (
        <ActivityIndicator className="mt-8" />
      ) : items.length === 0 ? (
        <View className="mt-12 items-center px-6">
          <Text className="text-center text-body text-lantern-text-secondary">Your cart is empty</Text>
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
            <Text className="text-caption font-semibold text-lantern-feature-groups-ink">See your Saved items</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance + 160, gap: 16 }}
        >
          {groups.map((group) => (
            <View key={group.sellerId} className="gap-3">
              <Text className="text-caption text-lantern-text-secondary">
                Seller · {formatPrice(group.itemTotalNaira)}
              </Text>
              {group.lines.map(({ source: item }) => {
                const stock = item.listing?.quantity;
                const maxQty = stock == null ? 1 : Math.max(1, Number(stock));
                return (
                  <View key={item.id} className="p-4 rounded-xl bg-lantern-surface border border-lantern-border">
                    <Pressable
                      onPress={() => navigation.navigate('ListingDetail', { listingId: item.listing_id })}
                      className="flex-row gap-3"
                    >
                      <ListingImage uri={item.listing?.images?.[0]} className="w-16 h-16 rounded-lg" />
                      <View className="flex-1">
                        <Text className="text-body font-semibold text-lantern-text" numberOfLines={2}>
                          {item.listing?.title || 'Listing'}
                        </Text>
                        <Text className="text-body font-bold text-lantern-feature-groups-ink mt-1">
                          {formatPrice(lineTotal(item))}
                        </Text>
                      </View>
                    </Pressable>
                    <View className="flex-row items-center justify-between mt-3">
                      {stock != null ? (
                        <View className="flex-row items-center rounded-lg border border-lantern-border overflow-hidden">
                          <Pressable
                            className="px-3 py-2 min-h-[44px] justify-center"
                            onPress={() =>
                              void updateMarketplaceCartItem(item.listing_id, item.quantity - 1).then(load)
                            }
                          >
                            <Text className="text-body text-lantern-text">−</Text>
                          </Pressable>
                          <Text className="px-3 py-2 text-body font-semibold text-lantern-text">
                            {item.quantity}
                          </Text>
                          <Pressable
                            className="px-3 py-2 min-h-[44px] justify-center"
                            disabled={item.quantity >= maxQty}
                            onPress={() =>
                              void updateMarketplaceCartItem(item.listing_id, item.quantity + 1).then(load)
                            }
                          >
                            <Text className="text-body text-lantern-text">+</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text className="text-caption text-lantern-text-secondary">Qty 1</Text>
                      )}
                      <Pressable
                        onPress={() => void removeMarketplaceCartItem(item.listing_id).then(load)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.listing?.title ?? 'item'} from cart`}
                        className="p-2 min-h-[44px] min-w-[44px] items-center justify-center"
                      >
                        <AppIcon name="trash" size={20} color="#ef4444" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {items.length > 0 ? (
        <View
          className="absolute bottom-0 left-0 right-0 px-4 pt-3 bg-lantern-surface border-t border-lantern-border"
          style={{ paddingBottom: tabBarClearance }}
        >
          <View className="flex-row justify-between mb-2">
            <Text className="text-body text-lantern-text">Items</Text>
            <Text className="text-body font-bold text-lantern-text">{formatPrice(cartTotal)}</Text>
          </View>
          <Text className="text-caption text-lantern-text-tertiary mb-3">
            Choose meetup, dropoff, or shipping next. One Paystack charge. Cart stays until you pay.
          </Text>
          <Button onPress={() => navigation.navigate('Checkout')}>
            Continue to checkout
          </Button>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
