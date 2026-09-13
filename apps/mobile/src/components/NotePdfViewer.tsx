import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';
import type { NoteAttachment } from '../services/notes';
import {
  describeAttachmentUrlError,
  fetchNoteAttachmentUrl,
  logLectureMedia,
} from '../services/noteAttachmentUrl';
import {
  attachmentSizeBytes,
  cachedPdfFileName,
  contentLengthBytes,
  describePdfOpenFailure,
  formatFileSize,
  planPdfPreview,
  type PdfPreviewPlan,
} from './notePdfPreview';
import { useTheme } from '../theme';
import { T } from './ui';
import { AppIcon } from './ui/AppIcon';

interface NotePdfViewerProps {
  noteId: string;
  attachment: NoteAttachment;
  height?: number;
  /** When true, parent ScrollView should stop stealing vertical gestures. */
  onScrollLockChange?: (locked: boolean) => void;
}

export function NotePdfViewer({
  noteId,
  attachment,
  height = 420,
  onScrollLockChange,
}: NotePdfViewerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<PdfPreviewPlan | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webViewFailed, setWebViewFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  /** Filled from the signed URL when the row never recorded a byte count. */
  const [probedSize, setProbedSize] = useState<number | undefined>(undefined);
  /** What the WebView itself said. Shown instead of a guess about connectivity. */
  const [webViewReason, setWebViewReason] = useState<string | null>(null);
  // Fullscreen is a nested RN Modal, which is safe because the note editor is
  // a plain stack screen — never move this component into a fullScreenModal
  // screen without turning the viewer into its own route first (nested Modals
  // fail silently there; see TestResultsScreen.tsx).
  const [fullscreen, setFullscreen] = useState(false);
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
    setWebViewReason(null);
    setPlan(null);
    setSignedUrl(null);
    setProbedSize(undefined);

    (async () => {
      try {
        const url = await fetchNoteAttachmentUrl(noteId, attachment.id);
        if (cancelled) return;
        setSignedUrl(url);
        setPlan(planPdfPreview(url, Platform.OS));
        // Size, second source. Only when the row has none, only a HEAD (no
        // body), and a refusal is silent — the card just keeps saying "PDF"
        // rather than inventing a figure.
        if (attachmentSizeBytes(attachment.metadata) === undefined) {
          void (async () => {
            try {
              const head = await fetch(url, { method: 'HEAD' });
              const bytes = contentLengthBytes(head.headers);
              if (!cancelled && bytes) setProbedSize(bytes);
            } catch {
              // No size is an honest state; a failed probe is not an error
              // the student can act on, so it never reaches the screen.
            }
          })();
        }
      } catch (err: unknown) {
        if (!cancelled) {
          // The server's own sentence and status, never "you may be offline":
          // a 400 "No storage path available for this attachment" is not a
          // connectivity problem and telling the student it is wastes their day.
          logLectureMedia('pdf:sign', {
            noteId,
            attachmentId: attachment.id,
            message: err instanceof Error ? err.message : String(err),
          });
          setError(describeAttachmentUrlError(err, 'Failed to load document'));
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

  /**
   * Open the file the student actually asked for.
   *
   * The signed URL is downloaded HERE, by the app, rather than handed to a
   * remote renderer: the link is short-lived and scoped to this session, so
   * anything else fetching it fails. The cached copy then goes to the system
   * viewer through the share sheet (every Android phone has a PDF handler;
   * iOS previews it inline). A browser tab on the signed URL is the fallback,
   * and if even that refuses, the student reads OUR reason, with the status.
   */
  const openExternally = useCallback(async () => {
    if (!signedUrl) return;
    setOpening(true);
    try {
      const target = `${FileSystem.cacheDirectory}${cachedPdfFileName(attachment.fileName, attachment.id)}`;
      const result = await FileSystem.downloadAsync(signedUrl, target);
      // Third source, and the most certain one: this IS the file on disk.
      const downloaded = contentLengthBytes(result.headers);
      if (downloaded) setProbedSize(downloaded);
      if (result.status >= 400) {
        throw Object.assign(new Error('The file could not be downloaded.'), {
          status: result.status,
        });
      }
      // Lazy, like shareFile.ts: expo-sharing is a native module and a
      // top-level import crashes any binary built before it existed.
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: attachment.fileName || 'Document',
        });
        return;
      }
      throw new Error('No app on this device can open a PDF.');
    } catch (err: unknown) {
      const status = (err as { status?: number } | null)?.status;
      const message = err instanceof Error ? err.message : String(err);
      logLectureMedia('pdf:open', { noteId, attachmentId: attachment.id, status, message });
      try {
        await WebBrowser.openBrowserAsync(signedUrl, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        });
      } catch (browserErr: unknown) {
        logLectureMedia('pdf:open:browser', {
          noteId,
          attachmentId: attachment.id,
          message: browserErr instanceof Error ? browserErr.message : String(browserErr),
        });
        setError(describePdfOpenFailure({ status, message }));
      }
    } finally {
      setOpening(false);
    }
  }, [signedUrl, noteId, attachment.id, attachment.fileName]);

  const webViewFallback = (fallbackHeight?: number) => (
    <View className="items-center justify-center px-4 py-10" style={fallbackHeight ? { height: fallbackHeight } : { flex: 1 }}>
      <Text className="text-sm text-center" style={{ color: colors.textSecondary }}>
        In-app preview is unavailable for this file.
      </Text>
      {webViewReason ? (
        <Text className="text-label text-center mb-3 mt-1" style={{ color: colors.textTertiary }}>
          {webViewReason}
        </Text>
      ) : (
        <View className="mb-3" />
      )}
      <Pressable
        onPress={() => void openExternally()}
        className="flex-row items-center gap-2 px-4 py-2 rounded-xl"
        style={{ backgroundColor: colors.primaryFill }}
      >
        <AppIcon name="open" size={18} color="#fff" />
        <Text className="text-sm font-semibold text-white">Open document</Text>
      </Pressable>
    </View>
  );

  if (loading) {
    return (
      <View className="items-center justify-center py-10" style={{ height, backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.primaryText} />
        <Text className="text-sm mt-2" style={{ color: colors.textTertiary }}>
          Loading document...
        </Text>
      </View>
    );
  }

  if (error || !plan) {
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
            style={{ backgroundColor: colors.primaryFill }}
          >
            <AppIcon name="open" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Open document</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (plan.kind === 'external') {
    // Android: no in-app PDF renderer exists here without a new native
    // dependency, so say so plainly and hand the file over, rather than
    // embedding a remote viewer that cannot read a private signed link and
    // blames the student's connection for it.
    const sizeLabel = formatFileSize(attachmentSizeBytes(attachment.metadata) ?? probedSize);
    return (
      <View
        className="rounded-xl border p-4"
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      >
        <View className="flex-row items-center gap-3">
          <AppIcon name="document" size={28} color={colors.primaryText} />
          <View className="flex-1">
            <T.Body numberOfLines={2} style={{ fontWeight: '600' }}>
              {attachment.fileName || 'Document'}
            </T.Body>
            <T.Label tone="tertiary" className="mt-0.5">
              {sizeLabel ? `PDF · ${sizeLabel}` : 'PDF'}
            </T.Label>
          </View>
        </View>
        <T.Label tone="secondary" className="mt-3">
          Android has no in-app PDF preview. Open it in your PDF app — the file is
          downloaded from your own session, so it works on a private link.
        </T.Label>
        <Pressable
          onPress={() => void openExternally()}
          disabled={opening}
          accessibilityRole="button"
          accessibilityLabel="Open PDF"
          accessibilityState={{ disabled: opening }}
          className="flex-row items-center justify-center gap-2 px-4 py-2.5 rounded-xl mt-3"
          style={{ backgroundColor: colors.primaryFill, opacity: opening ? 0.6 : 1 }}
        >
          {opening ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <AppIcon name="open" size={18} color="#fff" />
          )}
          <T.Label style={{ color: '#fff', fontWeight: '600' }}>
            {opening ? 'Opening…' : 'Open PDF'}
          </T.Label>
        </Pressable>
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
          onPress={() => setFullscreen(true)}
          className="flex-row items-center gap-1 px-2 py-1 rounded-lg"
          accessibilityRole="button"
          accessibilityLabel="View document fullscreen"
        >
          <AppIcon name="expand" size={16} color={colors.primaryText} />
          <Text className="text-xs font-medium" style={{ color: colors.primaryText }}>
            Fullscreen
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void openExternally()}
          className="flex-row items-center gap-1 px-2 py-1 rounded-lg"
          accessibilityRole="button"
          accessibilityLabel="Open document externally"
        >
          <AppIcon name="open" size={16} color={colors.primaryText} />
          <Text className="text-xs font-medium" style={{ color: colors.primaryText }}>
            Open
          </Text>
        </Pressable>
      </View>

      {webViewFailed ? (
        webViewFallback(height)
      ) : (
        <View
          style={{ height }}
          collapsable={false}
          onTouchStart={lockParentScroll}
          onTouchEnd={unlockParentScroll}
          onTouchCancel={unlockParentScroll}
        >
          <WebView
            source={{ uri: plan.kind === 'webview' ? plan.uri : '' }}
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
            onError={(event) => {
              const { description, code } = event.nativeEvent;
              logLectureMedia('pdf:webview', {
                attachmentId: attachment.id,
                status: typeof code === 'number' ? code : undefined,
                message: description,
              });
              setParentLocked(false);
              setWebViewReason(description || null);
              setWebViewFailed(true);
            }}
            onHttpError={(event) => {
              const { statusCode, description } = event.nativeEvent;
              logLectureMedia('pdf:webview:http', {
                attachmentId: attachment.id,
                status: statusCode,
                message: description,
              });
              setParentLocked(false);
              setWebViewReason(
                statusCode ? `The preview service answered ${statusCode}.` : description || null
              );
              setWebViewFailed(true);
            }}
            renderLoading={() => (
              <View
                className="absolute inset-0 items-center justify-center"
                style={{ backgroundColor: colors.surface }}
              >
                <ActivityIndicator size="large" color={colors.primaryText} />
              </View>
            )}
          />
        </View>
      )}
      <Text className="text-[11px] px-3 py-2" style={{ color: colors.textTertiary }}>
        Scroll inside this preview · tap Fullscreen for more room
      </Text>

      <Modal
        visible={fullscreen}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setFullscreen(false)}
      >
        <View className="flex-1" style={{ backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View
            className="px-3 py-2 border-b flex-row items-center justify-between gap-2"
            style={{ borderBottomColor: colors.border, backgroundColor: colors.surface }}
          >
            <Text className="text-sm font-medium flex-1" numberOfLines={1} style={{ color: colors.text }}>
              {attachment.fileName || 'Document'}
            </Text>
            <Pressable
              onPress={() => void openExternally()}
              className="p-2"
              accessibilityRole="button"
              accessibilityLabel="Open document externally"
            >
              <AppIcon name="open" size={20} color={colors.primaryText} />
            </Pressable>
            <Pressable
              onPress={() => setFullscreen(false)}
              className="p-2"
              accessibilityRole="button"
              accessibilityLabel="Leave fullscreen"
            >
              <AppIcon name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          {webViewFailed ? (
            webViewFallback()
          ) : (
            // No parent ScrollView inside the Modal, so none of the
            // scroll-lock choreography the inline preview needs.
            <WebView
              source={{ uri: plan.kind === 'webview' ? plan.uri : '' }}
              style={{ flex: 1 }}
              originWhitelist={['https://*', 'http://*']}
              startInLoadingState
              setSupportMultipleWindows={false}
              javaScriptEnabled
              domStorageEnabled
              mixedContentMode="always"
              scalesPageToFit
              onError={(event) => {
              setWebViewReason(event.nativeEvent.description || null);
              setWebViewFailed(true);
            }}
              onHttpError={() => setWebViewFailed(true)}
              renderLoading={() => (
                <View
                  className="absolute inset-0 items-center justify-center"
                  style={{ backgroundColor: colors.background }}
                >
                  <ActivityIndicator size="large" color={colors.primaryText} />
                </View>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

export default NotePdfViewer;
