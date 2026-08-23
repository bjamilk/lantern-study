import React, { useEffect, useRef, useState } from 'react';
import {
  aggregatePhotoOcrStatus,
  getAttachmentExtractionStatus,
  getExtractionStatusMessage,
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
  isPhotoNoteSource,
  isPlaceholderExtractedText,
} from '@lantern/shared';
import {
  ArrowLeftIcon,
  TrashIcon,
  UserPlusIcon,
  ShareIcon,
  BuildingStorefrontIcon,
  DocumentDuplicateIcon,
  MicrophoneIcon,
  StopIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import type { Group, NoteAttachment, NoteComment, StudyNote, DailyQuizSession, StudyGoalMode } from '../types';
import NoteLearnPanel from './NoteLearnPanel';
import DailyQuizWidget from './DailyQuizWidget';
import YouTubeEmbed from './YouTubeEmbed';
import YoutubeTranscriptPanel, {
  resolveTranscriptStatus,
} from './YoutubeTranscriptPanel';
import NoteCollaboratorsModal from './NoteCollaboratorsModal';
import Modal from './ui/Modal';
import NotePdfViewer from './NotePdfViewer';
import NoteImageGallery from './NoteImageGallery';
import { Button } from './ui';
import * as notesApi from '../services/notes';
import {
  formatRecordingDuration,
  getElapsedRecordingSeconds,
  MIN_LECTURE_RECORD_MS,
} from '../services/lectureRecording';
import { useLectureRecordingStore } from '../stores/lectureRecordingStore';
import { useNotesStore } from '../stores/notesStore';
import { CoursePicker } from './academic/CoursePicker';
import { useToastStore } from '../stores/toastStore';
import { navigateToPath } from '../utils/appNavigation';
import { useNoteCommentsSync } from '../hooks/useNoteCommentsSync';

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
  onSmartNote: (
    editorState?: { title?: string; body?: string },
    options?: import('@lantern/shared/utils/smartNotes').SmartNotesRequestOptions
  ) => Promise<string | void>;
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
  onPostComment: (comment: string) => Promise<void>;
  onRefreshComments: () => Promise<void>;
  onShareWithGroup: (groupId: string) => void;
  onTranscriptReady: (transcript: string) => void;
  /** Cancel pending autosave before/after voice transcription. */
  onCancelPendingSave?: () => void;
  /** Owner-only: generate a sellable study pack from this note (Phase 2 · H). */
  onSellAsStudyPack?: () => void;
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
  onRefreshComments,
  onShareWithGroup,
  onTranscriptReady,
  onCancelPendingSave,
  onSellAsStudyPack,
}) => {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const titleRef = useRef(title);
  titleRef.current = title;
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const lectureStatus = useLectureRecordingStore((s) => s.status);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStartedAt = useLectureRecordingStore((s) => s.startedAt);
  const lectureTick = useLectureRecordingStore((s) => s.tick);
  const startLectureRecording = useLectureRecordingStore((s) => s.start);
  const stopLectureRecording = useLectureRecordingStore((s) => s.stopAndTranscribe);
  const discardLectureRecording = useLectureRecordingStore((s) => s.discard);
  const cancelLectureTranscription = useLectureRecordingStore((s) => s.cancelTranscription);
  const setCurrentBodyProvider = useLectureRecordingStore((s) => s.setCurrentBodyProvider);
  const recordingForThisNote = lectureNoteId === note.id && lectureStatus === 'recording';
  const transcribingForThisNote =
    lectureNoteId === note.id &&
    (lectureStatus === 'uploading' || lectureStatus === 'transcribing');
  const recordingSeconds = recordingForThisNote
    ? getElapsedRecordingSeconds(lectureStartedAt)
    : 0;
  void lectureTick; // re-render on wall-clock ticks while recording
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
  const conflictReloadToken = useNotesStore((s) => s.conflictReloadToken);
  const showToast = useToastStore((s) => s.showToast);
  const isDark = theme === 'dark';
  const isOwner = note.accessRole === 'owner' || (!note.accessRole && note.userId === currentUserId);
  const canEdit = isOwner || note.accessRole === 'editor';
  const isViewer = !canEdit;
  const { refresh: refreshComments, isRefreshing: isRefreshingComments } =
    useNoteCommentsSync(note.id, onRefreshComments);

  const isDocumentNote = note.sourceType === 'pdf' || note.sourceType === 'presentation';
  const isYoutubeNote = note.sourceType === 'youtube' || Boolean(note.youtubeVideoId);
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
  const [retryingYoutubeTranscript, setRetryingYoutubeTranscript] = useState(false);
  const documentAttachment = note.attachments?.find(
    (a) => a.type === 'pdf' || (a.type === 'presentation' && a.metadata?.previewStoragePath)
  );
  const presentationAttachment = note.attachments?.find((a) => a.type === 'presentation');
  const youtubeAttachment = note.attachments?.find((a) => a.type === 'youtube');
  const youtubeTranscriptStatus = resolveTranscriptStatus(youtubeAttachment);
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
  const documentSourceAttachment =
    note.attachments?.find((a) => a.type === 'pdf') || presentationAttachment;
  // A photo note's text comes from several photographs at once, so its status is
  // the batch's, not any single attachment's.
  const extractionStatus = isPhotoNoteSource(note.sourceType)
    ? aggregatePhotoOcrStatus(note.attachments)
    : getAttachmentExtractionStatus(documentSourceAttachment);
  const extractionMessage = getExtractionStatusMessage(extractionStatus, note.sourceType);
  const [runningOcr, setRunningOcr] = useState(false);
  const ocrPollAttemptedRef = useRef<Set<string>>(new Set());
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

  // Collaborator / remote updates: apply when the viewer has not typed locally.
  useEffect(() => {
    if (userEditedRef.current) return;
    setTitle(note.title);
    setBody(note.body);
  }, [note.title, note.body, note.updatedAt]);

  // An autosave lost an optimistic-concurrency race: the store has reloaded the
  // authoritative note. Override the user's now-superseded local edits with it
  // (unlike the guarded effect above, this one runs even after local typing),
  // so the editor shows the version that actually saved.
  useEffect(() => {
    if (conflictReloadToken === 0) return;
    const latest = useNotesStore.getState().selectedNote;
    if (!latest || latest.id !== note.id) return;
    // Drop any debounced autosave still holding the superseded text, or it would
    // re-save (and win) against the version we just reloaded.
    onCancelPendingSave?.();
    userEditedRef.current = false;
    setTitle(latest.title);
    setBody(latest.body || '');
  }, [conflictReloadToken, note.id, onCancelPendingSave]);

  useEffect(() => {
    saveEnabledRef.current = canEdit;
    return () => {
      saveEnabledRef.current = false;
    };
  }, [note.id, canEdit]);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!canEdit || !note.id || !saveEnabledRef.current || !userEditedRef.current) return;
    onSaveRef.current({ title, body });
  }, [note.id, title, body, canEdit]);

  const handleTitleChange = (value: string) => {
    // Blocked during transcription: the completion handler replaces title/body
    // with the server copy, so anything typed meanwhile would be lost.
    if (!canEdit || transcribingForThisNote) return;
    userEditedRef.current = true;
    setTitle(value);
  };

  const handleBodyChange = (value: string) => {
    if (!canEdit || transcribingForThisNote) return;
    userEditedRef.current = true;
    setBody(value);
  };

  const handleImageAttachmentsChange = (attachments: NoteAttachment[]) => {
    const other = (note.attachments || []).filter((a) => a.type !== 'image');
    setSelectedNote({ ...note, attachments: [...other, ...attachments] });
  };

  const handleAddPhotosSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
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

  // Poll while a YouTube transcript job is still processing so Smart Notes unlocks.
  useEffect(() => {
    if (!isYoutubeNote) return;
    if (youtubeTranscriptStatus !== 'processing') return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40;
    const tick = async () => {
      if (cancelled || attempts >= maxAttempts) return;
      attempts += 1;
      try {
        const refreshed = await notesApi.fetchNote(note.id);
        if (cancelled) return;
        const prev = useNotesStore.getState().selectedNote;
        if (!prev || prev.id !== note.id) return;
        setSelectedNote({
          ...prev,
          ...refreshed,
          attachments: refreshed.attachments ?? prev.attachments,
        });
        const nextStatus = resolveTranscriptStatus(
          refreshed.attachments?.find((a) => a.type === 'youtube')
        );
        if (nextStatus === 'processing') {
          window.setTimeout(() => void tick(), 2500);
        }
      } catch {
        if (!cancelled) {
          window.setTimeout(() => void tick(), 4000);
        }
      }
    };
    const timer = window.setTimeout(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    isYoutubeNote,
    note.id,
    youtubeTranscriptStatus,
    setSelectedNote,
  ]);

  useEffect(() => {
    if (note.sourceType !== 'presentation' && note.sourceType !== 'pdf') return;
    if (!documentSourceAttachment) return;
    if (reextractAttemptedRef.current.has(note.id)) return;

    const extracted = documentSourceAttachment.extractedText;
    const needsReextract = isPlaceholderExtractedText(extracted);
    const studyReady = hasEnoughNoteStudyContent({
      sourceType: note.sourceType,
      body,
      summary: note.summary,
      attachments: note.attachments,
    });
    if (!needsReextract || studyReady) return;
    if (extractionStatus === 'ocr_processing') return;

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
  }, [
    note.id,
    note.sourceType,
    note.summary,
    note.attachments,
    documentSourceAttachment,
    body,
    setSelectedNote,
    extractionStatus,
  ]);

  useEffect(() => {
    if (
      note.sourceType !== 'pdf' &&
      note.sourceType !== 'presentation' &&
      !isPhotoNoteSource(note.sourceType)
    )
      return;
    if (extractionStatus !== 'ocr_processing') return;
    if (ocrPollAttemptedRef.current.has(note.id)) return;
    ocrPollAttemptedRef.current.add(note.id);
    let cancelled = false;
    setRunningOcr(true);
    void notesApi
      .waitForNoteOcr(note.id)
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
        if (result.status === 'failed') {
          showToast(result.ocrError || 'Local OCR failed', 'error');
        } else if (result.status === 'ready') {
          showToast('OCR finished — text is ready for Smart Notes', 'success');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        showToast(err instanceof Error ? err.message : 'OCR timed out', 'error');
      })
      .finally(() => {
        if (!cancelled) setRunningOcr(false);
      });
    return () => {
      cancelled = true;
    };
  }, [note.id, note.sourceType, extractionStatus, setSelectedNote]);

  const handleRunOcr = async () => {
    if (runningOcr) return;
    setRunningOcr(true);
    try {
      const result = await notesApi.runNoteOcr(note.id);
      const prev = useNotesStore.getState().selectedNote;
      if (prev?.id === note.id) {
        setSelectedNote({
          ...prev,
          attachments:
            prev.attachments?.map((a) =>
              a.id === result.attachment.id ? result.attachment : a
            ) ?? [result.attachment],
        });
      }
      if (result.status === 'ready') {
        showToast('OCR finished — text is ready for Smart Notes', 'success');
      } else if (result.status === 'failed') {
        showToast(result.ocrError || 'Local OCR failed', 'error');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to run OCR', 'error');
    } finally {
      setRunningOcr(false);
    }
  };

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
    if (!canEdit) {
      setCurrentBodyProvider(null);
      return;
    }
    setCurrentBodyProvider(() => bodyRef.current);
    return () => {
      setCurrentBodyProvider(null);
    };
  }, [canEdit, note.id, setCurrentBodyProvider]);

  useEffect(() => {
    if (!transcribingForThisNote) return;
    onCancelPendingSave?.();
    saveEnabledRef.current = false;
    return () => {
      window.setTimeout(() => {
        saveEnabledRef.current = true;
        // Save-window gap: edits typed during this cooldown fire the autosave
        // effect while saving is disabled, so nothing gets scheduled. Flush any
        // unsaved local edits now that saving is back on.
        if (userEditedRef.current) {
          onSaveRef.current({ title: titleRef.current, body: bodyRef.current });
        }
      }, 4000);
    };
  }, [transcribingForThisNote, onCancelPendingSave]);

  const prevTranscribingRef = useRef(false);
  useEffect(() => {
    if (prevTranscribingRef.current && !transcribingForThisNote && lectureStatus === 'idle') {
      userEditedRef.current = false;
      const latest = useNotesStore.getState().selectedNote;
      if (latest?.id === note.id) {
        setTitle(latest.title);
        setBody(latest.body || '');
      }
      onTranscriptReady('');
    }
    prevTranscribingRef.current = transcribingForThisNote;
  }, [transcribingForThisNote, lectureStatus, onTranscriptReady, note.id]);

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

  const handleRetryYoutubeTranscript = async () => {
    if (!canEdit || retryingYoutubeTranscript) return;
    setRetryingYoutubeTranscript(true);
    try {
      const result = await notesApi.retryYoutubeTranscript(note.id);
      const prev = useNotesStore.getState().selectedNote;
      if (prev?.id === note.id) {
        setSelectedNote({
          ...prev,
          ...result.note,
          attachments:
            prev.attachments?.map((a) =>
              a.id === result.attachment.id ? result.attachment : a
            ) ?? [result.attachment],
        });
      }
      if (result.status === 'failed') {
        showToast(
          result.transcriptError ||
            'Still could not fetch a transcript for this video.',
          'error'
        );
      } else {
        showToast('Transcript ready for Smart Notes', 'success');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Transcript retry failed', 'error');
    } finally {
      setRetryingYoutubeTranscript(false);
    }
  };

  const handlePostComment = async () => {
    const text = commentText.trim();
    if (!text || postingComment) return;
    setPostingComment(true);
    setCommentError(null);
    try {
      await onPostComment(text);
      // Clear only once the POST succeeded; a failure keeps the draft.
      setCommentText('');
    } catch {
      setCommentError("Couldn't post — check your connection and try again");
    } finally {
      setPostingComment(false);
    }
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

  const startRecording = () => {
    if (!canEdit) return;
    onCancelPendingSave?.();
    void startLectureRecording(note.id, title || note.title, { currentBody: bodyRef.current });
  };

  const stopRecording = () => {
    stopLectureRecording({ currentBody: bodyRef.current });
  };

  const discardRecording = () => {
    discardLectureRecording();
  };

  const cancelTranscription = () => {
    cancelLectureTranscription();
  };

  const handleMakeCopy = async () => {
    try {
      const copied = await notesApi.copyNote(note.id);
      const store = useNotesStore.getState();
      store.setNotes([copied, ...store.notes]);
      store.setSelectedNote(copied);
      navigateToPath(`/notes/${encodeURIComponent(copied.id)}`);
      showToast('Copy created in your notes.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not copy this note.', 'error');
    }
  };

  const handleLeave = async () => {
    try {
      await notesApi.leaveNoteCollaboration(note.id);
      useNotesStore.getState().setSelectedNote(null);
      navigateToPath('/notes');
      showToast('You no longer have access to this note.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not leave this note.', 'error');
    }
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
          readOnly={isViewer || transcribingForThisNote}
          aria-label="Note title"
          className={`flex-1 min-w-0 text-base sm:text-lg font-semibold bg-transparent outline-none ${isDark ? 'text-lantern-text' : 'text-lantern-text'}`}
        />
        {isSaving && <span className="hidden sm:inline text-xs text-lantern-text-tertiary shrink-0">Saving...</span>}
        {isOwner && <>
          {onSellAsStudyPack && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onSellAsStudyPack}
              aria-label="Turn into a Study Product"
              title="Turn into a Study Product"
              className="shrink-0 px-2 sm:px-3"
            >
              <BuildingStorefrontIcon className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Sell</span>
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={handleShareGroup} aria-label="Share with group" className="shrink-0 px-2 sm:px-3">
            <ShareIcon className="w-4 h-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowCollabModal(true)} aria-label="Manage sharing" className="shrink-0 px-2 sm:px-3">
            <UserPlusIcon className="w-4 h-4" />
          </Button>
        </>}
        {!isOwner && <Button variant="secondary" size="sm" onClick={() => void handleMakeCopy()} aria-label="Make a copy" className="shrink-0 px-2 sm:px-3"><DocumentDuplicateIcon className="w-4 h-4" /></Button>}
        {!isOwner && <Button variant="ghost" size="sm" onClick={() => void handleLeave()} className="hidden sm:inline-flex">Leave</Button>}
        {isOwner && <button
          type="button"
          onClick={onDelete}
          aria-label="Delete note"
          className="shrink-0 p-1.5 sm:p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
        >
          <TrashIcon className="w-5 h-5" />
        </button>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col-reverse lg:flex-row">
        <div className="flex-1 min-w-0 lg:overflow-y-auto p-3 sm:p-4 space-y-3">
          <div
            className={`sticky top-0 z-10 flex flex-wrap gap-2 py-2 -mt-2 lg:static lg:mt-0 lg:py-0 ${
              isDark ? 'bg-lantern-background' : 'bg-lantern-background'
            }`}
          >
            {canEdit && !recordingForThisNote ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={startRecording}
                disabled={transcribingForThisNote || (lectureStatus !== 'idle' && lectureNoteId !== note.id)}
              >
                <MicrophoneIcon className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Record lecture</span>
                <span className="sm:hidden">Record</span>
              </Button>
            ) : canEdit && recordingForThisNote ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={stopRecording}
                  disabled={recordingSeconds * 1000 < MIN_LECTURE_RECORD_MS}
                  title={
                    recordingSeconds * 1000 < MIN_LECTURE_RECORD_MS
                      ? 'Keep recording for at least 2 seconds'
                      : undefined
                  }
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
            ) : null}
            {transcribingForThisNote && (
              <>
                <span className="text-xs sm:text-sm text-lantern-text-tertiary self-center">
                  {lectureStatus === 'uploading' ? 'Uploading…' : 'Transcribing…'}
                </span>
                <Button size="sm" variant="ghost" onClick={cancelTranscription}>
                  Cancel
                </Button>
              </>
            )}
            {isSaving && <span className="sm:hidden text-xs text-lantern-text-tertiary self-center">Saving...</span>}
            {/* Note meta: course (academic archive). Non-content save — no CAS. */}
            <div className="w-full sm:w-auto sm:min-w-[14rem] sm:ml-auto">
              <CoursePicker
                id="note-course"
                hideLabel
                compact
                value={note.courseId ?? null}
                disabled={!canEdit}
                placeholder="No course"
                onChange={(course) => {
                  void useNotesStore
                    .getState()
                    .saveNote(note.id, { courseId: course?.id ?? null })
                    .catch((err: unknown) =>
                      showToast(err instanceof Error ? err.message : 'Could not update the course.', 'error')
                    );
                }}
              />
            </div>
          </div>

          {note.youtubeVideoId && (
            <YouTubeEmbed videoId={note.youtubeVideoId} title={title || note.title} />
          )}

          {isYoutubeNote && (
            <YoutubeTranscriptPanel
              theme={theme}
              attachment={youtubeAttachment}
              canRetry={canEdit}
              retrying={retryingYoutubeTranscript}
              onRetry={() => void handleRetryYoutubeTranscript()}
            />
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
                editable={isPhotoNote && canEdit}
                onAttachmentsChange={handleImageAttachmentsChange}
                onAddPhotos={
                  isPhotoNote && canEdit
                    ? () => {
                        if (!addingPhotos) addPhotosInputRef.current?.click();
                      }
                    : undefined
                }
              />
            </>
          )}

          {extractionMessage &&
            (note.sourceType === 'pdf' ||
              note.sourceType === 'presentation' ||
              isPhotoNoteSource(note.sourceType)) && (
            <div
              className={`text-sm rounded-lg border px-3 py-2 space-y-2 ${
                isDark
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                  : 'border-amber-500/40 bg-amber-50 text-amber-950'
              }`}
              role="status"
            >
              <p>{runningOcr || extractionStatus === 'ocr_processing' ? 'Running local OCR…' : extractionMessage}</p>
              {(extractionStatus === 'needs_ocr' ||
                extractionStatus === 'empty' ||
                extractionStatus === 'ocr_failed') &&
                canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => void handleRunOcr()} disabled={runningOcr}>
                    {runningOcr ? 'Running OCR…' : 'Run OCR (local)'}
                  </Button>
                )}
            </div>
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
                  Slide preview is being prepared
                  {extractionStatus === 'ok'
                    ? ' — extracted text is available for AI tools.'
                    : ' — AI tools need readable text (wait for extraction/OCR if this deck is image-based).'}
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
                    ? extractionStatus === 'ok'
                      ? 'Slide preview is unavailable. Extracted text is available for AI tools.'
                      : 'Slide preview is unavailable. Extracted text may be missing — run OCR or add notes.'
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

          {transcribingForThisNote && (
            <div
              className={`text-sm rounded-lg border px-3 py-2 ${
                isDark
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                  : 'border-amber-500/40 bg-amber-50 text-amber-950'
              }`}
              role="status"
            >
              Editing is paused while the lecture transcribes.
            </div>
          )}

          {isDocumentNote || isPhotoNote || isYoutubeNote ? (
            <div>
              <h4 className={`text-sm font-semibold mb-2 ${isDark ? 'text-lantern-text' : 'text-lantern-text'}`}>
                Your notes
              </h4>
              <textarea
                value={body}
                onChange={e => handleBodyChange(e.target.value)}
                readOnly={isViewer || transcribingForThisNote}
                aria-label="Note body"
                placeholder={
                  isPhotoNote
                    ? 'Add your own notes alongside these photos...'
                    : isYoutubeNote
                      ? 'Add your own notes alongside this video transcript...'
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
            readOnly={isViewer || transcribingForThisNote}
            aria-label="Note body"
            placeholder="Start typing your notes... Use headings, lists, and structure for better AI study tools."
            className={`w-full min-h-[240px] sm:min-h-[360px] p-3 sm:p-4 rounded-xl border resize-y text-sm leading-relaxed ${
              isDark ? 'bg-lantern-surface border-lantern-border text-lantern-text' : 'bg-lantern-surface border-lantern-border text-lantern-text'
            }`}
          />
          )}

          <div className={`rounded-xl border p-3 sm:p-4 ${isDark ? 'border-lantern-border' : 'border-lantern-border'}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className={`text-sm font-semibold ${isDark ? 'text-lantern-text' : 'text-lantern-text'}`}>
                Discussion ({comments.length})
              </h4>
              <button
                type="button"
                onClick={() => void refreshComments()}
                disabled={isRefreshingComments}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-lantern-primary hover:bg-lantern-primary-background disabled:opacity-50"
                aria-label="Refresh discussion"
                title="Refresh discussion"
              >
                <ArrowPathIcon
                  className={`h-4 w-4 ${isRefreshingComments ? 'animate-spin' : ''}`}
                  aria-hidden
                />
                Refresh
              </button>
            </div>
            <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
              {comments.map((c) => {
                const authorName =
                  c.user?.name ||
                  c.user?.username ||
                  (c.userId === currentUserId ? 'You' : 'Lantern user');
                return (
                  <div key={c.id} className={`text-sm p-2 rounded-lg ${isDark ? 'bg-lantern-surface' : 'bg-lantern-background'}`}>
                    <div className="mb-1 flex items-center gap-2">
                      {c.user?.avatarUrl ? (
                        <img
                          src={c.user.avatarUrl}
                          alt=""
                          className="h-5 w-5 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-lantern-primary-background text-[10px] font-semibold uppercase text-lantern-primary"
                          aria-hidden
                        >
                          {authorName.slice(0, 1)}
                        </span>
                      )}
                      <span className="font-medium text-lantern-text">{authorName}</span>
                      <span className="ml-auto text-xs text-lantern-text-tertiary">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className={isDark ? 'text-lantern-text' : 'text-lantern-text'}>{c.comment}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                disabled={isViewer}
                placeholder="Add a comment for collaborators..."
                className={`flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-lantern-surface border-lantern-border text-lantern-text' : 'bg-lantern-surface border-lantern-border'}`}
              />
              <Button
                size="sm"
                className="shrink-0 self-end sm:self-auto"
                onClick={() => void handlePostComment()}
                disabled={isViewer || postingComment}
              >
                {postingComment ? 'Posting…' : 'Post'}
              </Button>
            </div>
            {commentError && (
              <p className="mt-2 text-xs text-red-500" role="alert">
                {commentError}
              </p>
            )}
          </div>
        </div>

        <aside className={`w-full lg:w-[40rem] lg:max-w-[45vw] lg:shrink-0 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l p-4 sm:p-6 space-y-5 pb-[max(1.5rem,calc(1rem+env(safe-area-inset-bottom,0px)))] lg:pb-6 ${isDark ? 'border-lantern-border bg-lantern-surface/50' : 'border-lantern-border bg-lantern-surface'}`}>
          {canEdit && <NoteLearnPanel
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
            isBusy={transcribingForThisNote || generatingCards || generatingQuiz}
          />}
          {canEdit && dailyQuiz && onDailyQuizAnswer && onCompleteDailyQuiz && (
            <DailyQuizWidget
              theme={theme}
              studyGoal={studyGoal}
              dailyQuiz={dailyQuiz}
              progress={dailyQuizProgress}
              title="Note quiz"
              onStudyGoalChange={onStudyGoalChange || (() => {})}
              onStartQuiz={(_noteId) => {}}
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
