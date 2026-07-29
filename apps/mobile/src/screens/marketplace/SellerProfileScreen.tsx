import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore, useMarketplaceStore, type MarketplaceListing } from '../../stores';
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
  const { user } = useAuthStore();
  const { sellerProfile, fetchSellerProfile, updateMyShop, isLoading } = useMarketplaceStore();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shopName, setShopName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const isOwner = !!user?.id && user.id === sellerId;

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
  const displayName = profile?.shopName || profile?.name || 'Shop';

  const openEdit = () => {
    setShopName(displayName);
    setBio(profile?.shopBio || '');
    setEditOpen(true);
  };

  const saveShop = async () => {
    const trimmed = shopName.trim();
    if (!trimmed) {
      Alert.alert('Shop name required');
      return;
    }
    setSaving(true);
    try {
      await updateMyShop({ shopName: trimmed, bio: bio.trim() || null });
      setEditOpen(false);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save shop');
    } finally {
      setSaving(false);
    }
  };

  const shareShop = async () => {
    try {
      await Share.share({
        message: `Check out ${displayName} on Lantern: https://lanternstudy.com/marketplace/seller/${sellerId}`,
      });
    } catch {
      /* cancelled */
    }
  };

  if (isLoading && !profile) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center" edges={['top']}>
        <ActivityIndicator size="large" color="#6366f1" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      {profile?.coverImageUrl ? (
        <View className="h-28 bg-indigo-700">
          <ListingImage uri={profile.coverImageUrl} className="w-full h-full" />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.45)']}
            className="absolute inset-0"
          />
        </View>
      ) : (
        <LinearGradient colors={['#4f46e5', '#6366f1', '#059669']} className="h-28" />
      )}

      <View className="px-4 -mt-10">
        <View className="flex-row items-center justify-between mb-2">
          <Pressable
            onPress={() => navigation.goBack()}
            className="flex-row items-center gap-1 px-2 py-1.5 rounded-lg bg-black/30"
          >
            <Ionicons name="arrow-back" size={18} color="#f8fafc" />
            <Text className="text-sm font-medium text-white/90">Back</Text>
          </Pressable>
          <View className="flex-row gap-2">
            {isOwner ? (
              <Pressable onPress={openEdit} className="px-2.5 py-1.5 rounded-lg bg-black/30">
                <Text className="text-xs font-semibold text-white">Edit</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => void shareShop()} className="px-2.5 py-1.5 rounded-lg bg-black/30">
              <Text className="text-xs font-semibold text-white">Share</Text>
            </Pressable>
          </View>
        </View>

        <View className="flex-row items-end gap-3">
          <Avatar name={displayName} size={64} />
          <View className="flex-1 pb-1">
            <Text className="text-xl font-bold text-lantern-text" numberOfLines={1}>
              {displayName}
            </Text>
            {profile?.shopName && profile.shopName !== profile.name ? (
              <Text className="text-xs text-lantern-text-secondary">by {profile.name}</Text>
            ) : null}
          </View>
        </View>

        {profile?.average_rating != null && profile.average_rating > 0 ? (
          <View className="flex-row items-center gap-1 mt-2">
            <Ionicons name="star" size={14} color="#fbbf24" />
            <Text className="text-sm text-lantern-text-secondary">
              {profile.average_rating.toFixed(1)}
              {profile.review_count ? ` (${profile.review_count})` : ''}
            </Text>
          </View>
        ) : (
          <Text className="text-sm text-lantern-text-secondary mt-2">No ratings yet</Text>
        )}
        {profile?.shopBio ? (
          <Text className="text-sm text-lantern-text-secondary mt-2 leading-5">{profile.shopBio}</Text>
        ) : null}

        <View className="flex-row mt-3 gap-3 mb-2">
          {[
            { label: 'Active', value: profile?.active_listings ?? 0 },
            { label: 'Sold', value: profile?.sold_listings ?? 0 },
            { label: 'Reviews', value: profile?.review_count ?? 0 },
          ].map(stat => (
            <View key={stat.label} className="flex-1 bg-lantern-surface border border-lantern-border rounded-xl p-3 items-center">
              <Text className="text-lg font-bold text-lantern-text">{stat.value}</Text>
              <Text className="text-xs text-lantern-text-secondary">{stat.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text className="text-sm font-semibold text-lantern-text px-4 pt-2 pb-2">Listings</Text>

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

      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => setEditOpen(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-lantern-surface rounded-t-2xl p-4 border-t border-lantern-border">
            <Text className="text-base font-bold text-lantern-text mb-3">Edit shop</Text>
            <Text className="text-xs font-semibold text-lantern-text-secondary mb-1">Shop name</Text>
            <TextInput
              value={shopName}
              onChangeText={setShopName}
              maxLength={80}
              className="p-3 rounded-xl border border-lantern-border text-lantern-text mb-3"
            />
            <Text className="text-xs font-semibold text-lantern-text-secondary mb-1">Bio</Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              maxLength={500}
              multiline
              className="p-3 rounded-xl border border-lantern-border text-lantern-text mb-4 min-h-[80px]"
            />
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setEditOpen(false)}
                className="flex-1 py-3 rounded-xl border border-lantern-border items-center"
              >
                <Text className="font-semibold text-lantern-text-secondary">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveShop()}
                disabled={saving}
                className="flex-1 py-3 rounded-xl bg-lantern-primary items-center"
              >
                <Text className="font-semibold text-white">{saving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
