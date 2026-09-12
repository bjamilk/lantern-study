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
  AppState,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
// The same engine the recap and lesson studios narrate with, so "Read aloud"
// uses the voice the student has already heard rather than a second stack.
import * as Speech from 'expo-speech';
import { appAlert } from './ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import type { CompanionConversation, CompanionUserContext } from '@lantern/shared';
import { useCompanionStore } from '../stores/companionStore';
import { useNotesStore } from '../stores/notesStore';
import { useToastStore } from '../stores/toastStore';
import { AIDisclaimer } from './AIDisclaimer';
import AIUsageBadge from './AIUsageBadge';
import { AI_FEATURE_CREDIT_COST } from '@lantern/shared/utils/aiCredits';
import { navigate as navigateFromRef, navigationRef } from '../navigation/navigationRef';
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

import { useAuthStore } from '../stores/authStore';
import { profileDisplayName } from '../hooks/profileIdentity';
import { useAppTheme, useTheme } from '../theme';
import { Button, T, useFeatureAccent } from './ui';
import { FormattedBubbleText, BubbleTypingIndicator } from './companion/BubbleText';
import { CompanionEmptyState } from './companion/CompanionEmptyState';
import { CompanionHistory } from './companion/CompanionHistory';
import { ScopedPrompts } from './companion/ScopedPrompts';
import {
  EXPLAIN_SIMPLY_PROMPT,
  companionScopeFromRoute,
  previousUserMessage,
  scopeAccessibilityLabel,
  scopeSubtitle,
  type CompanionRouteScope,
} from './companion/companionScope';
import { transcribeAudioForNote } from '../services/notes';
import { trackAIAnalyticsEvent } from '../services/ai';
import { AppIcon } from './ui/AppIcon';

/**
 * One chip per excerpt while the list is short enough to read; past three they
 * collapse into one. Excerpt numbers, never page numbers — the companion
 * pipeline has no notion of pages, so a chip must not imply one.
 */
function citationChipLabels(excerpts: number[]): string[] {
  const unique = Array.from(new Set(excerpts.filter((n) => Number.isFinite(n) && n > 0))).sort(
    (a, b) => a - b
  );
  if (!unique.length) return [];
  if (unique.length > 3) return [`Excerpts ${unique.join(', ')}`];
  return unique.map((n) => `Excerpt ${n}`);
}

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
  const { colors } = useTheme();
  // Lantern AI is the `ai` feature identity (indigo ink), not the orange
  // budget accent every hex in here used to be.
  const ai = useFeatureAccent('ai');
  const user = useAuthStore(s => s.user);
  const profileName = useAuthStore(s => s.profileName);
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
    resetForScope: resetCompanionForScope,
    activeConversationId,
    conversations,
    isLoadingConversations,
    loadConversations,
    openConversation,
    startNewChat,
    deleteConversation,
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
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  /** Which message is being read aloud, so only one stop button is armed. */
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  /**
   * What the companion is "on", sampled when the panel opens.
   *
   * The web rail is rendered inside the surface it serves and reads its scope
   * from props; this panel is mounted ONCE in `RootNavigator` with no `context`
   * prop, so the equivalent truth is the route that was on screen at the moment
   * the sheet came up. Sampling on open (not every render) is deliberate: the
   * route underneath cannot change while a modal is over it, and re-reading
   * would only add renders.
   */
  const [routeScope, setRouteScope] = useState<CompanionRouteScope>({
    screenName: null,
    scopeName: null,
    activity: null,
    scopeId: null,
  });
  const hasLoaded = useRef(false);
  const didAutoAttachRef = useRef(false);
  const listRef = useRef<FlatList>(null);
  const inputValueRef = useRef('');
  /** True from the instant a send starts until the server answers or fails. */
  const sendInFlightRef = useRef(false);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const recordingStartedAtRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secondsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);

  // Resolved through the same pure planner every mobile surface uses, so the
  // companion greets a genuine name — including one that equals the email local
  // part — but never the email address itself. 'Student' is the neutral
  // fallback when nothing genuine is known; the local part is never used.
  const userName =
    profileDisplayName({
      profileName,
      metadataName:
        (typeof user?.user_metadata?.name === 'string' && user.user_metadata.name) ||
        (typeof user?.user_metadata?.first_name === 'string' && user.user_metadata.first_name) ||
        null,
      email: user?.email ?? null,
    }) || 'Student';

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
    // Sample the room the sheet came up over BEFORE anything is restored: a
    // thread and an attachment both belong to a room, and the phone mounts one
    // panel at the root with no `context` prop, so the live route is the only
    // truth about which room this open is for. Doing this only on room CHANGE
    // (CourseRoomScreen's effect) missed the walk note -> Ask in set A, then
    // Study -> set B -> Ask, which is how the leak was seen on device.
    const openRoute = navigationRef.isReady() ? navigationRef.getCurrentRoute() : null;
    const openParams = (openRoute?.params ?? null) as Record<string, unknown> | null;
    // A caller that named its own room wins over the route: `openForScope`
    // states the scope BEFORE the sheet mounts, while route inference is a
    // guess made after the fact.
    const requested = useCompanionStore.getState().requestedScope;
    const openScopeId =
      requested?.scopeId ?? companionScopeFromRoute(openRoute?.name ?? null, openParams).scopeId;
    /**
     * Opening from a note attaches THAT note.
     *
     * The route's own note id beats both the persisted attachment and the
     * (always absent, on mobile) `context` prop: the phone showed the chip
     * "Imported Notes" while the student was standing inside a different note,
     * because hydration ran first and whatever was attached last won.
     */
    const routeNoteId =
      typeof openParams?.noteId === 'string' && openParams.noteId.trim()
        ? openParams.noteId.trim()
        : null;
    void (async () => {
      resetCompanionForScope(openScopeId);
      if (routeNoteId && !didAutoAttachRef.current) {
        didAutoAttachRef.current = true;
        const known = useNotesStore.getState().notes.find((n) => n.id === routeNoteId);
        // Synchronous state write: the composer and the first send read the
        // right attachment even before persistence or history come back.
        useCompanionStore.getState().openForNote({
          id: routeNoteId,
          title: (known?.title || '').trim() || context?.noteTitle || 'Untitled note',
          scopeId: openScopeId,
        });
        await loadHistory();
        void loadConversations();
        return;
      }
      await hydrateNoteContext(openScopeId);
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
    resetCompanionForScope,
    context?.noteId,
    context?.noteTitle,
  ]);

  useEffect(() => {
    if (!isOpen) {
      hasLoaded.current = false;
      didAutoAttachRef.current = false;
      setShowHistoryList(false);
      setPromptsExpanded(false);
      return;
    }
    // Sample the scope of whatever the sheet just came up over.
    const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : null;
    const inferred = companionScopeFromRoute(
      route?.name ?? null,
      (route?.params ?? null) as Record<string, unknown> | null
    );
    const requested = useCompanionStore.getState().requestedScope;
    setRouteScope(
      requested
        ? {
            ...inferred,
            scopeId: requested.scopeId ?? inferred.scopeId,
            scopeName: requested.label?.trim() || inferred.scopeName,
          }
        : inferred
    );
  }, [isOpen]);

  /**
   * A relaunch must land on Home, not in the companion.
   *
   * `isOpen` is not persisted, so a genuine cold start already clears it — but
   * this app has an in-process remount (`RootNavigator`'s `preservedNavState`,
   * used so a font-size change can re-key the tree) that rebuilds the
   * navigator while module-level zustand state, `isOpen` included, survives.
   * Backgrounding and returning hit the same shape. Nothing anywhere called
   * `close()` on an AppState change, so the sheet was still up over a restored
   * nav state and read as "the companion re-opened itself".
   *
   * Closing on `background` — never on `inactive`, which fires for the
   * notification shade, a permission prompt and the app switcher preview — is
   * what makes leaving the app end the companion session. The composer text is
   * component state and this component never unmounts, so a draft survives the
   * close and is still there on reopen.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'background') return;
      if (!useCompanionStore.getState().isOpen) return;
      useCompanionStore.getState().close();
    });
    return () => sub.remove();
  }, []);

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
        // Picked while standing in this room, so it belongs to this room.
        scopeId: useCompanionStore.getState().activeScopeId,
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
        appAlert('Permission needed', 'Microphone access is required for voice dictation.');
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
      appAlert('Error', 'Could not start recording. Check microphone permission and try again.');
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
      // `isStreaming` is a render snapshot, so two taps inside one frame both
      // read false and both sent — one question, two credits. The ref flips
      // synchronously, before React can re-render. (The store carries the same
      // guard, so a send queued from anywhere else cannot double-charge
      // either.)
      if (sendInFlightRef.current) return;
      sendInFlightRef.current = true;
      setInput('');
      inputValueRef.current = '';
      try {
        await sendMessageStreaming(msg, enrichedContext);
      } finally {
        sendInFlightRef.current = false;
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [input, isLoading, isStreaming, isRecording, isTranscribing, sendMessageStreaming, enrichedContext]
  );

  /**
   * The attachment is narrower than the route, so it wins the "On:" line — a
   * note stapled to the thread is what the answer is actually grounded in.
   */
  const companionScope = useMemo(
    () => ({
      noteTitle: activeNoteContext?.title ?? null,
      scopeName: routeScope.scopeName,
      screenName: routeScope.screenName,
    }),
    [activeNoteContext?.title, routeScope.scopeName, routeScope.screenName]
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
    appAlert(
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

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      void deleteConversation(conversationId);
      trackAIAnalyticsEvent('companion_conversation_deleted', { conversationId });
    },
    [deleteConversation]
  );

  const handleCopyMessage = useCallback(
    (content: string) => {
      void Clipboard.setStringAsync(content)
        .then(() => showToast('Copied to clipboard', 'success'))
        .catch(() => showToast('Could not copy that.', 'error'));
    },
    [showToast]
  );

  /**
   * Read aloud, as a toggle: the same button stops it. `expo-speech` has no
   * per-utterance handle, so the id in state is what tells the row whether IT
   * is the one speaking — without it, every row would show "Stop".
   */
  const handleToggleSpeak = useCallback(
    (messageId: string, content: string) => {
      if (speakingMessageId === messageId) {
        void Speech.stop();
        setSpeakingMessageId(null);
        return;
      }
      void Speech.stop();
      setSpeakingMessageId(messageId);
      Speech.speak(content, {
        onDone: () => setSpeakingMessageId((id) => (id === messageId ? null : id)),
        onStopped: () => setSpeakingMessageId((id) => (id === messageId ? null : id)),
        onError: () => {
          setSpeakingMessageId((id) => (id === messageId ? null : id));
          showToast('Could not read that aloud.', 'error');
        },
      });
      trackAIAnalyticsEvent('companion_read_aloud');
    },
    [speakingMessageId, showToast]
  );

  // Nothing should keep talking after the sheet is gone.
  useEffect(() => {
    if (isOpen) return;
    void Speech.stop();
    setSpeakingMessageId(null);
  }, [isOpen]);

  useEffect(() => () => {
    void Speech.stop();
  }, []);

  /**
   * Ask the SAME question again. The thread is server-backed with no edit or
   * delete-one-message endpoint, so this appends a fresh turn rather than
   * replacing the answer in place — which is also the honest reading of the
   * button: you get another attempt, and the one you did not like stays above
   * it for comparison.
   */
  const handleRegenerate = useCallback(
    (messageId: string) => {
      const question = previousUserMessage(messages, messageId);
      if (!question) {
        showToast('Nothing to regenerate from.', 'info');
        return;
      }
      trackAIAnalyticsEvent('companion_regenerate');
      void handleSend(question);
    },
    [messages, handleSend, showToast]
  );

  const handleExplainSimply = useCallback(() => {
    trackAIAnalyticsEvent('companion_explain_simply');
    void handleSend(EXPLAIN_SIMPLY_PROMPT);
  }, [handleSend]);

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
          <AppIcon name="sparkles" size={22} color={ai.ink} />
          {/* flex:1 is correct HERE — the header row is full width. It is only
              inside the intrinsically sized bubble that flex-1 collapses. */}
          {/* Title over the scope line — the rail's two-line header. Without
              "On: …" the phone gave no way to tell whether a question was
              about the note you had open or about nothing in particular. */}
          <View style={{ flex: 1, marginLeft: 8 }}>
            <T.Heading style={{ fontWeight: '700' }}>Lantern AI</T.Heading>
            <T.Caption
              tone="tertiary"
              numberOfLines={1}
              accessibilityLabel={scopeAccessibilityLabel(companionScope) ?? undefined}
            >
              {scopeSubtitle(companionScope)}
            </T.Caption>
          </View>
          <Pressable onPress={handleOpenHistory} className="p-2" accessibilityLabel="Past chats">
            <AppIcon name="time" size={20} color={showHistoryList ? ai.ink : colors.textTertiary} />
          </Pressable>
          <Pressable onPress={handleNewChat} className="p-2" accessibilityLabel="New chat">
            <AppIcon name="create" size={20} color={colors.textTertiary} />
          </Pressable>
          <Pressable onPress={handleDeleteChat} className="p-2" accessibilityLabel="Delete this chat">
            <AppIcon name="trash" size={20} color={colors.textTertiary} />
          </Pressable>
          <Pressable onPress={close} className="p-2">
            <AppIcon name="close" size={24} color={colors.textTertiary} />
          </Pressable>
        </View>
        {/*
          Two lines, not one row.

          Side by side, the disclaimer and the credit line shared a phone's
          width and both lost: the device pass read
          "…Not professional advice.71/100 AI uses left ·" — no space where
          the row ran out, the reset countdown gone off the right edge. They
          are two different sentences about two different things; stacking
          them is what lets each one finish.
        */}
        <View className="px-4 pb-2">
          <AIDisclaimer compact textColor={colors.textTertiary} linkColor={ai.ink} />
          {/* Chat spends daily AI credits; the floating badge is hidden while
              the panel is open, so show the countdown here instead. */}
          <View className="mt-1">
            <AIUsageBadge variant="inline" cost={AI_FEATURE_CREDIT_COST} />
          </View>
        </View>

        {showHistoryList ? (
          <CompanionHistory
            conversations={conversations}
            activeConversationId={activeConversationId}
            isLoading={isLoadingConversations}
            onSelect={(c) => void handleSelectConversation(c)}
            onDelete={handleDeleteConversation}
            onNewChat={handleNewChat}
            onBack={() => setShowHistoryList(false)}
            formatRelativeTime={formatRelativeTime}
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
                <ActivityIndicator color={colors.primary} />
                <Text className="text-lantern-text-secondary text-center">
                  Loading conversation…
                </Text>
              </View>
            ) : (
            <View className="py-6 gap-5">
              <CompanionEmptyState />
              <ScopedPrompts
                activity={routeScope.activity}
                scopeName={companionScope.noteTitle ?? routeScope.scopeName}
                expanded={promptsExpanded}
                onToggleExpanded={() => setPromptsExpanded((v) => !v)}
                onAsk={(message) => void handleSend(message)}
                disabled={isBusy || dictationBusy}
              />
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
                    item.content.trim() ? (
                    <FormattedBubbleText content={item.content} />
                  ) : (
                    /* The store appends an EMPTY assistant message the moment a
                       send starts, so the placeholder belongs in that bubble —
                       not in a bare spinner under the list. */
                    <BubbleTypingIndicator />
                  )
                  )}
                </View>
                {/* Where this answer was read from. Tapping opens that note
                    through the same route the action chips use. */}
                {!isUser && item.citations && citationChipLabels(item.citations.excerpts).length > 0 && (
                  <View className="flex-row flex-wrap gap-1.5 mt-1.5">
                    {citationChipLabels(item.citations.excerpts).map((detail: string) => (
                      <Pressable
                        key={`${item.id}-cite-${detail}`}
                        onPress={() => {
                          close();
                          MOBILE_ACTION_ROUTES.open_note_learn?.({
                            noteId: item.citations!.noteId,
                          });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${item.citations!.noteTitle}, ${detail}`}
                        /* The lilac source chip: `ai` tint ground under `ai`
                           ink, so a citation reads as the companion's own mark
                           rather than borrowing the primary ramp every other
                           pill in the app already uses. */
                        style={{ backgroundColor: ai.tint }}
                        className="flex-row items-center max-w-full rounded-full px-3 py-1.5"
                      >
                        <AppIcon name="document-text" size={12} color={ai.ink} />
                        <T.Label
                          style={{ marginLeft: 5, flexShrink: 1, color: ai.ink }}
                          numberOfLines={1}
                        >
                          {`${item.citations!.noteTitle} · ${detail}`}
                        </T.Label>
                      </Pressable>
                    ))}
                  </View>
                )}
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
                        <T.Label style={{ color: ai.ink }}>{action.label}</T.Label>
                      </Pressable>
                    ))}
                  </View>
                )}
                {/* Per-answer actions. Copy / read aloud / regenerate work on
                    any finished answer — including one the server has not
                    persisted an id for yet — while the thumbs need a real id
                    to attach feedback to, which is what `canRate` gates. */}
                {!isUser && !isStreaming && item.content.trim() ? (
                  <View className="flex-row flex-wrap items-center gap-1 mt-1 pl-1">
                    <Pressable
                      onPress={() => handleCopyMessage(item.content)}
                      accessibilityRole="button"
                      accessibilityLabel="Copy answer"
                      hitSlop={6}
                      className="p-1.5"
                    >
                      <AppIcon name="copy" size={14} color={colors.textTertiary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleToggleSpeak(item.id, item.content)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        speakingMessageId === item.id ? 'Stop reading aloud' : 'Read answer aloud'
                      }
                      accessibilityState={{ selected: speakingMessageId === item.id }}
                      hitSlop={6}
                      className="p-1.5"
                    >
                      <AppIcon
                        name={speakingMessageId === item.id ? 'stop' : 'volume-medium'}
                        size={14}
                        color={speakingMessageId === item.id ? ai.ink : colors.textTertiary}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => handleRegenerate(item.id)}
                      disabled={isBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Ask again"
                      accessibilityState={{ disabled: isBusy }}
                      hitSlop={6}
                      className={`p-1.5 ${isBusy ? 'opacity-40' : ''}`}
                    >
                      <AppIcon name="refresh" size={14} color={colors.textTertiary} />
                    </Pressable>
                    <Pressable
                      onPress={handleExplainSimply}
                      disabled={isBusy}
                      accessibilityRole="button"
                      accessibilityLabel="I don't understand — explain more simply"
                      accessibilityState={{ disabled: isBusy }}
                      style={{ minHeight: 32, backgroundColor: ai.tint }}
                      className={`justify-center px-2.5 rounded-full ml-0.5 ${
                        isBusy ? 'opacity-40' : ''
                      }`}
                    >
                      <T.Label style={{ color: ai.ink, fontWeight: '500' }}>
                        I don&apos;t understand
                      </T.Label>
                    </Pressable>
                  </View>
                ) : null}
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
                            color={active ? ai.ink : colors.textTertiary}
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
            isTranscribing ? (
              <View className="py-2 items-start">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
        />
        )}

        {error ? (
          <Pressable onPress={clearError} className="mx-4 mb-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <Text className="text-red-600 dark:text-red-300 text-body">{error}</Text>
          </Pressable>
        ) : null}

        {!showHistoryList && (
        <View className="px-4 py-3 border-t border-lantern-border">
          {activeNoteContext ? (
            <View className="mb-2 flex-row items-center self-start max-w-full rounded-full bg-lantern-primary-background dark:bg-lantern-primary/20 px-3 py-1.5">
              <AppIcon name="document-text" size={14} color={ai.ink} />
              <T.Caption
                style={{ marginLeft: 6, marginRight: 8, flexShrink: 1, fontWeight: '500', color: ai.ink }}
                numberOfLines={1}
              >
                {activeNoteContext.title}
              </T.Caption>
              <Pressable
                onPress={() => {
                  void setActiveNoteContext(null);
                  trackAIAnalyticsEvent('companion_note_context_cleared');
                }}
                hitSlop={8}
                accessibilityLabel="Remove note context"
              >
                <AppIcon name="close" size={14} color={ai.ink} />
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
                  placeholderTextColor={colors.inputPlaceholder}
                  className="flex-1 text-body text-lantern-text dark:text-white"
                  autoFocus
                />
                <Pressable
                  onPress={() => {
                    setShowNotePicker(false);
                    setNoteSearch('');
                  }}
                  className="pl-2"
                >
                  <T.Caption tone="secondary">Close</T.Caption>
                </Pressable>
              </View>
              {notesLoading && notes.length === 0 ? (
                <View className="py-4 items-center">
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                <FlatList
                  data={filteredNotes}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 160 }}
                  ListEmptyComponent={
                    <T.Body tone="secondary" style={{ paddingHorizontal: 12, paddingVertical: 16, textAlign: 'center' }}>
                      {noteSearch.trim() ? 'No matching notes' : 'No notes yet'}
                    </T.Body>
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => void handleSelectNote(item)}
                      className={`px-3 py-2.5 border-b border-lantern-border/50 ${
                        activeNoteContext?.id === item.id ? 'bg-lantern-primary/10' : ''
                      }`}
                    >
                      <Text className="text-body text-lantern-text dark:text-white" numberOfLines={1}>
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
              <AppIcon name="add" size={22} color={ai.ink} />
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
                // White on the red recording fill in both themes: the fill is not a token.
                color={isRecording ? '#ffffff' : ai.ink}
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
              placeholderTextColor={colors.inputPlaceholder}
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
            <T.Caption tone="secondary" style={{ marginTop: 8, textAlign: 'center' }}>
              {isRecording
                ? `Listening… ${recordingSeconds}s — tap stop when done`
                : 'Converting speech to text…'}
            </T.Caption>
          )}
        </View>
        )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
