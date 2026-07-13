import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import type { NoteAttachment } from '../services/notes';
import { refreshNoteAttachmentUrl } from '../services/notes';
import { useTheme } from '../theme';

interface NotePdfViewerProps {
  noteId: string;
  attachment: NoteAttachment;
  height?: number;
  /** When true, parent ScrollView should stop stealing vertical gestures. */
  onScrollLockChange?: (locked: boolean) => void;
}

/**
 * Android WebView cannot load app cache file:// PDFs (net::ERR_ACCESS_DENIED)
 * and has no built-in PDF plugin. Use a signed HTTPS URL; on Android embed via
 * Google's viewer. Always offer an external open fallback.
 */
function buildInAppViewerUri(signedUrl: string): string {
  if (Platform.OS === 'android') {
    return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(signedUrl)}`;
  }
  return signedUrl;
}

export function NotePdfViewer({
  noteId,
  attachment,
  height = 420,
  onScrollLockChange,
}: NotePdfViewerProps) {
  const { colors } = useTheme();
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webViewFailed, setWebViewFailed] = useState(false);
  const onScrollLockChangeRef = useRef(onScrollLockChange);
  onScrollLockChangeRef.current = onScrollLockChange;
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setParentLocked = useCallback((locked: boolean) => {
    onScrollLockChangeRef.current?.(locked);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWebViewFailed(false);
    setViewerUri(null);
    setSignedUrl(null);

    (async () => {
      try {
        const result = await refreshNoteAttachmentUrl(noteId, attachment.id);
        if (cancelled) return;
        if (!result?.url) {
          throw new Error('Document URL unavailable');
        }
        setSignedUrl(result.url);
        setViewerUri(buildInAppViewerUri(result.url));
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
      setParentLocked(false);
    };
  }, [noteId, attachment.id, setParentLocked]);

  const lockParentScroll = useCallback(() => {
    if (unlockTimerRef.current) {
      clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
    setParentLocked(true);
  }, [setParentLocked]);

  const unlockParentScroll = useCallback(() => {
    // Delay unlock so fling/scroll gestures inside the WebView can finish
    // before the parent ScrollView takes over again.
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = setTimeout(() => {
      unlockTimerRef.current = null;
      setParentLocked(false);
    }, 280);
  }, [setParentLocked]);

  const openExternally = useCallback(async () => {
    if (!signedUrl) return;
    try {
      await WebBrowser.openBrowserAsync(signedUrl, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });
    } catch {
      setError('Could not open document. Try again.');
    }
  }, [signedUrl]);

  if (loading) {
    return (
      <View className="items-center justify-center py-10" style={{ height, backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-sm mt-2" style={{ color: colors.textTertiary }}>
          Loading document...
        </Text>
      </View>
    );
  }

  if (error || !viewerUri) {
    return (
      <View
        className="items-center justify-center py-8 px-4 rounded-xl border"
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      >
        <Text className="text-sm text-center mb-3" style={{ color: colors.error }}>
          {error || 'Document unavailable'}
        </Text>
        {signedUrl ? (
          <Pressable
            onPress={() => void openExternally()}
            className="flex-row items-center gap-2 px-4 py-2 rounded-xl"
            style={{ backgroundColor: colors.primary }}
          >
            <Ionicons name="open-outline" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Open document</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      className="rounded-xl overflow-hidden border"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
    >
      <View
        className="px-3 py-2 border-b flex-row items-center justify-between gap-2"
        style={{ borderBottomColor: colors.border }}
      >
        <Text className="text-sm font-medium flex-1" numberOfLines={1} style={{ color: colors.text }}>
          {attachment.fileName || 'Document'}
        </Text>
        <Pressable
          onPress={() => void openExternally()}
          className="flex-row items-center gap-1 px-2 py-1 rounded-lg"
          accessibilityLabel="Open document externally"
        >
          <Ionicons name="open-outline" size={16} color={colors.primary} />
          <Text className="text-xs font-medium" style={{ color: colors.primary }}>
            Open
          </Text>
        </Pressable>
      </View>

      {webViewFailed ? (
        <View className="items-center justify-center px-4 py-10" style={{ height }}>
          <Text className="text-sm text-center mb-3" style={{ color: colors.textSecondary }}>
            In-app preview is unavailable for this file.
          </Text>
          <Pressable
            onPress={() => void openExternally()}
            className="flex-row items-center gap-2 px-4 py-2 rounded-xl"
            style={{ backgroundColor: colors.primary }}
          >
            <Ionicons name="open-outline" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Open document</Text>
          </Pressable>
        </View>
      ) : (
        <View
          style={{ height }}
          collapsable={false}
          onTouchStart={lockParentScroll}
          onTouchEnd={unlockParentScroll}
          onTouchCancel={unlockParentScroll}
        >
          <WebView
            source={{ uri: viewerUri }}
            style={{ flex: 1, height }}
            originWhitelist={['https://*', 'http://*']}
            startInLoadingState
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            nestedScrollEnabled
            scrollEnabled
            overScrollMode="content"
            scalesPageToFit
            onTouchStart={lockParentScroll}
            onTouchEnd={unlockParentScroll}
            onTouchCancel={unlockParentScroll}
            onError={() => {
              setParentLocked(false);
              setWebViewFailed(true);
            }}
            onHttpError={() => {
              setParentLocked(false);
              setWebViewFailed(true);
            }}
            renderLoading={() => (
              <View
                className="absolute inset-0 items-center justify-center"
                style={{ backgroundColor: colors.surface }}
              >
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          />
        </View>
      )}
      <Text className="text-[11px] px-3 py-2" style={{ color: colors.textTertiary }}>
        Scroll inside this preview · tap Open for full screen
      </Text>
    </View>
  );
}

export default NotePdfViewer;
