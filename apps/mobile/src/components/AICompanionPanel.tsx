import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import type { CompanionUserContext } from '@lantern/shared';
import { useCompanionStore } from '../stores/companionStore';
import { useNotesStore } from '../stores/notesStore';
import { useToastStore } from '../stores/toastStore';
import { AIDisclaimer } from './AIDisclaimer';
import { useAuthStore } from '../stores/authStore';
import { useAppTheme } from '../theme';
import { Button } from './ui';
import { transcribeAudioForNote } from '../services/notes';
import { trackAIAnalyticsEvent } from '../services/ai';

const QUICK_PROMPTS = [
  'What should I study today?',
  'Generate flashcards for my weak topics',
  'Quiz me on my weak topics',
  'Give me a study tip',
  'Explain spaced repetition',
];

const MIN_DICTATION_MS = 800;
const MAX_DICTATION_MS = 60_000;

type RecordingHandle = {
  stopAndUnloadAsync: () => Promise<void>;
  getURI: () => string | null;
};

interface Props {
  context?: CompanionUserContext;
}

export function AICompanionPanel({ context }: Props) {
  const theme = useAppTheme();
  const user = useAuthStore(s => s.user);
  const showToast = useToastStore(s => s.showToast);
  const {
    isOpen,
    close,
    messages,
    isLoading,
    isLoadingHistory,
    historyLoaded,
    isStreaming,
    error,
    loadHistory,
    sendMessageStreaming,
    clearHistory,
    clearError,
    pendingMessage,
    setPendingMessage,
    activeNoteContext,
    setActiveNoteContext,
    hydrateNoteContext,
  } = useCompanionStore();
  const notes = useNotesStore((s) => s.notes);
  const notesLoading = useNotesStore((s) => s.isLoading);
  const loadNotes = useNotesStore((s) => s.loadNotes);

  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');
  const hasLoaded = useRef(false);
  const didAutoAttachRef = useRef(false);
  const listRef = useRef<FlatList>(null);
  const inputValueRef = useRef('');
  const recordingRef = useRef<RecordingHandle | null>(null);
  const recordingStartedAtRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secondsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);

  const userName =
    user?.user_metadata?.name ||
    user?.user_metadata?.first_name ||
    user?.email?.split('@')[0] ||
    'Student';

  const enrichedContext: CompanionUserContext = useMemo(
    () => ({
      userName,
      ...context,
    }),
    [userName, context]
  );

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!isOpen || !user?.id) return;
    if (hasLoaded.current) return;
    hasLoaded.current = true;
    void (async () => {
      await hydrateNoteContext();
      if (!useCompanionStore.getState().activeNoteContext && context?.noteId && !didAutoAttachRef.current) {
        didAutoAttachRef.current = true;
        await setActiveNoteContext({
          id: context.noteId,
          title: context.noteTitle || 'Untitled note',
        });
        return;
      }
      await loadHistory();
    })();
  }, [isOpen, user?.id, hydrateNoteContext, loadHistory, setActiveNoteContext, context?.noteId, context?.noteTitle]);

  useEffect(() => {
    if (!isOpen) {
      hasLoaded.current = false;
      didAutoAttachRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!showNotePicker) return;
    if (notes.length === 0) void loadNotes();
  }, [showNotePicker, notes.length, loadNotes]);

  const filteredNotes = useMemo(() => {
    const active = notes.filter((n) => !n.isArchived);
    const q = noteSearch.trim().toLowerCase();
    if (!q) return active;
    return active.filter((n) => (n.title || '').toLowerCase().includes(q));
  }, [notes, noteSearch]);

  const handleSelectNote = useCallback(
    async (note: { id: string; title?: string | null }) => {
      setShowNotePicker(false);
      setNoteSearch('');
      await setActiveNoteContext({
        id: note.id,
        title: (note.title || '').trim() || 'Untitled note',
      });
      trackAIAnalyticsEvent('companion_note_context_attached', { noteId: note.id });
    },
    [setActiveNoteContext]
  );

  useEffect(() => {
    if (
      isOpen &&
      pendingMessage &&
      historyLoaded &&
      !isLoadingHistory &&
      !isLoading &&
      !isStreaming
    ) {
      const msg = pendingMessage;
      setPendingMessage(null);
      void sendMessageStreaming(msg, enrichedContext);
    }
  }, [
    isOpen,
    pendingMessage,
    historyLoaded,
    isLoadingHistory,
    isLoading,
    isStreaming,
    setPendingMessage,
    sendMessageStreaming,
    enrichedContext,
  ]);

  const clearRecordingTimers = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (secondsTimerRef.current) {
      clearInterval(secondsTimerRef.current);
      secondsTimerRef.current = null;
    }
  }, []);

  const finishDictation = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    clearRecordingTimers();
    setIsRecording(false);
    setRecordingSeconds(0);
    recordingRef.current = null;

    if (discardRecordingRef.current) {
      discardRecordingRef.current = false;
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore unload errors when discarding
      }
      return;
    }

    const elapsed = Date.now() - recordingStartedAtRef.current;
    if (elapsed < MIN_DICTATION_MS) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      showToast('Recording was too short. Hold the mic a bit longer.', 'error');
      return;
    }

    setIsTranscribing(true);
    const abortController = new AbortController();
    transcribeAbortRef.current = abortController;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error('No recording file');

      const info = await FileSystem.getInfoAsync(uri);
      const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
      });
      if (!base64 || base64.length < 64 || (byteLength > 0 && byteLength < 256)) {
        throw new Error('Recording was empty. Hold a bit longer, then stop again.');
      }

      const lowerUri = uri.toLowerCase();
      const mimeType = lowerUri.endsWith('.webm')
        ? 'audio/webm'
        : lowerUri.endsWith('.wav')
          ? 'audio/wav'
          : lowerUri.endsWith('.ogg')
            ? 'audio/ogg'
            : 'audio/mp4';
      const ext = lowerUri.endsWith('.webm')
        ? 'webm'
        : lowerUri.endsWith('.wav')
          ? 'wav'
          : lowerUri.endsWith('.ogg')
            ? 'ogg'
            : 'm4a';

      const result = await transcribeAudioForNote(base64, {
        mimeType,
        fileName: `companion-dictation-${Date.now()}.${ext}`,
        signal: abortController.signal,
        durationMs: elapsed,
        clientByteLength: byteLength || undefined,
        localFileUri: uri,
        // Prefer signed-URL storage so longer clips avoid proxy empty-body failures.
        useStoragePath: true,
      });

      const transcript = (result.transcript || '').trim();
      if (!transcript) {
        showToast('Could not hear that clearly. Try again.', 'info');
        return;
      }

      const next = [inputValueRef.current.trim(), transcript].filter(Boolean).join(' ');
      setInput(next);
      inputValueRef.current = next;
      trackAIAnalyticsEvent('companion_voice_dictation', {
        screen: context?.currentScreen,
        duration_ms: elapsed,
      });
    } catch (e: unknown) {
      if (!transcribeAbortRef.current && e instanceof Error && e.name === 'AbortError') return;
      const message =
        e instanceof Error && e.name === 'AbortError'
          ? 'Transcription cancelled.'
          : e instanceof Error
            ? e.message
            : 'Could not transcribe audio';
      showToast(message, 'error');
    } finally {
      transcribeAbortRef.current = null;
      setIsTranscribing(false);
    }
  }, [clearRecordingTimers, context?.currentScreen, showToast]);

  const startDictation = useCallback(async () => {
    if (isRecording || isTranscribing) return;
    discardRecordingRef.current = false;
    try {
      const { Audio } = await import('expo-av');
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Microphone access is required for voice dictation.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = rec as unknown as RecordingHandle;
      recordingStartedAtRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);
      secondsTimerRef.current = setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      }, 250);
      maxTimerRef.current = setTimeout(() => {
        void finishDictation();
      }, MAX_DICTATION_MS);
      trackAIAnalyticsEvent('companion_voice_dictation_start', {
        screen: context?.currentScreen,
      });
    } catch {
      Alert.alert('Error', 'Could not start recording. Check microphone permission and try again.');
    }
  }, [context?.currentScreen, finishDictation, isRecording, isTranscribing]);

  const discardDictation = useCallback(() => {
    discardRecordingRef.current = true;
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    clearRecordingTimers();
    setIsTranscribing(false);
    setIsRecording(false);
    setRecordingSeconds(0);
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      void recording.stopAndUnloadAsync().catch(() => undefined);
    }
  }, [clearRecordingTimers]);

  useEffect(() => {
    if (isOpen) return;
    discardDictation();
  }, [isOpen, discardDictation]);

  useEffect(() => {
    return () => {
      discardDictation();
    };
  }, [discardDictation]);

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || isLoading || isStreaming || isRecording || isTranscribing) return;
      setInput('');
      inputValueRef.current = '';
      await sendMessageStreaming(msg, enrichedContext);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [input, isLoading, isStreaming, isRecording, isTranscribing, sendMessageStreaming, enrichedContext]
  );

  const isBusy = isLoading || isStreaming || isLoadingHistory;
  const dictationBusy = isRecording || isTranscribing;

  if (!isOpen) {
    return null;
  }

  return (
    <Modal visible={isOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView
        className={`flex-1 ${theme === 'dark' ? 'bg-lantern-background' : 'bg-lantern-surface'}`}
        edges={['top', 'bottom']}
      >
        <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
          <Ionicons name="sparkles" size={22} color="#6366f1" />
          <Text className="flex-1 ml-2 text-lg font-bold text-lantern-text dark:text-white">Lantern AI</Text>
          <Pressable onPress={() => void clearHistory()} className="p-2 mr-1">
            <Ionicons name="trash-outline" size={20} color="#94a3b8" />
          </Pressable>
          <Pressable onPress={close} className="p-2">
            <Ionicons name="close" size={24} color="#94a3b8" />
          </Pressable>
        </View>
        <View className="px-4 pb-2">
          <AIDisclaimer compact textColor="#64748b" linkColor="#6366f1" />
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id || `${item.role}-${item.content.slice(0, 24)}`}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingVertical: 16, gap: 12 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            isLoadingHistory ? (
              <View className="py-8 items-center gap-2">
                <ActivityIndicator color="#6366f1" />
                <Text className="text-lantern-text-secondary text-center">
                  Loading conversation…
                </Text>
              </View>
            ) : (
            <View className="py-8">
              <Text className="text-lantern-text-secondary text-center mb-4">
                Ask anything about your study plan, flashcards, or tests.
              </Text>
              <View className="flex-row flex-wrap gap-2 justify-center">
                {QUICK_PROMPTS.map(p => (
                  <Pressable
                    key={p}
                    onPress={() => void handleSend(p)}
                    className="px-3 py-2 rounded-full bg-lantern-primary-background dark:bg-lantern-primary-background/50 border border-lantern-primary/30 dark:border-lantern-primary/30"
                  >
                    <Text className="text-xs text-lantern-primary">{p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            )
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View className={`max-w-[85%] ${isUser ? 'self-end' : 'self-start'}`}>
                <View
                  className={`px-4 py-3 rounded-2xl ${
                    isUser
                      ? 'bg-lantern-primary rounded-br-sm'
                      : 'bg-lantern-background-secondary rounded-bl-sm'
                  }`}
                >
                  <Text className={isUser ? 'text-white' : 'text-lantern-text'}>
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            isBusy || isTranscribing ? (
              <View className="py-2 items-start">
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : null
          }
        />

        {error ? (
          <Pressable onPress={clearError} className="mx-4 mb-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <Text className="text-red-600 dark:text-red-300 text-sm">{error}</Text>
          </Pressable>
        ) : null}

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className="px-4 py-3 border-t border-lantern-border">
            {activeNoteContext ? (
              <View className="mb-2 flex-row items-center self-start max-w-full rounded-full bg-lantern-primary-background dark:bg-lantern-primary/20 px-3 py-1.5">
                <Ionicons name="document-text-outline" size={14} color="#6366f1" />
                <Text className="ml-1.5 mr-2 flex-shrink text-xs font-medium text-lantern-primary" numberOfLines={1}>
                  {activeNoteContext.title}
                </Text>
                <Pressable
                  onPress={() => {
                    void setActiveNoteContext(null);
                    trackAIAnalyticsEvent('companion_note_context_cleared');
                  }}
                  hitSlop={8}
                  accessibilityLabel="Remove note context"
                >
                  <Ionicons name="close" size={14} color="#6366f1" />
                </Pressable>
              </View>
            ) : null}

            {showNotePicker ? (
              <View className="mb-2 max-h-52 rounded-xl border border-lantern-border bg-lantern-background-secondary overflow-hidden">
                <View className="flex-row items-center px-3 py-2 border-b border-lantern-border">
                  <TextInput
                    value={noteSearch}
                    onChangeText={setNoteSearch}
                    placeholder="Search notes…"
                    placeholderTextColor="#94a3b8"
                    className="flex-1 text-sm text-lantern-text dark:text-white"
                    autoFocus
                  />
                  <Pressable
                    onPress={() => {
                      setShowNotePicker(false);
                      setNoteSearch('');
                    }}
                    className="pl-2"
                  >
                    <Text className="text-xs text-lantern-text-secondary">Close</Text>
                  </Pressable>
                </View>
                {notesLoading && notes.length === 0 ? (
                  <View className="py-4 items-center">
                    <ActivityIndicator color="#6366f1" />
                  </View>
                ) : (
                  <FlatList
                    data={filteredNotes}
                    keyExtractor={(item) => item.id}
                    keyboardShouldPersistTaps="handled"
                    style={{ maxHeight: 160 }}
                    ListEmptyComponent={
                      <Text className="px-3 py-4 text-sm text-center text-lantern-text-secondary">
                        {noteSearch.trim() ? 'No matching notes' : 'No notes yet'}
                      </Text>
                    }
                    renderItem={({ item }) => (
                      <Pressable
                        onPress={() => void handleSelectNote(item)}
                        className={`px-3 py-2.5 border-b border-lantern-border/50 ${
                          activeNoteContext?.id === item.id ? 'bg-lantern-primary/10' : ''
                        }`}
                      >
                        <Text className="text-sm text-lantern-text dark:text-white" numberOfLines={1}>
                          {(item.title || '').trim() || 'Untitled note'}
                        </Text>
                      </Pressable>
                    )}
                  />
                )}
              </View>
            ) : null}

            <View className="flex-row items-end gap-2">
              <Pressable
                onPress={() => setShowNotePicker((v) => !v)}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel="Attach a note as context"
                className={`h-11 w-11 items-center justify-center rounded-full ${
                  showNotePicker || activeNoteContext
                    ? 'bg-lantern-primary-background'
                    : 'bg-lantern-background-secondary'
                } ${isBusy ? 'opacity-40' : ''}`}
              >
                <Ionicons name="add" size={22} color="#6366f1" />
              </Pressable>
              <Pressable
                onPress={() => {
                  if (isRecording) void finishDictation();
                  else void startDictation();
                }}
                disabled={isBusy || isTranscribing}
                accessibilityRole="button"
                accessibilityLabel={isRecording ? 'Stop dictation' : 'Dictate with microphone'}
                accessibilityState={{ disabled: isBusy || isTranscribing, selected: isRecording }}
                className={`h-11 w-11 items-center justify-center rounded-full ${
                  isRecording ? 'bg-red-500' : 'bg-lantern-background-secondary'
                } ${(isBusy || isTranscribing) ? 'opacity-40' : ''}`}
              >
                <Ionicons
                  name={isRecording ? 'stop' : 'mic'}
                  size={20}
                  color={isRecording ? '#fff' : '#6366f1'}
                />
              </Pressable>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={
                  isRecording
                    ? 'Listening…'
                    : isTranscribing
                      ? 'Transcribing…'
                      : activeNoteContext
                        ? `Ask about this note…`
                        : 'Ask Lantern AI...'
                }
                placeholderTextColor="#94a3b8"
                multiline
                editable={!dictationBusy}
                className="flex-1 max-h-24 bg-lantern-background-secondary rounded-2xl px-4 py-3 text-lantern-text dark:text-white"
              />
              <Button
                size="sm"
                disabled={!input.trim() || isBusy || dictationBusy}
                onPress={() => void handleSend()}
              >
                Send
              </Button>
            </View>
            {(isRecording || isTranscribing) && (
              <Text className="mt-2 text-xs text-center text-lantern-text-secondary">
                {isRecording
                  ? `Listening… ${recordingSeconds}s — tap stop when done`
                  : 'Converting speech to text…'}
              </Text>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
