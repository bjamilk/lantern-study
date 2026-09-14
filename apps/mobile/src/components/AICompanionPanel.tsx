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
  Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
// The same engine the recap and lesson studios narrate with, so "Read aloud"
// uses the voice the student has already heard rather than a second stack.
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import { appAlert } from './ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import type { CompanionConversation, CompanionUserContext } from '@lantern/shared';
import { useCompanionStore } from '../stores/companionStore';
import { useNotesStore } from '../stores/notesStore';
import { useToastStore } from '../stores/toastStore';
import { AIDisclaimer } from './AIDisclaimer';
import { navigate as navigateFromRef, navigationRef } from '../navigation/navigationRef';
import { toTab } from '../navigation/nestedTab';
import { submitCompanionFeedback } from '../services/ai';
import type { CompanionAction } from '@lantern/shared/types';
import {
  IMAGE_ATTACH_COST_LABEL,
  describeImageAttachFailure,
  MAX_IMAGE_ATTACHMENTS,
  describeImageAttachment,
  validateImageAsset,
} from './companion/imageAttach';

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
import { ActionSheet, Button, T, useFeatureAccent } from './ui';
import { FormattedBubbleText, BubbleTypingIndicator } from './companion/BubbleText';
import { CompanionEmptyState } from './companion/CompanionEmptyState';
import { CompanionHistory } from './companion/CompanionHistory';
import { ScopedPrompts } from './companion/ScopedPrompts';
import {
  EXPLAIN_SIMPLY_PROMPT,
  companionOpenAttachment,
  companionScopeFromRoute,
  previousUserMessage,
  scopeAccessibilityLabel,
  scopeSubtitle,
  type CompanionRouteScope,
} from './companion/companionScope';
import { GuidedPicker } from './companion/GuidedPicker';
import {
  companionComposerPicker,
  companionEmptyState,
} from './companion/companionEmptyStateModel';
import { companionHeaderModel } from './companion/companionHeaderModel';
import {
  buildGuidedGoals,
  GUIDED_MODE_PROMISE,
  type GuidedGoal,
  type GuidedNextTopic,
} from '@lantern/shared/api/companion';
import {
  TURN_INTO_TARGETS,
  formatTurnIntoCost,
  type TurnIntoTargetId,
} from '@lantern/shared/learning/courseWorkspace';
import {
  messageToNoteDraft,
  messageTurnIntoActionLabel,
} from '@lantern/shared/learning/messageTurnInto';
import { hasEnoughNoteStudyContent } from '@lantern/shared/utils/noteStudyContent';
import {
  messageNotePayload,
  messageTurnIntoStudioRoute,
  roomScopeFromRouteParams,
  type CompanionRoomScope,
} from './companion/messageTurnInto';
import { startFlashcardsFromNote, startTestFromNote } from '../screens/study/turnIntoJobs';
import { useJobsStore } from '../stores/jobsStore';
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
  // `ai` now dresses ONE thing: the lilac citation chip, which is the
  // companion's own mark and matches the web rail (StudyFetch parity). Every
  // control and every piece of chrome in here is the app's ink — `primaryFill`
  // under `textInverse` when filled, `text` when it is a bare glyph — so the
  // panel's buttons read as the same black pills as `Button` primary and the
  // selected `ContextualBar` segment rather than as a second, violet system.
  const ai = useFeatureAccent('ai');
  /** The filled ink pill, identical to `useButtonSkin('primary')`. */
  const inkFill = colors.primaryFill;
  const inkGlyph = colors.textInverse;
  /** Turn-into makes study material, so its pill wears the flashcards accent. */
  const flashcardsAccent = useFeatureAccent('flashcards');
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
    pendingImages,
    isUploadingImage,
    imageError,
    imageErrorDetail,
    clearImageError,
    attachImage,
    removeImage,
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
  /**
   * True from the moment we launch the picker/camera Activity until shortly
   * after it hands control back. The AppState watcher below reads it so OUR
   * Activity switch is not mistaken for the student leaving the app.
   */
  const pickerBusyRef = useRef(false);

  /**
   * A failed read belongs to the room it failed in.
   *
   * The message used to survive a change of study set, so a stale red line sat
   * under a composer that had never tried to attach anything.
   */
  const companionScopeId = useCompanionStore((s) => s.activeScopeId);
  useEffect(() => {
    setShowImageErrorDetail(false);
    clearImageError();
  }, [companionScopeId, clearImageError]);

  /** A new message replaces the old small print rather than re-opening it. */
  useEffect(() => {
    setShowImageErrorDetail(false);
  }, [imageError]);

  /**
   * Pick a photo and have it read.
   *
   * `base64: true` keeps this to one dependency — the picker already returns
   * the bytes, so there is no file read step. The read is charged on pick, so
   * the cost is announced in the chooser above it, not after.
   */
  const pickCompanionImage = useCallback(
    async (source: 'library' | 'camera') => {
      if (pendingImages.length >= MAX_IMAGE_ATTACHMENTS) {
        showToast(`Up to ${MAX_IMAGE_ATTACHMENTS} images per question.`, 'info');
        return;
      }
      pickerBusyRef.current = true;
      try {
        const permission =
          source === 'camera'
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.status !== 'granted') {
          appAlert(
            'Permission needed',
            source === 'camera'
              ? 'Camera access is required to photograph a page.'
              : 'Photo library access is required to attach an image.'
          );
          return;
        }
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false, base64: true })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.85,
                exif: false,
                base64: true,
              });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        const problem = validateImageAsset(asset);
        if (problem) {
          useCompanionStore.setState({ imageError: problem, imageErrorDetail: null });
          return;
        }
        if (!asset.base64) {
          useCompanionStore.setState({
            imageError: 'Could not read that image — the file came back empty.',
            imageErrorDetail: asset.fileName ? `File: ${asset.fileName}` : null,
          });
          return;
        }
        const attached = await attachImage({
          base64Data: asset.base64,
          fileName: asset.fileName || 'photo.jpg',
          contentType: asset.mimeType || undefined,
          // The chip shows THIS picture, not a stand-in glyph.
          previewUri: asset.uri || undefined,
        });
        if (attached && attached.wordCount === 0) {
          showToast('No readable text in that image — try a sharper, closer photo.', 'info');
        }
      } catch (err) {
        // Anything the picker itself throws is still a reason, not a shrug:
        // write it under the chip row where a failed upload writes its own.
        const failure = describeImageAttachFailure(err, null);
        useCompanionStore.setState({
          isUploadingImage: false,
          imageError: failure.message,
          imageErrorDetail: failure.detail,
        });
      } finally {
        // Cleared a tick late: Android delivers the foreground AppState change
        // after the picker's promise resolves.
        setTimeout(() => {
          pickerBusyRef.current = false;
        }, 1200);
      }
    },
    [attachImage, pendingImages.length, showToast]
  );

  /**
   * One "+" , one sheet.
   *
   * The phone used to answer "+" with the note picker and keep a second button
   * for photos, so the price line ("Reading a photo costs 2 AI uses") lived in
   * an accessibility label nobody hears. Everything attachable is now one list,
   * and the cost is printed under the two entries that charge for it.
   */
  const [showAttachSheet, setShowAttachSheet] = useState(false);

  const handleAttachImage = useCallback(
    (source: 'library' | 'camera') => {
      void pickCompanionImage(source);
    },
    [pickCompanionImage]
  );

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [showImageErrorDetail, setShowImageErrorDetail] = useState(false);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  /**
   * Guided is per-thread UI state, never a saved setting — a new chat starts in
   * normal mode, and the "+" row stays reachable mid-lesson so ordinary chat is
   * one tap away.
   */
  const [guided, setGuided] = useState(false);
  /**
   * The student shut the picker card above the composer. Per thread and per
   * toggle: turning Guided off and on again is a fresh intent to pick a goal.
   */
  const [guidedPickerDismissed, setGuidedPickerDismissed] = useState(false);
  const composerRef = useRef<TextInput>(null);
  /** Which message is being read aloud, so only one stop button is armed. */
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  /**
   * Which answer has its six-target row open. One id, not a per-bubble flag:
   * opening a second answer's row closes the first, so a scrolled thread never
   * carries two identical six-pill blocks.
   */
  const [turnIntoMessageId, setTurnIntoMessageId] = useState<string | null>(null);
  /** The room the sheet came up over — where a saved answer gets filed. */
  const [roomScope, setRoomScope] = useState<CompanionRoomScope>({});
  const startJob = useJobsStore((s) => s.startJob);
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
  /**
   * The topic the scoped set's plan says comes next — stated by the caller
   * that opened the sheet, or derived by the store from the saved plan when no
   * caller stated one (`hydrateGuidedNextTopic`).
   *
   * SUBSCRIBED, not sampled on open. It used to be copied into local state in
   * the `isOpen` effect, which is fine for a value a host hands over
   * synchronously and useless for one the store has to fetch a plan to know:
   * the derived topic landed a tick after the sample and the picker never saw
   * it. `requestedScope` is nulled by `open()` and `close()`, so a door that
   * names no room still shows no `Continue learning:` row.
   */
  const guidedNextTopic = useCompanionStore((s) => s.requestedScope?.guidedNextTopic ?? null);
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
      // Every send in this thread carries the mode while Guided is on. The
      // server persists nothing, so a turn that omitted it would silently drop
      // back to `explain` mid-lesson.
      ...(guided ? { mode: 'guided' as const } : {}),
    }),
    [userName, context, guided]
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
      // Standing IN the set: nothing is attached, so the sheet is honestly
      // about the set rather than about whichever note this scope had open
      // last (SF2 §6 #14). The rule is in companionScope.ts, keyed on the
      // route, so every door into the panel gets the same answer.
      if (companionOpenAttachment(openRoute?.name ?? null, openParams) === 'set') {
        await setActiveNoteContext(null);
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
    setRoomScope(roomScopeFromRouteParams((route?.params ?? null) as Record<string, unknown> | null));
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
      // The system photo picker and the camera are separate Activities: on
      // Android they STOP this one, so AppState reports 'background', not
      // 'inactive'. Closing here is what dismissed the companion the moment a
      // photo was chosen — the upload then finished against a sheet nobody
      // could see, which is how a real error read as "the app just quit the
      // panel". While we are the ones who launched that Activity, leaving is
      // not leaving the app.
      if (pickerBusyRef.current) return;
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
    async (
      text?: string,
      /**
       * Extra context for THIS turn only — the Guided seed uses it to name the
       * source note its topic was built from, so the first reply teaches from
       * that note instead of asking which material to use. Not an attachment:
       * nothing is stapled to the thread and no history is reloaded.
       */
      turnContext?: Partial<CompanionUserContext>
    ) => {
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
        await sendMessageStreaming(
          msg,
          turnContext ? { ...enrichedContext, ...turnContext } : enrichedContext
        );
      } finally {
        sendInFlightRef.current = false;
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [input, isLoading, isStreaming, isRecording, isTranscribing, sendMessageStreaming, enrichedContext]
  );

  /**
   * Send a picker row's first guided turn.
   *
   * When the goal knows the note its topic was built from, that note rides
   * along as this turn's context, so the model can teach step 1 rather than
   * spend the credit asking which of the unit's notes to use. Deliberately
   * not an attachment: attaching clears the thread and reloads history, and
   * the card above the composer exists so a goal can be picked mid-lesson.
   */
  const handlePickGuidedGoal = useCallback(
    (goal: GuidedGoal) => {
      setGuidedPickerDismissed(true);
      const sourceNoteId = goal.sourceNoteId?.trim();
      void handleSend(
        goal.prompt,
        sourceNoteId && !activeNoteContext
          ? { noteId: sourceNoteId, noteTitle: goal.sourceTitle || undefined }
          : undefined
      );
    },
    [handleSend, activeNoteContext]
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

  /**
   * The Guided picker's rows, from material this screen already holds — the
   * attached note and the set the thread is scoped to. Pure and local: drawing
   * the picker costs nothing, only the row that is tapped sends a turn.
   *
   * `nextTopic` arrives from whichever host opened the sheet, or from the
   * store's own reading of the scoped set's saved plan when the host named
   * none. With neither there is no `Continue learning:` row at all — one that
   * is not backed by a real plan position would claim progress the student
   * never made.
   */
  const guidedGoals = useMemo(
    () =>
      buildGuidedGoals({
        nextTopic: guidedNextTopic,
        topics: [companionScope.noteTitle, companionScope.scopeName],
      }),
    [guidedNextTopic, companionScope.noteTitle, companionScope.scopeName]
  );

  /** The header's strings, as one testable value. See companionHeaderModel.ts. */
  const headerModel = useMemo(
    () =>
      companionHeaderModel({
        mode: guided ? 'guided' : 'chat',
        subtitle: scopeSubtitle(companionScope),
      }),
    [guided, companionScope]
  );

  /**
   * What the empty thread offers — the picker or the chips, never both.
   * Pure, and pinned by companionEmptyStateModel.test.ts.
   */
  const emptyState = useMemo(
    () => companionEmptyState({ guided, isLoadingHistory }),
    [guided, isLoadingHistory]
  );

  const isBusy = isLoading || isStreaming || isLoadingHistory;
  /** "+" reads as filled while anything is actually attached to this turn. */
  const attachActive =
    showAttachSheet || showNotePicker || Boolean(activeNoteContext) || pendingImages.length > 0;
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

  /**
   * Turn one answer into study material.
   *
   * The answer is FILED first, every time. Cards and a test are generated from
   * a note, the three note studios open on one, and a student who spent a
   * credit on an answer should be able to find the text it came from — so the
   * note is not a side effect, it is the first half of the action.
   */
  const handleTurnIntoMessage = useCallback(
    async (target: TurnIntoTargetId, message: { id: string; content: string; createdAt?: string }) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) {
        showToast('Sign in to turn this answer into study material.', 'error');
        return;
      }
      const draft = messageToNoteDraft(
        message,
        conversations.find((row) => row.id === activeConversationId)?.title ?? null
      );
      let note;
      try {
        note = await useNotesStore.getState().createNote(messageNotePayload(draft, roomScope));
      } catch (e: any) {
        showToast(e?.message || 'Could not save that answer as a note.', 'error');
        return;
      }
      showToast('Answer saved as a note.', 'success');
      const studio = messageTurnIntoStudioRoute(target, roomScope, note.id);
      if (studio) {
        close();
        // Nested navigate, so the Study tab is entered rather than reset:
        // `toTab` carries `initial: false`, which is what keeps the back
        // button going to the room instead of out of the tab.
        navigateFromRef('Main', {
          screen: 'StudyTab',
          params: toTab(studio.screen, studio.params),
        });
        return;
      }
      if (target !== 'cards' && target !== 'test') {
        // A studio with no room behind it. The answer is saved either way; the
        // toast says what is missing rather than opening an empty shell.
        showToast('Saved as a note. Open a study set to use that studio.', 'info');
        return;
      }
      if (!hasEnoughNoteStudyContent(note)) {
        showToast('That answer is too short to generate from.', 'info');
        return;
      }
      const scope = {
        userId,
        courseId: roomScope.courseId,
        studySetId: roomScope.studySetId,
      };
      if (target === 'cards') {
        startFlashcardsFromNote(note, scope, startJob);
        showToast('Building your flashcards…', 'info');
      } else {
        startTestFromNote(note, scope, startJob);
        showToast('Building your practice test…', 'info');
      }
    },
    [activeConversationId, close, conversations, roomScope, showToast, startJob]
  );

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
          <AppIcon name="sparkles" size={22} color={colors.text} />
          {/* flex:1 is correct HERE — the header row is full width. It is only
              inside the intrinsically sized bubble that flex-1 collapses. */}
          {/* Title over the scope line — the rail's two-line header. Without
              "On: …" the phone gave no way to tell whether a question was
              about the note you had open or about nothing in particular. */}
          <View style={{ flex: 1, marginLeft: 8 }}>
            <View className="flex-row items-center gap-2">
              <T.Heading style={{ fontWeight: '700' }}>{headerModel.title}</T.Heading>
              {/* The mode rides BESIDE the name, never replaces it: a student
                  mid-lesson had nothing on screen saying which mode they were
                  paying for, and the mode is per thread, so there is nowhere
                  else to look it up. Same pill skin as the attachment chip
                  below — no new shape, no new type step. */}
              {headerModel.modeLabel ? (
                <View
                  className="rounded-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary px-2 py-0.5"
                  accessibilityLabel={headerModel.modeAccessibilityLabel ?? undefined}
                >
                  <T.Label>{headerModel.modeLabel}</T.Label>
                </View>
              ) : null}
            </View>
            <T.Caption
              tone="tertiary"
              numberOfLines={1}
              accessibilityLabel={scopeAccessibilityLabel(companionScope) ?? undefined}
            >
              {headerModel.subtitle}
            </T.Caption>
          </View>
          <Pressable onPress={handleOpenHistory} className="p-2" accessibilityLabel="Past chats">
            <AppIcon name="time" size={20} color={showHistoryList ? colors.text : colors.textTertiary} />
          </Pressable>
          <Pressable onPress={handleNewChat} className="p-2" accessibilityLabel="New chat">
            <AppIcon name="create" size={20} color={colors.textTertiary} />
          </Pressable>
          <Pressable onPress={handleDeleteChat} className="p-2" accessibilityLabel="Delete this chat">
            <AppIcon name="trash" size={20} color={colors.textTertiary} />
          </Pressable>
          <Pressable
            onPress={close}
            className="p-2"
            accessibilityRole="button"
            accessibilityLabel="Close Lantern AI"
          >
            <AppIcon name="close" size={24} color={colors.textTertiary} />
          </Pressable>
        </View>
        <View className="px-4 pb-2">
          <AIDisclaimer compact textColor={colors.textTertiary} linkColor={colors.text} />
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
          /* One offer, never two: `emptyState` decides between the Guided
             picker and the intent chips (see companionEmptyStateModel.ts).
             Drawing both put a `Give me a study tip` pill over the picker's
             cost line on the Home door. */
          ListEmptyComponent={
            emptyState.showLoading ? (
              <View className="py-8 items-center gap-2">
                <ActivityIndicator color={colors.primary} />
                <Text className="text-lantern-text-secondary text-center">
                  Loading conversation…
                </Text>
              </View>
            ) : (
            <View className="py-6 gap-5">
              {emptyState.showGreeting ? <CompanionEmptyState /> : null}
              {emptyState.showGuidedPicker ? (
                <View className="gap-2">
                  <T.Caption tone="secondary" style={{ textAlign: 'center' }}>
                    {GUIDED_MODE_PROMISE}
                  </T.Caption>
                  <GuidedPicker
                    goals={guidedGoals}
                    onPick={handlePickGuidedGoal}
                    onSomethingElse={() => composerRef.current?.focus()}
                    disabled={isBusy || dictationBusy}
                  />
                </View>
              ) : null}
              {emptyState.showIntentChips ? (
              <ScopedPrompts
                activity={routeScope.activity}
                scopeName={companionScope.noteTitle ?? routeScope.scopeName}
                expanded={promptsExpanded}
                onToggleExpanded={() => setPromptsExpanded((v) => !v)}
                onAsk={(message) => void handleSend(message)}
                disabled={isBusy || dictationBusy}
              />
              ) : null}
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
                  // The user bubble is the theme's inverted PAIR, not a white
                  // literal: dark mode's fill is near-white ink, so hard-coded
                  // white text on it was white-on-white. Ground and ink move
                  // together, in both modes, exactly like the action chips.
                  style={isUser ? { backgroundColor: inkFill } : undefined}
                  className={`px-4 py-3 rounded-2xl ${
                    isUser ? 'rounded-br-sm' : 'bg-lantern-background-secondary rounded-bl-sm'
                  }`}
                >
                  {isUser ? (
                    <Text style={{ color: inkGlyph }}>{item.content}</Text>
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
                        style={{ backgroundColor: inkFill }}
                        className="px-3 py-1.5 rounded-full"
                      >
                        <T.Label style={{ color: inkGlyph }}>{action.label}</T.Label>
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
                        color={speakingMessageId === item.id ? colors.text : colors.textTertiary}
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
                      style={{ minHeight: 32, backgroundColor: inkFill }}
                      className={`justify-center px-2.5 rounded-full ml-0.5 ${
                        isBusy ? 'opacity-40' : ''
                      }`}
                    >
                      <T.Label style={{ color: inkGlyph, fontWeight: '500' }}>
                        I don&apos;t understand
                      </T.Label>
                    </Pressable>
                    {/* Turn-into acts on the ANSWER: the thing a student wants
                        cards from is usually the explanation they just read,
                        not whichever note the thread has attached. */}
                    <Pressable
                      onPress={() =>
                        setTurnIntoMessageId((current) => (current === item.id ? null : item.id))
                      }
                      disabled={isBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Turn this answer into study material"
                      accessibilityState={{
                        disabled: isBusy,
                        expanded: turnIntoMessageId === item.id,
                      }}
                      style={{ minHeight: 32, backgroundColor: flashcardsAccent.tint }}
                      className={`flex-row items-center justify-center px-2.5 rounded-full ml-0.5 ${
                        isBusy ? 'opacity-40' : ''
                      }`}
                    >
                      <AppIcon name="sparkles" size={13} color={flashcardsAccent.ink} />
                      <T.Label
                        style={{ color: flashcardsAccent.ink, fontWeight: '500', marginLeft: 4 }}
                      >
                        Turn into…
                      </T.Label>
                    </Pressable>
                  </View>
                ) : null}
                {!isUser && !isStreaming && turnIntoMessageId === item.id ? (
                  <View className="mt-1.5 ml-1 rounded-xl border border-lantern-border p-2.5">
                    <T.Label style={{ color: colors.textSecondary, marginBottom: 6 }}>
                      TURN THIS ANSWER INTO
                    </T.Label>
                    <View className="flex-row flex-wrap gap-2">
                      {TURN_INTO_TARGETS.map((target) => (
                        <Pressable
                          key={`${item.id}-turn-${target.id}`}
                          onPress={() => {
                            setTurnIntoMessageId(null);
                            void handleTurnIntoMessage(target.id, item);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`${messageTurnIntoActionLabel(target.id)} — ${formatTurnIntoCost(
                            target.id
                          )}`}
                          style={{ minHeight: 44 }}
                          className="flex-row items-center rounded-full border border-lantern-border px-3"
                        >
                          <AppIcon name={target.icon} size={15} color={colors.text} />
                          <T.Label style={{ color: colors.text, marginLeft: 6, fontWeight: '500' }}>
                            {target.label}
                          </T.Label>
                          <T.Label style={{ color: colors.textTertiary, marginLeft: 4 }}>
                            {`· ${formatTurnIntoCost(target.id)}`}
                          </T.Label>
                        </Pressable>
                      ))}
                    </View>
                    {/* Said once, plainly, rather than on all six pills. */}
                    <T.Label style={{ color: colors.textTertiary, marginTop: 6 }}>
                      This answer is saved as a note first, so you can find it again.
                    </T.Label>
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
                            color={active ? colors.text : colors.textTertiary}
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
            <View className="mb-2 flex-row items-center self-start max-w-full rounded-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary px-3 py-1.5">
              <AppIcon name="document-text" size={14} color={colors.text} />
              <T.Caption
                style={{ marginLeft: 6, marginRight: 8, flexShrink: 1, fontWeight: '500', color: colors.text }}
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
                <AppIcon name="close" size={14} color={colors.text} />
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

          <ActionSheet
            visible={showAttachSheet}
            title="Attach to this question"
            onClose={() => setShowAttachSheet(false)}
            items={[
              {
                label: 'Add image',
                icon: 'image',
                hint: IMAGE_ATTACH_COST_LABEL,
                accessibilityLabel: `Add image (${IMAGE_ATTACH_COST_LABEL})`,
                disabled: pendingImages.length >= MAX_IMAGE_ATTACHMENTS,
                onPress: () => handleAttachImage('library'),
              },
              {
                label: 'Take photo',
                icon: 'camera',
                hint: IMAGE_ATTACH_COST_LABEL,
                accessibilityLabel: `Take photo (${IMAGE_ATTACH_COST_LABEL})`,
                disabled: pendingImages.length >= MAX_IMAGE_ATTACHMENTS,
                onPress: () => handleAttachImage('camera'),
              },
              {
                label: 'Attach a note',
                icon: 'document-text',
                // Free, and saying nothing is how a student assumes otherwise
                // when the two rows above it both carry a price.
                hint: 'Grounds the answer in your note — no AI uses',
                accessibilityLabel: 'Attach a note as context',
                onPress: () => setShowNotePicker(true),
              },
              {
                section: 'How Lantern teaches',
                label: 'Guided mode',
                // The check IS the icon: this row toggles a state, and a
                // sheet row that only changes its words leaves the state
                // resting on the label alone.
                icon: guided ? 'checkmark-circle' : 'school',
                iconFilled: guided,
                hint: guided
                  ? 'On — one step at a time, with a check before moving on'
                  : GUIDED_MODE_PROMISE,
                accessibilityLabel: guided
                  ? 'Guided mode on. Turn off to go back to normal chat.'
                  : 'Guided mode off. Turn on to be taught one step at a time.',
                onPress: () => {
                  setGuidedPickerDismissed(false);
                  setGuided((v) => !v);
                },
              },
            ]}
          />

          {pendingImages.length ? (
            <View className="mb-2 flex-row flex-wrap items-center gap-2">
              {pendingImages.map((image) => (
                <View
                  key={image.attachmentId}
                  className="flex-row items-center rounded-full bg-lantern-background-secondary px-2 py-1.5"
                >
                  {image.previewUri ? (
                    <Image
                      source={{ uri: image.previewUri }}
                      style={{ width: 22, height: 22, borderRadius: 5 }}
                      resizeMode="cover"
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <AppIcon name="image" size={14} color={colors.text} />
                  )}
                  <T.Caption
                    style={{ marginLeft: 6, marginRight: 8, flexShrink: 1, color: colors.text }}
                    numberOfLines={1}
                  >
                    {describeImageAttachment(image.wordCount)}
                  </T.Caption>
                  <Pressable
                    onPress={() => removeImage(image.attachmentId)}
                    hitSlop={8}
                    accessibilityLabel={`Remove ${image.fileName}`}
                  >
                    <AppIcon name="close" size={14} color={colors.text} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {imageError ? (
            <View className="mb-2">
              <Text className="text-red-600 dark:text-red-300 text-caption">{imageError}</Text>
              {imageErrorDetail ? (
                <Pressable
                  onPress={() => setShowImageErrorDetail((v) => !v)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text className="mt-0.5 text-red-600 dark:text-red-300 text-caption underline">
                    {showImageErrorDetail ? 'Hide details' : 'Details'}
                  </Text>
                </Pressable>
              ) : null}
              {showImageErrorDetail && imageErrorDetail ? (
                <Text className="mt-0.5 text-lantern-text-secondary text-caption">
                  {imageErrorDetail}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Guided on inside a thread with turns in it showed the badge and
              nothing else — the mode with no way to name a target except free
              text. The picker now follows the mode: above the composer, so the
              lesson so far stays readable, and dismissable, because a student
              already mid-lesson does not need it. An empty thread still draws
              its own picker in the empty state, and `companionComposerPicker`
              is what stops both appearing at once. */}
          {companionComposerPicker({
            guided,
            hasMessages: messages.length > 0,
            dismissed: guidedPickerDismissed,
            isLoadingHistory,
          }) ? (
            <View className="mb-2 gap-1">
              <Pressable
                onPress={() => setGuidedPickerDismissed(true)}
                accessibilityRole="button"
                accessibilityLabel="Hide the guided goal picker"
                style={{ minHeight: 44 }}
                className="flex-row items-center justify-end gap-1 px-1"
              >
                <AppIcon name="close" size={14} color={colors.textSecondary} />
                <T.Caption tone="secondary">Hide</T.Caption>
              </Pressable>
              <GuidedPicker
                goals={guidedGoals}
                onPick={handlePickGuidedGoal}
                onSomethingElse={() => {
                  setGuidedPickerDismissed(true);
                  composerRef.current?.focus();
                }}
                disabled={isBusy || dictationBusy}
              />
            </View>
          ) : null}

          <View className="flex-row items-end gap-2">
            <Pressable
              onPress={() => setShowAttachSheet(true)}
              disabled={isBusy || isUploadingImage}
              accessibilityRole="button"
              accessibilityLabel="Attach to this question"
              style={attachActive ? { backgroundColor: inkFill } : undefined}
              className={`h-11 w-11 items-center justify-center rounded-full ${
                attachActive ? '' : 'bg-lantern-background-secondary'
              } ${isBusy || isUploadingImage ? 'opacity-40' : ''}`}
            >
              {isUploadingImage ? (
                <ActivityIndicator size="small" color={attachActive ? inkGlyph : colors.text} />
              ) : (
                <AppIcon name="add" size={22} color={attachActive ? inkGlyph : colors.text} />
              )}
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
                color={isRecording ? '#ffffff' : colors.text}
              />
            </Pressable>
            <TextInput
              ref={composerRef}
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
