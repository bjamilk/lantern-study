import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { NoteAttachment } from '../services/notes';
import { refreshNoteAttachmentUrl, reorderNoteAttachments } from '../services/notes';
import { Button, Card } from './ui';
import { useTheme } from '../theme';

interface NoteImageGalleryProps {
  noteId: string;
  attachments: NoteAttachment[];
  editable?: boolean;
  onAttachmentsChange?: (attachments: NoteAttachment[]) => void;
  onAddPhotos?: () => void;
}

function sortOrderValue(attachment: NoteAttachment): number {
  return typeof attachment.metadata?.sortOrder === 'number' ? attachment.metadata.sortOrder : 0;
}

function ZoomableImage({ uri, onClose }: { uri: string; onClose: () => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(0.5, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.value > 1 ? 1 : 2;
      scale.value = withTiming(next);
      savedScale.value = next;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        <View className="flex-row items-center justify-end px-4 pt-12 pb-3">
          <Pressable onPress={onClose} className="p-2" accessibilityLabel="Close">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        <GestureDetector gesture={Gesture.Simultaneous(pinch, doubleTap)}>
          <Animated.View className="flex-1 items-center justify-center px-4 pb-8" style={animatedStyle}>
            <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

export function NoteImageGallery({
  noteId,
  attachments,
  editable = false,
  onAttachmentsChange,
  onAddPhotos,
}: NoteImageGalleryProps) {
  const { colors } = useTheme();
  const [ordered, setOrdered] = useState<NoteAttachment[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  useEffect(() => {
    setOrdered(
      [...attachments]
        .filter((a) => a.type === 'image')
        .sort((a, b) => sortOrderValue(a) - sortOrderValue(b))
    );
  }, [attachments]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setImageUrls({});

    (async () => {
      try {
        const settled = await Promise.allSettled(
          ordered.map(async (attachment) => {
            const result = await refreshNoteAttachmentUrl(noteId, attachment.id, {
              variant: 'thumb',
            });
            return [attachment.id, result.url] as const;
          })
        );
        if (cancelled) return;
        const entries = settled
          .filter((result): result is PromiseFulfilledResult<readonly [string, string]> => result.status === 'fulfilled')
          .map((result) => result.value);
        setImageUrls(Object.fromEntries(entries));
        if (entries.length === 0 && ordered.length > 0) {
          const firstRejection = settled.find((result) => result.status === 'rejected') as
            | PromiseRejectedResult
            | undefined;
          const reason = firstRejection?.reason;
          setError(reason instanceof Error ? reason.message : 'Failed to load photos');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load photos');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [noteId, ordered]);

  const openZoom = useCallback(
    async (attachmentId: string) => {
      const thumbUri = imageUrls[attachmentId];
      if (thumbUri) setZoomUri(thumbUri);
      try {
        const result = await refreshNoteAttachmentUrl(noteId, attachmentId, {
          variant: 'original',
        });
        setZoomUri(result.url);
      } catch {
        // Keep thumb preview if original sign fails.
      }
    },
    [imageUrls, noteId],
  );

  const persistOrder = useCallback(
    async (next: NoteAttachment[]) => {
      setReordering(true);
      try {
        const result = await reorderNoteAttachments(
          noteId,
          next.map((attachment) => attachment.id)
        );
        const sorted = [...result.attachments].sort(
          (a, b) => sortOrderValue(a) - sortOrderValue(b)
        );
        setOrdered(sorted);
        onAttachmentsChange?.(sorted);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to reorder photos');
      } finally {
        setReordering(false);
      }
    },
    [noteId, onAttachmentsChange]
  );

  const moveImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setOrdered(next);
    void persistOrder(next);
  };

  return (
    <Card className="mb-4 overflow-hidden border-lantern-border">
      <View className="flex-row items-center justify-between px-3 py-2 border-b border-lantern-border">
        <Text className="text-sm font-semibold text-lantern-text">
          {ordered.length === 1 ? '1 photo' : `${ordered.length} photos`}
        </Text>
        <View className="flex-row items-center gap-2">
          {editable && ordered.length > 1 && (
            <Pressable
              onPress={() => setEditMode((value) => !value)}
              className="px-2 py-1 rounded-md border border-lantern-border"
            >
              <Text className="text-xs text-lantern-text-secondary">
                {editMode ? 'Done' : 'Reorder'}
              </Text>
            </Pressable>
          )}
          {editable && onAddPhotos && (
            <Button size="sm" variant="secondary" onPress={onAddPhotos}>
              Add photos
            </Button>
          )}
        </View>
      </View>

      <ScrollView className="max-h-[480px] p-3" nestedScrollEnabled>
        {loading && (
          <View className="py-8 items-center">
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        {error && !loading && (
          <Text className="text-sm text-red-500 text-center py-6">{error}</Text>
        )}
        {!loading &&
          ordered.map((attachment, index) => (
            <View key={attachment.id} className="mb-3">
              {editMode && (
                <View className="absolute top-2 right-2 z-10 flex-col gap-1">
                  <Pressable
                    disabled={index === 0 || reordering}
                    onPress={() => moveImage(index, -1)}
                    className="p-2 rounded-md bg-black/55"
                  >
                    <Ionicons name="arrow-up" size={16} color="#fff" />
                  </Pressable>
                  <Pressable
                    disabled={index === ordered.length - 1 || reordering}
                    onPress={() => moveImage(index, 1)}
                    className="p-2 rounded-md bg-black/55"
                  >
                    <Ionicons name="arrow-down" size={16} color="#fff" />
                  </Pressable>
                </View>
              )}
              <Pressable
                disabled={editMode}
                onPress={() => {
                  void openZoom(attachment.id);
                }}
              >
                {imageUrls[attachment.id] ? (
                  <Image
                    source={{ uri: imageUrls[attachment.id] }}
                    className="w-full rounded-lg"
                    style={{ aspectRatio: 4 / 3 }}
                    resizeMode="contain"
                  />
                ) : (
                  <View className="h-40 rounded-lg bg-lantern-background-secondary" />
                )}
              </Pressable>
              {attachment.fileName ? (
                <Text className="text-xs text-lantern-text-secondary mt-1" numberOfLines={1}>
                  {attachment.fileName}
                </Text>
              ) : null}
            </View>
          ))}
      </ScrollView>

      {zoomUri ? <ZoomableImage uri={zoomUri} onClose={() => setZoomUri(null)} /> : null}
    </Card>
  );
}
