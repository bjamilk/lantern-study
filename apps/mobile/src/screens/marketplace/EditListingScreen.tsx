import React, { useEffect, useRef, useState } from 'react';
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
import { HEIC_IMAGE_UPLOAD_ERROR, isHeicImageUpload } from '@lantern/shared';
import {
  isMarketplaceListingEditable,
  isOtherCityCampus,
  type MarketplaceCampus,
} from '@lantern/shared/marketplace';
import { uploadMarketplaceImage } from '../../services/marketplaceImageUpload';
import { fetchMarketplaceCampuses } from '../../services/api';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { topicIdAfterCourseChange } from '../../utils/topicSelection';
import { CampusPicker } from './CampusPicker';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { ATTESTATION_REQUIRED_MESSAGE, isAcademicListing } from '@lantern/shared/moderation';
import { RightsAttestationCheckbox } from '../../components/moderation/RightsAttestationCheckbox';
import { ListingTakedownNotice } from '../../components/moderation/ListingTakedownNotice';

type NavigationProp = {
  goBack: () => void;
};

const ALL_CATEGORIES = [...ACADEMIC_CATEGORIES, ...STUDENT_LIFE_CATEGORIES];
const MAX_IMAGES = 5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short, Intl-free label for an ISO sale end date, e.g. "Aug 25". */
function formatSaleEndShort(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function EditListingScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params?: { listingId?: string } };
}) {
  // Publish sits at the end of the scroll; clear the floating tab bar.
  const tabBarClearance = useTabBarClearance(32);
  const listingId = route.params?.listingId ?? '';
  const { user } = useAuthStore();
  const { currentListing, fetchListing, updateListing, isLoading } = useMarketplaceStore();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('textbook_exchange');
  const [price, setPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleEndsPreset, setSaleEndsPreset] = useState<'keep' | 'none' | '24h' | '7d'>('none');
  // The listing's existing sale end date, tracked so editing does NOT silently
  // rewrite it to now+7d. "Keep current" resends this ISO string unchanged.
  const [originalSaleEndsAt, setOriginalSaleEndsAt] = useState<string | null>(null);
  const [promoLabel, setPromoLabel] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const [campusId, setCampusId] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseCode, setCourseCode] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  // Rights attestation (Phase 1 · E): the API demands it when an edit moves
  // an unattested listing into an academic category; already-attested
  // listings just show a confirmation line.
  const [attested, setAttested] = useState(false);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (listingId) void fetchListing(listingId);
  }, [listingId, fetchListing]);

  useEffect(() => {
    void fetchMarketplaceCampuses('NG')
      .then(rows => setCampuses(rows))
      .catch(() => {});
  }, []);

  // Seed the form once per listing. The store swaps currentListing back to the
  // pre-edit copy after a rejected save; re-seeding then would wipe the user's input.
  const seededListingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentListing || currentListing.id !== listingId) return;
    if (seededListingIdRef.current === listingId) return;
    seededListingIdRef.current = listingId;
    setTitle(currentListing.title);
    setCategory(currentListing.category as MarketplaceCategory);
    setPrice(currentListing.price != null ? String(currentListing.price) : '');
    setSalePrice(currentListing.sale_price != null ? String(currentListing.sale_price) : '');
    setPromoLabel(currentListing.promo_label || '');
    setOriginalSaleEndsAt(currentListing.sale_ends_at ?? null);
    // Default to "keep current" so an untouched edit preserves the sale window.
    setSaleEndsPreset(currentListing.sale_ends_at ? 'keep' : 'none');
    setDescription(currentListing.description || '');
    setLocation(currentListing.location || '');
    setImages(currentListing.images || []);
    setQuantity(currentListing.quantity != null ? String(currentListing.quantity) : '');
    setCampusId(currentListing.campus_id || currentListing.campus?.id || '');
    setCourseId(currentListing.courseId ?? null);
    setTopicId(currentListing?.topicId ?? null);
    const legacyCourseCode = currentListing.category_specific_fields?.courseCode;
    setCourseCode(typeof legacyCourseCode === 'string' && legacyCourseCode.trim() ? legacyCourseCode : null);
  }, [currentListing, listingId]);

  const selectedCategory = ALL_CATEGORIES.find(c => c.id === category);
  const isAcademic = isAcademicListing({ listingKind: currentListing?.listing_kind, category });
  const alreadyAttested =
    currentListing?.rights_status === 'attested' || currentListing?.rights_status === 'cleared';
  const needsAttestation = isAcademic && !alreadyAttested;
  const listingCampus = currentListing?.campus;
  const campusOptions =
    listingCampus && !campuses.some(campus => campus.id === listingCampus.id)
      ? [
          ...campuses,
          {
            ...listingCampus,
            slug: listingCampus.slug || '',
            country_code: listingCampus.country_code || 'NG',
          },
        ]
      : campuses;
  const selectedCampus = campusOptions.find(campus => campus.id === campusId);
  const isOtherCity = isOtherCityCampus(selectedCampus);

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
    const accepted = result.assets.filter(
      (asset) =>
        !isHeicImageUpload({
          contentType: asset.mimeType || 'image/jpeg',
          fileName: asset.uri || asset.fileName,
        })
    );
    if (accepted.length < result.assets.length) {
      Alert.alert('Unsupported photo format', HEIC_IMAGE_UPLOAD_ERROR);
    }
    if (accepted.length === 0) return;

    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const asset of accepted) {
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
    if (!campusId) {
      Alert.alert(
        'Missing area',
        'Choose a campus, or select Other (city in Nigeria).'
      );
      return;
    }
    if (isOtherCity && !location.trim()) {
      Alert.alert('Missing city', 'Enter the Nigerian city for this listing.');
      return;
    }
    const parsedPrice = price.trim() ? parseFloat(price.replace(/,/g, '')) : undefined;
    const parsedSalePrice = salePrice.trim() ? parseFloat(salePrice.replace(/,/g, '')) : undefined;

    // Discount validation (mirrors web's EditMarketplaceListingModal).
    const hasSale = parsedSalePrice != null && parsedSalePrice > 0;
    if (hasSale) {
      if (!Number.isFinite(parsedSalePrice) || (parsedSalePrice as number) < 0) {
        Alert.alert('Invalid discount', 'Enter a valid discounted price, or choose No sale.');
        return;
      }
      if (parsedPrice == null || (parsedSalePrice as number) >= parsedPrice) {
        Alert.alert(
          'Discount too high',
          'The discounted price must be lower than the asking price, or choose No sale.'
        );
        return;
      }
      // A discounted price with no end date never shows to buyers (fix #7).
      if (saleEndsPreset === 'none') {
        Alert.alert(
          'Add a promo end date',
          "Pick 24 hours or 7 days, or choose No sale — a discount with no end date won't show to buyers."
        );
        return;
      }
    }

    // Explicit null clears the discount server-side; undefined would leave it.
    let salePricePayload: number | null;
    let saleEndsPayload: string | null;
    if (!hasSale || saleEndsPreset === 'none') {
      salePricePayload = null;
      saleEndsPayload = null;
    } else if (saleEndsPreset === 'keep') {
      salePricePayload = parsedSalePrice as number;
      saleEndsPayload = originalSaleEndsAt; // resend the existing window unchanged
    } else {
      salePricePayload = parsedSalePrice as number;
      saleEndsPayload = new Date(
        Date.now() + (saleEndsPreset === '24h' ? 24 : 168) * 60 * 60 * 1000
      ).toISOString();
    }
    const parsedQuantity = quantity.trim() ? parseInt(quantity, 10) : undefined;
    if (needsAttestation && !attested) {
      setAttestationError(ATTESTATION_REQUIRED_MESSAGE);
      Alert.alert('Confirm your rights', ATTESTATION_REQUIRED_MESSAGE);
      return;
    }
    setAttestationError(null);
    setSubmitError(null);
    try {
      await updateListing(
        listingId,
        {
          title: title.trim(),
          category,
          description: description.trim() || undefined,
          price: parsedPrice,
          sale_price: salePricePayload,
          sale_ends_at: saleEndsPayload,
          promo_label: promoLabel.trim() || null,
          location: location.trim() || undefined,
          campus_id: campusId,
          quantity: parsedQuantity,
          images,
          // Academic archive: always send courseId (null clears); mirror the
          // code into category_specific_fields.courseCode for legacy readers.
          courseId: courseId ?? null,
          // The topic goes with it (null clears) — the server rejects a topic
          // that belongs to a different course.
          topicId: courseId ? topicId : null,
          ...(courseCode !== (currentListing?.category_specific_fields?.courseCode ?? null)
            ? { category_specific_fields: { courseCode: courseCode ?? null } }
            : {}),
          // Rights attestation (academic categories; API 400 without it).
          ...(attested ? { attestation: true } : {}),
        },
        user.id
      );
      Alert.alert('Saved', 'Listing updated.');
      navigation.goBack();
    } catch (e) {
      // The API refuses edits to moderated listings (403) with seller-facing
      // copy, and 400s the rights/content checks — keep the message inline too.
      const message = e instanceof Error && e.message ? e.message : 'Failed to update listing.';
      setSubmitError(message);
      Alert.alert('Could not save', message);
    }
  };

  // Moderation takedown: the listing is read-only for the seller, so show the
  // notice instead of a form whose save can only be refused.
  const loadedListing = currentListing?.id === listingId ? currentListing : null;
  if (loadedListing && !isMarketplaceListingEditable(loadedListing.status)) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
        <View className="px-4 pt-2 pb-3 flex-row items-center">
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
            <Ionicons name="arrow-back" size={22} color="#64748b" />
          </Pressable>
          <Text className="text-xl font-bold text-lantern-text">Edit Listing</Text>
        </View>
        <View className="px-4">
          {/* Takedown reason + appeal state / one-shot Appeal (Phase 1 · E). */}
          <ListingTakedownNotice listing={loadedListing} />
          <Button fullWidth variant="secondary" className="mt-4" onPress={() => navigation.goBack()}>
            Go back
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="px-4 pt-2 pb-3 flex-row items-center">
          <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2 mr-1">
            <Ionicons name="arrow-back" size={22} color="#64748b" />
          </Pressable>
          <Text className="text-xl font-bold text-lantern-text">Edit Listing</Text>
        </View>

        <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: tabBarClearance }}>
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

          <Text className="text-sm font-semibold text-lantern-text mb-2">
            Campus or city *
          </Text>
          <CampusPicker
            campuses={campusOptions}
            value={campusId}
            onChange={setCampusId}
            emptyLabel="Choose a campus or Other city"
          />
          <Text className="text-xs text-lantern-text-secondary mt-1 mb-4">
            Listings stay visible across Nigeria; this only identifies where yours is based.
          </Text>

          <Text className="text-sm font-semibold text-lantern-text mb-2">Course (optional)</Text>
          <CoursePicker
            value={courseId}
            fallbackLabel={courseCode}
            onChange={course => {
              const nextCourseId = course?.id ?? null;
              setTopicId(topicIdAfterCourseChange(topicId, courseId, nextCourseId));
              setCourseId(nextCourseId);
              setCourseCode(course?.code ?? null);
            }}
            placeholder="Which course is this for? e.g. BIO 201"
            title="Course for this listing"
          />
          <Text className="text-xs text-lantern-text-secondary mt-1 mb-4">
            Helps students at your level find it.
          </Text>

          <Text className="text-sm font-semibold text-lantern-text mb-2">Topic (optional)</Text>
          <TopicPicker
            courseId={courseId}
            value={topicId}
            onChange={topic => setTopicId(topic?.id ?? null)}
            placeholder="Which part of the syllabus?"
            title="Topic for this listing"
          />
          <Text className="text-xs text-lantern-text-secondary mt-1 mb-4">
            Buyers browsing a course see this under the right week of the outline.
          </Text>

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
          <View className="flex-row flex-wrap gap-2 mb-2">
            {(originalSaleEndsAt
              ? (['keep', 'none', '24h', '7d'] as const)
              : (['none', '24h', '7d'] as const)
            ).map(preset => (
              <Pressable
                key={preset}
                onPress={() => {
                  setSaleEndsPreset(preset);
                  // "No sale" clears the discount outright (explicit null on save).
                  if (preset === 'none') setSalePrice('');
                }}
                className={`px-3 py-1.5 rounded-lg border ${
                  saleEndsPreset === preset ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                }`}
              >
                <Text className={`text-xs font-medium ${saleEndsPreset === preset ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  {preset === 'keep'
                    ? `Keep current (ends ${formatSaleEndShort(originalSaleEndsAt)})`
                    : preset === 'none'
                      ? 'No sale'
                      : preset === '24h'
                        ? '24 hours'
                        : '7 days'}
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

          <Text className="text-sm font-semibold text-lantern-text mb-2">
            {isOtherCity
              ? 'City / pickup or delivery area *'
              : 'Pickup or delivery detail (optional)'}
          </Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder={
              isOtherCity
                ? 'Enter the city and a useful area'
                : 'Pickup point, delivery area, or landmark…'
            }
            placeholderTextColor="#94a3b8"
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

          {needsAttestation ? (
            <>
              <Text className="text-sm font-semibold text-lantern-text mb-2">Rights confirmation *</Text>
              <RightsAttestationCheckbox
                value={attested}
                onChange={(next) => {
                  setAttested(next);
                  if (next) setAttestationError(null);
                }}
                error={attestationError}
              />
            </>
          ) : isAcademic && alreadyAttested ? (
            <View className="flex-row items-center gap-2 mb-4">
              <Ionicons name="checkmark-circle" size={16} color="#059669" />
              <Text className="text-xs text-lantern-text-secondary flex-1">
                Rights confirmed for this listing. Editing keeps your attestation.
              </Text>
            </View>
          ) : null}

          {submitError ? (
            <View className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30">
              <Text className="text-sm text-red-700 dark:text-red-300">{submitError}</Text>
            </View>
          ) : null}

          <Button fullWidth loading={isLoading || uploading} onPress={handleSubmit}>
            Save changes
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
