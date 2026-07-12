import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  useMarketplaceStore,
  useAuthStore,
  ACADEMIC_CATEGORIES,
  STUDENT_LIFE_CATEGORIES,
  getCategoryInfo,
  type MarketplaceListing,
  type MarketplaceCategory,
} from '../../stores';
import { fetchMarketplaceListing } from '../../services/api';
import { uploadMarketplaceImage } from '../../services/marketplaceImageUpload';
import { Button } from '../../components/ui';
import { categoryIcon, formatPrice, isOwnListing, ListingImage } from './marketplaceHelpers';
import { getRecentlyViewedListingIds } from './marketplaceRecentlyViewed';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

const MAX_IMAGES = 5;

export function CreateListingScreen({ navigation }: { navigation: NavigationProp & { goBack: () => void } }) {
  const { user } = useAuthStore();
  const { createListing, isLoading } = useMarketplaceStore();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('textbook_exchange');
  const [price, setPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleEndsPreset, setSaleEndsPreset] = useState<'none' | '24h' | '7d'>('none');
  const [promoLabel, setPromoLabel] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const ALL_CATEGORIES = [...ACADEMIC_CATEGORIES, ...STUDENT_LIFE_CATEGORIES];
  const selectedCategory = ALL_CATEGORIES.find(c => c.id === category);

  const pickImages = async () => {
    if (images.length >= MAX_IMAGES) {
      Alert.alert('Limit reached', `Maximum ${MAX_IMAGES} images allowed.`);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Photo library access is needed.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: MAX_IMAGES - images.length,
    });
    if (result.canceled) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const asset of result.assets) {
        const { url } = await uploadMarketplaceImage(asset.uri, asset.mimeType);
        uploaded.push(url);
      }
      setImages(prev => [...prev, ...uploaded].slice(0, MAX_IMAGES));
    } catch (e: unknown) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload images');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in to create a listing.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a title for your listing.');
      return;
    }
    const parsedPrice = price.trim() ? parseFloat(price.replace(/,/g, '')) : undefined;
    if (price.trim() && (!parsedPrice || parsedPrice < 0)) {
      Alert.alert('Invalid price', 'Please enter a valid price.');
      return;
    }
    try {
      const saleEndsAt =
        saleEndsPreset === 'none'
          ? undefined
          : new Date(
              Date.now() + (saleEndsPreset === '24h' ? 24 : 168) * 60 * 60 * 1000
            ).toISOString();
      const parsedSalePrice = salePrice.trim() ? parseFloat(salePrice.replace(/,/g, '')) : undefined;
      const parsedQuantity = quantity.trim() ? parseInt(quantity, 10) : undefined;
      const listing = await createListing(
        {
          user_id: user.id,
          category,
          title: title.trim(),
          description: description.trim() || undefined,
          price: parsedPrice,
          sale_price: parsedSalePrice,
          sale_ends_at: parsedSalePrice ? saleEndsAt : undefined,
          promo_label: promoLabel.trim() || undefined,
          location: location.trim() || undefined,
          quantity: parsedQuantity,
          images,
          status: 'active',
        } as Omit<MarketplaceListing, 'id' | 'created_at' | 'updated_at' | 'views_count' | 'favorites_count'>,
        user.id
      );
      Alert.alert('Listing created', 'Your listing is now live.');
      navigation.navigate('ListingDetail', { listingId: listing.id });
    } catch {
      Alert.alert('Error', 'Failed to create listing. Please try again.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold text-lantern-text">Create Listing</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        <Text className="text-sm font-semibold text-lantern-text mb-2">Photos</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
          {images.map((uri, i) => (
            <View key={`${uri}-${i}`} className="mr-2 relative">
              <Image source={{ uri }} className="w-20 h-20 rounded-xl" />
              <Pressable
                onPress={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5"
              >
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
          {images.length < MAX_IMAGES ? (
            <Pressable
              onPress={pickImages}
              className="w-20 h-20 rounded-xl border border-dashed border-lantern-border items-center justify-center"
            >
              {uploading ? (
                <Text className="text-xs text-lantern-text-secondary">…</Text>
              ) : (
                <Ionicons name="add" size={24} color="#64748b" />
              )}
            </Pressable>
          ) : null}
        </ScrollView>

        <Text className="text-sm font-semibold text-lantern-text mb-2">Title *</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What are you selling?"
          placeholderTextColor="#94a3b8"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
        />

        <Text className="text-sm font-semibold text-lantern-text mb-2">Category *</Text>
        <Pressable
          onPress={() => setShowCategories(v => !v)}
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface mb-2 flex-row items-center justify-between"
        >
          <Text className="text-lantern-text">{selectedCategory?.name ?? 'Select category'}</Text>
          <Ionicons name={showCategories ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
        </Pressable>
        {showCategories ? (
          <View className="flex-row flex-wrap gap-2 mb-4">
            {ALL_CATEGORIES.map(cat => (
              <Pressable
                key={cat.id}
                onPress={() => {
                  setCategory(cat.id);
                  setShowCategories(false);
                }}
                className={`px-3 py-1.5 rounded-full border ${
                  category === cat.id ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                }`}
              >
                <Text className={`text-xs font-medium ${category === cat.id ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  {cat.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="mb-4" />
        )}

        <Text className="text-sm font-semibold text-lantern-text mb-2">Price (₦)</Text>
        <TextInput
          value={price}
          onChangeText={setPrice}
          placeholder="Leave empty for free"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
        />

        <Text className="text-sm font-semibold text-lantern-text mb-2">Quantity in stock (optional)</Text>
        <TextInput
          value={quantity}
          onChangeText={setQuantity}
          placeholder="Leave empty for unlimited"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
        />

        <Text className="text-sm font-semibold text-lantern-text mb-2">Promotion (optional)</Text>
        <TextInput
          value={salePrice}
          onChangeText={setSalePrice}
          placeholder="Sale price (₦)"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-2"
        />
        <View className="flex-row gap-2 mb-2">
          {(['none', '24h', '7d'] as const).map(preset => (
            <Pressable
              key={preset}
              onPress={() => setSaleEndsPreset(preset)}
              className={`px-3 py-1.5 rounded-lg border ${
                saleEndsPreset === preset ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
              }`}
            >
              <Text className={`text-xs font-medium ${saleEndsPreset === preset ? 'text-white' : 'text-lantern-text-secondary'}`}>
                {preset === 'none' ? 'No sale' : preset === '24h' ? '24 hours' : '7 days'}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={promoLabel}
          onChangeText={setPromoLabel}
          placeholder="Promo label (e.g. Exam week)"
          placeholderTextColor="#94a3b8"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
        />

        <Text className="text-sm font-semibold text-lantern-text mb-2">Location</Text>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="Campus or city"
          placeholderTextColor="#94a3b8"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
        />

        <Text className="text-sm font-semibold text-lantern-text mb-2">Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Describe your item…"
          placeholderTextColor="#94a3b8"
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          className="min-h-[120px] p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-6"
        />

        <Button fullWidth loading={isLoading || uploading} onPress={handleSubmit}>
          Publish Listing
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
