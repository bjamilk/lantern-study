/**
 * Chat wallpaper — the layer painted behind a transcript, and the hook that
 * resolves which photo (if any) a given chat should show.
 *
 * HARD RULE: `ChatWallpaperLayer` must be an absolutely-positioned SIBLING of
 * the FlatList — never a descendant, never `ListHeaderComponent`, never in
 * `contentContainerStyle`, never an ImageBackground wrapping the list content.
 * Inside the list the image is laid out against the FULL content height, so a
 * long transcript asks Android to composite a bitmap tens of thousands of
 * points tall — an out-of-memory crash on exactly the phones this is for. The
 * wallpaper is fixed; it does not scroll.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '../../stores/authStore';
import { useChatWallpaperStore } from '../../stores/chatWallpaperStore';
import {
  absoluteWallpaperUri,
  resolveChatWallpaper,
  wallpaperScrimAlpha,
  type WallpaperPhoto,
} from '../../utils/chatWallpaper';
import { useTheme, withAlpha } from '../../theme';

export interface ChatWallpaperViewModel {
  /** Absolute file:// uri, or null when this chat has no wallpaper. */
  uri: string | null;
  photo: WallpaperPhoto | null;
  active: boolean;
  scrimColor: string;
  /** What the message list's own background should be. */
  listBackgroundColor: string;
  /** Opaque pill for text that would otherwise sit on the photo. */
  pillStyle: ViewStyle | undefined;
  onImageError: () => void;
}

export function useChatWallpaper(scopeKey: string | null): ChatWallpaperViewModel {
  const { colors, isDark, effects } = useTheme();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const manifest = useChatWallpaperStore((s) => s.manifest);
  const storeUserId = useChatWallpaperStore((s) => s.userId);
  const hydrated = useChatWallpaperStore((s) => s.hydrated);
  const hydrate = useChatWallpaperStore((s) => s.hydrate);
  const forgetMissing = useChatWallpaperStore((s) => s.forgetMissing);

  useEffect(() => {
    void hydrate(userId);
  }, [hydrate, userId]);

  /**
   * PRIVACY GATE. The store is module state that outlives a sign-out, and
   * hydrate is an effect — it runs AFTER the first paint. Without this, two
   * students sharing a handset would see the first one's personal photo painted
   * behind the second one's transcript for the whole hydrate window (an
   * AsyncStorage read plus N getInfoAsync calls: 100-300ms on a cheap phone).
   * Show nothing until the store is known to hold THIS user's manifest.
   */
  const ready = hydrated && userId !== null && storeUserId === userId;

  const photo = useMemo(
    () => (ready && scopeKey ? resolveChatWallpaper(manifest, scopeKey) : null),
    [ready, manifest, scopeKey],
  );
  const uri = useMemo(
    () => absoluteWallpaperUri(FileSystem.documentDirectory ?? null, photo),
    [photo],
  );
  const active = uri !== null;

  const scrimColor = useMemo(
    () =>
      withAlpha(
        colors.chatBackground,
        wallpaperScrimAlpha({ isDark, highContrast: effects.highContrast }),
      ),
    [colors.chatBackground, isDark, effects.highContrast],
  );

  // Fully opaque, so it holds contrast over ANY photo: light #f1f5f9 against
  // textSecondary #475569 is about 7.4:1, dark #1a1d21 against #94a3b8 about
  // 6.6:1 — both clear AA at the 11px sizes these pills carry.
  const pillStyle = useMemo<ViewStyle | undefined>(
    () =>
      active
        ? {
            backgroundColor: colors.surfaceSecondary,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: withAlpha(colors.border, 0.8),
          }
        : undefined,
    [active, colors.surfaceSecondary, colors.border],
  );

  const onImageError = useCallback(() => {
    if (photo) forgetMissing(photo.path);
  }, [forgetMissing, photo]);

  return {
    uri,
    photo,
    active,
    scrimColor,
    listBackgroundColor: active ? 'transparent' : colors.chatBackground,
    pillStyle,
    onImageError,
  };
}

interface ChatWallpaperLayerProps {
  uri: string | null;
  scrimColor: string;
  onError: () => void;
}

export function ChatWallpaperLayer({ uri, scrimColor, onError }: ChatWallpaperLayerProps) {
  if (!uri) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        // Plain RN Image: expo-image is not installed, and is not needed for a
        // single static local file. resizeMethod="resize" caps the Android
        // decode near screen size instead of decoding the full JPEG.
        // Keyed by uri so swapping the photo mounts a FRESH Image: without it a
        // late onError from the previous file would be delivered against the
        // new one's handler.
        key={uri}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        resizeMethod="resize"
        fadeDuration={0}
        onError={onError}
        accessible={false}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]} />
    </View>
  );
}

/**
 * "Saving background…" while the picked photo is prepared.
 *
 * The action sheet closes before the work starts (ActionSheet.select dismisses
 * first, on purpose), and preparing a 12 MP photo on an entry-level Android is
 * two full ImageManipulator passes plus a file copy — several seconds during
 * which the chat looks completely unchanged. Without this the student assumes
 * the tap missed and picks again.
 */
export function ChatWallpaperBusyOverlay() {
  const { colors } = useTheme();
  const busy = useChatWallpaperStore((s) => s.busy);
  if (!busy) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      className="items-center justify-center"
    >
      <View
        className="flex-row items-center gap-2 rounded-full px-4 py-2.5"
        style={{
          backgroundColor: colors.surfaceSecondary,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        accessibilityLabel="Saving your chat background"
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <Text className="text-sm font-medium" style={{ color: colors.text }}>
          Saving background…
        </Text>
      </View>
    </View>
  );
}
