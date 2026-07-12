import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import type { NoteAttachment } from '../services/notes';
import { fetchNoteAttachmentContent } from '../services/notes';

interface NotePdfViewerProps {
  noteId: string;
  attachment: NoteAttachment;
  height?: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function NotePdfViewer({ noteId, attachment, height = 420 }: NotePdfViewerProps) {
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const buffer = await fetchNoteAttachmentContent(noteId, attachment.id);
        if (cancelled) return;
        const fileUri = `${FileSystem.cacheDirectory}note-${attachment.id}.pdf`;
        await FileSystem.writeAsStringAsync(fileUri, arrayBufferToBase64(buffer), {
          encoding: 'base64',
        });
        if (!cancelled) setPdfUri(fileUri);
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
    };
  }, [noteId, attachment.id]);

  if (loading) {
    return (
      <View className="items-center justify-center py-10" style={{ height }}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text className="text-sm text-lantern-text-tertiary mt-2">Loading document...</Text>
      </View>
    );
  }

  if (error || !pdfUri) {
    return (
      <View className="items-center justify-center py-8 px-4 rounded-xl border border-lantern-border bg-lantern-surface">
        <Text className="text-sm text-red-500 text-center">{error || 'Document unavailable'}</Text>
      </View>
    );
  }

  return (
    <View className="rounded-xl overflow-hidden border border-lantern-border bg-lantern-surface">
      <View className="px-3 py-2 border-b border-lantern-border">
        <Text className="text-sm font-medium text-lantern-text" numberOfLines={1}>
          {attachment.fileName || 'Document'}
        </Text>
      </View>
      <WebView
        source={{ uri: pdfUri }}
        style={{ height }}
        originWhitelist={['*']}
        startInLoadingState
        renderLoading={() => (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        )}
      />
    </View>
  );
}

export default NotePdfViewer;
