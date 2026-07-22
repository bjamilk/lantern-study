import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useMarketplaceStore,
  useAuthStore,
  ACADEMIC_CATEGORIES,
  STUDENT_LIFE_CATEGORIES,
  type MarketplaceListing,
  type MarketplaceCategory,
} from '../../stores';
import { fetchMarketplaceCampuses } from '../../services/api';
import { aiGenerateListingDescription } from '../../services/ai';
import { uploadMarketplaceImage } from '../../services/marketplaceImageUpload';
import { Button } from '../../components/ui';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

const MAX_IMAGES = 5;

type Campus = { id: string; name: string; city: string; state: string };

interface ListingDraft {
  title: string;
  category: MarketplaceCategory;
  price: string;
  salePrice: string;
  saleEndsPreset: 'none' | '24h' | '7d';
  promoLabel: string;
  description: string;
  location: string;
  quantity: string;
  campusId: string;
  images: string[];
  savedAt: number;
}

function draftStorageKey(userId?: string | null): string {
  return `lantern_listing_draft_${userId ?? 'anonymous'}`;
}

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
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusId, setCampusId] = useState('');
  const [campusQuery, setCampusQuery] = useState('');
  const [showCampuses, setShowCampuses] = useState(false);

  // Draft persistence: survive app switches / process death mid-creation.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftKey = draftStorageKey(user?.id);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ALL_CATEGORIES = [...ACADEMIC_CATEGORIES, ...STUDENT_LIFE_CATEGORIES];
  const selectedCategory = ALL_CATEGORIES.find(c => c.id === category);
  const selectedCampus = campuses.find(c => c.id === campusId);

  useEffect(() => {
    fetchMarketplaceCampuses('NG')
      .then(rows => setCampuses(rows))
      .catch(() => {});
  }, []);

  // Restore a saved draft once on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(draftKey)
      .then(raw => {
        if (cancelled || !raw) return;
        const draft = JSON.parse(raw) as ListingDraft;
        const hasContent =
          draft.title || draft.description || draft.price || (draft.images?.length ?? 0) > 0;
        if (!hasContent) return;
        setTitle(draft.title || '');
        setCategory(draft.category || 'textbook_exchange');
        setPrice(draft.price || '');
        setSalePrice(draft.salePrice || '');
        setSaleEndsPreset(draft.saleEndsPreset || 'none');
        setPromoLabel(draft.promoLabel || '');
        setDescription(draft.description || '');
        setLocation(draft.location || '');
        setQuantity(draft.quantity || '');
        setCampusId(draft.campusId || '');
        setImages(Array.isArray(draft.images) ? draft.images : []);
        setDraftRestored(true);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDraftLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft (debounced) whenever any field changes.
  useEffect(() => {
    if (!draftLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const hasContent = title || description || price || images.length > 0;
      if (!hasContent) {
        AsyncStorage.removeItem(draftKey).catch(() => {});
        return;
      }
      const draft: ListingDraft = {
        title,
        category,
        price,
        salePrice,
        saleEndsPreset,
        promoLabel,
        description,
        location,
        quantity,
        campusId,
        images,
        savedAt: Date.now(),
      };
      AsyncStorage.setItem(draftKey, JSON.stringify(draft)).catch(() => {});
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    draftLoaded,
    draftKey,
    title,
    category,
    price,
    salePrice,
    saleEndsPreset,
    promoLabel,
    description,
    location,
    quantity,
    campusId,
    images,
  ]);

  const clearDraft = () => AsyncStorage.removeItem(draftKey).catch(() => {});

  const resetForm = () => {
    setTitle('');
    setCategory('textbook_exchange');
    setPrice('');
    setSalePrice('');
    setSaleEndsPreset('none');
    setPromoLabel('');
    setDescription('');
    setLocation('');
    setQuantity('');
    setCampusId('');
    setImages([]);
    setDraftRestored(false);
    void clearDraft();
  };

  const filteredCampuses = useMemo(() => {
    const q = campusQuery.trim().toLowerCase();
    const rows = q
      ? campuses.filter(
          c =>
            c.name.toLowerCase().includes(q) ||
            c.city?.toLowerCase().includes(q) ||
            c.state?.toLowerCase().includes(q)
        )
      : campuses;
    return rows.slice(0, 25);
  }, [campuses, campusQuery]);

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

  const handleGenerateDescription = async () => {
    if (!title.trim()) {
      Alert.alert('Add a title first', 'Enter a title so AI knows what you are selling.');
      return;
    }
    setGeneratingDesc(true);
    try {
      const { description: generated } = await aiGenerateListingDescription({
        title: title.trim(),
        category: selectedCategory?.name ?? category,
        subcategory: category,
        price: price.trim() || undefined,
      });
      if (generated) setDescription(generated);
    } catch (e: unknown) {
      Alert.alert(
        'Could not generate description',
        e instanceof Error ? e.message : 'Please try again in a moment.'
      );
    } finally {
      setGeneratingDesc(false);
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
    if (!campusId) {
      Alert.alert('Missing campus', 'Please select your campus so buyers know where to meet.');
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
      const { listing, queued } = await createListing(
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
          campus_id: campusId,
          quantity: parsedQuantity,
          images,
          status: 'active',
        } as Omit<MarketplaceListing, 'id' | 'created_at' | 'updated_at' | 'views_count' | 'favorites_count'>,
        user.id
      );
      await clearDraft();
      if (queued) {
        Alert.alert(
          'Saved for publishing',
          'You appear to be offline. Your listing will publish automatically when you reconnect.'
        );
        navigation.goBack();
      } else {
        Alert.alert('Listing published', 'Your listing is now live.');
        navigation.navigate('ListingDetail', { listingId: listing.id });
      }
    } catch (e: unknown) {
      Alert.alert(
        'Could not publish listing',
        e instanceof Error && e.message ? e.message : 'Failed to create listing. Please try again.'
      );
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold text-lantern-text flex-1">Create Listing</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        {draftRestored ? (
          <View className="flex-row items-center justify-between bg-lantern-primary-background rounded-xl px-3 py-2 mb-4">
            <View className="flex-row items-center flex-1 mr-2">
              <Ionicons name="save-outline" size={16} color="#64748b" />
              <Text className="text-xs text-lantern-text-secondary ml-2 flex-1">
                Draft restored — we saved your progress automatically.
              </Text>
            </View>
            <Pressable onPress={resetForm} hitSlop={8}>
              <Text className="text-xs font-semibold text-red-500">Discard</Text>
            </Pressable>
          </View>
        ) : null}

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
                <ActivityIndicator size="small" color="#64748b" />
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

        <Text className="text-sm font-semibold text-lantern-text mb-2">Campus *</Text>
        <Pressable
          onPress={() => setShowCampuses(v => !v)}
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface mb-2 flex-row items-center justify-between"
        >
          <Text className={selectedCampus ? 'text-lantern-text' : 'text-lantern-text-secondary'}>
            {selectedCampus ? selectedCampus.name : 'Select your campus'}
          </Text>
          <Ionicons name={showCampuses ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
        </Pressable>
        {showCampuses ? (
          <View className="mb-4 border border-lantern-border rounded-xl bg-lantern-surface overflow-hidden">
            <TextInput
              value={campusQuery}
              onChangeText={setCampusQuery}
              placeholder="Search campuses…"
              placeholderTextColor="#94a3b8"
              className="p-3 border-b border-lantern-border text-lantern-text"
            />
            {campuses.length === 0 ? (
              <Text className="p-3 text-sm text-lantern-text-secondary">Loading campuses…</Text>
            ) : filteredCampuses.length === 0 ? (
              <Text className="p-3 text-sm text-lantern-text-secondary">No campuses match your search.</Text>
            ) : (
              filteredCampuses.map(c => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setCampusId(c.id);
                    setShowCampuses(false);
                    setCampusQuery('');
                  }}
                  className={`p-3 border-b border-lantern-border/50 ${campusId === c.id ? 'bg-lantern-primary-background' : ''}`}
                >
                  <Text className="text-sm text-lantern-text">{c.name}</Text>
                  <Text className="text-xs text-lantern-text-secondary">
                    {[c.city, c.state].filter(Boolean).join(', ')}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        ) : (
          <View className="mb-2" />
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

        <Text className="text-sm font-semibold text-lantern-text mb-2">Meetup detail (optional)</Text>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="Faculty gate, hall, landmark…"
          placeholderTextColor="#94a3b8"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-4"
        />

        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-sm font-semibold text-lantern-text">Description</Text>
          <Pressable
            onPress={handleGenerateDescription}
            disabled={generatingDesc || !title.trim()}
            className={`flex-row items-center px-3 py-1.5 rounded-lg ${
              generatingDesc || !title.trim() ? 'bg-lantern-border' : 'bg-lantern-primary'
            }`}
          >
            {generatingDesc ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="sparkles" size={14} color="#fff" />
            )}
            <Text className="text-xs font-semibold text-white ml-1.5">
              {generatingDesc ? 'Generating…' : 'AI Generate'}
            </Text>
          </Pressable>
        </View>
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
