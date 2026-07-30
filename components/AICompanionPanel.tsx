import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  XMarkIcon,
  TrashIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  MicrophoneIcon,
  StopIcon,
  PlusIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { HandThumbUpIcon as ThumbUpSolid, HandThumbDownIcon as ThumbDownSolid } from '@heroicons/react/24/solid';
import { useCompanionStore } from '../stores/companionStore';
import { useNotesStore } from '../stores/notesStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { CompanionMessage, CompanionAction, CompanionUserContext } from '../types';
import {
  isPersistedCompanionMessageId,
  submitCompanionFeedback,
  trackAIAnalyticsEvent,
} from '../services/ai';
import { transcribeAudioForNote } from '../services/notes';
import { AIDisclaimer } from './AIDisclaimer';
import Drawer from './ui/Drawer';

interface AICompanionPanelProps {
  context?: CompanionUserContext;
  onAction?: (action: CompanionAction) => void;
  theme?: 'light' | 'dark';
}

const QUICK_PROMPTS = [
  'What should I study today?',
  'Generate flashcards for my weak topics',
  'Quiz me on my weak topics',
  'Give me a study tip',
  'Explain spaced repetition',
  'Build my study plan for this week',
  'How am I spending this month?',
];

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

const AICompanionPanel: React.FC<AICompanionPanelProps> = ({ context, onAction, theme = 'light' }) => {
  const {
    isOpen, close, messages, isLoading, isLoadingHistory, historyLoaded, isStreaming, error,
    loadHistory, sendMessageStreaming, clearHistory, clearError,
    pendingMessage, setPendingMessage,
    pendingAssistantMessage, setPendingAssistantMessage, injectAssistantMessage,
    activeNoteContext, setActiveNoteContext,
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
  const [showNotePicker, setShowNotePicker] = useState(false);
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

  // Load history on first open (scoped to active note thread if any)
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (isOpen && !hasLoaded.current && currentUser) {
      hasLoaded.current = true;
      loadHistory();
    }
  }, [isOpen, currentUser, loadHistory]);

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
    const q = noteSearch.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => (n.title || '').toLowerCase().includes(q));
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

  // Scroll to bottom on new messages / streaming tokens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isStreaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

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

  // Cleanup mic / in-flight transcription when the panel closes or unmounts
  useEffect(() => {
    if (isOpen) return;
    discardDictation();
  }, [isOpen, discardDictation]);

  useEffect(() => {
    return () => {
      discardDictation();
    };
  }, [discardDictation]);

  const enrichedContext: CompanionUserContext = useMemo(() => ({
    userName: currentUser?.firstName || currentUser?.name || 'Student',
    ...context,
  }), [currentUser?.firstName, currentUser?.name, context]);

  const isSending = isLoading || isStreaming;
  const isBusy = isSending || isLoadingHistory;
  const dictationBusy = isRecording || isTranscribing;

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isBusy || dictationBusy) return;
    setInput('');
    inputValueRef.current = '';
    await sendMessageStreaming(msg, enrichedContext);
    trackAIAnalyticsEvent('companion_message_sent', { screen: context?.currentScreen });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isBusy, dictationBusy, sendMessageStreaming, enrichedContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = async () => {
    setShowClearConfirm(false);
    await clearHistory();
  };

  const handleAction = (action: CompanionAction) => {
    onAction?.(action);
    trackAIAnalyticsEvent('companion_action_clicked', { action_type: action.type, label: action.label });
    close();
  };

  if (!isOpen) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={close}
      ariaLabelledBy="ai-companion-title"
      maxWidthClass="max-w-sm"
      zIndexClass="z-[70]"
      backdropClassName="bg-black/20 md:hidden"
      panelClassName={`!p-0 shadow-2xl ${theme === 'dark' ? 'bg-lantern-background text-white' : 'bg-lantern-surface text-lantern-text'}`}
      loading={isSending}
      closeOnBackdrop={!isSending}
    >

        {/* Header */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b flex-shrink-0
          ${theme === 'dark' ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-primary-background'}`}>
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-lantern-primary flex-shrink-0">
            <SparklesIcon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p id="ai-companion-title" className="font-semibold text-sm text-lantern-primary">Lantern</p>
            <p className={`text-xs truncate ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              {context?.currentScreen ? `On: ${context.currentScreen}` : 'Your AI study companion'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowClearConfirm(true)}
              title="Clear conversation"
              className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
            >
              <TrashIcon className="w-4 h-4" />
            </button>
            <button
              onClick={close}
              title="Close"
              aria-label="Close AI companion"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Clear confirm banner */}
        {showClearConfirm && (
          <div className={`px-4 py-2 flex items-center gap-2 text-sm border-b flex-shrink-0
            ${theme === 'dark' ? 'bg-red-900/30 border-red-700 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <span className="flex-1">Clear entire conversation?</span>
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

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {isLoadingHistory && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-lantern-text-secondary">
              <TypingDots />
              <span>Loading conversation…</span>
            </div>
          )}

          {!isLoadingHistory && messages.length === 0 && !isBusy && (
            <EmptyState theme={theme} onQuickPrompt={handleSend} />
          )}

          {!isLoadingHistory && messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              theme={theme}
              onAction={handleAction}
              isStreaming={isStreaming && msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id}
            />
          ))}

          {/* Typing indicator (non-streaming fallback) */}
          {isLoading && !isStreaming && (
            <div className="flex items-start gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-lantern-primary flex-shrink-0 mt-0.5">
                <SparklesIcon className="w-4 h-4 text-white" />
              </div>
              <div className={`px-3 py-2 rounded-2xl rounded-tl-none max-w-[80%]
                ${theme === 'dark' ? 'bg-lantern-surface-secondary' : 'bg-lantern-background-secondary'}`}>
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area — pad above home indicator; stays above bottom nav when that is visible */}
        <div className={`px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] border-t flex-shrink-0
          ${theme === 'dark' ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-background'}`}>
          {activeNoteContext && (
            <div className="mb-2 flex items-center gap-2">
              <div
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs
                  ${theme === 'dark'
                    ? 'border-lantern-primary/40 bg-lantern-primary/15 text-lantern-primary-light'
                    : 'border-lantern-primary/30 bg-lantern-primary-background text-lantern-primary'
                  }`}
              >
                <DocumentTextIcon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate font-medium" title={activeNoteContext.title}>
                  {activeNoteContext.title}
                </span>
                <button
                  type="button"
                  onClick={() => void handleClearNoteContext()}
                  title="Remove note context"
                  aria-label="Remove note context"
                  className="flex-shrink-0 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </div>
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
          <div className={`flex items-end gap-2 rounded-xl border px-3 py-2
            ${theme === 'dark' ? 'bg-lantern-surface-secondary border-lantern-border' : 'bg-lantern-surface border-lantern-border'}`}>
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
              <PlusIcon className="w-4 h-4" />
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
              {isRecording ? <StopIcon className="w-4 h-4" /> : <MicrophoneIcon className="w-4 h-4" />}
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
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
              className="flex-shrink-0 p-1.5 rounded-lg bg-lantern-primary text-white disabled:opacity-40 hover:bg-lantern-primary-dark transition-colors"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
            </button>
          </div>
          {(isRecording || isTranscribing) && (
            <p className={`mt-1.5 text-xs text-center ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              {isRecording
                ? `Listening… ${recordingSeconds}s — tap stop when done`
                : 'Converting speech to text…'}
            </p>
          )}
          <div className={`mt-1.5 text-center ${theme === 'dark' ? 'text-lantern-text-secondary' : 'text-lantern-text-tertiary'}`}>
            <AIDisclaimer compact />
          </div>
        </div>
    </Drawer>
  );
};

// ─── Sub-components ────────────────────────────────────────

interface MessageBubbleProps {
  message: CompanionMessage;
  theme: 'light' | 'dark';
  onAction: (action: CompanionAction) => void;
  isStreaming?: boolean;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, theme, onAction, isStreaming }) => {
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

  return (
    <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-lantern-primary flex-shrink-0 mt-0.5">
          <SparklesIcon className="w-4 h-4 text-white" />
        </div>
      )}
      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
          ${isUser
            ? 'bg-lantern-primary text-white rounded-tr-none'
            : theme === 'dark'
              ? 'bg-lantern-surface-secondary text-white rounded-tl-none'
              : 'bg-lantern-background-secondary text-lantern-text rounded-tl-none'
          }`}>
          {message.content}
          {isStreaming && (
            <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-current animate-pulse align-middle" />
          )}
        </div>
        {/* Action buttons */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
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
        {/* Thumbs feedback (only on completed, persisted assistant messages) */}
        {canRate && (
          <div className="flex items-center gap-1 mt-0.5" role="group" aria-label="Rate this response">
            <button
              type="button"
              onClick={() => void handleFeedback('up')}
              title={feedback === 'up' ? 'Remove upvote' : 'Good response'}
              aria-pressed={feedback === 'up'}
              aria-label="Thumbs up"
              className={`p-1 rounded transition-colors
                ${feedback === 'up'
                  ? 'text-green-500'
                  : theme === 'dark' ? 'text-lantern-text-secondary hover:text-green-400' : 'text-lantern-text-tertiary hover:text-green-500'
                }`}
            >
              {feedback === 'up' ? <ThumbUpSolid className="w-3.5 h-3.5" /> : <HandThumbUpIcon className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => void handleFeedback('down')}
              title={feedback === 'down' ? 'Remove downvote' : 'Poor response'}
              aria-pressed={feedback === 'down'}
              aria-label="Thumbs down"
              className={`p-1 rounded transition-colors
                ${feedback === 'down'
                  ? 'text-red-500'
                  : theme === 'dark' ? 'text-lantern-text-secondary hover:text-red-400' : 'text-lantern-text-tertiary hover:text-red-500'
                }`}
            >
              {feedback === 'down' ? <ThumbDownSolid className="w-3.5 h-3.5" /> : <HandThumbDownIcon className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ theme: 'light' | 'dark'; onQuickPrompt: (text: string) => void }> = ({ theme, onQuickPrompt }) => (
  <div className="flex flex-col items-center gap-4 py-6 text-center">
    <div className="flex items-center justify-center w-14 h-14 rounded-full bg-lantern-primary-background dark:bg-lantern-primary-dark">
      <SparklesIcon className="w-8 h-8 text-lantern-primary" />
    </div>
    <div>
      <p className={`font-semibold text-base ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}>Hi, I'm Lantern!</p>
      <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
        Your personal AI study companion. Ask me anything.
      </p>
    </div>
    <div className="flex flex-wrap justify-center gap-2 mt-1">
      {QUICK_PROMPTS.map(p => (
        <button
          key={p}
          onClick={() => onQuickPrompt(p)}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors
            ${theme === 'dark'
              ? 'border-lantern-border text-lantern-text-tertiary hover:bg-lantern-surface-secondary'
              : 'border-lantern-border text-lantern-text-secondary hover:bg-lantern-background-secondary'
            }`}
        >
          {p}
        </button>
      ))}
    </div>
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

