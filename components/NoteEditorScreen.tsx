import React, { useEffect, useRef, useState } from 'react';
import { getNoteStudyContent, hasEnoughNoteStudyContent, isPlaceholderExtractedText } from '@lantern/shared';
import {
  ArrowLeftIcon,
  TrashIcon,
  UserPlusIcon,
  ShareIcon,
  MicrophoneIcon,
  StopIcon,
} from '@heroicons/react/24/outline';
import type { Group, NoteAttachment, NoteComment, StudyNote, DailyQuizSession, StudyGoalMode } from '../types';
import NoteLearnPanel from './NoteLearnPanel';
import DailyQuizWidget from './DailyQuizWidget';
import YouTubeEmbed from './YouTubeEmbed';
import NoteCollaboratorsModal from './NoteCollaboratorsModal';
import Modal from './ui/Modal';
import NotePdfViewer from './NotePdfViewer';
import NoteImageGallery from './NoteImageGallery';
import { Button } from './ui';
import * as notesApi from '../services/notes';
import { useNotesStore } from '../stores/notesStore';
import { useToastStore } from '../stores/toastStore';

interface NoteEditorScreenProps {
  theme: 'light' | 'dark';
  note: StudyNote & { attachments?: NoteAttachment[] };
  comments: NoteComment[];
  groups: Group[];
  currentUserId: string;
  isSaving?: boolean;
  onBack: () => void;
  onSave: (updates: { title?: string; body?: string }) => void;
  onDelete: () => void;
  onSmartNote: (editorState?: { title?: string; body?: string }) => Promise<string | void>;
  onChatWithNote: () => void;
  onGenerateFlashcards: (editorState?: { title?: string; body?: string }) => Promise<void>;
  onGenerateQuiz: (editorState?: { title?: string; body?: string }) => Promise<void>;
  studyGoal?: StudyGoalMode;
  dailyQuiz?: DailyQuizSession | null;
  dailyQuizProgress?: number;
  onStudyGoalChange?: (goal: StudyGoalMode) => void;
  onDailyQuizAnswer?: (questionId: string, answer: string) => void;
  onCompleteDailyQuiz?: () => void;
  onRegenerateQuiz?: () => Promise<void>;
  onPostComment: (comment: string) => void;
  onShareWithGroup: (groupId: string) => void;
  onTranscriptReady: (transcript: string) => void;
  /** Cancel pending autosave before/after voice transcription. */
  onCancelPendingSave?: () => void;
}

const MIN_RECORD_MS = 1500;
const RECORDER_CHUNK_WAIT_MS = 1000;
const AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS = 4000;

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

/** Wait until MediaRecorder has flushed at least one chunk, or timeout. */
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
    // Let stop()'s final dataavailable land before the first poll.
    window.setTimeout(tick, 0);
  });
}

async function encodeBlobAsWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('WAV re-encode is not supported in this browser.');
  }
  const ctx = new AudioContextCtor();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = decoded.sampleRate;
    const length = decoded.length;
    const mono = new Float32Array(length);
    const ch0 = decoded.getChannelData(0);
    if (decoded.numberOfChannels > 1) {
      const ch1 = decoded.getChannelData(1);
      for (let i = 0; i < length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
    } else {
      mono.set(ch0);
    }
    const dataSize = length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, mono[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function formatTranscribeDiag(meta: {
  blobSize?: number;
  mimeType?: string;
  durationMs?: number;
}): string {
  const parts: string[] = [];
  if (typeof meta.durationMs === 'number') parts.push(`${Math.round(meta.durationMs / 1000)}s`);
  if (typeof meta.blobSize === 'number') parts.push(`${meta.blobSize}B`);
  if (meta.mimeType) parts.push(meta.mimeType);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

const NoteEditorScreen: React.FC<NoteEditorScreenProps> = ({
  theme,
  note,
  comments,
  groups,
  currentUserId,
  isSaving,
  onBack,
  onSave,
  onDelete,
  onSmartNote,
  onChatWithNote,
  onGenerateFlashcards,
  onGenerateQuiz,
  studyGoal = 'retention',
  dailyQuiz = null,
  dailyQuizProgress = 0,
  onStudyGoalChange,
  onDailyQuizAnswer,
  onCompleteDailyQuiz,
  onRegenerateQuiz,
  onPostComment,
  onShareWithGroup,
  onTranscriptReady,
  onCancelPendingSave,
}) => {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const [commentText, setCommentText] = useState('');
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeStage, setTranscribeStage] = useState<'idle' | 'uploading' | 'transcribing'>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedAtRef = useRef(0);
  const [generatingCards, setGeneratingCards] = useState(false);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBannerDismissed, setPreviewBannerDismissed] = useState(false);
  const [previewTrigger, setPreviewTrigger] = useState(0);
  const [shareGroupOpen, setShareGroupOpen] = useState(false);
  const saveEnabledRef = useRef(true);
  const userEditedRef = useRef(false);
  const previewAttemptedRef = useRef<Set<string>>(new Set());
  const reextractAttemptedRef = useRef<Set<string>>(new Set());
  const setSelectedNote = useNotesStore((s) => s.setSelectedNote);
  const showToast = useToastStore((s) => s.showToast);
  const isDark = theme === 'dark';

  const isDocumentNote = note.sourceType === 'pdf' || note.sourceType === 'presentation';
  const isPhotoNote = note.sourceType === 'photos';
  const imageAttachments = (note.attachments || [])
    .filter((a) => a.type === 'image')
    .sort(
      (a, b) =>
        (typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : 0) -
        (typeof b.metadata?.sortOrder === 'number' ? b.metadata.sortOrder : 0)
    );
  const showImageGallery = isPhotoNote || imageAttachments.length > 0;
  const addPhotosInputRef = useRef<HTMLInputElement>(null);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const documentAttachment = note.attachments?.find(
    (a) => a.type === 'pdf' || (a.type === 'presentation' && a.metadata?.previewStoragePath)
  );
  const presentationAttachment = note.attachments?.find((a) => a.type === 'presentation');
  const presentationPreviewPath =
    typeof presentationAttachment?.metadata?.previewStoragePath === 'string'
      ? presentationAttachment.metadata.previewStoragePath
      : null;
  const isPreviewProcessing =
    presentationAttachment?.metadata?.previewProcessing === true && !presentationPreviewPath;
  const showPreviewBanner =
    note.sourceType === 'presentation' &&
    !presentationPreviewPath &&
    !previewBannerDismissed &&
    (generatingPreview || isPreviewProcessing);
  const studyContentLength = getNoteStudyContent({
    sourceType: note.sourceType,
    body,
    summary: note.summary,
    attachments: note.attachments,
  }).length;

  useEffect(() => {
    // Only hydrate when switching notes. Re-syncing on every store title/body
    // update races autosave and erases keystrokes typed after the save started.
    userEditedRef.current = false;
    setTitle(note.title);
    setBody(note.body);
  }, [note.id]);

  useEffect(() => {
    saveEnabledRef.current = true;
    return () => {
      saveEnabledRef.current = false;
    };
  }, [note.id]);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!note.id || !saveEnabledRef.current || !userEditedRef.current) return;
    onSaveRef.current({ title, body });
  }, [note.id, title, body]);

  const handleTitleChange = (value: string) => {
    userEditedRef.current = true;
    setTitle(value);
  };

  const handleBodyChange = (value: string) => {
    userEditedRef.current = true;
    setBody(value);
  };

  const handleImageAttachmentsChange = (attachments: NoteAttachment[]) => {
    const other = (note.attachments || []).filter((a) => a.type !== 'image');
    setSelectedNote({ ...note, attachments: [...other, ...attachments] });
  };

  const handleAddPhotosSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    setAddingPhotos(true);
    try {
      const result = await notesApi.addImagesToPhotoNote(note.id, files);
      const other = (note.attachments || []).filter((a) => a.type !== 'image');
      const merged = [...other, ...result.attachments].filter(
        (attachment, index, list) => list.findIndex((item) => item.id === attachment.id) === index
      );
      setSelectedNote({ ...note, attachments: merged });
      showToast(
        files.length === 1 ? 'Photo added' : `${files.length} photos added`,
        'success'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add photos', 'error');
    } finally {
      setAddingPhotos(false);
    }
  };

  useEffect(() => {
    setPreviewError(null);
    setPreviewBannerDismissed(false);
    previewAttemptedRef.current.delete(note.id);
  }, [note.id]);

  useEffect(() => {
    if (note.sourceType !== 'presentation') return;
    if (!presentationAttachment) return;
    if (reextractAttemptedRef.current.has(note.id)) return;

    const extracted = presentationAttachment.extractedText;
    const needsReextract = isPlaceholderExtractedText(extracted);
    const studyReady = hasEnoughNoteStudyContent({
      sourceType: note.sourceType,
      body,
      summary: note.summary,
      attachments: note.attachments,
    });
    if (!needsReextract || studyReady) return;

    reextractAttemptedRef.current.add(note.id);
    let cancelled = false;
    void notesApi
      .reextractNoteText(note.id)
      .then((result) => {
        if (cancelled) return;
        const prev = useNotesStore.getState().selectedNote;
        if (!prev || prev.id !== note.id) return;
        setSelectedNote({
          ...prev,
          attachments:
            prev.attachments?.map((a) =>
              a.id === result.attachment.id ? result.attachment : a
            ) ?? [result.attachment],
        });
      })
      .catch(() => {
        // Non-fatal; user can still add manual notes
      });

    return () => {
      cancelled = true;
    };
  }, [note.id, note.sourceType, note.summary, note.attachments, presentationAttachment, body, setSelectedNote]);

  useEffect(() => {
    if (note.sourceType !== 'presentation') return;
    if (!presentationAttachment || presentationPreviewPath) return;
    if (previewAttemptedRef.current.has(note.id)) return;

    previewAttemptedRef.current.add(note.id);
    let cancelled = false;
    setGeneratingPreview(true);
    setPreviewError(null);
    const previewPromise = notesApi.regeneratePresentationPreview(note.id);
    void previewPromise
      .then((result) => {
        if (cancelled) return;
        const prev = useNotesStore.getState().selectedNote;
        if (!prev || prev.id !== note.id) return;
        setSelectedNote({
          ...prev,
          attachments:
            prev.attachments?.map((a) =>
              a.id === result.attachment.id ? result.attachment : a
            ) ?? [result.attachment],
        });
        if (!result.previewAvailable) {
          const message =
            result.previewError ||
            'Slide preview is unavailable, but AI can still use extracted text from your deck.';
          setPreviewError(message);
          showToast('Slides saved — preview failed', 'error');
        } else {
          setPreviewError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const raw =
          err instanceof Error
            ? err.message
            : "Preview couldn't be generated. Try reopening the note or re-uploading.";
        const message = /404|missing slide files|no presentation attachment/i.test(raw)
          ? 'This note is missing slide files. Delete it and re-upload your presentation.'
          : raw;
        setPreviewError(message);
        showToast('Slides saved — preview failed', 'error');
      })
      .finally(() => {
        if (!cancelled) setGeneratingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    note.id,
    note.sourceType,
    presentationPreviewPath,
    presentationAttachment,
    isPreviewProcessing,
    previewTrigger,
    setSelectedNote,
    showToast,
  ]);

  useEffect(() => {
    if (!recording) {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      return;
    }

    setRecordingSeconds(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [recording]);

  const handleDownloadOriginalSlides = async () => {
    if (!presentationAttachment) return;
    try {
      const { url } = await notesApi.refreshNoteAttachmentUrl(note.id, presentationAttachment.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      try {
        const buffer = await notesApi.fetchNoteAttachmentContent(note.id, presentationAttachment.id);
        const blob = new Blob([buffer], {
          type: presentationContentType(presentationAttachment.fileName || 'slides.pptx'),
        });
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = presentationAttachment.fileName || 'slides.pptx';
        link.click();
        URL.revokeObjectURL(blobUrl);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Could not download slides.', 'error');
      }
    }
  };

  function presentationContentType(fileName: string): string {
    return /\.ppt$/i.test(fileName) && !/\.pptx$/i.test(fileName)
      ? 'application/vnd.ms-powerpoint'
      : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }

  const handleRetryPreview = () => {
    previewAttemptedRef.current.delete(note.id);
    setPreviewError(null);
    setPreviewTrigger((t) => t + 1);
  };

  const handleShareGroup = () => {
    if (groups.length === 0) {
      useToastStore.getState().showToast('Join a group first to share notes.', 'info');
      return;
    }
    if (groups.length === 1) {
      onShareWithGroup(groups[0].id);
      return;
    }
    setShareGroupOpen(true);
  };

  const formatRecordingDuration = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const startRecording = async () => {
    try {
      discardRecordingRef.current = false;
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        useToastStore
          .getState()
          .showToast('Audio recording is not supported in this browser. Try Chrome or Edge.', 'error');
        return;
      }
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
        useToastStore.getState().showToast('Recording failed. Please try again.', 'error');
        stopMediaStream();
        setRecording(false);
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

        // Keep tracks alive until the final dataavailable flush lands.
        await waitForRecorderChunks(() => chunksRef.current);
        const durationMs = Date.now() - recordingStartedAtRef.current;
        let blob = new Blob(chunksRef.current, { type: recordingMime });
        chunksRef.current = [];
        stopMediaStream();

        if (blob.size < 512) {
          useToastStore.getState().showToast(
            `Recording was empty or too short. Hold for at least 2 seconds, then stop.${formatTranscribeDiag({
              blobSize: blob.size,
              mimeType: recordingMime,
              durationMs,
            })}`,
            'error'
          );
          return;
        }

        const abortController = new AbortController();
        transcribeAbortRef.current = abortController;
        setTranscribing(true);
        setTranscribeStage('uploading');
        onCancelPendingSave?.();
        saveEnabledRef.current = false;
        try {
          const runTranscribe = async (audioBlob: Blob, mime: string, fileExt: string) => {
            const base64 = await blobToBase64(audioBlob);
            if (!base64 || base64.length < 64) {
              throw new Error(
                `Recording was empty or too short. Hold for at least 2 seconds, then stop.${formatTranscribeDiag({
                  blobSize: audioBlob.size,
                  mimeType: mime,
                  durationMs,
                })}`
              );
            }
            return notesApi.transcribeAudioForNote(base64, {
              mimeType: mime,
              noteId: note.id,
              fileName: `lecture-${Date.now()}.${fileExt}`,
              signal: abortController.signal,
              currentBody: bodyRef.current,
              durationMs,
              clientByteLength: audioBlob.size,
              useStoragePath: true,
              onProgress: (progress) => {
                if (progress.stage === 'uploading') setTranscribeStage('uploading');
                if (progress.stage === 'processing') setTranscribeStage('transcribing');
              },
            });
          };

          let mimeType = recordingMime.split(';')[0] || 'audio/webm';
          let ext = mimeType.includes('mp4')
            ? 'm4a'
            : mimeType.includes('ogg')
              ? 'ogg'
              : 'webm';
          let result: Awaited<ReturnType<typeof notesApi.transcribeAudioForNote>>;
          try {
            result = await runTranscribe(blob, mimeType, ext);
          } catch (firstErr: unknown) {
            const firstMessage = firstErr instanceof Error ? firstErr.message : '';
            const shouldRetryAsWav =
              /could not read that recording|unsupported|invalid.*media/i.test(firstMessage) &&
              !mimeType.includes('wav');
            if (!shouldRetryAsWav) throw firstErr;
            blob = await encodeBlobAsWav(blob);
            mimeType = 'audio/wav';
            ext = 'wav';
            result = await runTranscribe(blob, mimeType, ext);
          }

          if (result.transcript) {
            setBody((prev) =>
              prev.includes(result.transcript)
                ? prev
                : [prev, result.transcript].filter(Boolean).join('\n\n')
            );
            // Keep autosave paused briefly so a racing save cannot wipe the transcript merge.
            userEditedRef.current = false;
            useToastStore.getState().showToast('Transcript ready', 'success');
          }
          if (result.persistWarning) {
            useToastStore.getState().showToast(result.persistWarning, 'info');
          }
          onTranscriptReady(result.transcript || '');
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const message = err instanceof Error ? err.message : 'Transcription failed';
          const diag = formatTranscribeDiag({
            blobSize: blob.size,
            mimeType: recordingMime,
            durationMs,
          });
          useToastStore
            .getState()
            .showToast(message.includes('(') ? message : `${message}${diag}`, 'error');
        } finally {
          transcribeAbortRef.current = null;
          setTranscribing(false);
          setTranscribeStage('idle');
          window.setTimeout(() => {
            saveEnabledRef.current = true;
          }, AUTOSAVE_PAUSE_AFTER_TRANSCRIPT_MS);
        }
      };
      mediaRecorderRef.current = recorder;
      // Smaller timeslice so short lectures still produce chunks before stop.
      recorder.start(250);
      recordingStartedAtRef.current = Date.now();
      setRecording(true);
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      const message =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Microphone permission is blocked. Allow mic access for lanternstudy.com, then retry.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug in a mic and try again.'
            : 'Microphone access is required to record lectures.';
      useToastStore.getState().showToast(message, 'error');
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const elapsed = Date.now() - recordingStartedAtRef.current;
    if (elapsed < MIN_RECORD_MS) {
      useToastStore
        .getState()
        .showToast('Keep recording for at least 2 seconds so we can capture audio.', 'info');
      return;
    }
    mediaRecorderRef.current = null;
    setRecording(false);
    try {
      // stop() alone emits the final dataavailable; do not requestData()+stop (race → empty blob).
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop();
      }
    } catch {
      // ignore
    }
  };

  const discardRecording = () => {
    discardRecordingRef.current = true;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    try {
      if (recorder && (recorder.state === 'recording' || recorder.state === 'paused')) {
        // Let onstop stop the stream — killing tracks before stop() can abort the flush.
        recorder.stop();
      } else {
        stopMediaStream();
      }
    } catch {
      stopMediaStream();
    }
  };

  const cancelTranscription = () => {
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    setTranscribing(false);
    setTranscribeStage('idle');
  };

  return (
    <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${isDark ? 'bg-lantern-background' : 'bg-lantern-background'}`}>
      <div className={`shrink-0 flex items-center gap-1.5 sm:gap-3 px-3 py-2 sm:px-4 sm:py-3 border-b min-w-0 ${isDark ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-surface'}`}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to notes"
          className="shrink-0 p-1.5 sm:p-2 rounded-lg hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <input
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          className={`flex-1 min-w-0 text-base sm:text-lg font-semibold bg-transparent outline-none ${isDark ? 'text-lantern-text' : 'text-lantern-text'}`}
        />
        {isSaving && <span className="hidden sm:inline text-xs text-lantern-text-tertiary shrink-0">Saving...</span>}
        <Button variant="secondary" size="sm" onClick={handleShareGroup} aria-label="Share with group" className="shrink-0 px-2 sm:px-3">
          <ShareIcon className="w-4 h-4" />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setShowCollabModal(true)} aria-label="Add collaborator" className="shrink-0 px-2 sm:px-3">
          <UserPlusIcon className="w-4 h-4" />
        </Button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete note"
          className="shrink-0 p-1.5 sm:p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col-reverse lg:flex-row">
        <div className="flex-1 min-w-0 lg:overflow-y-auto p-3 sm:p-4 space-y-3">
          <div
            className={`sticky top-0 z-10 flex flex-wrap gap-2 py-2 -mt-2 lg:static lg:mt-0 lg:py-0 ${
              isDark ? 'bg-lantern-background' : 'bg-lantern-background'
            }`}
          >
            {!recording ? (
              <Button size="sm" variant="secondary" onClick={startRecording} disabled={transcribing}>
                <MicrophoneIcon className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Record lecture</span>
                <span className="sm:hidden">Record</span>
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={stopRecording}
                  disabled={recordingSeconds < 2}
                  title={recordingSeconds < 2 ? 'Keep recording for at least 2 seconds' : undefined}
                >
                  <StopIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">
                    {recordingSeconds < 2 ? `Wait ${2 - recordingSeconds}s` : 'Stop & transcribe'}
                  </span>
                  <span className="sm:hidden">{recordingSeconds < 2 ? `${2 - recordingSeconds}s` : 'Stop'}</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={discardRecording}>
                  Cancel
                </Button>
                <div className="flex items-center gap-2 self-center">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  <span className="text-xs sm:text-sm font-medium text-red-500">
                    Recording {formatRecordingDuration(recordingSeconds)}
                  </span>
                </div>
              </>
            )}
            {transcribing && (
              <>
                <span className="text-xs sm:text-sm text-lantern-text-tertiary self-center">
                  {transcribeStage === 'uploading' ? 'Uploading…' : 'Transcribing…'}
                </span>
                <Button size="sm" variant="ghost" onClick={cancelTranscription}>
                  Cancel
                </Button>
              </>
            )}
            {isSaving && <span className="sm:hidden text-xs text-lantern-text-tertiary self-center">Saving...</span>}
          </div>

          {note.youtubeVideoId && (
            <YouTubeEmbed videoId={note.youtubeVideoId} title={title || note.title} />
          )}

          {documentAttachment && (
            <NotePdfViewer noteId={note.id} attachment={documentAttachment} theme={theme} />
          )}

          {showImageGallery && imageAttachments.length > 0 && (
            <>
              <input
                ref={addPhotosInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => void handleAddPhotosSelected(event)}
              />
              <NoteImageGallery
                noteId={note.id}
                attachments={imageAttachments}
                theme={theme}
                editable={isPhotoNote}
                onAttachmentsChange={handleImageAttachmentsChange}
                onAddPhotos={
                  isPhotoNote
                    ? () => {
                        if (!addingPhotos) addPhotosInputRef.current?.click();
                      }
                    : undefined
                }
              />
            </>
          )}

          {showPreviewBanner && (
            <div
              className={`text-sm rounded-lg border px-3 py-2 flex items-start justify-between gap-3 ${
                isDark ? 'border-lantern-primary/30 bg-lantern-primary-background text-lantern-primary-light' : 'border-lantern-primary/30 bg-lantern-primary-background text-lantern-primary-dark'
              }`}
              role="status"
            >
              <div className="space-y-1">
                <p>
                  Slide preview is being prepared — your notes and AI tools are ready now.
                </p>
                {presentationAttachment && (
                  <button
                    type="button"
                    className="text-lantern-primary underline text-left text-xs"
                    onClick={() => void handleDownloadOriginalSlides()}
                  >
                    Download original slides ({presentationAttachment.fileName || 'presentation'})
                  </button>
                )}
              </div>
              <button
                type="button"
                className={`shrink-0 text-xs underline ${isDark ? 'text-lantern-primary-light' : 'text-lantern-primary'}`}
                onClick={() => setPreviewBannerDismissed(true)}
              >
                Dismiss
              </button>
            </div>
          )}

          {isDocumentNote && !documentAttachment && !showPreviewBanner && (
            <div className={`text-sm rounded-lg border px-3 py-2 space-y-2 ${isDark ? 'border-lantern-border text-lantern-text-tertiary' : 'border-lantern-border text-lantern-text-secondary'}`}>
              <p>
                {previewError ||
                  (note.sourceType === 'presentation'
                    ? 'Slide preview is unavailable, but AI can still use extracted text from your deck.'
                    : 'Document preview is unavailable.')}
                {presentationAttachment?.fileName ? ` (${presentationAttachment.fileName})` : ''}
              </p>
              {note.sourceType === 'presentation' && presentationAttachment && (
                <button
                  type="button"
                  className="text-lantern-primary underline text-left block"
                  onClick={() => void handleDownloadOriginalSlides()}
                >
                  Download original slides
                </button>
              )}
              {note.sourceType === 'presentation' && previewError && (
                <Button size="sm" variant="secondary" onClick={handleRetryPreview}>
                  Retry preview
                </Button>
              )}
            </div>
          )}

          {isDocumentNote || isPhotoNote ? (
            <div>
              <h4 className={`text-sm font-semibold mb-2 ${isDark ? 'text-lantern-text' : 'text-lantern-text'}`}>
                Your notes
              </h4>
              <textarea
                value={body}
                onChange={e => handleBodyChange(e.target.value)}
                placeholder={
                  isPhotoNote
                    ? 'Add your own notes alongside these photos...'
                    : 'Add your own notes on top of this document...'
                }
                className={`w-full min-h-[160px] sm:min-h-[200px] p-3 sm:p-4 rounded-xl border resize-y text-sm leading-relaxed ${
                  isDark ? 'bg-lantern-surface border-lantern-border text-lantern-text' : 'bg-lantern-surface border-lantern-border text-lantern-text'
                }`}
              />
            </div>
          ) : (
          <textarea
            value={body}
            onChange={e => handleBodyChange(e.target.value)}
            placeholder="Start typing your notes... Use headings, lists, and structure for better AI study tools."
            className={`w-full min-h-[240px] sm:min-h-[360px] p-3 sm:p-4 rounded-xl border resize-y text-sm leading-relaxed ${
              isDark ? 'bg-lantern-surface border-lantern-border text-lantern-text' : 'bg-lantern-surface border-lantern-border text-lantern-text'
            }`}
          />
          )}

          <div className={`rounded-xl border p-3 sm:p-4 ${isDark ? 'border-lantern-border' : 'border-lantern-border'}`}>
            <h4 className={`text-sm font-semibold mb-2 ${isDark ? 'text-lantern-text' : 'text-lantern-text'}`}>
              Discussion ({comments.length})
            </h4>
            <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
              {comments.map(c => (
                <div key={c.id} className={`text-sm p-2 rounded-lg ${isDark ? 'bg-lantern-surface' : 'bg-lantern-background'}`}>
                  <p className={isDark ? 'text-lantern-text' : 'text-lantern-text'}>{c.comment}</p>
                  <p className="text-xs text-lantern-text-tertiary mt-1">{new Date(c.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a comment for collaborators..."
                className={`flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-lantern-surface border-lantern-border text-lantern-text' : 'bg-lantern-surface border-lantern-border'}`}
              />
              <Button
                size="sm"
                className="shrink-0 self-end sm:self-auto"
                onClick={() => {
                  if (!commentText.trim()) return;
                  onPostComment(commentText.trim());
                  setCommentText('');
                }}
              >
                Post
              </Button>
            </div>
          </div>
        </div>

        <aside className={`w-full lg:w-[40rem] lg:max-w-[45vw] lg:shrink-0 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l p-4 sm:p-6 space-y-5 pb-[max(1.5rem,calc(1rem+env(safe-area-inset-bottom,0px)))] lg:pb-6 ${isDark ? 'border-lantern-border bg-lantern-surface/50' : 'border-lantern-border bg-lantern-surface'}`}>
          <NoteLearnPanel
            note={{ ...note, title, body }}
            studyContentLength={studyContentLength}
            theme={theme}
            onSmartNote={onSmartNote}
            onChatWithNote={onChatWithNote}
            onGenerateFlashcards={async () => {
              setGeneratingCards(true);
              try {
                await onGenerateFlashcards({ title, body });
              } finally {
                setGeneratingCards(false);
              }
            }}
            onGenerateQuiz={async () => {
              setGeneratingQuiz(true);
              try {
                await onGenerateQuiz({ title, body });
              } finally {
                setGeneratingQuiz(false);
              }
            }}
            isBusy={transcribing || generatingCards || generatingQuiz}
          />
          {dailyQuiz && onDailyQuizAnswer && onCompleteDailyQuiz && (
            <DailyQuizWidget
              theme={theme}
              studyGoal={studyGoal}
              dailyQuiz={dailyQuiz}
              progress={dailyQuizProgress}
              title="Note quiz"
              onStudyGoalChange={onStudyGoalChange || (() => {})}
              onStartQuiz={() => {}}
              onAnswer={onDailyQuizAnswer}
              onComplete={onCompleteDailyQuiz}
              onRegenerateQuiz={
                onRegenerateQuiz
                  ? () => { void onRegenerateQuiz(); }
                  : undefined
              }
            />
          )}
        </aside>
      </div>

      {showCollabModal && (
        <NoteCollaboratorsModal
          isOpen={showCollabModal}
          onClose={() => setShowCollabModal(false)}
          noteId={note.id}
          currentUserId={currentUserId}
        />
      )}
      {shareGroupOpen && (
        <Modal
          isOpen={shareGroupOpen}
          onClose={() => setShareGroupOpen(false)}
          ariaLabelledBy="share-group-title"
          maxWidthClass="max-w-sm"
          zIndexClass="z-[70]"
        >
          <div className="space-y-3">
            <h3 id="share-group-title" className="text-lg font-semibold text-lantern-text">Share with group</h3>
            <ul className="max-h-60 overflow-y-auto divide-y divide-lantern-border">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 min-h-[44px] text-sm text-lantern-text hover:bg-lantern-background-secondary rounded-lg"
                    onClick={() => {
                      setShareGroupOpen(false);
                      onShareWithGroup(g.id);
                    }}
                  >
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setShareGroupOpen(false)} className="w-full min-h-[44px] py-2 text-sm rounded-lg bg-lantern-background-secondary text-lantern-text">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default NoteEditorScreen;
