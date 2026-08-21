import React, { useState, useRef, useEffect, useMemo } from 'react';
import { PaperAirplaneIcon, PlusCircleIcon, MicrophoneIcon, XMarkIcon, PhotoIcon, PencilSquareIcon } from '@heroicons/react/24/solid';
import {
  buildChatAudioMarkdown,
  chatMessagePreview,
  formatAiTutorReply,
  parseAiQuery,
} from '@lantern/shared/utils';
import type { MessageReplyPreview } from '../types';
import { uploadChatAudio, uploadChatImage } from '../services/supabase';

export type MentionCandidate = {
  id: string;
  username: string;
  name?: string;
};

export type SendMessageOptions = {
  replyToMessageId?: string;
  mentionedUserIds?: string[];
};

interface MessageInputBarProps {
  onSendMessage: (text: string, options?: SendMessageOptions) => void | Promise<void>;
  onOpenQuestionModal?: () => void;
  onAIQuery?: (question: string) => Promise<string | null>;
  onTyping?: () => void;
  mentionCandidates?: MentionCandidate[];
  /** When set, appends @username into the composer (e.g. tapping an author name). */
  seedMentionUsername?: string | null;
  onSeedMentionConsumed?: () => void;
  replyTo?: MessageReplyPreview | null;
  onClearReply?: () => void;
  editingMessage?: { id: string; text: string } | null;
  onClearEdit?: () => void;
  groupId?: string;
  threadId?: string;
}

const MAX_VOICE_MS = 120_000;

const MessageInputBar: React.FC<MessageInputBarProps> = ({
  onSendMessage,
  onOpenQuestionModal,
  onAIQuery,
  onTyping,
  mentionCandidates = [],
  seedMentionUsername = null,
  onSeedMentionConsumed,
  replyTo,
  onClearReply,
  editingMessage,
  onClearEdit,
  groupId,
  threadId,
}) => {
  const [inputText, setInputText] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordStartedAtRef = useRef(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [inputText]);

  const focusComposer = () => {
    const el = textareaRef.current;
    if (!el || isRecording || isUploadingAudio) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // Some browsers reject setSelectionRange on empty/readonly briefly.
    }
  };

  useEffect(() => {
    if (!editingMessage) return;
    setInputText(editingMessage.text);
    setMentionQuery(null);
    requestAnimationFrame(focusComposer);
  }, [editingMessage?.id]);

  // Ready-to-type when opening a chat session (group or DM).
  useEffect(() => {
    if (!groupId && !threadId) return;
    const timer = window.setTimeout(() => focusComposer(), 50);
    return () => window.clearTimeout(timer);
  }, [groupId, threadId]);

  // Ready-to-type when starting a reply.
  useEffect(() => {
    if (!replyTo?.id) return;
    const timer = window.setTimeout(() => focusComposer(), 0);
    return () => window.clearTimeout(timer);
  }, [replyTo?.id]);

  useEffect(() => {
    const raw = seedMentionUsername?.trim();
    if (!raw) return;
    const username = raw.startsWith('@') ? raw.slice(1) : raw;
    if (!username) {
      onSeedMentionConsumed?.();
      return;
    }
    setInputText((prev) => {
      const needsSpace = prev.length > 0 && !/\s$/.test(prev);
      return `${prev}${needsSpace ? ' ' : ''}@${username} `;
    });
    setMentionQuery(null);
    onSeedMentionConsumed?.();
    requestAnimationFrame(focusComposer);
  }, [seedMentionUsername]);

  useEffect(() => {
    return () => {
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const mentionMatches = useMemo(() => {
    if (mentionQuery == null || !mentionCandidates.length) return [];
    const q = mentionQuery.toLowerCase();
    return mentionCandidates
      .filter((m) => m.username && (m.username.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)))
      .slice(0, 8);
  }, [mentionQuery, mentionCandidates]);

  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = before.match(/(^|[\s])@([a-zA-Z0-9_]*)$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(match[2] || '');
    setMentionIndex(0);
  };

  const insertMention = (candidate: MentionCandidate) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? inputText.length;
    const before = inputText.slice(0, caret);
    const after = inputText.slice(caret);
    const replaced = before.replace(/(^|[\s])@([a-zA-Z0-9_]*)$/, `$1@${candidate.username} `);
    const next = replaced + after;
    setInputText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = replaced.length;
      el?.setSelectionRange(pos, pos);
      el?.focus();
    });
  };

  const replyPreviewText = replyTo
    ? (replyTo.questionStem || chatMessagePreview(replyTo.text)).slice(0, 80)
    : '';

  const resolveMentionedUserIds = (text: string): string[] => {
    if (!mentionCandidates.length) return [];
    const mentioned = new Set<string>();
    for (const match of text.matchAll(/@([a-zA-Z0-9_]{2,32})\b/g)) {
      const username = match[1]?.toLowerCase();
      if (username) mentioned.add(username);
    }
    if (!mentioned.size) return [];
    const canMentionAll = mentionCandidates.some((c) => c.id === '__all__');
    if (mentioned.has('all') && canMentionAll) {
      return mentionCandidates
        .filter((c) => c.username.toLowerCase() !== 'all' && c.id !== '__all__')
        .map((c) => c.id);
    }
    return mentionCandidates
      .filter((c) => mentioned.has(c.username.toLowerCase()) && c.id !== '__all__')
      .map((c) => c.id);
  };

  const handleSend = async (overrideText?: string) => {
    if (isSending || isAIThinking || isUploadingAudio) return;
    const trimmed = (overrideText ?? inputText).trim();
    if (!trimmed) return;

    const question = editingMessage ? null : parseAiQuery(trimmed);
    if (question && onAIQuery) {
      setInputText('');
      setRecordError(null);
      setIsAIThinking(true);
      try {
        const answer = await onAIQuery(question);
        if (answer) {
          setIsSending(true);
          try {
            await onSendMessage(formatAiTutorReply(answer), {
              replyToMessageId: replyTo?.id,
            });
            onClearReply?.();
          } finally {
            setIsSending(false);
          }
        } else {
          // Empty answer: restore the prompt so the message is never silently lost.
          setInputText(trimmed);
          setRecordError('The AI tutor could not answer that. Your message was restored — try again.');
        }
      } catch (error) {
        setInputText(trimmed);
        setRecordError(
          error instanceof Error
            ? error.message
            : 'The AI tutor is unavailable right now. Your message was restored.'
        );
      } finally {
        setIsAIThinking(false);
      }
      return;
    }

    setIsSending(true);
    setRecordError(null);
    if (!overrideText && !editingMessage) setInputText('');
    try {
      const mentionedUserIds = editingMessage ? undefined : resolveMentionedUserIds(trimmed);
      await onSendMessage(trimmed, {
        replyToMessageId: editingMessage ? undefined : replyTo?.id,
        mentionedUserIds,
      });
      if (editingMessage) {
        setInputText('');
        onClearEdit?.();
      }
      onClearReply?.();
    } catch (error) {
      if (!overrideText && !editingMessage) setInputText(trimmed);
      setRecordError(error instanceof Error ? error.message : 'Could not send message');
    } finally {
      setIsSending(false);
    }
  };

  const stopRecording = () => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setIsRecording(false);
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        if (!base64) reject(new Error('Empty recording'));
        else resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read recording'));
      reader.readAsDataURL(blob);
    });

  const finishRecording = async (blob: Blob, mimeType: string) => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    const elapsed = Date.now() - recordStartedAtRef.current;
    if (elapsed < 400 || blob.size < 256) {
      setRecordError('Recording was too short. Hold a bit longer.');
      return;
    }
    setIsUploadingAudio(true);
    setRecordError(null);
    try {
      const base64Data = await blobToBase64(blob);
      // Strip codec params (e.g. audio/webm;codecs=opus) — API allowlists bare MIME types.
      const contentType = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase() || 'audio/webm';
      const ext =
        contentType.includes('mp4') || contentType.includes('m4a')
          ? 'm4a'
          : contentType.includes('ogg')
            ? 'ogg'
            : contentType.includes('wav')
              ? 'wav'
              : 'webm';
      const { url } = await uploadChatAudio({
        fileName: `voice-${Date.now()}.${ext}`,
        base64Data,
        contentType,
        groupId,
        threadId,
      });
      await handleSend(buildChatAudioMarkdown(url));
    } catch (err: any) {
      setRecordError(err?.message || 'Could not upload voice note');
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const handlePickImage = async (file: File) => {
    if (isUploadingImage || isUploadingAudio || isSending || isAIThinking || isRecording) return;
    if (!file.type.startsWith('image/')) {
      setRecordError('Please choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setRecordError('Image is too large (max 8MB).');
      return;
    }
    setIsUploadingImage(true);
    setRecordError(null);
    try {
      const base64Data = await blobToBase64(file);
      const contentType = (file.type || 'image/jpeg').split(';')[0].trim().toLowerCase() || 'image/jpeg';
      const ext = contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : contentType.includes('gif')
            ? 'gif'
            : 'jpg';
      const { url } = await uploadChatImage({
        fileName: `image-${Date.now()}.${ext}`,
        base64Data,
        contentType,
        groupId,
      });
      // Media messages are plain text of `![image](url)` (matches mobile + the parser).
      await handleSend(`![image](${url})`);
    } catch (err: any) {
      setRecordError(err?.message || 'Could not upload image');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const startRecording = async () => {
    setRecordError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRecordError('Voice notes are not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // MP4/AAC first: expo-av on iOS and Android cannot decode WebM/Opus, so a
      // voice note recorded here in WebM plays on web and shows "Voice note
      // unavailable" on every phone. WebM stays as the fallback for browsers
      // that cannot record MP4 (mainly Firefox).
      const mimeCandidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
      const supportedMime =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
          : '';
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || supportedMime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        void finishRecording(blob, type);
      };
      mediaRecorderRef.current = recorder;
      recordStartedAtRef.current = Date.now();
      recorder.start();
      setIsRecording(true);
      maxTimerRef.current = setTimeout(() => stopRecording(), MAX_VOICE_MS);
    } catch {
      setRecordError('Microphone permission denied.');
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else void startRecording();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMatches.length > 0 && mentionQuery != null) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mentionMatches[mentionIndex]!);
        return;
      }
      if (event.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const busy = isAIThinking || isSending || isUploadingAudio || isUploadingImage;
  const showMic = !editingMessage && !inputText.trim() && !busy;
  // The "+" tray collapses insert actions (question + photo). Hidden while editing.
  const showTray = !editingMessage;

  return (
    <div className="px-4 md:px-6 py-3 bg-lantern-surface border-t border-lantern-border">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-lantern-border bg-lantern-background px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-lantern-primary">
              Replying to {replyTo.senderName || 'message'}
            </p>
            <p className="text-xs text-lantern-text-secondary truncate">{replyPreviewText}</p>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="p-1 text-lantern-text-tertiary hover:text-lantern-text"
            aria-label="Cancel reply"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {editingMessage && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-lantern-primary/30 bg-lantern-primary-background px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-lantern-primary">Editing message</p>
            <p className="text-xs text-lantern-text-secondary truncate">
              Changes do not extend the original 30-minute window.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setInputText('');
              onClearEdit?.();
            }}
            className="p-1 text-lantern-text-tertiary hover:text-lantern-text"
            aria-label="Cancel edit"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {mentionMatches.length > 0 && (
        <div
          id="mention-listbox"
          role="listbox"
          aria-label="Mention suggestions"
          className="mb-2 rounded-xl border border-lantern-border bg-lantern-surface shadow-sm overflow-hidden"
        >
          {mentionMatches.map((m, i) => (
            <button
              key={m.id}
              id={`mention-option-${m.id}`}
              role="option"
              aria-selected={i === mentionIndex}
              type="button"
              onClick={() => insertMention(m)}
              className={`w-full text-left px-3 py-2 text-sm ${
                i === mentionIndex ? 'bg-lantern-primary-background text-lantern-primary' : 'text-lantern-text hover:bg-lantern-background'
              }`}
            >
              <span className="font-semibold">{m.name || `@${m.username}`}</span>
              {m.name ? (
                <span className="text-lantern-text-secondary ml-2">@{m.username}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {recordError && (
        <p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {recordError}
        </p>
      )}

      <div className="flex items-end gap-2">
        {showTray && (
          <div className="relative flex-shrink-0">
            {trayOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setTrayOpen(false)} aria-hidden />
                <div
                  role="menu"
                  className="absolute bottom-full left-0 mb-2 min-w-[11rem] rounded-xl border border-lantern-border bg-lantern-surface shadow-lg overflow-hidden z-30"
                >
                  {onOpenQuestionModal && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setTrayOpen(false); onOpenQuestionModal(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-lantern-text hover:bg-lantern-background text-left"
                    >
                      <PencilSquareIcon className="w-4 h-4 text-lantern-primary" />
                      Submit a question
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setTrayOpen(false); imageInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-lantern-text hover:bg-lantern-background text-left"
                  >
                    <PhotoIcon className="w-4 h-4 text-lantern-primary" />
                    Attach photo
                  </button>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setTrayOpen((v) => !v)}
              disabled={busy || isRecording}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-primary hover:bg-lantern-primary-background rounded-lantern-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Add to message"
              aria-haspopup="menu"
              aria-expanded={trayOpen}
              title="Add"
            >
              {isUploadingImage ? (
                <span className="w-5 h-5 border-2 border-lantern-primary/30 border-t-lantern-primary rounded-full animate-spin" />
              ) : (
                <PlusCircleIcon className="w-6 h-6" />
              )}
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handlePickImage(file);
              }}
            />
          </div>
        )}
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => {
              const value = e.target.value;
              setInputText(value);
              detectMention(value, e.target.selectionStart ?? value.length);
              const now = Date.now();
              if (onTyping && now - lastTypingRef.current > 1500) {
                lastTypingRef.current = now;
                onTyping();
              }
            }}
            onKeyDown={handleKeyDown}
            onClick={(e) => detectMention(inputText, e.currentTarget.selectionStart ?? inputText.length)}
            placeholder={
              isRecording
                ? 'Recording… tap mic to stop'
                : isUploadingAudio
                  ? 'Uploading voice note…'
                  : isUploadingImage
                    ? 'Uploading image…'
                    : isAIThinking
                      ? 'AI is thinking...'
                      : isSending
                        ? 'Sending...'
                        : 'Type a message… (@ to mention)'
            }
            rows={1}
            disabled={busy || isRecording}
            aria-label="Message text"
            role="combobox"
            aria-expanded={mentionMatches.length > 0}
            aria-controls="mention-listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              mentionMatches.length > 0 ? `mention-option-${mentionMatches[mentionIndex]?.id}` : undefined
            }
            className="w-full resize-none px-4 py-2.5 border border-lantern-border rounded-2xl bg-lantern-background text-lantern-text text-sm placeholder:text-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary focus-visible:border-transparent transition-colors duration-200"
            style={{ maxHeight: '120px' }}
          />
        </div>
        {showMic || isRecording ? (
          <button
            type="button"
            onClick={toggleRecording}
            disabled={isUploadingAudio}
            className={`flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lantern-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary ${
              isRecording
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-lantern-background-secondary text-lantern-primary hover:bg-lantern-primary-background'
            }`}
            aria-label={isRecording ? 'Stop recording' : 'Record voice note'}
            title={isRecording ? 'Stop recording' : 'Voice note (max 2 min)'}
          >
            <MicrophoneIcon className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!inputText.trim() || busy}
            className="flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-background-secondary text-white disabled:text-lantern-text-tertiary rounded-lantern-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:cursor-not-allowed"
            aria-label={editingMessage ? 'Save message changes' : 'Send message'}
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default MessageInputBar;
