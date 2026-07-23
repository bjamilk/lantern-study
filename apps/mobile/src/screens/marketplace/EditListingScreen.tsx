import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  useMarketplaceStore,
  useAuthStore,
  ACADEMIC_CATEGORIES,
  STUDENT_LIFE_CATEGORIES,
  type MarketplaceCategory,
} from '../../stores';
import { Button } from '../../components/ui';
import { uploadMarketplaceImage } from '../../services/marketplaceImageUpload';

type NavigationProp = {
  goBack: () => void;
};

const ALL_CATEGORIES = [...ACADEMIC_CATEGORIES, ...STUDENT_LIFE_CATEGORIES];
const MAX_IMAGES = 5;

export function EditListingScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params?: { listingId?: string } };
}) {
  const listingId = route.params?.listingId ?? '';
  const { user } = useAuthStore();
  const { currentListing, fetchListing, updateListing, isLoading } = useMarketplaceStore();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('textbook_exchange');
  const [price, setPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleEndsPreset, setSaleEndsPreset] = useState<'none' | '24h' | '7d'>('none');
  const [promoLabel, setPromoLabel] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  useEffect(() => {
    if (listingId) void fetchListing(listingId);
  }, [listingId, fetchListing]);

  useEffect(() => {
    if (!currentListing || currentListing.id !== listingId) return;
    setTitle(currentListing.title);
    setCategory(currentListing.category as MarketplaceCategory);
    setPrice(currentListing.price != null ? String(currentListing.price) : '');
    setSalePrice(currentListing.sale_price != null ? String(currentListing.sale_price) : '');
    setPromoLabel(currentListing.promo_label || '');
    setSaleEndsPreset(currentListing.sale_ends_at ? '7d' : 'none');
    setDescription(currentListing.description || '');
    setLocation(currentListing.location || '');
    setImages(currentListing.images || []);
    setQuantity(currentListing.quantity != null ? String(currentListing.quantity) : '');
  }, [currentListing, listingId]);

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
      quality: 0.7,
      base64: true,
      exif: false,
      selectionLimit: MAX_IMAGES - images.length,
    });
    if (result.canceled) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const asset of result.assets) {
        const resultUpload = await uploadMarketplaceImage(
          asset.uri,
          asset.mimeType || 'image/jpeg',
          listingId,
          asset.base64
        );
        uploaded.push(resultUpload.storageUrl || resultUpload.path || resultUpload.url);
      }
      setImages(prev => [...prev, ...uploaded].slice(0, MAX_IMAGES));
    } catch (e: unknown) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload images');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!user?.id || !listingId) return;
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a title.');
      return;
    }
    const parsedPrice = price.trim() ? parseFloat(price.replace(/,/g, '')) : undefined;
    const parsedSalePrice = salePrice.trim() ? parseFloat(salePrice.replace(/,/g, '')) : undefined;
    const saleEndsAt =
      saleEndsPreset === 'none' || !parsedSalePrice
        ? undefined
        : new Date(
            Date.now() + (saleEndsPreset === '24h' ? 24 : 168) * 60 * 60 * 1000
          ).toISOString();
    const parsedQuantity = quantity.trim() ? parseInt(quantity, 10) : undefined;
    try {
      await updateListing(
        listingId,
        {
          title: title.trim(),
          category,
          description: description.trim() || undefined,
          price: parsedPrice,
          sale_price: parsedSalePrice,
          sale_ends_at: saleEndsAt,
          promo_label: promoLabel.trim() || undefined,
          location: location.trim() || undefined,
          quantity: parsedQuantity,
          images,
        },
        user.id
      );
      Alert.alert('Saved', 'Listing updated.');
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Failed to update listing.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="px-4 pt-2 pb-3 flex-row items-center">
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
            <Ionicons name="arrow-back" size={22} color="#64748b" />
          </Pressable>
          <Text className="text-xl font-bold text-lantern-text">Edit Listing</Text>
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
            className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
          />

          <Text className="text-sm font-semibold text-lantern-text mb-2">Category</Text>
          <Pressable
            onPress={() => setShowCategories(v => !v)}
            className="p-3 rounded-xl border border-lantern-border bg-lantern-surface mb-2 flex-row items-center justify-between"
          >
            <Text className="text-lantern-text">{selectedCategory?.name ?? category}</Text>
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
                  <Text className={`text-xs ${category === cat.id ? 'text-white' : 'text-lantern-text-secondary'}`}>
                    {cat.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View className="mb-4" />
          )}

          <Text className="text-sm font-semibold text-lantern-text mb-2">Asking price (₦)</Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="What buyers normally pay"
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

          <Text className="text-sm font-semibold text-lantern-text mb-1">Promotion (optional)</Text>
          <Text className="text-xs text-lantern-text-secondary mb-2">
            Discounted price is a temporary markdown for a sale badge — not your cost or profit.
          </Text>
          <TextInput
            value={salePrice}
            onChangeText={setSalePrice}
            placeholder="Discounted price (₦) — must be lower than asking"
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
            className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
          />

          <Text className="text-sm font-semibold text-lantern-text mb-2">Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
            className="min-h-[120px] p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-6"
          />

          <Button fullWidth loading={isLoading || uploading} onPress={handleSubmit}>
            Save changes
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
