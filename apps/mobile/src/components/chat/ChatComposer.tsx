import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { buildChatAudioMarkdown } from '@lantern/shared/utils';
import { Button } from '../ui';
import { useTheme } from '../../theme';
import { featureAccents } from '@lantern/shared/design';
import { uploadChatAudio } from '../../services/chatAudioUpload';

export type MentionCandidate = {
  id: string;
  username: string;
  name?: string;
};

export type ReplyPreview = {
  id: string;
  senderName?: string;
  text?: string;
};

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onAttachImage?: (uri: string, mimeType?: string | null) => Promise<void>;
  sending?: boolean;
  placeholder?: string;
  mentionCandidates?: MentionCandidate[];
  seedMentionUsername?: string | null;
  onSeedMentionConsumed?: () => void;
  replyTo?: ReplyPreview | null;
  onClearReply?: () => void;
  editingMessage?: { id: string; text: string } | null;
  onCancelEdit?: () => void;
  groupId?: string;
  threadId?: string;
  onSendAudioMarkdown?: (markdown: string) => Promise<void>;
}

const MAX_VOICE_MS = 120_000;

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onAttachImage,
  sending = false,
  placeholder = 'Message...',
  mentionCandidates = [],
  seedMentionUsername = null,
  onSeedMentionConsumed,
  replyTo,
  onClearReply,
  editingMessage,
  onCancelEdit,
  groupId,
  threadId,
  onSendAudioMarkdown,
}: ChatComposerProps) {
  const { colors } = useTheme();
  const [attaching, setAttaching] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const recordingRef = useRef<{
    stopAndUnloadAsync: () => Promise<unknown>;
    getURI: () => string | null;
  } | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);

  const focusComposer = () => {
    if (isRecording || uploadingAudio) return;
    inputRef.current?.focus();
  };

  useEffect(() => {
    return () => {
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      void recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  // Ready-to-type when opening a chat session (group or DM).
  useEffect(() => {
    if (!groupId && !threadId) return;
    const timer = setTimeout(() => focusComposer(), 80);
    return () => clearTimeout(timer);
  }, [groupId, threadId]);

  // Ready-to-type when starting a reply or edit.
  useEffect(() => {
    if (!replyTo?.id && !editingMessage?.id) return;
    const timer = setTimeout(() => focusComposer(), 0);
    return () => clearTimeout(timer);
  }, [replyTo?.id, editingMessage?.id]);

  useEffect(() => {
    const raw = seedMentionUsername?.trim();
    if (!raw) return;
    const username = raw.startsWith('@') ? raw.slice(1) : raw;
    if (!username) {
      onSeedMentionConsumed?.();
      return;
    }
    const needsSpace = value.length > 0 && !/\s$/.test(value);
    onChangeText(`${value}${needsSpace ? ' ' : ''}@${username} `);
    setMentionQuery(null);
    onSeedMentionConsumed?.();
    requestAnimationFrame(focusComposer);
  }, [seedMentionUsername]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery == null || !mentionCandidates.length) return [];
    const q = mentionQuery.toLowerCase();
    return mentionCandidates
      .filter(
        (m) =>
          m.username &&
          (m.username.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [mentionQuery, mentionCandidates]);

  const detectMention = (text: string) => {
    const match = text.match(/(^|[\s])@([a-zA-Z0-9_]*)$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(match[2] || '');
  };

  const insertMention = (candidate: MentionCandidate) => {
    const replaced = value.replace(/(^|[\s])@([a-zA-Z0-9_]*)$/, `$1@${candidate.username} `);
    onChangeText(replaced);
    setMentionQuery(null);
  };

  const pickImage = async () => {
    if (!onAttachImage || attaching) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setAttaching(true);
    try {
      await onAttachImage(asset.uri, asset.mimeType);
    } finally {
      setAttaching(false);
    }
  };

  const stopRecording = async () => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    const recording = recordingRef.current;
    if (!recording) {
      setIsRecording(false);
      return;
    }
    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      const elapsed = Date.now() - startedAtRef.current;
      if (!uri || elapsed < 400) {
        Alert.alert('Voice note', 'Recording was too short. Hold a bit longer.');
        return;
      }
      if (!onSendAudioMarkdown) return;
      setUploadingAudio(true);
      try {
        const lower = uri.toLowerCase();
        const mimeType = lower.endsWith('.webm')
          ? 'audio/webm'
          : lower.endsWith('.wav')
            ? 'audio/wav'
            : lower.endsWith('.ogg')
              ? 'audio/ogg'
              : 'audio/mp4';
        const { url } = await uploadChatAudio(uri, mimeType, { groupId, threadId });
        await onSendAudioMarkdown(buildChatAudioMarkdown(url));
      } catch (err: any) {
        Alert.alert('Voice note', err?.message || 'Could not upload voice note');
      } finally {
        setUploadingAudio(false);
      }
    } catch {
      recordingRef.current = null;
      Alert.alert('Voice note', 'Could not finish recording.');
    }
  };

  const startRecording = async () => {
    if (!onSendAudioMarkdown || uploadingAudio || sending) return;
    try {
      const { Audio } = await import('expo-av');
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone', 'Microphone permission is required for voice notes.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      startedAtRef.current = Date.now();
      setIsRecording(true);
      maxTimerRef.current = setTimeout(() => {
        void stopRecording();
      }, MAX_VOICE_MS);
    } catch {
      Alert.alert('Voice note', 'Could not start recording.');
    }
  };

  const busy = sending || attaching || uploadingAudio;
  const showMic = !editingMessage && !value.trim() && !!onSendAudioMarkdown;

  return (
    <View>
      {replyTo ? (
        <View
          className="flex-row items-start gap-2 px-3 pt-2"
          style={{ backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1 }}
        >
          <View className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: colors.backgroundSecondary }}>
            <Text className="text-[11px] font-semibold" style={{ color: colors.primary }}>
              Replying to {replyTo.senderName || 'message'}
            </Text>
            <Text className="text-xs" numberOfLines={1} style={{ color: colors.textSecondary }}>
              {(replyTo.text || 'Message').slice(0, 80)}
            </Text>
          </View>
          <Pressable onPress={onClearReply} accessibilityLabel="Cancel reply" className="p-2">
            <Ionicons name="close" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}

      {editingMessage ? (
        <View
          className="flex-row items-start gap-2 px-3 pt-2"
          style={{ backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1 }}
        >
          <View className="flex-1 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: colors.primaryBackground }}>
            <Text className="text-[11px] font-semibold" style={{ color: colors.primary }}>
              Editing message
            </Text>
            <Text className="text-xs" style={{ color: colors.textSecondary }}>
              Original 30-minute window applies
            </Text>
          </View>
          <Pressable onPress={onCancelEdit} accessibilityLabel="Cancel edit" className="p-2">
            <Ionicons name="close" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}

      {mentionMatches.length > 0 ? (
        <View className="mx-3 mb-1 rounded-xl border overflow-hidden" style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
          {mentionMatches.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => insertMention(m)}
              className="px-3 py-2 border-b"
              style={{ borderBottomColor: colors.border }}
            >
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                {m.name || `@${m.username}`}
                {m.name ? (
                  <Text style={{ color: colors.textSecondary }}>  @{m.username}</Text>
                ) : null}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View
        className="flex-row items-end gap-2 px-3 py-2 border-t border-lantern-border bg-lantern-surface"
        style={{ borderTopColor: colors.border }}
      >
        {onAttachImage && !editingMessage ? (
          <Pressable
            onPress={() => void pickImage()}
            disabled={busy || isRecording}
            className="p-2 mb-0.5 min-w-[44px] min-h-[44px] items-center justify-center"
            accessibilityLabel="Attach image"
          >
            {attaching ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="image-outline" size={24} color={featureAccents.groups} />
            )}
          </Pressable>
        ) : null}

        {showMic || isRecording ? (
          <Pressable
            onPress={() => {
              if (isRecording) void stopRecording();
              else void startRecording();
            }}
            disabled={uploadingAudio}
            className="p-2 mb-0.5 min-w-[44px] min-h-[44px] items-center justify-center rounded-xl"
            style={{ backgroundColor: isRecording ? '#ef4444' : colors.backgroundSecondary }}
            accessibilityLabel={isRecording ? 'Stop recording' : 'Record voice note'}
          >
            {uploadingAudio ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="mic" size={22} color={isRecording ? '#fff' : colors.primary} />
            )}
          </Pressable>
        ) : null}

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(next) => {
            onChangeText(next);
            detectMention(next);
          }}
          placeholder={
            isRecording
              ? 'Recording… tap mic to stop'
              : uploadingAudio
                ? 'Uploading voice note…'
                : editingMessage
                  ? 'Edit message...'
                  : placeholder
          }
          placeholderTextColor={colors.inputPlaceholder}
          multiline
          editable={!busy && !isRecording}
          className="flex-1 max-h-28 px-3 py-2.5 rounded-2xl border border-lantern-border bg-lantern-background text-sm text-lantern-text"
          style={{
            borderColor: colors.inputBorder,
            backgroundColor: colors.inputBackground,
            color: colors.inputText,
          }}
        />
        <Button size="sm" loading={sending} disabled={!value.trim() || busy || isRecording} onPress={onSend}>
          Send
        </Button>
      </View>
    </View>
  );
}
