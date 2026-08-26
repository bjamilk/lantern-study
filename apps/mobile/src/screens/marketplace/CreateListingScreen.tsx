import React, { useEffect, useRef, useState } from 'react';
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
  type MarketplaceListing,
  type MarketplaceCategory,
} from '../../stores';
import { fetchMarketplaceCampuses } from '../../services/api';
import { aiGenerateListingDescription } from '../../services/ai';
import { HEIC_IMAGE_UPLOAD_ERROR, isHeicImageUpload } from '@lantern/shared';
import {
  getTaxonomyNode,
  isOtherCityCampus,
  listingNeedsCoursePicker,
  taxonomyPathLabel,
  type MarketplaceCampus,
  type TaxonomyNode,
} from '@lantern/shared/marketplace';
import { ListingClassifier } from './ListingClassifier';
import { uploadMarketplaceImage } from '../../services/marketplaceImageUpload';
import { Button } from '../../components/ui';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { topicIdAfterCourseChange } from '../../utils/topicSelection';
import { CampusPicker } from './CampusPicker';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { ATTESTATION_REQUIRED_MESSAGE, isAcademicListing } from '@lantern/shared/moderation';
import { RightsAttestationCheckbox } from '../../components/moderation/RightsAttestationCheckbox';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

const MAX_IMAGES = 5;

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
  /** Academic archive: picked course (id + code for the label/legacy field). */
  courseId?: string | null;
  courseCode?: string | null;
  /** Topic within `courseId`; the title labels the trigger before the outline loads. */
  topicId?: string | null;
  topicTitle?: string | null;
  taxonomyNodeId?: string;
  images: string[];
  savedAt: number;
}

function draftStorageKey(userId?: string | null): string {
  return `lantern_listing_draft_${userId ?? 'anonymous'}`;
}

export function CreateListingScreen({ navigation }: { navigation: NavigationProp & { goBack: () => void } }) {
  // The submit button is the last scroll child; clear the floating tab bar.
  const tabBarClearance = useTabBarClearance(32);
  const { user } = useAuthStore();
  const { createListing, isLoading } = useMarketplaceStore();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('textbook_exchange');
  const [taxonomyNodeId, setTaxonomyNodeId] = useState('academic.materials.textbooks.course');
  const [price, setPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleEndsPreset, setSaleEndsPreset] = useState<'none' | '24h' | '7d'>('none');
  const [promoLabel, setPromoLabel] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('');
  /** Local previews before publish; uploaded to storage on submit. */
  const [pendingImages, setPendingImages] = useState<
    Array<{ uri: string; mimeType?: string; base64?: string | null }>
  >([]);
  const [uploading, setUploading] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const [campusId, setCampusId] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseCode, setCourseCode] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [topicTitle, setTopicTitle] = useState<string | null>(null);
  // Rights attestation (Phase 1 · E): required by the API for academic
  // categories (past questions, notes, projects, textbooks). Never drafted.
  const [attested, setAttested] = useState(false);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  /** Server refusal shown inline (attestation missing, blocked content). */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const needsAttestation = isAcademicListing({ category });

  // Draft persistence: survive app switches / process death mid-creation.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftKey = draftStorageKey(user?.id);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedNode = getTaxonomyNode(taxonomyNodeId);
  const showCourse = listingNeedsCoursePicker(category);
  const selectedCampus = campuses.find(c => c.id === campusId);
  const isOtherCity = isOtherCityCampus(selectedCampus);

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
        if (typeof (draft as ListingDraft).taxonomyNodeId === 'string') {
          setTaxonomyNodeId((draft as ListingDraft).taxonomyNodeId as string);
        }
        setPrice(draft.price || '');
        setSalePrice(draft.salePrice || '');
        setSaleEndsPreset(draft.saleEndsPreset || 'none');
        setPromoLabel(draft.promoLabel || '');
        setDescription(draft.description || '');
        setLocation(draft.location || '');
        setQuantity(draft.quantity || '');
        setCampusId(draft.campusId || '');
        setCourseId(draft.courseId ?? null);
        setCourseCode(draft.courseCode ?? null);
        setTopicId(draft.topicId ?? null);
        setTopicTitle(draft.topicTitle ?? null);
        // Draft image URIs are best-effort (local paths may expire after process death).
        setPendingImages(
          Array.isArray(draft.images)
            ? draft.images.filter(Boolean).map((uri) => ({ uri }))
            : []
        );
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
      const hasContent = title || description || price || pendingImages.length > 0;
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
        courseId,
        courseCode,
        topicId,
        topicTitle,
        taxonomyNodeId,
        images: pendingImages.map((img) => img.uri),
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
    courseId,
    courseCode,
    topicId,
    topicTitle,
    taxonomyNodeId,
    pendingImages,
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
    setCourseId(null);
    setCourseCode(null);
    setTopicId(null);
    setTopicTitle(null);
    setPendingImages([]);
    setAttested(false);
    setAttestationError(null);
    setSubmitError(null);
    setDraftRestored(false);
    void clearDraft();
  };

  const pickImages = async () => {
    if (pendingImages.length >= MAX_IMAGES) {
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
      selectionLimit: MAX_IMAGES - pendingImages.length,
    });
    if (result.canceled) return;
    const accepted: Array<{ uri: string; mimeType?: string; base64?: string | null }> = [];
    let rejectedHeic = 0;
    for (const asset of result.assets) {
      const mimeType = asset.mimeType || 'image/jpeg';
      if (isHeicImageUpload({ contentType: mimeType, fileName: asset.uri || asset.fileName })) {
        rejectedHeic += 1;
        continue;
      }
      accepted.push({
        uri: asset.uri,
        mimeType,
        base64: asset.base64,
      });
    }
    if (rejectedHeic > 0) {
      Alert.alert('Unsupported photo format', HEIC_IMAGE_UPLOAD_ERROR);
    }
    if (accepted.length === 0) return;
    setPendingImages((prev) => [...prev, ...accepted].slice(0, MAX_IMAGES));
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
        category: selectedNode?.label ?? category,
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
      Alert.alert(
        'Missing area',
        'Choose a campus, or select Other (city in Nigeria).'
      );
      return;
    }
    if (isOtherCity && !location.trim()) {
      Alert.alert(
        'Missing city',
        'Enter the Nigerian city for this listing.'
      );
      return;
    }
    const parsedPrice = price.trim() ? parseFloat(price.replace(/,/g, '')) : undefined;
    if (price.trim() && (!parsedPrice || parsedPrice < 0)) {
      Alert.alert('Invalid price', 'Please enter a valid price.');
      return;
    }
    if (needsAttestation && !attested) {
      setAttestationError(ATTESTATION_REQUIRED_MESSAGE);
      Alert.alert('Confirm your rights', ATTESTATION_REQUIRED_MESSAGE);
      return;
    }
    setAttestationError(null);
    setSubmitError(null);
    // Photos are the strongest conversion lever a listing has; nudge — but
    // don't block — before publishing a photoless one.
    if (pendingImages.length === 0) {
      const publishWithout = await new Promise<boolean>(resolve => {
        Alert.alert(
          'No photos yet',
          'Listings with photos get far more buyers. Add one first?',
          [
            { text: 'Add photo', onPress: () => resolve(false) },
            { text: 'Publish without', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      });
      if (!publishWithout) return;
    }
    try {
      const saleEndsAt =
        saleEndsPreset === 'none'
          ? undefined
          : new Date(
              Date.now() + (saleEndsPreset === '24h' ? 24 : 168) * 60 * 60 * 1000
            ).toISOString();
      const parsedSalePrice = salePrice.trim() ? parseFloat(salePrice.replace(/,/g, '')) : undefined;
      if (
        parsedSalePrice != null &&
        (!Number.isFinite(parsedSalePrice) ||
          parsedSalePrice < 0 ||
          parsedPrice == null ||
          parsedSalePrice >= parsedPrice)
      ) {
        Alert.alert(
          'Invalid discounted price',
          'Discounted price must be lower than the asking price, or leave it blank. This is for a promo — not your cost/profit.'
        );
        return;
      }
      // A discounted price with no end date never shows to buyers (fix #7).
      if (parsedSalePrice != null && parsedSalePrice > 0 && saleEndsPreset === 'none') {
        Alert.alert(
          'Add a promo end date',
          "Pick 24 hours or 7 days, or clear the discounted price — a discount with no end date won't show to buyers."
        );
        return;
      }
      const parsedQuantity = quantity.trim() ? parseInt(quantity, 10) : undefined;
      setUploading(true);
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
          country_code: 'NG',
          currency: 'NGN',
          quantity: parsedQuantity,
          images: [],
          status: 'active',
          // Academic archive: course_id column + legacy free-text courseCode
          // in category_specific_fields for web/back-compat readers.
          courseId: courseId ?? null,
          category_specific_fields: {
            ...(courseCode ? { courseCode } : {}),
            ...(taxonomyNodeId
              ? { taxonomyNodeId, taxonomyPath: taxonomyPathLabel(taxonomyNodeId) }
              : {}),
          },
          // Never sent without its course — the server rejects a bare topic.
          topicId: courseId ? topicId : null,
          // Rights attestation for academic categories (API: 400 without it).
          ...(attested ? { attestation: true } : {}),
        },
        user.id
      );

      let uploadedUrls: string[] = [];
      let failedUploads = 0;
      let heicFailures = 0;
      if (!queued && pendingImages.length > 0) {
        for (const img of pendingImages) {
          try {
            const result = await uploadMarketplaceImage(
              img.uri,
              img.mimeType,
              listing.id,
              img.base64
            );
            uploadedUrls.push(result.storageUrl || result.path || result.url);
          } catch (err: unknown) {
            failedUploads += 1;
            const message = err instanceof Error ? err.message : '';
            if (message.includes('HEIC') || isHeicImageUpload({ contentType: img.mimeType, fileName: img.uri })) {
              heicFailures += 1;
            }
          }
        }
        if (uploadedUrls.length > 0) {
          await useMarketplaceStore.getState().updateListing(
            listing.id,
            { images: uploadedUrls },
            user.id
          );
        }
      }

      setUploading(false);
      await clearDraft();
      if (queued) {
        Alert.alert(
          'Saved for publishing',
          'You appear to be offline. Your listing will publish automatically when you reconnect.'
        );
        navigation.goBack();
      } else if (failedUploads > 0 && uploadedUrls.length === 0) {
        Alert.alert(
          'Listing created, photos failed',
          heicFailures > 0
            ? HEIC_IMAGE_UPLOAD_ERROR
            : 'Your listing is live, but photos failed to upload. Edit the listing to add photos.'
        );
        navigation.navigate('ListingDetail', { listingId: listing.id });
      } else if (failedUploads > 0) {
        Alert.alert(
          'Listing published',
          heicFailures > 0
            ? `${failedUploads} photo(s) failed. ${HEIC_IMAGE_UPLOAD_ERROR}`
            : `${failedUploads} photo(s) failed to upload. You can add them from Edit listing.`
        );
        navigation.navigate('ListingDetail', { listingId: listing.id });
      } else {
        Alert.alert('Listing published', 'Your listing is now live.');
        navigation.navigate('ListingDetail', { listingId: listing.id });
      }
    } catch (e: unknown) {
      setUploading(false);
      // 400s from the rights/content checks (ATTESTATION_REQUIRED_MESSAGE,
      // CONTENT_BLOCK_MESSAGE) stay visible inline above the button.
      const message =
        e instanceof Error && e.message ? e.message : 'Failed to create listing. Please try again.';
      setSubmitError(message);
      Alert.alert('Could not publish listing', message);
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

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: tabBarClearance }}>
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
          {pendingImages.map((img, i) => (
            <View key={`${img.uri}-${i}`} className="mr-2 relative">
              <Image source={{ uri: img.uri }} className="w-20 h-20 rounded-xl" />
              <Pressable
                onPress={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5"
              >
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
          {pendingImages.length < MAX_IMAGES ? (
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

        <ListingClassifier
          title={title}
          selectedNodeId={taxonomyNodeId}
          onSelect={(node: TaxonomyNode) => {
            if (node.publishFlow === 'question_bank' || node.publishFlow === 'study_pack') {
              Alert.alert(
                'Publish from Study products',
                node.publishFlow === 'question_bank'
                  ? 'A Lantern question bank is a takeable test. Publish it from Study products, or list a PDF/printed pack here.'
                  : 'Study packs are published from a deck or note in your library.',
                [
                  node.publishFlow === 'question_bank'
                    ? {
                        text: 'List a PDF pack',
                        onPress: () => {
                          const printed = getTaxonomyNode('academic.materials.assessments.printed-pq');
                          if (printed?.listingCategory) {
                            setTaxonomyNodeId(printed.id);
                            setCategory(printed.listingCategory as MarketplaceCategory);
                          }
                        },
                      }
                    : { text: 'OK' },
                  {
                    text: 'Open Study products',
                    onPress: () => navigation.navigate('StudyProductDrafts'),
                  },
                ]
              );
              return;
            }
            const listingCategory = node.listingCategory;
            if (!listingCategory || listingCategory === 'other') return;
            setTaxonomyNodeId(node.id);
            setCategory(listingCategory as MarketplaceCategory);
            if (!listingNeedsCoursePicker(listingCategory)) {
              setCourseId(null);
              setCourseCode(null);
              setTopicId(null);
              setTopicTitle(null);
            }
          }}
        />

        <Text className="text-sm font-semibold text-lantern-text mb-2">
          Campus or city *
        </Text>
        <CampusPicker
          campuses={campuses}
          value={campusId}
          onChange={setCampusId}
          emptyLabel="Choose a campus or Other city"
        />
        <Text className="text-xs text-lantern-text-secondary mt-1 mb-4">
          Listings are visible across Nigeria; this tells buyers where the item is based.
        </Text>

        {/* Course + Topic only for academic study material (matches web's
            courseCode field gate). Textbooks, accommodation etc. don't file
            under a syllabus. */}
        {showCourse ? (
          <>
            <Text className="text-sm font-semibold text-lantern-text mb-2">Course (optional)</Text>
            <CoursePicker
              value={courseId}
              fallbackLabel={courseCode}
              onChange={course => {
                const nextCourseId = course?.id ?? null;
                const nextTopicId = topicIdAfterCourseChange(topicId, courseId, nextCourseId);
                setTopicId(nextTopicId);
                if (!nextTopicId) setTopicTitle(null);
                setCourseId(nextCourseId);
                setCourseCode(course?.code ?? null);
              }}
              placeholder="Which course is this for? e.g. BIO 201"
              title="Course for this listing"
            />
            <Text className="text-xs text-lantern-text-secondary mt-1 mb-4">
              Helps students at your level find it. Past questions, notes and projects sell faster with a course.
            </Text>

            <Text className="text-sm font-semibold text-lantern-text mb-2">Topic (optional)</Text>
            <TopicPicker
              courseId={courseId}
              value={topicId}
              fallbackLabel={topicTitle}
              onChange={topic => {
                setTopicId(topic?.id ?? null);
                setTopicTitle(topic?.title ?? null);
              }}
              placeholder="Which part of the syllabus?"
              title="Topic for this listing"
            />
            {/* Filing under a topic just records where in the syllabus it sits —
                no marketplace view browses by topic, so promise nothing more. */}
            <Text className="text-xs text-lantern-text-secondary mt-1 mb-4">
              Files it under that part of the course's outline.
            </Text>
          </>
        ) : null}

        <Text className="text-sm font-semibold text-lantern-text mb-2">Asking price (₦)</Text>
        <TextInput
          value={price}
          onChangeText={setPrice}
          placeholder="What buyers normally pay (empty = free)"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
          className="p-3 rounded-xl border border-lantern-border bg-lantern-surface text-lantern-text mb-1"
        />
        <Text className="text-xs text-lantern-text-secondary mb-4">
          Your selling price. Leave empty for free items.
        </Text>

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
        ) : null}

        {submitError ? (
          <View className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30">
            <Text className="text-sm text-red-700 dark:text-red-300">{submitError}</Text>
          </View>
        ) : null}

        <Button fullWidth loading={isLoading || uploading} onPress={handleSubmit}>
          Publish Listing
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
