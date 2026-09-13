import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  buildChatAudioMarkdown,
  chatMessagePreview,
  formatAiTutorReply,
  parseAiQuery,
} from '@lantern/shared/utils';
import { chatDraftIsEmpty, chatDraftStorageKey } from '@lantern/shared/chat';
import { COMMUNITY_BOARD_COPY } from '@lantern/shared/network';
import type { MessageReplyPreview } from '../types';
import { uploadChatAudio, uploadChatImage } from '../services/supabase';
import { compressImage } from '../utils/imageCompression';
import {
  BOARD_IMAGE_ACCEPT,
  BOARD_IMAGE_MAX_DIMENSION,
  boardImageFileName,
  boardImagePickError,
  dataUrlContentType,
  preservesOriginalBytes,
  resolvePickContentType,
  stripDataUrlPrefix,
} from '../utils/boardImageUpload';
import { AppIcon } from './ui/AppIcon';
import { useToastStore } from '../stores/toastStore';

export type MentionCandidate = {
  id: string;
  username: string;
  name?: string;
};

export type SendMessageOptions = {
  replyToMessageId?: string;
  mentionedUserIds?: string[];
  /**
   * A board post's photo, carried on `messages.image_url` so a title, a body
   * and one photo are ONE row. Only ever set in `attachmentMode="inline"`;
   * chat and DMs never send it and the server accepts it on boards only.
   */
  imageUrl?: string;
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
  /** Overrides the idle placeholder (a board composer says "Write a post"). */
  placeholder?: string;
  /** Accessible name for the send button (a board says "Post"). */
  sendLabel?: string;
  /** Focus the body field on mount — the board composer expands into it (§9). */
  autoFocus?: boolean;
  /**
   * What picking a photo does.
   *
   * `'send'` (the default, and what chat and DMs keep) uploads it and sends it
   * immediately as its own `![image](url)` message.
   *
   * `'inline'` uploads it and HOLDS it as one attachment on the composer, so
   * `Post` sends the title, the body and the photo as a single row. This is
   * the gap the board had: there was no code path in the repo that wrote typed
   * text and an image into one message.
   */
  attachmentMode?: 'send' | 'inline';
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
  placeholder,
  sendLabel,
  autoFocus = false,
  attachmentMode = 'send',
}) => {
  const [inputText, setInputText] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  /** The one held photo in `'inline'` mode — uploaded, not yet posted. */
  const [attachedImageUrl, setAttachedImageUrl] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const removeAttachmentRef = useRef<HTMLButtonElement>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Expanding the board composer moves focus into the body field (spec §9).
  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!trayOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTrayOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [trayOpen]);
  const lastTypingRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordStartedAtRef = useRef(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntentRef = useRef(false);
  const cancelNextRecordingRef = useRef(false);

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
    const key = chatDraftStorageKey(groupId ? 'group' : 'dm', groupId || threadId || '');
    if (!editingMessage) {
      try {
        const saved = sessionStorage.getItem(key);
        setInputText(saved || '');
      } catch {
        setInputText('');
      }
    }
    const timer = window.setTimeout(() => focusComposer(), 50);
    return () => window.clearTimeout(timer);
  }, [groupId, threadId]);

  useEffect(() => {
    if (editingMessage || (!groupId && !threadId)) return;
    const key = chatDraftStorageKey(groupId ? 'group' : 'dm', groupId || threadId || '');
    try {
      if (chatDraftIsEmpty(inputText)) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, inputText);
    } catch {
      // Session drafts are best-effort.
    }
  }, [inputText, groupId, threadId, editingMessage]);

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
    // A held photo rides only the ordinary send, never an `overrideText` one:
    // a voice note stays its own post in Phase 1, exactly as on mobile.
    const pendingImageUrl = overrideText ? null : attachedImageUrl;
    // A photo-only post is a real post — the board renders a media-only card.
    if (!trimmed && !pendingImageUrl) return;

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
    if (pendingImageUrl) setAttachedImageUrl(null);
    try {
      const mentionedUserIds = editingMessage ? undefined : resolveMentionedUserIds(trimmed);
      await onSendMessage(trimmed, {
        replyToMessageId: editingMessage ? undefined : replyTo?.id,
        mentionedUserIds,
        ...(pendingImageUrl ? { imageUrl: pendingImageUrl } : {}),
      });
      if (editingMessage) {
        setInputText('');
        onClearEdit?.();
      }
      onClearReply?.();
    } catch (error) {
      // Restore BOTH halves of what was typed: losing the photo would mean
      // paying for the upload twice on a connection that just failed once.
      if (!overrideText && !editingMessage) setInputText(trimmed);
      if (pendingImageUrl) setAttachedImageUrl(pendingImageUrl);
      setRecordError(error instanceof Error ? error.message : 'Could not send message');
    } finally {
      setIsSending(false);
    }
  };

  const stopRecording = (cancel = false) => {
    if (cancel) cancelNextRecordingRef.current = true;
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
    // Some browsers hand back a File with an empty `type`; the extension is
    // the fallback, so a real `.gif` pick is not refused as "not an image".
    const pickedType = resolvePickContentType(file.type, file.name);
    // Checked BEFORE a single byte is read. This is what gives web the HEIC
    // guard mobile already had, and it is why an over-cap pick now costs
    // nothing instead of being paid for and then refused by the server.
    const refusal = boardImagePickError({
      contentType: pickedType,
      fileName: file.name,
      byteLength: file.size,
    });
    if (refusal) {
      setRecordError(refusal);
      return;
    }
    setIsUploadingImage(true);
    setRecordError(null);
    try {
      let contentType = pickedType || 'image/jpeg';
      let base64Data: string;
      if (preservesOriginalBytes(contentType, file.name)) {
        // A GIF goes up byte-for-byte or it stops being a GIF.
        base64Data = await blobToBase64(file);
      } else {
        try {
          const dataUrl = (await compressImage(file, {
            maxWidth: BOARD_IMAGE_MAX_DIMENSION,
            maxHeight: BOARD_IMAGE_MAX_DIMENSION,
            outputType: 'base64',
          })) as string;
          base64Data = stripDataUrlPrefix(dataUrl);
          contentType = dataUrlContentType(dataUrl) || contentType;
        } catch {
          // A canvas that refuses the file (memory, a codec the browser will
          // decode but not re-encode) must not lose the photo: the original is
          // already under the cap, so send it as picked.
          base64Data = await blobToBase64(file);
        }
      }
      const { url } = await uploadChatImage({
        fileName: boardImageFileName(contentType),
        base64Data,
        contentType,
        groupId,
      });
      if (attachmentMode === 'inline') {
        // Held, not sent: `Post` will carry it alongside the title and body.
        setAttachedImageUrl(url);
        requestAnimationFrame(() => removeAttachmentRef.current?.focus());
        return;
      }
      // Chat and DMs are unchanged: a photo is its own `![image](url)` message
      // (matches mobile and the shipped `parseChatImageUrl`).
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
        const cancelled = cancelNextRecordingRef.current;
        cancelNextRecordingRef.current = false;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (cancelled) return;
        const type = recorder.mimeType || supportedMime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        void finishRecording(blob, type);
      };
      mediaRecorderRef.current = recorder;
      recordStartedAtRef.current = Date.now();
      if (!holdIntentRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        return;
      }
      recorder.start();
      setIsRecording(true);
      maxTimerRef.current = setTimeout(() => stopRecording(), MAX_VOICE_MS);
    } catch {
      setRecordError('Microphone permission denied.');
    }
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
    // Enter inserts a newline on purpose (users compose multi-line messages);
    // only the Send button sends. Enter still picks a mention above.
  };

  const busy = isAIThinking || isSending || isUploadingAudio || isUploadingImage;
  // With a photo held there is something to post, so the send control has to be
  // the one on screen — a mic here would make a photo-only post unreachable.
  const showMic = !editingMessage && !inputText.trim() && !attachedImageUrl && !busy;
  const canSend = !!inputText.trim() || !!attachedImageUrl;
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
            <AppIcon name="close" size={16} />
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
            <AppIcon name="close" size={16} />
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

      {/*
        The one attachment slot (§5.3). It is announced in words — the photo is
        NOT previewed here, because the list rule is that a board surface
        downloads no media, and previewing it would also mean signing a URL for
        an object the composer already knows it has.
      */}
      {attachedImageUrl && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-lantern-border bg-lantern-background px-3 py-2">
          <AppIcon name="image" size={16} className="shrink-0 text-lantern-text-secondary" aria-hidden="true" />
          <p className="flex-1 min-w-0 truncate text-xs font-medium text-lantern-text" role="status">
            {COMMUNITY_BOARD_COPY.photoAttached}
          </p>
          <button
            ref={removeAttachmentRef}
            type="button"
            onClick={() => setAttachedImageUrl(null)}
            aria-label={COMMUNITY_BOARD_COPY.removePhoto}
            title={COMMUNITY_BOARD_COPY.removePhoto}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lantern text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <AppIcon name="close" size={16} aria-hidden="true" />
          </button>
        </div>
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
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body text-lantern-text hover:bg-lantern-background text-left"
                    >
                      <AppIcon name="create" size={16} className="text-lantern-primary" />
                      Submit a question
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setTrayOpen(false); cameraInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body text-lantern-text hover:bg-lantern-background text-left"
                  >
                    <AppIcon name="camera" size={16} className="text-lantern-primary" />
                    Camera
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setTrayOpen(false); imageInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body text-lantern-text hover:bg-lantern-background text-left"
                  >
                    <AppIcon name="image" size={16} className="text-lantern-primary" />
                    Photo library
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setTrayOpen(false); documentInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body text-lantern-text hover:bg-lantern-background text-left"
                  >
                    <AppIcon name="document" size={16} className="text-lantern-primary" />
                    Document
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
                <AppIcon name="add-circle" size={24} />
              )}
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept={BOARD_IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handlePickImage(file);
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept={BOARD_IMAGE_ACCEPT}
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handlePickImage(file);
              }}
            />
            <input
              ref={documentInputRef}
              type="file"
              accept={`${BOARD_IMAGE_ACCEPT},application/pdf`}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (file.type === 'application/pdf') {
                  useToastStore.getState().showToast('Photograph the page for now — PDF attach is next.', 'info');
                  return;
                }
                void handlePickImage(file);
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
                ? 'Recording… release to send'
                : isUploadingAudio
                  ? 'Uploading voice note…'
                  : isUploadingImage
                    ? 'Uploading image…'
                    : isAIThinking
                      ? 'AI is thinking...'
                      : isSending
                        ? 'Sending...'
                        : (placeholder ?? 'Type a message… (@ to mention)')
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
            onPointerDown={(e) => {
              if (e.button !== 0 || isUploadingAudio) return;
              e.preventDefault();
              holdIntentRef.current = true;
              void startRecording();
            }}
            onPointerUp={() => {
              holdIntentRef.current = false;
              if (isRecording) stopRecording();
            }}
            onPointerCancel={() => {
              holdIntentRef.current = false;
              if (isRecording) stopRecording(true);
            }}
            onPointerLeave={() => {
              holdIntentRef.current = false;
              if (isRecording) stopRecording(true);
            }}
            disabled={isUploadingAudio}
            className={`flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lantern-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary select-none ${
              isRecording
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-lantern-background-secondary text-lantern-primary hover:bg-lantern-primary-background'
            }`}
            aria-label={isRecording ? 'Release to send voice note' : 'Hold to record voice note'}
            title={isRecording ? 'Release to send' : 'Hold to record (max 2 min)'}
          >
            <AppIcon name="mic" size={20} filled />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend || busy}
            className="flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-background-secondary text-white disabled:text-lantern-text-tertiary rounded-lantern-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:cursor-not-allowed"
            aria-label={
              editingMessage ? 'Save message changes' : (sendLabel ?? 'Send message')
            }
          >
            <AppIcon name="send" size={20} filled />
          </button>
        )}
      </div>
    </div>
  );
};

export default MessageInputBar;
