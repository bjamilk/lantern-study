import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { normalizeStorageUrl, segmentMentions } from '@lantern/shared/utils';

const IMAGE_MARKDOWN = /!\[.*?\]\((https?:\/\/[^)]+)\)/;

export function MentionText({
  text,
  color,
  mentionColor,
}: {
  text: string;
  color: string;
  mentionColor: string;
}) {
  const segments = segmentMentions(text);
  return (
    // Not a TalkBack stop of its own: every caller sits inside a bubble whose
    // row Pressable already announces the message text, so leaving this
    // important made each message read out twice back to back.
    <Text
      importantForAccessibility="no"
      className="text-sm leading-relaxed"
      style={{ color }}
    >
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <Text key={i} style={{ color: mentionColor, fontWeight: '700' }}>
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        )
      )}
    </Text>
  );
}

/**
 * Full-screen pinch-to-zoom viewer for a chat image. Mirrors the ZoomableImage
 * pattern already proven in NoteImageGallery (Pinch + double-tap inside a
 * native Modal) so no new dependency is pulled in and gestures work inside the
 * Modal window the same way they do there.
 */
function ChatImageViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const scale = useSharedValue(1);
  const insets = useSafeAreaInsets();
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
        <View className="flex-row items-center justify-end px-4 pb-3" style={{ paddingTop: insets.top + 8 }}>
          <Pressable
            onPress={onClose}
            className="p-2"
            accessibilityRole="button"
            accessibilityLabel="Close image"
          >
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

/**
 * A tappable chat image thumbnail. Sizes itself to the image's real aspect
 * ratio inside a max box (so a tall screenshot renders as a small portrait
 * card, not an unreadable cover-cropped strip) and opens the pinch-to-zoom
 * viewer on tap. Used for both plain shared images and question visuals.
 */
export function ChatImageThumbnail({
  uri,
  accessibilityLabel = 'Shared image',
  maxWidth = 240,
  maxHeight = 280,
  borderColor,
  borderWidth = 0,
  borderRadius = 10,
}: {
  uri: string;
  accessibilityLabel?: string;
  maxWidth?: number;
  maxHeight?: number;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRatio(null);
    setFailed(false);
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setRatio(w / h);
      },
      () => {
        // Ratio stays null (default box below); <Image onError> marks it failed
        // if the pixels themselves don't load either.
      }
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (failed) return null;

  // Fit the natural size inside maxWidth × maxHeight without cropping. Until the
  // real ratio resolves, use a neutral landscape box to hold space.
  let width = maxWidth;
  let height = Math.round(maxWidth * 0.7);
  if (ratio && ratio > 0) {
    height = maxWidth / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    width = Math.round(width);
    height = Math.round(height);
  }

  return (
    <>
      <Pressable
        onPress={() => setViewerOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`${accessibilityLabel}. Tap to view full screen.`}
      >
        <Image
          source={{ uri }}
          // Exact-fit dims mean cover never crops; contain avoids a crop on the
          // pre-measure fallback box.
          resizeMode={ratio ? 'cover' : 'contain'}
          onError={() => setFailed(true)}
          style={{ width, height, borderRadius, borderColor, borderWidth }}
        />
      </Pressable>
      {viewerOpen ? <ChatImageViewer uri={uri} onClose={() => setViewerOpen(false)} /> : null}
    </>
  );
}

/**
 * The body of a plain chat message: an optional attached image followed by the
 * text with @mentions highlighted.
 *
 * Attachments are posted as `![image](url)` markdown by `useChatImageAttach`.
 * Only MessageBubble knew how to unwrap that, so once the attach button was
 * enabled in DMs and threads their bubbles rendered the raw markdown as text —
 * keeping this in one place is what stops that recurring.
 */
export function ChatTextBody({
  text,
  textColor,
  mentionColor,
}: {
  text?: string;
  textColor: string;
  mentionColor: string;
}) {
  const imageUri = text?.match(IMAGE_MARKDOWN)?.[1];
  const normalizedUri = imageUri ? normalizeStorageUrl(imageUri) : undefined;
  const textWithoutImage = text?.replace(IMAGE_MARKDOWN, '').trim();

  return (
    <View className="gap-2">
      {normalizedUri ? (
        <ChatImageThumbnail uri={normalizedUri} accessibilityLabel="Shared image" />
      ) : null}
      {textWithoutImage ? (
        <MentionText text={textWithoutImage} color={textColor} mentionColor={mentionColor} />
      ) : null}
    </View>
  );
}
