import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMarketplaceStore, type MarketplaceListing } from '../../stores';
import * as api from '../../services/api';
import { Avatar } from '../../components/ui';
import { formatPrice, ListingImage } from './marketplaceHelpers';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { sellerId?: string } };
}

export function SellerProfileScreen({ navigation, route }: Props) {
  const sellerId = route.params?.sellerId ?? '';
  const { sellerProfile, fetchSellerProfile, isLoading } = useMarketplaceStore();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadListings = useCallback(async () => {
    if (!sellerId) return;
    setLoadingListings(true);
    try {
      const response = await api.fetchMarketplaceListings();
      const raw = Array.isArray(response) ? response : response.data;
      const mapped: MarketplaceListing[] = raw
        .filter((l: { user_id: string }) => l.user_id === sellerId)
        .map((l: {
          id: string;
          user_id: string;
          category: string;
          title: string;
          description?: string;
          price?: number;
          location?: string;
          images?: string[];
          status: 'active' | 'sold' | 'inactive';
          created_at: string;
          updated_at: string;
        }) => ({
          id: l.id,
          user_id: l.user_id,
          seller_id: l.user_id,
          category: l.category,
          title: l.title,
          description: l.description,
          price: l.price,
          location: l.location,
          images: l.images || [],
          status: l.status,
          created_at: l.created_at,
          updated_at: l.updated_at,
        }));
      setListings(mapped.filter(l => l.status === 'active'));
    } catch {
      setListings([]);
    } finally {
      setLoadingListings(false);
    }
  }, [sellerId]);

  const load = useCallback(async () => {
    if (sellerId) {
      await fetchSellerProfile(sellerId);
      await loadListings();
    }
  }, [sellerId, fetchSellerProfile, loadListings]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const profile = sellerProfile;

  if (isLoading && !profile) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center" edges={['top']}>
        <ActivityIndicator size="large" color="#6366f1" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <LinearGradient colors={['#4f46e5', '#6366f1', '#7c3aed']} className="px-4 pt-2 pb-5">
        <Pressable onPress={() => navigation.goBack()} className="flex-row items-center gap-1 mb-4">
          <Ionicons name="arrow-back" size={18} color="#e0e7ff" />
          <Text className="text-sm font-medium text-lantern-primary-light">Back</Text>
        </Pressable>

        <View className="flex-row items-center gap-4">
          <Avatar name={profile?.name} size={64} />
          <View className="flex-1">
            <Text className="text-xl font-bold text-white" numberOfLines={1}>
              {profile?.name ?? 'Seller'}
            </Text>
            {profile?.average_rating != null && profile.average_rating > 0 ? (
              <View className="flex-row items-center gap-1 mt-1">
                <Ionicons name="star" size={14} color="#fbbf24" />
                <Text className="text-sm text-lantern-primary-light">
                  {profile.average_rating.toFixed(1)}
                  {profile.review_count ? ` (${profile.review_count} reviews)` : ''}
                </Text>
              </View>
            ) : (
              <Text className="text-sm text-lantern-primary-light mt-1">No ratings yet</Text>
            )}
          </View>
        </View>

        <View className="flex-row mt-4 gap-3">
          {[
            { label: 'Active', value: profile?.active_listings ?? 0 },
            { label: 'Sold', value: profile?.sold_listings ?? 0 },
            { label: 'Total', value: profile?.total_listings ?? 0 },
          ].map(stat => (
            <View key={stat.label} className="flex-1 bg-lantern-surface/15 rounded-xl p-3 items-center">
              <Text className="text-lg font-bold text-white">{stat.value}</Text>
              <Text className="text-xs text-lantern-primary-light">{stat.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <Text className="text-sm font-semibold text-lantern-text px-4 pt-4 pb-2">
        Listings
      </Text>

      {loadingListings && !listings.length ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 8, paddingBottom: 24 }}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Ionicons name="bag-outline" size={40} color="#cbd5e1" />
              <Text className="text-sm text-lantern-text-secondary mt-3">No active listings</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
              className="flex-1 m-1.5 rounded-2xl overflow-hidden bg-lantern-surface border border-lantern-border"
            >
              <View className="aspect-[4/3]">
                <ListingImage uri={item.images?.[0]} className="w-full h-full" />
              </View>
              <View className="p-2.5">
                <Text className="text-sm font-semibold text-lantern-text" numberOfLines={2}>
                  {item.title}
                </Text>
                <Text className="text-sm font-bold text-lantern-primary mt-1">
                  {formatPrice(item.price)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
