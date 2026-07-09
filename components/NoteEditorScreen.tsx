import React, { useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
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
import NotePdfViewer from './NotePdfViewer';
import { Button } from './ui';
import * as notesApi from '../services/notes';
import { useNotesStore } from '../stores/notesStore';
import { useUIStore } from '../stores/uiStore';
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
}) => {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [commentText, setCommentText] = useState('');
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  const setImportProgress = useUIStore((s) => s.setImportProgress);
  const showToast = useToastStore((s) => s.showToast);
  const isDark = theme === 'dark';

  const isDocumentNote = note.sourceType === 'pdf' || note.sourceType === 'presentation';
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
    userEditedRef.current = false;
    setTitle(note.title);
    setBody(note.body);
  }, [note.id, note.title, note.body]);

  useEffect(() => {
    saveEnabledRef.current = true;
    return () => {
      saveEnabledRef.current = false;
    };
  }, [note.id]);

  useEffect(() => {
    if (!note.id || !saveEnabledRef.current || !userEditedRef.current) return;
    onSave({ title, body });
  }, [note.id, title, body, onSave]);

  const handleTitleChange = (value: string) => {
    userEditedRef.current = true;
    setTitle(value);
  };

  const handleBodyChange = (value: string) => {
    userEditedRef.current = true;
    setBody(value);
  };

  useEffect(() => {
    setPreviewError(null);
    setPreviewBannerDismissed(false);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stopMediaStream();
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          return;
        }

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const abortController = new AbortController();
          transcribeAbortRef.current = abortController;
          setTranscribing(true);
          try {
            await notesApi.transcribeAudioForNote(base64, {
              mimeType: 'audio/webm',
              noteId: note.id,
              fileName: `lecture-${Date.now()}.webm`,
              signal: abortController.signal,
            });
            onTranscriptReady('');
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            const message = err instanceof Error ? err.message : 'Transcription failed';
            useToastStore.getState().showToast(message, 'error');
          } finally {
            transcribeAbortRef.current = null;
            setTranscribing(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      useToastStore.getState().showToast('Microphone access is required to record lectures.', 'error');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const discardRecording = () => {
    discardRecordingRef.current = true;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    stopMediaStream();
    chunksRef.current = [];
    setRecording(false);
  };

  const cancelTranscription = () => {
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    setTranscribing(false);
  };

  return (
    <div className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className={`shrink-0 flex items-center gap-1.5 sm:gap-3 px-3 py-2 sm:px-4 sm:py-3 border-b min-w-0 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to notes"
          className="shrink-0 p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <input
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          className={`flex-1 min-w-0 text-base sm:text-lg font-semibold bg-transparent outline-none ${isDark ? 'text-gray-100' : 'text-gray-900'}`}
        />
        {isSaving && <span className="hidden sm:inline text-xs text-gray-400 shrink-0">Saving...</span>}
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
              isDark ? 'bg-gray-900' : 'bg-gray-50'
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
                <Button size="sm" variant="danger" onClick={stopRecording}>
                  <StopIcon className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Stop & transcribe</span>
                  <span className="sm:hidden">Stop</span>
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
                <span className="text-xs sm:text-sm text-gray-400 self-center">Transcribing...</span>
                <Button size="sm" variant="ghost" onClick={cancelTranscription}>
                  Cancel
                </Button>
              </>
            )}
            {isSaving && <span className="sm:hidden text-xs text-gray-400 self-center">Saving...</span>}
          </div>

          {note.youtubeVideoId && (
            <YouTubeEmbed videoId={note.youtubeVideoId} title={title || note.title} />
          )}

          {documentAttachment && (
            <NotePdfViewer noteId={note.id} attachment={documentAttachment} theme={theme} />
          )}

          {showPreviewBanner && (
            <div
              className={`text-sm rounded-lg border px-3 py-2 flex items-start justify-between gap-3 ${
                isDark ? 'border-indigo-800/50 bg-indigo-950/30 text-indigo-200' : 'border-indigo-200 bg-indigo-50 text-indigo-900'
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
                    className="text-indigo-500 underline text-left text-xs"
                    onClick={() => void handleDownloadOriginalSlides()}
                  >
                    Download original slides ({presentationAttachment.fileName || 'presentation'})
                  </button>
                )}
              </div>
              <button
                type="button"
                className={`shrink-0 text-xs underline ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}
                onClick={() => setPreviewBannerDismissed(true)}
              >
                Dismiss
              </button>
            </div>
          )}

          {isDocumentNote && !documentAttachment && !showPreviewBanner && (
            <div className={`text-sm rounded-lg border px-3 py-2 space-y-2 ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
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
                  className="text-indigo-500 underline text-left block"
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

          {isDocumentNote ? (
            <div>
              <h4 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                Your notes
              </h4>
              <textarea
                value={body}
                onChange={e => handleBodyChange(e.target.value)}
                placeholder="Add your own notes on top of this document..."
                className={`w-full min-h-[160px] sm:min-h-[200px] p-3 sm:p-4 rounded-xl border resize-y text-sm leading-relaxed ${
                  isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-800'
                }`}
              />
            </div>
          ) : (
          <textarea
            value={body}
            onChange={e => handleBodyChange(e.target.value)}
            placeholder="Start typing your notes... Use headings, lists, and structure for better AI study tools."
            className={`w-full min-h-[240px] sm:min-h-[360px] p-3 sm:p-4 rounded-xl border resize-y text-sm leading-relaxed ${
              isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-800'
            }`}
          />
          )}

          <div className={`rounded-xl border p-3 sm:p-4 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <h4 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              Discussion ({comments.length})
            </h4>
            <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
              {comments.map(c => (
                <div key={c.id} className={`text-sm p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                  <p className={isDark ? 'text-gray-200' : 'text-gray-800'}>{c.comment}</p>
                  <p className="text-xs text-gray-400 mt-1">{new Date(c.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a comment for collaborators..."
                className={`flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-200'}`}
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

        <aside className={`w-full lg:w-[40rem] lg:max-w-[45vw] lg:shrink-0 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l p-4 sm:p-6 space-y-5 pb-6 lg:pb-6 ${isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-white'}`}>
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

      <NoteCollaboratorsModal
        isOpen={showCollabModal}
        onClose={() => setShowCollabModal(false)}
        noteId={note.id}
        currentUserId={currentUserId}
      />
      {shareGroupOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Share with group</h3>
            <ul className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg"
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
            <button type="button" onClick={() => setShareGroupOpen(false)} className="w-full py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NoteEditorScreen;
