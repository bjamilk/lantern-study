import React, { useCallback, useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useMarketplaceStore } from '../../stores';
import { formatPrice, ListingImage } from './marketplaceHelpers';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function FavoritesScreen({ navigation }: { navigation: NavigationProp }) {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const { user } = useAuthStore();
  const { favoriteListings, favorites, listings, fetchServerFavorites, toggleFavorite } = useMarketplaceStore();

  const load = useCallback(async () => {
    await fetchServerFavorites();
  }, [fetchServerFavorites]);

  useEffect(() => {
    void load();
  }, [load]);

  const items =
    favoriteListings.length > 0
      ? favoriteListings
      : listings.filter(l => favorites.has(l.id));

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="p-2 -ml-2 mr-1"
        >
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold text-lantern-text">Saved Listings</Text>
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
              <Text className="text-sm font-bold text-lantern-primary mt-1">{formatPrice(item.price)}</Text>
            </View>
            {user?.id ? (
              <Pressable
                onPress={() => void toggleFavorite(item.id, user.id)}
                accessibilityRole="button"
                accessibilityLabel="Remove from favorites"
                className="justify-center pr-3"
              >
                <Ionicons name="heart" size={20} color="#ef4444" />
              </Pressable>
            ) : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
