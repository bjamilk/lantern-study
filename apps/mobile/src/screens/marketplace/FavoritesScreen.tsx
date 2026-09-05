import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore, useMarketplaceStore } from '../../stores';
import { Button } from '../../components/ui';
import { formatPrice, isOwnListing, ListingImage } from './marketplaceHelpers';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { getFavoritePriceSnapshots } from './marketplaceFavoritePrices';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function FavoritesScreen({ navigation }: { navigation: NavigationProp }) {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const { user } = useAuthStore();
  const { favoriteListings, favorites, listings, fetchServerFavorites, toggleFavorite, addToCart } =
    useMarketplaceStore();

  const [priceSnapshots, setPriceSnapshots] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    await fetchServerFavorites();
    setPriceSnapshots(await getFavoritePriceSnapshots());
  }, [fetchServerFavorites]);

  useEffect(() => {
    void load();
  }, [load]);

  const items =
    favoriteListings.length > 0
      ? favoriteListings
      : listings.filter(l => favorites.has(l.id));

  const handleAddToCart = (listingId: string) => {
    void addToCart(listingId, 1)
      .then(() =>
        // Alert, not toast: showToast(message, type?) has no action slot, so a
        // toast cannot offer "View cart" (same call as ListingDetail).
        Alert.alert('Added to cart', 'Item added to cart.', [
          { text: 'Keep shopping', style: 'cancel' },
          { text: 'View cart', onPress: () => navigation.navigate('Cart') },
        ])
      )
      .catch((err: unknown) =>
        Alert.alert('Error', err instanceof Error ? err.message : 'Could not add to cart')
      );
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable hitSlop={10}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="p-2 -ml-2 mr-1"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-lantern-text">Saved Items</Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance }}
        ListEmptyComponent={
          <Text className="text-center text-lantern-text-secondary mt-12">
            No saved listings yet. Tap the heart on any listing to save it.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
            className="flex-row mb-3 rounded-2xl overflow-hidden bg-lantern-surface border border-lantern-border"
          >
            <ListingImage uri={item.images?.[0]} className="w-24 h-24" />
            <View className="flex-1 p-3 justify-center">
              <Text className="text-sm font-semibold text-lantern-text" numberOfLines={2}>
                {item.title}
              </Text>
              {(() => {
                // Flag listings whose price fell since the user saved them.
                const seen = priceSnapshots[item.id];
                const current = item.effective_price ?? item.price;
                const dropped =
                  typeof seen === 'number' && typeof current === 'number' && current < seen;
                return (
                  <View className="flex-row items-center gap-2 mt-1">
                    <Text className="text-sm font-bold text-lantern-primary">
                      {formatPrice(current ?? item.price)}
                    </Text>
                    {dropped ? (
                      <View className="px-1.5 py-0.5 rounded-md bg-lantern-success-background">
                        <Text className="text-[10px] font-semibold text-lantern-success">
                          Price drop · was {formatPrice(seen)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })()}
              {(() => {
                // Amazon's Lists -> Add to Cart. A saved listing can go stale under
                // the user, so say why instead of hiding the button.
                if (typeof item.price !== 'number') return null;
                const own = isOwnListing(item, user?.id);
                const reason = own
                  ? 'This is your listing'
                  : item.status !== 'active'
                    ? 'No longer available'
                    : item.quantity != null && Number(item.quantity) <= 0
                      ? 'Sold out'
                      : null;
                return (
                  <View className="mt-2 flex-row items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={reason != null}
                      accessibilityLabel={reason ? `Add to cart, unavailable: ${reason}` : 'Add to cart'}
                      onPress={() => handleAddToCart(item.id)}
                    >
                      Add to cart
                    </Button>
                    {reason ? (
                      <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>
                        {reason}
                      </Text>
                    ) : null}
                  </View>
                );
              })()}
            </View>
            {user?.id ? (
              <Pressable
                onPress={() => void toggleFavorite(item.id, user.id)}
                accessibilityRole="button"
                accessibilityLabel="Remove from favorites"
                className="justify-center pr-3"
              >
                <AppIcon name="heart" size={20} color="#ef4444" />
              </Pressable>
            ) : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
