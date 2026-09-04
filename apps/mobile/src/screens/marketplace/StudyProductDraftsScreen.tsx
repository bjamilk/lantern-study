import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { Ionicons } from '@expo/vector-icons';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import {
  createStudyPackDraft,
  fetchStudyPackDrafts,
  fetchStudyPackDraft,
  deleteStudyPackDraft,
} from '../../services/api';
import { waitForNoteOcr } from '../../services/notes';
import type { StudyPackDraft, StudyPackDraftSummary } from '@lantern/shared/marketplace';
import { summarizeStudyPackCounts, STUDY_PACK_DRAFT_CREDITS } from '@lantern/shared/marketplace';
import { PublishStudyPackModal } from '../settings/PublishStudyPackModal';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  setParams?: (params: Record<string, unknown>) => void;
};
type RouteProp = {
  params?: { source?: { noteIds?: string[]; folderId?: string | null; courseId?: string | null; title?: string } };
};

const POLL_MS = 4000;

export function StudyProductDraftsScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: RouteProp;
}) {
  const source = route.params?.source;
  const [drafts, setDrafts] = useState<StudyPackDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewDraft, setReviewDraft] = useState<StudyPackDraft | null>(null);
  const createdRef = useRef(false);
  // Clears the absolutely-positioned bottom tab bar; the old paddingBottom: 24
  // left the last draft's Review/Publish actions under it.
  const bottomPadding = useScreenBottomPadding();

  const load = useCallback(async () => {
    try {
      setDrafts(await fetchStudyPackDrafts());
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!source || createdRef.current) return;
    createdRef.current = true;
    void (async () => {
      try {
        for (const id of source.noteIds || []) {
          try {
            await waitForNoteOcr(id);
          } catch {
            /* factory also waits */
          }
        }
        await createStudyPackDraft(source);
      } catch (e: unknown) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not start the study product');
      } finally {
        navigation.setParams?.({ source: undefined });
        void load();
      }
    })();
  }, [source, load, navigation]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPending = drafts.some((d) => d.status === 'queued' || d.status === 'generating');
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [hasPending, load]);

  const handleDelete = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    void deleteStudyPackDraft(id).catch(() => void load());
  };

  const handleReview = async (id: string) => {
    try {
      setReviewDraft(await fetchStudyPackDraft(id));
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not open this draft');
    }
  };

  const renderItem = ({ item }: { item: StudyPackDraftSummary }) => {
    const pending = item.status === 'queued' || item.status === 'generating';
    return (
      <View className="mx-4 mb-3 rounded-xl border border-lantern-border bg-lantern-surface p-4 flex-row items-start">
        <View className="w-9 h-9 rounded-lg bg-lantern-primary/10 items-center justify-center mr-3 mt-0.5">
          {pending ? (
            <ActivityIndicator size="small" color="#6366f1" />
          ) : (
            <Ionicons
              name={item.status === 'failed' ? 'alert-circle-outline' : 'sparkles-outline'}
              size={18}
              color={item.status === 'failed' ? '#ef4444' : '#6366f1'}
            />
          )}
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
            {item.suggested_title || 'Untitled study product'}
          </Text>
          <Text className="text-xs text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
            {pending
              ? 'Generating…'
              : item.status === 'failed'
                ? item.error || 'Generation failed'
                : summarizeStudyPackCounts(item.counts || {}) || 'Ready to review'}
          </Text>
        </View>
        <View className="flex-row items-center self-center" style={{ gap: 6 }}>
          {item.status === 'ready' ? (
            <Pressable
              onPress={() => void handleReview(item.id)}
              className="flex-row items-center rounded-lg bg-lantern-primary px-3 py-1.5"
              style={{ gap: 5 }}
            >
              <Ionicons name="storefront-outline" size={13} color="#fff" />
              <Text className="text-xs font-semibold text-white">Review</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => handleDelete(item.id)} hitSlop={8} className="p-1">
            <Ionicons name="trash-outline" size={16} color="#94a3b8" />
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} className="mr-2 -ml-1 p-1">
          <Ionicons name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-lantern-text">Study Products</Text>
          <Text className="text-xs text-lantern-text-secondary">
            Turn your notes into a sellable study pack
          </Text>
        </View>
        {/* Seller tool: You carries the seller's own badges, Cart would only be clutter here. */}
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} hide={['cart']} />
        <Pressable onPress={() => void load()} hitSlop={8} className="p-1">
          <Ionicons name="refresh" size={20} color="#64748b" />
        </Pressable>
      </View>

      {source && !drafts.length && !loading ? (
        <View className="mx-4 mt-3 rounded-xl border border-lantern-primary/30 bg-lantern-primary/5 px-4 py-2.5">
          <Text className="text-sm text-lantern-text">
            Starting a new study product… (uses {STUDY_PACK_DRAFT_CREDITS} AI credits)
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : drafts.length === 0 && !source ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="sparkles-outline" size={40} color="#94a3b8" />
          <Text className="mt-3 text-base font-semibold text-lantern-text">No study products yet</Text>
          <Text className="mt-1 text-sm text-lantern-text-secondary text-center">
            Open a note and tap the shop icon, or pick a course in your Library and choose "Create a
            study pack". Lantern drafts the guide, flashcards and questions for you to review before
            publishing.
          </Text>
          <Text className="mt-2 text-xs text-lantern-text-tertiary">
            Uses {STUDY_PACK_DRAFT_CREDITS} AI credits per draft.
          </Text>
        </View>
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={(d) => d.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPadding }}
        />
      )}

      <PublishStudyPackModal
        visible={!!reviewDraft}
        onClose={() => setReviewDraft(null)}
        draftId={reviewDraft?.id}
        content={reviewDraft?.content || {}}
        defaultTitle={reviewDraft?.suggested_title || ''}
        defaultDescription={reviewDraft?.suggested_description || ''}
        defaultPrice={
          reviewDraft?.suggested_price_kobo != null
            ? Math.round(reviewDraft.suggested_price_kobo / 100)
            : null
        }
        defaultCourseId={reviewDraft?.course_id ?? null}
        onPublished={(listingId) => {
          const done = reviewDraft?.id;
          setReviewDraft(null);
          if (done) setDrafts((prev) => prev.filter((d) => d.id !== done));
          if (listingId) navigation.navigate('ListingDetail', { listingId });
        }}
      />
    </Screen>
  );
}

export default StudyProductDraftsScreen;
