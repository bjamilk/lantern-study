import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AppIcon } from './ui/AppIcon';
import { SourceChip } from './ui/SourceChip';
import { useCompanionStore } from '../stores/companionStore';
import { useNotesStore } from '../stores/notesStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import {
  CompanionMessage,
  CompanionAction,
  CompanionUserContext,
  CompanionConversation,
} from '../types';
import {
  isPersistedCompanionMessageId,
  submitCompanionFeedback,
  trackAIAnalyticsEvent,
} from '../services/ai';
import { transcribeAudioForNote } from '../services/notes';
import { AIDisclaimer } from './AIDisclaimer';
import { ImageAttachmentChips } from './companion/ImageAttachmentChips';
import {
  IMAGE_ATTACH_ACCEPT,
  IMAGE_ATTACH_COST_LABEL,
  MAX_IMAGE_ATTACHMENTS,
  readFileAsBase64,
  validateImagePick,
} from './companion/imageAttach';
import ReactMarkdown from 'react-markdown';
// The phone's hand-rolled bubble parser renders tables; without gfm the web
// bubble showed the same answer's table as a row of raw pipes.
import remarkGfm from 'remark-gfm';
import type { MdProps } from './ui/markdownProps';
import type { MessageNoteDraft, TurnIntoTargetId } from '@lantern/shared';
import { messageToNoteDraft } from '@lantern/shared';
import { TurnIntoMenu } from './study/TurnIntoMenu';
import { CompanionHistory } from './companion/CompanionHistory';
import { CompanionPrompts } from './companion/CompanionPrompts';
import { GuidedPicker } from './companion/GuidedPicker';
import {
  buildGuidedGoals,
  showGuidedComposerPicker,
  GUIDED_MODE_PROMISE,
  type GuidedGoal,
  type GuidedNextTopic,
  type GuidedStartTopic,
} from '@lantern/shared/api';
import { MessageActions } from './companion/MessageActions';
import {
  EXPLAIN_SIMPLY_PROMPT,
  composerKeyIntent,
  deriveChatTitle,
  previousUserMessage,
} from './companion/companionScope';
import { cancelSpeech, isSpeechSupported, speak } from './narration/speechEngine';

/**
 * Compact markdown mapping for chat bubbles: the model is instructed to use
 * bullets/bold, but replies rendered as raw text (`**bold**` and `- ` shown
 * literally). Spacing stays tight so short answers still look like chat.
 *
 * Every mapping drops `node` — see `MdProps`.
 */
const bubbleMarkdownComponents = {
  p: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLParagraphElement>>) => <p className="my-1 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLUListElement>>) => <ul className="my-1 pl-4 list-disc space-y-0.5" {...props} />,
  ol: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLOListElement>>) => <ol className="my-1 pl-4 list-decimal space-y-0.5" {...props} />,
  li: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLLIElement>>) => <li className="leading-relaxed" {...props} />,
  /* A bold lead-in is the model's own structure — "**Why it matters:** …" — so
     it takes the page's full ink rather than inheriting the body tone, which is
     what made every lead-in read as ordinary text. */
  strong: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLElement>>) => (
    <strong className="font-semibold text-lantern-text dark:text-white" {...props} />
  ),
  /* Tinted, not grey: a quote in an answer is nearly always the source
     sentence being quoted back, and the `ai` wash marks it as the companion's
     own voice rather than a generic callout. */
  blockquote: ({ node: _node, ...props }: MdProps<React.BlockquoteHTMLAttributes<HTMLQuoteElement>>) => (
    <blockquote
      className="my-1.5 rounded-r-lg border-l-[3px] border-lantern-feature-ai-ink/50 bg-lantern-feature-ai-tint/50 py-1 pl-2.5 pr-2 italic"
      {...props}
    />
  ),
  code: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLElement>>) => (
    <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[0.85em]" {...props} />
  ),
  table: ({ node: _node, ...props }: MdProps<React.TableHTMLAttributes<HTMLTableElement>>) => (
    /* Wide tables scroll inside their own box; the thread must never scroll
       sideways. */
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-left" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }: MdProps<React.ThHTMLAttributes<HTMLTableCellElement>>) => (
    <th className="border border-lantern-border px-2 py-1 font-semibold" {...props} />
  ),
  td: ({ node: _node, ...props }: MdProps<React.TdHTMLAttributes<HTMLTableCellElement>>) => (
    <td className="border border-lantern-border px-2 py-1" {...props} />
  ),
  a: ({ node: _node, ...props }: MdProps<React.AnchorHTMLAttributes<HTMLAnchorElement>>) => (
    <a className="underline" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  h1: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => <p className="font-semibold my-1" {...props} />,
  h2: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => <p className="font-semibold my-1" {...props} />,
  h3: ({ node: _node, ...props }: MdProps<React.HTMLAttributes<HTMLHeadingElement>>) => <p className="font-semibold my-1" {...props} />,
};
/**
 * CommonMark collapses single newlines into spaces, but replies (and stored
 * history) often use plain newlines as line breaks. Convert them to hard
 * breaks — except inside fenced code blocks, where newlines are literal.
 */
function withHardBreaks(content: string): string {
  return content
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith('```') ? part : part.replace(/(?<!\n)\n(?!\n)/g, '  \n')))
    .join('');
}
import Drawer from './ui/Drawer';
import { Illustration } from './ui/Illustration';

interface AICompanionPanelProps {
  context?: CompanionUserContext;
  onAction?: (action: CompanionAction) => void;
  /**
   * Open one note by id — what a source chip under an answer does. Without it
   * a chip falls back to the Notes list, which is still true but coarser.
   */
  onOpenNote?: (noteId: string) => void;
  theme?: 'light' | 'dark';
  /**
   * `drawer` is the overlay that follows every screen.
   * `rail` is the docked pane in a course workspace — always visible, no close
   * unless `closable` is set (Library note editor: the rail is optional).
   */
  variant?: 'drawer' | 'rail';
  /** Show the close control on a rail so the note can take the column back. */
  closable?: boolean;
  /**
   * Drawer width only. The global companion stays `max-w-sm`; Study can pass
   * a wider class so the chat matches the docked rail.
   */
  drawerMaxWidthClass?: string;
  /**
   * Turn the attached note into a study product — the same six targets the
   * studios offer, reusing `TurnIntoMenu`.
   *
   * A prop rather than a call into the pipeline, because the whole turn-into
   * flow (credits, existing-target ticks, navigation to what it made) lives in
   * `CourseWorkspace`; reaching into it from here would mean a second
   * implementation that spends credits by a different path. The control is only
   * drawn when a host supplies this AND a note is attached.
   *
   * The attached note is passed through, because the note the companion holds
   * is not always the note the host has open — the picker above attaches a
   * note without opening it.
   */
  onTurnInto?: (target: TurnIntoTargetId, noteId: string) => void;
  /** Targets already made from the attached note, so nobody pays twice. */
  turnIntoExisting?: Partial<Record<TurnIntoTargetId, boolean>>;
  /**
   * Turn ONE answer into study material.
   *
   * The panel does the part only it can do — deciding which answer, and
   * building the note draft from it — and hands the host a finished draft. The
   * host files the note in its own scope (this set, this course) and runs the
   * existing turn-into path on it, so a message and a note spend credits and
   * navigate by exactly the same code.
   *
   * Absent on hosts that have nowhere to file a note; the control is then not
   * drawn at all rather than drawn and failing.
   */
  onTurnIntoMessage?: (
    target: TurnIntoTargetId,
    draft: MessageNoteDraft,
    message: CompanionMessage
  ) => void | Promise<void>;
  /**
   * The topic this set's plan says comes next, when the host has one.
   *
   * Optional, and honestly so: with nothing here the Guided picker offers
   * `Start learning:` rows only. A `Continue learning:` row that is not backed
   * by a real stored checkpoint would claim progress the student never made.
   *
   * A bare string is the topic title; the object form names the unit too, which
   * reaches the first guided turn as context rather than as a second line on
   * the row.
   */
  guidedNextTopic?: string | GuidedNextTopic | null;
  /**
   * Topics the Guided picker may offer to start — from the plan or units.
   *
   * Plan rows, not bare titles, so the picker can tell a MASTERED topic (which
   * it drops) from a COVERED one (which it still offers: seen once is not
   * done). A host that has only titles may still pass strings.
   */
  guidedTopics?: readonly (string | GuidedStartTopic)[];
}

const MIN_DICTATION_MS = 800;
const MAX_DICTATION_MS = 60_000;
const RECORDER_CHUNK_WAIT_MS = 1_200;

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function chunksTotalSize(chunks: Blob[]): number {
  return chunks.reduce((sum, chunk) => sum + (chunk?.size || 0), 0);
}

function waitForRecorderChunks(
  getChunks: () => Blob[],
  timeoutMs = RECORDER_CHUNK_WAIT_MS
): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (chunksTotalSize(getChunks()) > 0 || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, 0);
  });
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

const AICompanionPanel: React.FC<AICompanionPanelProps> = ({
  context,
  onAction,
  onOpenNote,
  theme = 'light',
  variant = 'drawer',
  closable = false,
  drawerMaxWidthClass = 'max-w-sm',
  onTurnInto,
  turnIntoExisting,
  onTurnIntoMessage,
  guidedNextTopic,
  guidedTopics,
}) => {
  const {
    isOpen, close, messages, isLoading, isLoadingHistory, historyLoaded, isStreaming, error,
    failedMessage, consumeFailedMessage,
    loadHistory, sendMessageStreaming, clearHistory, deleteConversation, clearError,
    pendingMessage, setPendingMessage,
    pendingAssistantMessage, setPendingAssistantMessage, injectAssistantMessage,
    activeNoteContext, setActiveNoteContext,
    activeConversationId, conversations, isLoadingConversations,
    loadConversations, openConversation, startNewChat,
    pendingImages, isUploadingImage, imageError, attachImage, removeImage,
  } = useCompanionStore();
  const notes = useNotesStore((s) => s.notes);
  const notesLoading = useNotesStore((s) => s.isLoading);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const currentUser = useAuthStore(s => s.currentUser);
  const showToast = useToastStore(s => s.showToast);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [showTurnInto, setShowTurnInto] = useState(false);
  /**
   * Which answer has its six-target menu open. One id rather than a per-bubble
   * boolean: opening a second answer's menu closes the first, so the thread
   * never carries two identical six-pill rows.
   */
  const [turnIntoMessageId, setTurnIntoMessageId] = useState<string | null>(null);
  /**
   * The saved conversation's title, used to name a note when the answer opens
   * with prose rather than a heading. Empty on a thread that has not been
   * saved yet — `messageToNoteDraft` falls back again from there.
   */
  const activeConversationTitle = useMemo(
    () => conversations.find((row) => row.id === activeConversationId)?.title ?? '',
    [conversations, activeConversationId]
  );
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  /**
   * Guided is per-thread UI state, never an account setting: a new chat starts
   * in normal mode, and the pill stays reachable mid-lesson so the student can
   * drop back to ordinary chat without losing the thread.
   */
  const [guided, setGuided] = useState(false);
  /**
   * The student shut the picker card that sits above the composer. Per thread
   * and per toggle: turning Guided off and on again is a fresh intent to pick
   * a goal, so the card comes back rather than staying dismissed forever.
   */
  const [guidedPickerDismissed, setGuidedPickerDismissed] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBarTimerRef = useRef<number | undefined>(undefined);
  const [noteSearch, setNoteSearch] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secondsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRecordingRef = useRef(false);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const inputValueRef = useRef('');
  const imageInputRef = useRef<HTMLInputElement>(null);

  /**
   * Picked a photo: check it here first (the server charges before it reads, so
   * a file that was never going to be accepted should not cost AI uses), then
   * upload — the read happens now, not on send.
   */
  const handlePickImage = async (file: File | null | undefined) => {
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (!file) return;
    if (pendingImages.length >= MAX_IMAGE_ATTACHMENTS) {
      showToast(`You can attach up to ${MAX_IMAGE_ATTACHMENTS} images per question.`, 'info');
      return;
    }
    const problem = validateImagePick(file);
    if (problem) {
      showToast(problem, 'error');
      return;
    }
    try {
      const base64Data = await readFileAsBase64(file);
      const attached = await attachImage({
        base64Data,
        fileName: file.name || 'image.jpg',
        contentType: file.type || undefined,
      });
      if (attached && attached.wordCount === 0) {
        showToast('No readable text in that image — try a sharper, closer photo.', 'info');
      }
    } catch {
      showToast('Could not read that file.', 'error');
    }
  };

  // Load active thread (+ conversation list) when the panel opens
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      hasLoaded.current = false;
      setShowHistoryList(false);
      return;
    }
    if (!hasLoaded.current && currentUser) {
      hasLoaded.current = true;
      void loadHistory();
      void loadConversations();
    }
  }, [isOpen, currentUser, loadHistory, loadConversations]);

  // Once per panel open: if no persisted note thread, seed from the open note editor
  const didAutoAttachRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      didAutoAttachRef.current = false;
      return;
    }
    if (didAutoAttachRef.current) return;
    didAutoAttachRef.current = true;
    if (activeNoteContext || !context?.noteId) return;
    void setActiveNoteContext({
      id: context.noteId,
      title: context.noteTitle || 'Untitled note',
    });
  }, [isOpen, context?.noteId, context?.noteTitle, activeNoteContext, setActiveNoteContext]);

  // Load notes list when opening the picker
  useEffect(() => {
    if (!showNotePicker || !currentUser) return;
    if (notes.length === 0) {
      void loadNotes();
    }
  }, [showNotePicker, currentUser, notes.length, loadNotes]);

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

  const handleClearNoteContext = useCallback(async () => {
    await setActiveNoteContext(null);
    trackAIAnalyticsEvent('companion_note_context_cleared');
  }, [setActiveNoteContext]);

  // Auto-send pending message only after history has loaded (never during history fetch)
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
      setInput('');
      handleSend(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingMessage, historyLoaded, isLoadingHistory, isLoading, isStreaming]);

  // Inject assistant-only content (e.g. group chat summary) after history loads
  useEffect(() => {
    if (
      isOpen &&
      pendingAssistantMessage &&
      historyLoaded &&
      !isLoadingHistory
    ) {
      const content = pendingAssistantMessage;
      setPendingAssistantMessage(null);
      injectAssistantMessage(content);
    }
  }, [
    isOpen,
    pendingAssistantMessage,
    historyLoaded,
    isLoadingHistory,
    setPendingAssistantMessage,
    injectAssistantMessage,
  ]);

  /**
   * How far from the bottom still counts as "following the stream". One line
   * of slack, so a rounding pixel or a smooth-scroll still settling does not
   * read as "the student scrolled away".
   */
  const AT_BOTTOM_SLACK_PX = 48;

  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK_PX);
    el.classList.add('is-scrolling');
    if (scrollBarTimerRef.current !== undefined) window.clearTimeout(scrollBarTimerRef.current);
    scrollBarTimerRef.current = window.setTimeout(() => {
      el.classList.remove('is-scrolling');
      scrollBarTimerRef.current = undefined;
    }, 800);
  }, []);

  const scrollMessagesToEnd = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const jumpToLatest = useCallback(() => {
    scrollMessagesToEnd('smooth');
    setIsAtBottom(true);
  }, [scrollMessagesToEnd]);

  /**
   * Follow the stream — but only while the student is already at the bottom.
   *
   * The old effect scrolled on every token unconditionally, so scrolling up to
   * re-read the paragraph above yanked you back down a few times a second for
   * as long as the answer kept arriving; the answer was unreadable until it
   * finished. Now scrolling up simply stops the follow and raises the "Jump to
   * latest" pill, which is the same bargain every chat app makes.
   */
  useEffect(() => {
    if (!isAtBottom) return;
    scrollMessagesToEnd('auto');
  }, [messages, isLoading, isStreaming, isAtBottom, scrollMessagesToEnd]);

  useEffect(() => () => {
    if (scrollBarTimerRef.current !== undefined) window.clearTimeout(scrollBarTimerRef.current);
  }, []);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  // A failed send hands the typed text back: restore it into the composer
  // (unless the user has already started typing something new).
  useEffect(() => {
    if (!failedMessage) return;
    const restored = consumeFailedMessage();
    if (restored && !inputValueRef.current.trim()) {
      setInput(restored);
      inputValueRef.current = restored;
      inputRef.current?.focus();
    }
  }, [failedMessage, consumeFailedMessage]);

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

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

  const resizeInput = useCallback(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 96)}px`;
  }, []);

  const stopDictation = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    clearRecordingTimers();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
    try {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop();
      }
    } catch {
      stopMediaStream();
    }
  }, [clearRecordingTimers, stopMediaStream]);

  const discardDictation = useCallback(() => {
    discardRecordingRef.current = true;
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    stopDictation();
    setIsTranscribing(false);
  }, [stopDictation]);

  const startDictation = useCallback(async () => {
    if (isRecording || isTranscribing || typeof MediaRecorder === 'undefined') return;
    discardRecordingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;
      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const supportedMime =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
          : '';
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
      const recordingMime = recorder.mimeType || supportedMime || 'audio/webm';
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        showToast('Recording failed. Please try again.', 'error');
        clearRecordingTimers();
        stopMediaStream();
        setIsRecording(false);
        setRecordingSeconds(0);
        mediaRecorderRef.current = null;
        chunksRef.current = [];
      };
      recorder.onstop = async () => {
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          stopMediaStream();
          return;
        }

        await waitForRecorderChunks(() => chunksRef.current);
        const durationMs = Date.now() - recordingStartedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: recordingMime });
        chunksRef.current = [];
        stopMediaStream();

        if (blob.size < 256 || durationMs < MIN_DICTATION_MS) {
          showToast('Recording was too short. Hold the mic a bit longer.', 'error');
          return;
        }

        const abortController = new AbortController();
        transcribeAbortRef.current = abortController;
        setIsTranscribing(true);
        try {
          const base64 = await blobToBase64(blob);
          if (!base64 || base64.length < 64) {
            throw new Error('Recording was empty. Please try again.');
          }
          const mimeType = recordingMime.split(';')[0] || 'audio/webm';
          const ext = mimeType.includes('mp4')
            ? 'm4a'
            : mimeType.includes('ogg')
              ? 'ogg'
              : 'webm';
          const result = await transcribeAudioForNote(base64, {
            mimeType,
            fileName: `companion-dictation-${Date.now()}.${ext}`,
            signal: abortController.signal,
            durationMs,
            clientByteLength: blob.size,
            audioBlob: blob,
            // Prefer signed-URL storage so longer clips avoid CF proxy empty-body failures.
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
          requestAnimationFrame(() => {
            resizeInput();
            inputRef.current?.focus();
          });
          trackAIAnalyticsEvent('companion_voice_dictation', {
            screen: context?.currentScreen,
            duration_ms: durationMs,
          });
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const message = err instanceof Error ? err.message : 'Transcription failed';
          showToast(message, 'error');
        } finally {
          transcribeAbortRef.current = null;
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      recordingStartedAtRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);
      secondsTimerRef.current = setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      }, 250);
      maxTimerRef.current = setTimeout(() => {
        stopDictation();
      }, MAX_DICTATION_MS);
      trackAIAnalyticsEvent('companion_voice_dictation_start', {
        screen: context?.currentScreen,
      });
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      const message =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Microphone permission is blocked. Allow mic access, then retry.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug in a mic and try again.'
            : 'Microphone access is required for voice dictation.';
      showToast(message, 'error');
    }
  }, [
    clearRecordingTimers,
    context?.currentScreen,
    isRecording,
    isTranscribing,
    resizeInput,
    showToast,
    stopDictation,
    stopMediaStream,
  ]);

  // Cleanup mic / in-flight transcription when the overlay closes or unmounts.
  // The rail stays mounted, so it only discards on unmount.
  useEffect(() => {
    if (variant === 'rail' || isOpen) return;
    discardDictation();
  }, [isOpen, variant, discardDictation]);

  useEffect(() => {
    return () => {
      discardDictation();
    };
  }, [discardDictation]);

  const enrichedContext: CompanionUserContext = useMemo(() => ({
    userName: currentUser?.firstName || currentUser?.name || 'Student',
    ...context,
    // Every send in this thread carries the mode while Guided is on — the
    // server keeps nothing, so a turn that omitted it would silently drop back
    // to `explain` mid-lesson. Off, the host's own mode (if any) stands.
    ...(guided ? { mode: 'guided' as const } : {}),
  }), [currentUser?.firstName, currentUser?.name, context, guided]);

  /**
   * The picker's rows, from material the client already holds. Pure and local:
   * drawing the picker costs nothing, only the row that is tapped sends a turn.
   */
  const guidedGoals = useMemo(
    () =>
      buildGuidedGoals({
        nextTopic: guidedNextTopic,
        topics: [...(guidedTopics ?? []), activeNoteContext?.title],
      }),
    [guidedNextTopic, guidedTopics, activeNoteContext?.title]
  );

  /**
   * The header's name for this thread. Derived from the messages rather than
   * read off the server's conversation row, so a brand-new chat is named the
   * moment the student's first question lands — before the row exists.
   */
  const chatTitle = useMemo(
    () => (messages.length ? deriveChatTitle(messages) : 'Lantern AI'),
    [messages]
  );

  const isSending = isLoading || isStreaming;
  const isBusy = isSending || isLoadingHistory;
  const dictationBusy = isRecording || isTranscribing;

  /**
   * A send is in flight. `isBusy` derives from store state, which only flips
   * after React re-renders, so two clicks landing inside the same frame both
   * read the stale `false` and both charge a credit. A ref flips synchronously
   * and closes that window.
   */
  const sendInFlightRef = useRef(false);

  const handleSend = useCallback(async (
    text?: string,
    /**
     * Extra context for THIS turn only. The Guided seed uses it to name the
     * source note the plan topic came from, so the first reply teaches from
     * the note's text instead of asking which material to use. It is not an
     * attachment: nothing is stapled to the thread and no history is reloaded.
     */
    turnContext?: Partial<CompanionUserContext>
  ) => {
    const msg = (text ?? input).trim();
    if (!msg || isBusy || dictationBusy || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    // Clear on accept, the way mobile does: the question is about to appear in
    // the thread, so leaving it in the box invites a second send of the same
    // text. `resizeInput` collapses the grown textarea back to one row — without
    // it the box keeps the height of the message that just left it.
    setInput('');
    inputValueRef.current = '';
    requestAnimationFrame(resizeInput);
    try {
      await sendMessageStreaming(
        msg,
        turnContext ? { ...enrichedContext, ...turnContext } : enrichedContext
      );
    } finally {
      sendInFlightRef.current = false;
    }
    trackAIAnalyticsEvent('companion_message_sent', { screen: context?.currentScreen });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isBusy, dictationBusy, sendMessageStreaming, enrichedContext, resizeInput]);

  /**
   * Send a picker row's first guided turn.
   *
   * When the goal knows the note its topic was built from, that note rides
   * along as THIS TURN's context — the model then has the text in front of it
   * and can teach step 1, instead of spending the credit asking which of the
   * unit's notes to use. It is deliberately not an attachment: attaching
   * clears the thread and reloads history, and the card above the composer
   * exists precisely so a student can pick a goal mid-conversation.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleSend, activeNoteContext]
  );

  const handleCopyMessage = useCallback(
    (content: string) => {
      const write = navigator?.clipboard?.writeText?.(content);
      if (!write) {
        showToast('Copying is not available in this browser.', 'error');
        return;
      }
      void write
        .then(() => showToast('Copied to clipboard', 'success'))
        .catch(() => showToast('Could not copy that.', 'error'));
    },
    [showToast]
  );

  /**
   * Read aloud, as a toggle: the same button stops it. The engine speaks one
   * utterance at a time, so the id in state is what tells a row whether IT is
   * the one talking — without it every row would show "Stop".
   */
  const handleToggleSpeak = useCallback(
    (messageId: string, content: string) => {
      if (speakingMessageId === messageId) {
        cancelSpeech();
        setSpeakingMessageId(null);
        return;
      }
      cancelSpeech();
      setSpeakingMessageId(messageId);
      speak({
        text: content,
        rate: 1,
        onEnd: () => setSpeakingMessageId((id) => (id === messageId ? null : id)),
        onError: () => {
          setSpeakingMessageId((id) => (id === messageId ? null : id));
          showToast('Could not read that aloud.', 'error');
        },
      });
      trackAIAnalyticsEvent('companion_read_aloud');
    },
    [speakingMessageId, showToast]
  );

  // Nothing should keep talking after the drawer closes. The rail stays
  // mounted, so it only falls silent on unmount.
  useEffect(() => {
    if (variant === 'rail' || isOpen) return;
    cancelSpeech();
    setSpeakingMessageId(null);
  }, [isOpen, variant]);

  useEffect(() => () => cancelSpeech(), []);

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

  const handleComposerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const intent = composerKeyIntent({
        key: e.key,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        nativeEvent: { isComposing: e.nativeEvent?.isComposing },
      });
      if (intent !== 'send') return;
      e.preventDefault();
      void handleSend();
    },
    [handleSend]
  );

  const handleClear = async () => {
    setShowClearConfirm(false);
    await clearHistory();
  };

  const handleOpenHistory = () => {
    setShowHistoryList(true);
    setShowNotePicker(false);
    setShowClearConfirm(false);
    void loadConversations();
    trackAIAnalyticsEvent('companion_history_opened');
  };

  const handleSelectConversation = async (conversation: CompanionConversation) => {
    setShowHistoryList(false);
    await openConversation(conversation.id);
    trackAIAnalyticsEvent('companion_history_resumed', {
      conversationId: conversation.id,
      hasNote: Boolean(conversation.noteContextId),
    });
  };

  const handleNewChat = () => {
    setShowHistoryList(false);
    startNewChat();
    trackAIAnalyticsEvent('companion_new_chat');
  };

  const handleAction = (action: CompanionAction) => {
    onAction?.(action);
    trackAIAnalyticsEvent('companion_action_clicked', { action_type: action.type, label: action.label });
    close();
  };

  if (variant !== 'rail' && !isOpen) return null;

  const body = (
    <>
        {/* Header */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b flex-shrink-0
          ${theme === 'dark' ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-primary-background'}`}>
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-lantern-primary flex-shrink-0">
            <AppIcon name="sparkles" size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            {/* The chat's own name, from the first thing that was asked. The
                header used to say "Lantern AI" over every thread, so the one
                open chat was indistinguishable from the fifty in history. */}
            <p id="ai-companion-title" className="font-semibold text-sm text-lantern-text dark:text-white truncate">
              {chatTitle}
            </p>
            <p className={`text-xs truncate ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              {guided
                ? 'Guided'
                : context?.currentScreen
                  ? `On: ${context.currentScreen}`
                  : 'Your AI study companion'}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            {onTurnInto && activeNoteContext && (
              <button
                onClick={() => { setShowTurnInto((v) => !v); setShowHistoryList(false); }}
                title="Turn this note into something"
                aria-label="Turn into"
                aria-expanded={showTurnInto}
                className={`p-1.5 rounded-lg transition-colors ${showTurnInto ? 'text-lantern-feature-ai-ink' : theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
              >
                <AppIcon name="apps" size={16} />
              </button>
            )}
            <button
              onClick={handleOpenHistory}
              title="Past chats"
              aria-label="Past chats"
              aria-pressed={showHistoryList}
              className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'} ${showHistoryList ? 'text-lantern-primary' : ''}`}
            >
              <AppIcon name="time" size={16} />
            </button>
            <button
              onClick={handleNewChat}
              title="New chat"
              aria-label="New chat"
              className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
            >
              <AppIcon name="chatbubbles" size={16} />
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              title="Delete this chat"
              aria-label="Delete this chat"
              className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
            >
              <AppIcon name="trash" size={16} />
            </button>
            {(variant !== 'rail' || closable) && (
            <button
              onClick={close}
              title="Close"
              aria-label="Close AI companion"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
            >
              <AppIcon name="close" size={20} />
            </button>
            )}
          </div>
        </div>

        {/* Clear confirm banner */}
        {showClearConfirm && (
          <div className={`px-4 py-2 flex items-center gap-2 text-sm border-b flex-shrink-0
            ${theme === 'dark' ? 'bg-red-900/30 border-red-700 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <span className="flex-1">Delete this chat? Past chats stay in history.</span>
            <button onClick={handleClear} className="font-medium hover:underline">Yes</button>
            <button onClick={() => setShowClearConfirm(false)} className="font-medium hover:underline">Cancel</button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className={`px-4 py-2 flex items-center gap-2 text-sm border-b flex-shrink-0
            ${theme === 'dark' ? 'bg-red-900/30 border-red-700 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="font-medium hover:underline">Dismiss</button>
          </div>
        )}

        {showHistoryList ? (
          <CompanionHistory
            conversations={conversations}
            activeConversationId={activeConversationId}
            isLoading={isLoadingConversations}
            onSelect={(conversation) => void handleSelectConversation(conversation)}
            onDelete={(conversationId) => void deleteConversation(conversationId)}
            onNewChat={handleNewChat}
            onBack={() => setShowHistoryList(false)}
            formatRelativeTime={formatRelativeTime}
          />
        ) : (
        /* Messages area. `relative` anchors the "Jump to latest" pill. */
        <div className="relative flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col">
        <div
          ref={scrollRef}
          onScroll={handleMessagesScroll}
          className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden scrollbar-autohide px-4 py-3 space-y-4"
        >
          {isLoadingHistory && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-lantern-text-secondary">
              <TypingDots />
              <span>Loading conversation…</span>
            </div>
          )}

          {!isLoadingHistory && messages.length === 0 && !isBusy && (
            <EmptyState
              theme={theme}
              onQuickPrompt={handleSend}
              promptsExpanded={promptsExpanded}
              onTogglePrompts={() => setPromptsExpanded((v) => !v)}
              disabled={isBusy || dictationBusy}
              guided={guided}
              guidedGoals={guidedGoals}
              onPickGuidedGoal={handlePickGuidedGoal}
              onGuidedSomethingElse={() => inputRef.current?.focus()}
            />
          )}

          {!isLoadingHistory && messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              theme={theme}
              onAction={handleAction}
              onOpenNote={onOpenNote}
              onTurnInto={
                onTurnIntoMessage
                  ? (target) => {
                      setTurnIntoMessageId(null);
                      void onTurnIntoMessage(
                        target,
                        messageToNoteDraft(msg, activeConversationTitle),
                        msg
                      );
                    }
                  : undefined
              }
              turnIntoOpen={turnIntoMessageId === msg.id}
              onToggleTurnInto={() =>
                setTurnIntoMessageId((current) => (current === msg.id ? null : msg.id))
              }
              isStreaming={isStreaming && msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id}
              busy={isBusy}
              isSpeaking={speakingMessageId === msg.id}
              onCopy={handleCopyMessage}
              onToggleSpeak={handleToggleSpeak}
              onRegenerate={handleRegenerate}
              onExplainSimply={handleExplainSimply}
            />
          ))}

          {/* Typing indicator (non-streaming fallback) */}
          {isLoading && !isStreaming && (
            <div className="flex items-start gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-lantern-primary flex-shrink-0 mt-0.5">
                <AppIcon name="sparkles" size={16} className="text-white" />
              </div>
              <div className={`px-3 py-2 rounded-2xl rounded-tl-none max-w-[80%]
                ${theme === 'dark' ? 'bg-lantern-surface-secondary' : 'bg-lantern-background-secondary'}`}>
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        {/* Scrolling up stops the auto-follow; this is how you get back without
            hunting for the bottom of a still-growing answer. */}
        {!isAtBottom && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-surface px-3 py-1.5 text-xs font-medium text-lantern-text shadow-lg dark:bg-lantern-surface-secondary"
          >
            <AppIcon name="chevron-down" size={14} />
            Jump to latest
          </button>
        )}
        </div>
        )}

        {/* Input area — pad above home indicator; stays above bottom nav when that is visible */}
        {!showHistoryList && (
        <div className={`px-4 pt-3 border-t flex-shrink-0 min-w-0 overflow-x-hidden ${
          variant === 'rail'
            ? 'pb-3'
            : 'pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]'
        } ${theme === 'dark' ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-background'}`}>
          {activeNoteContext && (
            <div className="mb-2 flex items-center gap-2">
              <SourceChip
                title={activeNoteContext.title}
                theme={theme}
                onRemove={() => void handleClearNoteContext()}
              />
            </div>
          )}
          {/* The six targets, on the note that is attached — the same menu the
              studios draw, not a second one. */}
          {showTurnInto && onTurnInto && activeNoteContext && (
            <div className="mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-2.5 dark:bg-lantern-surface-secondary">
              <TurnIntoMenu
                disabled={isBusy}
                existing={turnIntoExisting}
                onSelect={(target) => {
                  setShowTurnInto(false);
                  onTurnInto(target, activeNoteContext.id);
                }}
              />
            </div>
          )}
          {showNotePicker && (
            <div
              className={`mb-2 rounded-xl border shadow-lg overflow-hidden
                ${theme === 'dark' ? 'border-lantern-border bg-lantern-surface-secondary' : 'border-lantern-border bg-lantern-surface'}`}
              role="listbox"
              aria-label="Select a note for context"
            >
              <div className={`flex items-center gap-2 px-3 py-2 border-b ${theme === 'dark' ? 'border-lantern-border' : 'border-lantern-border'}`}>
                <input
                  type="search"
                  value={noteSearch}
                  onChange={(e) => setNoteSearch(e.target.value)}
                  placeholder="Search notes…"
                  autoFocus
                  className={`flex-1 bg-transparent text-sm outline-none placeholder:text-lantern-text-tertiary
                    ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}
                />
                <button
                  type="button"
                  onClick={() => { setShowNotePicker(false); setNoteSearch(''); }}
                  className="text-xs text-lantern-text-secondary hover:underline"
                >
                  Close
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {notesLoading && notes.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-center text-lantern-text-secondary">Loading notes…</p>
                ) : filteredNotes.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-center text-lantern-text-secondary">
                    {noteSearch.trim() ? 'No matching notes' : 'No notes yet'}
                  </p>
                ) : (
                  filteredNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      role="option"
                      aria-selected={activeNoteContext?.id === note.id}
                      onClick={() => void handleSelectNote(note)}
                      className={`w-full text-left px-3 py-2.5 text-sm truncate transition-colors
                        ${activeNoteContext?.id === note.id
                          ? theme === 'dark'
                            ? 'bg-lantern-primary/20 text-lantern-primary-light'
                            : 'bg-lantern-primary-background text-lantern-primary'
                          : theme === 'dark'
                            ? 'text-white hover:bg-lantern-surface'
                            : 'text-lantern-text hover:bg-lantern-background-secondary'
                        }`}
                    >
                      {(note.title || '').trim() || 'Untitled note'}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          <ImageAttachmentChips
            images={pendingImages}
            onRemove={removeImage}
            theme={theme}
            disabled={isBusy}
          />
          {imageError && (
            <p className="mb-2 text-xs text-red-500" role="alert">{imageError}</p>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept={IMAGE_ATTACH_ACCEPT}
            className="hidden"
            onChange={(e) => void handlePickImage(e.target.files?.[0])}
          />
          {/* Guided on inside a thread that already has turns used to show the
              badge and nothing else — the mode with no way to name a target
              except free text. The picker now follows the mode: above the
              composer, so the lesson so far stays readable, and dismissable,
              because a student who is already mid-lesson does not need it. The
              empty thread still draws its own picker in the empty state, and
              `showGuidedComposerPicker` is what stops both appearing at once. */}
          {showGuidedComposerPicker({
            guided,
            hasMessages: messages.length > 0,
            dismissed: guidedPickerDismissed,
            isLoadingHistory,
          }) && (
            <div className="mb-2">
              <div className="mb-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setGuidedPickerDismissed(true)}
                  aria-label="Hide the guided goal picker"
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-caption font-medium text-lantern-text-secondary hover:text-lantern-text dark:text-lantern-text-tertiary"
                >
                  <AppIcon name="close" size={14} />
                  Hide
                </button>
              </div>
              <GuidedPicker
                theme={theme}
                goals={guidedGoals}
                onPick={handlePickGuidedGoal}
                onSomethingElse={() => {
                  setGuidedPickerDismissed(true);
                  inputRef.current?.focus();
                }}
                disabled={isBusy || dictationBusy}
              />
            </div>
          )}
          {/* The Guided pill sits in the composer row, where the mode it
              changes is — not in a settings menu. It is a toggle, so it carries
              its state in `aria-pressed` rather than only in its fill, and it
              stays live mid-lesson so normal chat is one tap away. */}
          <div className="mb-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setGuided((v) => {
                  // Turning Guided ON is a fresh intent to pick a goal, so the
                  // card above the composer comes back even if it was shut
                  // earlier in this thread.
                  setGuidedPickerDismissed(false);
                  return !v;
                })
              }
              aria-pressed={guided}
              aria-label={
                guided
                  ? 'Guided mode on. Turn off to go back to normal chat.'
                  : 'Guided mode off. Turn on to be taught one step at a time.'
              }
              title={guided ? 'Back to normal chat' : GUIDED_MODE_PROMISE}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-label font-medium transition-colors
                ${guided
                  ? 'border-lantern-primary bg-lantern-primary-background text-lantern-primary dark:bg-lantern-primary/20'
                  : theme === 'dark'
                    ? 'border-lantern-border text-lantern-text-tertiary hover:text-lantern-primary'
                    : 'border-lantern-border text-lantern-text-secondary hover:text-lantern-primary'
                }`}
            >
              <AppIcon name="school" size={14} />
              Guided
            </button>
          </div>
          <div className={`flex items-end gap-2 rounded-xl border px-3 py-2
            ${theme === 'dark' ? 'bg-lantern-surface-secondary border-lantern-border' : 'bg-lantern-surface border-lantern-border'}`}>
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isBusy || isUploadingImage || pendingImages.length >= MAX_IMAGE_ATTACHMENTS}
              // The price is in the tooltip because it is spent on the pick,
              // before anything is typed or sent.
              title={`Add image — ${IMAGE_ATTACH_COST_LABEL}`}
              aria-label={`Add image (${IMAGE_ATTACH_COST_LABEL})`}
              className={`flex-shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg transition-colors disabled:opacity-40
                ${pendingImages.length
                  ? 'text-lantern-primary bg-lantern-primary-background dark:bg-lantern-primary/20'
                  : theme === 'dark'
                    ? 'text-lantern-text-tertiary hover:bg-lantern-surface hover:text-lantern-primary'
                    : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-primary'
                }`}
            >
              <AppIcon name={isUploadingImage ? 'time' : 'image'} size={16} />
            </button>
            <button
              type="button"
              onClick={() => setShowNotePicker((v) => !v)}
              disabled={isBusy}
              title="Attach a note as context"
              aria-label="Attach a note as context"
              aria-expanded={showNotePicker}
              className={`flex-shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg transition-colors disabled:opacity-40
                ${showNotePicker || activeNoteContext
                  ? 'text-lantern-primary bg-lantern-primary-background dark:bg-lantern-primary/20'
                  : theme === 'dark'
                    ? 'text-lantern-text-tertiary hover:bg-lantern-surface hover:text-lantern-primary'
                    : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-primary'
                }`}
            >
              <AppIcon name="add" size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (isRecording) stopDictation();
                else void startDictation();
              }}
              disabled={isBusy || isTranscribing}
              title={isRecording ? 'Stop dictation' : 'Dictate with microphone'}
              aria-label={isRecording ? 'Stop dictation' : 'Dictate with microphone'}
              aria-pressed={isRecording}
              className={`flex-shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg transition-colors disabled:opacity-40
                ${isRecording
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : theme === 'dark'
                    ? 'text-lantern-text-tertiary hover:bg-lantern-surface hover:text-lantern-primary'
                    : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-primary'
                }`}
            >
              {isRecording ? <AppIcon name="stop" size={16} /> : <AppIcon name="mic" size={16} />}
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              // Enter sends, Shift+Enter opens a line — see `composerKeyIntent`,
              // which also drops the Enter that commits an IME composition.
              onKeyDown={handleComposerKeyDown}
              placeholder={
                isRecording
                  ? 'Listening…'
                  : isTranscribing
                    ? 'Transcribing…'
                    : activeNoteContext
                      ? `Ask about “${activeNoteContext.title.slice(0, 28)}${activeNoteContext.title.length > 28 ? '…' : ''}”`
                      : 'Ask Lantern anything…'
              }
              rows={1}
              disabled={dictationBusy}
              className={`flex-1 resize-none bg-transparent text-sm outline-none max-h-24 leading-relaxed
                placeholder:text-lantern-text-tertiary disabled:opacity-70 ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}
              style={{ height: 'auto' }}
              onInput={e => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 96) + 'px';
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isBusy || dictationBusy}
              aria-label="Send message"
              title="Send (Enter)"
              className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-lantern-primary-fill text-white disabled:opacity-40 hover:bg-lantern-primary-dark transition-colors"
            >
              <AppIcon name="arrow-up" size={16} />
            </button>
          </div>
          {(isRecording || isTranscribing) && (
            <p className={`mt-1.5 text-xs text-center ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              {isRecording
                ? `Listening… ${recordingSeconds}s — tap stop when done`
                : 'Converting speech to text…'}
            </p>
          )}
          <div className="mt-1.5 flex items-center justify-center text-center">
            <AIDisclaimer compact />
          </div>
        </div>
        )}
    </>
  );

  if (variant === 'rail') {
    return (
      <aside
        className={`h-full min-h-0 min-w-0 overflow-hidden flex flex-col ${theme === 'dark' ? 'bg-lantern-background text-white' : 'bg-lantern-surface text-lantern-text'}`}
        aria-labelledby="ai-companion-title"
      >
        {body}
      </aside>
    );
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={close}
      ariaLabelledBy="ai-companion-title"
      maxWidthClass={drawerMaxWidthClass}
      zIndexClass="z-[70]"
      backdropClassName="bg-black/20 md:hidden"
      panelClassName={`!p-0 min-w-0 overflow-x-hidden shadow-2xl ${theme === 'dark' ? 'bg-lantern-background text-white' : 'bg-lantern-surface text-lantern-text'}`}
      loading={isSending}
      closeOnBackdrop={!isSending}
    >
      {body}
    </Drawer>
  );
};

// ─── Sub-components ────────────────────────────────────────

interface MessageBubbleProps {
  message: CompanionMessage;
  theme: 'light' | 'dark';
  onAction: (action: CompanionAction) => void;
  onOpenNote?: (noteId: string) => void;
  isStreaming?: boolean;
  /** A send is in flight — the two actions that spend a credit are held. */
  busy?: boolean;
  isSpeaking?: boolean;
  onCopy?: (content: string) => void;
  onToggleSpeak?: (messageId: string, content: string) => void;
  onRegenerate?: (messageId: string) => void;
  onExplainSimply?: () => void;
  /** Turn this one answer into study material; absent where nothing can file a note. */
  onTurnInto?: (target: TurnIntoTargetId) => void;
  turnIntoOpen?: boolean;
  onToggleTurnInto?: () => void;
}

/**
 * One chip per excerpt while the list is short enough to read; past three they
 * collapse into a single chip, because eight pills say less than one.
 */
export function buildCitationChipLabels(excerpts: number[]): string[] {
  const unique = Array.from(new Set(excerpts.filter((n) => Number.isFinite(n) && n > 0))).sort(
    (a, b) => a - b
  );
  if (!unique.length) return [];
  if (unique.length > 3) return [`Excerpts ${unique.join(', ')}`];
  return unique.map((n) => `Excerpt ${n}`);
}

/**
 * One turn in the thread.
 *
 * The anatomy, which is the point of this component:
 *
 *   - The ASSISTANT's answer sits on the page ground with no bubble at all,
 *     with the Lantern mark alone in the gutter. An answer is usually the
 *     longest thing on screen, and wrapping several paragraphs, a list and a
 *     table in a grey rounded box made a document look like an SMS; the mark in
 *     the margin already says who is speaking.
 *   - The STUDENT's question keeps a bubble, in a pale grey — not the brand
 *     fill it used to have. A saturated indigo block is the loudest thing on
 *     the screen, which put the emphasis on the question rather than on the
 *     answer the student is here to read.
 */
const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  theme,
  onAction,
  onOpenNote,
  isStreaming,
  busy,
  isSpeaking,
  onCopy,
  onToggleSpeak,
  onRegenerate,
  onExplainSimply,
  onTurnInto,
  turnIntoOpen,
  onToggleTurnInto,
}) => {
  const isUser = message.role === 'user';
  const setMessageFeedback = useCompanionStore((s) => s.setMessageFeedback);
  const feedback = message.feedback ?? null;
  const pendingRef = useRef(false);
  const canRate =
    !isUser &&
    !isStreaming &&
    message.content.length > 0 &&
    isPersistedCompanionMessageId(message.id);

  const handleFeedback = async (rating: 'up' | 'down') => {
    if (pendingRef.current || !canRate) return;
    const next = feedback === rating ? null : rating;
    pendingRef.current = true;
    const previous = feedback;
    // Persist in the store immediately so remounts / history merges keep the selection.
    setMessageFeedback(message.id, next);
    try {
      await submitCompanionFeedback(message.id, next);
      trackAIAnalyticsEvent('companion_feedback', {
        rating: next,
        messageId: message.id,
      });
    } catch {
      setMessageFeedback(message.id, previous);
    } finally {
      pendingRef.current = false;
    }
  };

  if (isUser) {
    return (
      <div className="flex min-w-0 max-w-full justify-end">
        <div
          className={`max-w-[85%] min-w-0 break-words whitespace-pre-wrap rounded-2xl rounded-tr-md px-3 py-2 text-sm leading-relaxed
            ${theme === 'dark'
              ? 'bg-lantern-surface-secondary text-white'
              : 'bg-lantern-background-secondary text-lantern-text'
            }`}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      {/* The mark in the gutter is what says "Lantern" now that the answer has
          no bubble of its own. */}
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-lantern-feature-ai-tint">
        <AppIcon name="sparkles" size={15} className="text-lantern-feature-ai-ink" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <div
          className={`w-full min-w-0 break-words text-sm leading-relaxed ${isStreaming ? 'whitespace-pre-wrap' : ''}
            ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}
        >
          {isStreaming ? (
            // Plain while streaming: the caret stays inline with the text and
            // half-typed markdown never renders literally mid-stream.
            message.content
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={bubbleMarkdownComponents}>
              {withHardBreaks(message.content)}
            </ReactMarkdown>
          )}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current align-middle" />
          )}
        </div>
        {/* Where this answer was read from. Excerpt numbers, never page
            numbers — the pipeline has no pages. */}
        {!isStreaming && message.citations && (
          <div className="flex flex-wrap gap-1.5">
            {buildCitationChipLabels(message.citations.excerpts).map((detail) => (
              <SourceChip
                key={detail}
                title={message.citations!.noteTitle}
                detail={detail}
                theme={theme}
                onPress={
                  onOpenNote
                    ? () => onOpenNote(message.citations!.noteId)
                    : () =>
                        onAction({
                          type: 'navigate_to_notes',
                          label: message.citations!.noteTitle,
                          payload: { noteId: message.citations!.noteId },
                        })
                }
              />
            ))}
          </div>
        )}
        {/* Action buttons */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.actions.map((action, i) => (
              <button
                key={i}
                onClick={() => onAction(action)}
                className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors
                  ${theme === 'dark'
                    ? 'border-lantern-primary text-lantern-primary-light hover:bg-lantern-primary-dark'
                    : 'border-lantern-primary text-lantern-primary hover:bg-lantern-primary-background'
                  }`}
              >
                → {action.label}
              </button>
            ))}
          </div>
        )}
        {/* Copy / read aloud / ask again / explain simply / the two thumbs. */}
        {!isStreaming && message.content.trim() && (
          <MessageActions
            onCopy={() => onCopy?.(message.content)}
            onToggleSpeak={() => onToggleSpeak?.(message.id, message.content)}
            isSpeaking={Boolean(isSpeaking)}
            canSpeak={isSpeechSupported()}
            onRegenerate={() => onRegenerate?.(message.id)}
            onExplainSimply={() => onExplainSimply?.()}
            onRate={(rating) => void handleFeedback(rating)}
            feedback={feedback}
            canRate={canRate}
            busy={busy}
            onTurnInto={onTurnInto}
            turnIntoOpen={turnIntoOpen}
            onToggleTurnInto={onToggleTurnInto}
          />
        )}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{
  theme: 'light' | 'dark';
  onQuickPrompt: (text: string) => void;
  promptsExpanded: boolean;
  onTogglePrompts: () => void;
  disabled?: boolean;
  guided: boolean;
  guidedGoals: readonly GuidedGoal[];
  onPickGuidedGoal: (goal: GuidedGoal) => void;
  onGuidedSomethingElse: () => void;
}> = ({
  theme,
  onQuickPrompt,
  promptsExpanded,
  onTogglePrompts,
  disabled,
  guided,
  guidedGoals,
  onPickGuidedGoal,
  onGuidedSomethingElse,
}) => (
  <div className="flex flex-col items-center gap-4 py-6 text-center">
    {/* The AI empty state's spot illustration (§5.6). It replaces a plain
        indigo disc: the disc was a container with a glyph in it, and this is
        the same hue doing the same job while actually saying what Lantern
        reads — a book. */}
    <Illustration name="sparkles-book" feature="ai" size={88} />
    <div>
      <p className={`font-semibold text-base ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}>Hi, I'm Lantern!</p>
      <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
        {guided ? GUIDED_MODE_PROMISE : 'Your personal AI study companion. Ask me anything.'}
      </p>
    </div>
    {guided ? (
      <GuidedPicker
        theme={theme}
        goals={guidedGoals}
        onPick={onPickGuidedGoal}
        onSomethingElse={onGuidedSomethingElse}
        disabled={disabled}
      />
    ) : (
      <CompanionPrompts
        expanded={promptsExpanded}
        onToggleExpanded={onTogglePrompts}
        onAsk={onQuickPrompt}
        disabled={disabled}
      />
    )}
  </div>
);


const TypingDots: React.FC = () => (
  <div className="flex items-center gap-1 h-5">
    {[0, 1, 2].map(i => (
      <span
        key={i}
        className="w-2 h-2 rounded-full bg-lantern-border animate-bounce"
        style={{ animationDelay: `${i * 150}ms`, animationDuration: '800ms' }}
      />
    ))}
  </div>
);

export default AICompanionPanel;

