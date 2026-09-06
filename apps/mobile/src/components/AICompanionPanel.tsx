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
import * as FileSystem from 'expo-file-system/legacy';
import type { CompanionConversation, CompanionUserContext } from '@lantern/shared';
import { useCompanionStore } from '../stores/companionStore';
import { useNotesStore } from '../stores/notesStore';
import { useToastStore } from '../stores/toastStore';
import { AIDisclaimer } from './AIDisclaimer';
import AIUsageBadge from './AIUsageBadge';
import { navigate as navigateFromRef } from '../navigation/navigationRef';
import { toTab } from '../navigation/nestedTab';
import { submitCompanionFeedback } from '../services/ai';
import type { CompanionAction } from '@lantern/shared/types';

/** Action chips the mobile panel can actually honor (web handles the rest). */
const MOBILE_ACTION_ROUTES: Partial<Record<CompanionAction['type'], (payload?: Record<string, string>) => void>> = {
  navigate_to_dashboard: () => navigateFromRef('Main', { screen: 'HomeTab' }),
  navigate_to_chat: () => navigateFromRef('Main', { screen: 'ChatTab' }),
  navigate_to_flashcards: () => navigateFromRef('Main', { screen: 'StudyTab', params: toTab('FlashcardsList') }),
  navigate_to_notes: () => navigateFromRef('Main', { screen: 'StudyTab', params: toTab('NotesList') }),
  open_note_learn: (payload) => {
    if (payload?.noteId) {
      navigateFromRef('Main', { screen: 'StudyTab', params: toTab('NoteEditor', { noteId: payload.noteId }) });
    } else {
      navigateFromRef('Main', { screen: 'StudyTab', params: toTab('NotesList') });
    }
  },
};

/**
 * Minimal chat-bubble formatting: the model answers with **bold** and "- "
 * bullets, which used to render as literal asterisks and dashes. A full
 * markdown dependency isn't worth the native-lockfile churn for two patterns.
 */
function FormattedBubbleText({ content, color }: { content: string; color: string }) {
  const renderInline = (text: string, keyPrefix: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <Text key={`${keyPrefix}-${i}`} className="font-semibold">{part.slice(2, -2)}</Text>
      ) : (
        <Text key={`${keyPrefix}-${i}`}>{part}</Text>
      )
    );
  };
  const lines = content.split('\n');
  return (
    <View>
      {lines.map((line, i) => {
        // Keep the numbering for ordered lists — step order carries meaning.
        const bullet = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (bullet) {
          const marker = /^\d+\.$/.test(bullet[1]) ? `${bullet[1]} ` : '• ';
          return (
            <View key={i} className="flex-row pl-1">
              <Text className={color}>{marker}</Text>
              <Text className={`${color} flex-1`}>{renderInline(bullet[2], `l${i}`)}</Text>
            </View>
          );
        }
        if (!line.trim()) {
          // Blank line = paragraph gap (an empty <Text> has no height).
          return <View key={i} className="h-2" />;
        }
        return (
          <Text key={i} className={color}>
            {renderInline(line, `l${i}`)}
          </Text>
        );
      })}
    </View>
  );
}
import { useAuthStore } from '../stores/authStore';
import { useAppTheme } from '../theme';
import { Button } from './ui';
import { transcribeAudioForNote } from '../services/notes';
import { trackAIAnalyticsEvent } from '../services/ai';
import { AppIcon } from './ui/AppIcon';

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

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

/**
 * Android 15 (API 35) stopped honouring `android:windowSoftInputMode="adjustResize"`
 * for apps targeting SDK 35+ — and this app targets 36 — so the window no longer
 * shrinks when the keyboard opens and a KeyboardAvoidingView with no `behavior`
 * (the pattern used everywhere else in this app) does nothing: the keyboard just
 * covers the composer. Below API 35 the window still resizes on its own, and
 * adding padding on top of that would lift the composer twice as far.
 */
const COMPOSER_KEYBOARD_BEHAVIOR: 'padding' | undefined =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 35)
    ? 'padding'
    : undefined;

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
    failedMessage,
    consumeFailedMessage,
    loadHistory,
    sendMessageStreaming,
    clearHistory,
    clearError,
    pendingMessage,
    setPendingMessage,
    activeNoteContext,
    setActiveNoteContext,
    hydrateNoteContext,
    activeConversationId,
    conversations,
    isLoadingConversations,
    loadConversations,
    openConversation,
    startNewChat,
    setMessageFeedback,
  } = useCompanionStore();
  const notes = useNotesStore((s) => s.notes);
  const notesLoading = useNotesStore((s) => s.isLoading);
  const loadNotes = useNotesStore((s) => s.loadNotes);

  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  // A failed send hands the typed text back: restore it into the composer
  // (unless the user has already started typing something new).
  useEffect(() => {
    if (!failedMessage) return;
    const restored = consumeFailedMessage();
    if (restored) {
      setInput((prev) => (prev.trim() ? prev : restored));
    }
  }, [failedMessage, consumeFailedMessage]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [showHistoryList, setShowHistoryList] = useState(false);
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
        void loadConversations();
        return;
      }
      await loadHistory();
      void loadConversations();
    })();
  }, [
    isOpen,
    user?.id,
    hydrateNoteContext,
    loadHistory,
    loadConversations,
    setActiveNoteContext,
    context?.noteId,
    context?.noteTitle,
  ]);

  useEffect(() => {
    if (!isOpen) {
      hasLoaded.current = false;
      didAutoAttachRef.current = false;
      setShowHistoryList(false);
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

  const handleOpenHistory = useCallback(() => {
    setShowHistoryList(true);
    setShowNotePicker(false);
    void loadConversations();
    trackAIAnalyticsEvent('companion_history_opened');
  }, [loadConversations]);

  const handleSelectConversation = useCallback(
    async (conversation: CompanionConversation) => {
      setShowHistoryList(false);
      await openConversation(conversation.id);
      trackAIAnalyticsEvent('companion_history_resumed', {
        conversationId: conversation.id,
        hasNote: Boolean(conversation.noteContextId),
      });
    },
    [openConversation]
  );

  const handleNewChat = useCallback(() => {
    setShowHistoryList(false);
    startNewChat();
    trackAIAnalyticsEvent('companion_new_chat');
  }, [startNewChat]);

  const handleDeleteChat = useCallback(() => {
    Alert.alert(
      'Delete this chat?',
      'Past chats stay in history. This only removes the current conversation.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void clearHistory(),
        },
      ]
    );
  }, [clearHistory]);

  if (!isOpen) {
    return null;
  }

  return (
    <Modal visible={isOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView
        className={`flex-1 ${theme === 'dark' ? 'bg-lantern-background' : 'bg-lantern-surface'}`}
        edges={['top', 'bottom']}
      >
        <KeyboardAvoidingView className="flex-1" behavior={COMPOSER_KEYBOARD_BEHAVIOR}>
        <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
          <AppIcon name="sparkles" size={22} color="#c45c26" />
          <Text className="flex-1 ml-2 text-lg font-bold text-lantern-text dark:text-white">Lantern AI</Text>
          <Pressable onPress={handleOpenHistory} className="p-2" accessibilityLabel="Past chats">
            <AppIcon name="time" size={20} color={showHistoryList ? '#c45c26' : '#94a3b8'} />
          </Pressable>
          <Pressable onPress={handleNewChat} className="p-2" accessibilityLabel="New chat">
            <AppIcon name="create" size={20} color="#94a3b8" />
          </Pressable>
          <Pressable onPress={handleDeleteChat} className="p-2" accessibilityLabel="Delete this chat">
            <AppIcon name="trash" size={20} color="#94a3b8" />
          </Pressable>
          <Pressable onPress={close} className="p-2">
            <AppIcon name="close" size={24} color="#94a3b8" />
          </Pressable>
        </View>
        <View className="px-4 pb-2 flex-row items-center justify-between">
          <AIDisclaimer compact textColor="#64748b" linkColor="#c45c26" />
          {/* Chat spends daily AI credits; the floating badge is hidden while
              the panel is open, so show the countdown here instead. */}
          <AIUsageBadge variant="inline" />
        </View>

        {showHistoryList ? (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            className="flex-1 px-3"
            contentContainerStyle={{ paddingVertical: 12, gap: 8, flexGrow: 1 }}
            ListHeaderComponent={
              <View className="flex-row items-center justify-between px-1 mb-2">
                <Text className="text-xs font-semibold uppercase text-lantern-text-secondary">
                  Past chats
                </Text>
                <Pressable onPress={handleNewChat}>
                  <Text className="text-xs font-medium text-lantern-primary-text">New chat</Text>
                </Pressable>
              </View>
            }
            ListEmptyComponent={
              isLoadingConversations ? (
                <View className="py-8 items-center gap-2">
                  <ActivityIndicator color="#c45c26" />
                  <Text className="text-lantern-text-secondary text-center">Loading chats…</Text>
                </View>
              ) : (
                <Text className="text-lantern-text-secondary text-center py-8 px-4">
                  No past chats yet. Start a conversation and it will show up here.
                </Text>
              )
            }
            renderItem={({ item }) => {
              const isActive = item.id === activeConversationId;
              return (
                <Pressable
                  onPress={() => void handleSelectConversation(item)}
                  className={`rounded-xl px-3 py-3 border ${
                    isActive
                      ? 'border-lantern-primary/30 bg-lantern-primary-background'
                      : 'border-transparent bg-lantern-background-secondary dark:bg-lantern-surface-secondary'
                  }`}
                >
                  <View className="flex-row items-start justify-between gap-2">
                    <Text
                      className="flex-1 text-sm font-medium text-lantern-text dark:text-white"
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    <Text className="text-[11px] text-lantern-text-secondary">
                      {formatRelativeTime(item.updatedAt)}
                    </Text>
                  </View>
                  {item.noteTitle ? (
                    <Text className="mt-0.5 text-[11px] text-lantern-primary-text" numberOfLines={1}>
                      {item.noteTitle}
                    </Text>
                  ) : null}
                  {item.preview ? (
                    <Text className="mt-0.5 text-xs text-lantern-text-secondary" numberOfLines={2}>
                      {item.preview}
                    </Text>
                  ) : null}
                </Pressable>
              );
            }}
            ListFooterComponent={
              <Pressable onPress={() => setShowHistoryList(false)} className="py-3">
                <Text className="text-xs text-center text-lantern-text-secondary">Back to chat</Text>
              </Pressable>
            }
          />
        ) : (
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
                <ActivityIndicator color="#c45c26" />
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
                    className="px-3 py-2 rounded-full bg-lantern-primary-background dark:bg-lantern-primary-background border border-lantern-primary/30 dark:border-lantern-primary/30"
                  >
                    <Text className="text-xs text-lantern-primary-text">{p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            )
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            const supportedActions = ((item.actions || []) as CompanionAction[]).filter(
              (a: CompanionAction) => MOBILE_ACTION_ROUTES[a.type]
            );
            const canRate = !isUser && !!item.id && !item.id.startsWith('tmp-');
            return (
              <View className={`max-w-[85%] ${isUser ? 'self-end' : 'self-start'}`}>
                <View
                  className={`px-4 py-3 rounded-2xl ${
                    isUser
                      ? 'bg-lantern-primary-fill rounded-br-sm'
                      : 'bg-lantern-background-secondary rounded-bl-sm'
                  }`}
                >
                  {isUser ? (
                    <Text className="text-white">{item.content}</Text>
                  ) : (
                    <FormattedBubbleText content={item.content} color="text-lantern-text" />
                  )}
                </View>
                {/* Action chips — the web panel had these from day one; mobile
                    silently dropped them, so the companion's suggestions were
                    dead ends here. */}
                {!isUser && supportedActions.length > 0 && (
                  <View className="flex-row flex-wrap gap-1.5 mt-1.5">
                    {supportedActions.map((action: CompanionAction, i: number) => (
                      <Pressable
                        key={`${item.id}-action-${i}`}
                        onPress={() => {
                          close();
                          MOBILE_ACTION_ROUTES[action.type]?.(action.payload);
                        }}
                        className="px-3 py-1.5 rounded-full bg-lantern-primary-background dark:bg-lantern-primary/20"
                      >
                        <Text className="text-xs font-medium text-lantern-primary-text">{action.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {canRate && (
                  <View className="flex-row gap-2 mt-1 pl-1">
                    {(['up', 'down'] as const).map((rating) => {
                      const active = item.feedback === rating;
                      return (
                        <Pressable
                          key={rating}
                          accessibilityLabel={rating === 'up' ? 'Helpful' : 'Not helpful'}
                          onPress={() => {
                            const previous = item.feedback ?? null;
                            const next = active ? null : rating;
                            setMessageFeedback(item.id, next);
                            void submitCompanionFeedback(item.id, next).catch(() => {
                              // Revert only if OUR optimistic value is still
                              // showing — a rapid second tap may have already
                              // moved it, and its request decides that state.
                              const current = useCompanionStore
                                .getState()
                                .messages.find((m) => m.id === item.id)?.feedback ?? null;
                              if (current === next) setMessageFeedback(item.id, previous);
                            });
                          }}
                          className="p-1"
                        >
                          <AppIcon
                            name={rating === 'up' ? 'thumbs-up' : 'thumbs-down'}
                            filled={active}
                            size={14}
                            color={active ? '#4f46e5' : '#94a3b8'}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          }}
          ListFooterComponent={
            isBusy || isTranscribing ? (
              <View className="py-2 items-start">
                <ActivityIndicator color="#c45c26" />
              </View>
            ) : null
          }
        />
        )}

        {error ? (
          <Pressable onPress={clearError} className="mx-4 mb-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <Text className="text-red-600 dark:text-red-300 text-sm">{error}</Text>
          </Pressable>
        ) : null}

        {!showHistoryList && (
        <View className="px-4 py-3 border-t border-lantern-border">
          {activeNoteContext ? (
            <View className="mb-2 flex-row items-center self-start max-w-full rounded-full bg-lantern-primary-background dark:bg-lantern-primary/20 px-3 py-1.5">
              <AppIcon name="document-text" size={14} color="#c45c26" />
              <Text className="ml-1.5 mr-2 flex-shrink text-xs font-medium text-lantern-primary-text" numberOfLines={1}>
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
                <AppIcon name="close" size={14} color="#c45c26" />
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
              <AppIcon name="add" size={22} color="#6366f1" />
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
              <AppIcon
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
        )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
