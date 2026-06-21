import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  TrashIcon,
  UserPlusIcon,
  ShareIcon,
  MicrophoneIcon,
  StopIcon,
  DocumentTextIcon,
  DocumentIcon,
} from '@heroicons/react/24/outline';
import type { Group, NoteAttachment, NoteComment, StudyNote, DailyQuizSession, StudyGoalMode } from '../types';
import NoteLearnPanel from './NoteLearnPanel';
import DailyQuizWidget from './DailyQuizWidget';
import YouTubeEmbed from './YouTubeEmbed';
import NoteCollaboratorsModal from './NoteCollaboratorsModal';
import NotePdfViewer from './NotePdfViewer';
import { Button } from './ui';
import * as notesApi from '../services/notes';

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
  onSummarize: () => Promise<string | void>;
  onChatWithNote: () => void;
  onGenerateFlashcards: () => Promise<void>;
  onGenerateQuiz: () => Promise<void>;
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
  onSummarize,
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
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [generatingCards, setGeneratingCards] = useState(false);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [contentView, setContentView] = useState<'document' | 'text'>('document');
  const isDark = theme === 'dark';

  const pdfAttachment = note.attachments?.find(
    (a) => a.type === 'pdf' || (a.type === 'presentation' && a.metadata?.previewStoragePath)
  );
  const presentationAttachment = note.attachments?.find((a) => a.type === 'presentation');
  const showDocumentView = Boolean(pdfAttachment) && contentView === 'document';

  useEffect(() => {
    if (note.sourceType === 'pdf' || note.sourceType === 'presentation') {
      setContentView('document');
    }
  }, [note.id, note.sourceType]);

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
  }, [note.id, note.title, note.body]);

  useEffect(() => {
    if (!note.id) return;
    const timer = setTimeout(() => onSave({ title, body }), 800);
    return () => clearTimeout(timer);
  }, [note.id, title, body, onSave]);

  const handleShareGroup = () => {
    const groupId = prompt(
      `Share with group ID (available: ${groups.map(g => g.name).join(', ')})`,
      groups[0]?.id || ''
    );
    if (groupId) onShareWithGroup(groupId);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setTranscribing(true);
          try {
            const result = await notesApi.transcribeAudioForNote(base64, {
              mimeType: 'audio/webm',
              noteId: note.id,
              fileName: `lecture-${Date.now()}.webm`,
            });
            onTranscriptReady(result.transcript);
            setBody(prev => [prev, result.transcript].filter(Boolean).join('\n\n'));
          } catch (err: any) {
            alert(err.message || 'Transcription failed');
          } finally {
            setTranscribing(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      alert('Microphone access is required to record lectures.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
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
          onChange={e => setTitle(e.target.value)}
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

      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row">
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
              <Button size="sm" onClick={stopRecording}>
                <StopIcon className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Stop & transcribe</span>
                <span className="sm:hidden">Stop</span>
              </Button>
            )}
            {transcribing && <span className="text-xs sm:text-sm text-gray-400 self-center">Transcribing...</span>}
            {isSaving && <span className="sm:hidden text-xs text-gray-400 self-center">Saving...</span>}
          </div>

          {note.youtubeVideoId && (
            <YouTubeEmbed videoId={note.youtubeVideoId} title={title || note.title} />
          )}

          {pdfAttachment && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={contentView === 'document' ? 'primary' : 'secondary'}
                onClick={() => setContentView('document')}
              >
                <DocumentIcon className="w-4 h-4 mr-1" />
                Document
              </Button>
              <Button
                size="sm"
                variant={contentView === 'text' ? 'primary' : 'secondary'}
                onClick={() => setContentView('text')}
              >
                <DocumentTextIcon className="w-4 h-4 mr-1" />
                Extracted text
              </Button>
            </div>
          )}

          {showDocumentView && pdfAttachment && (
            <NotePdfViewer noteId={note.id} attachment={pdfAttachment} theme={theme} />
          )}

          {presentationAttachment && showDocumentView && (
            <p className="text-xs text-gray-400">
              Showing converted PDF preview
              {presentationAttachment.fileName ? ` of ${presentationAttachment.fileName}` : ''}.
            </p>
          )}

          {(!pdfAttachment || contentView === 'text') && (
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
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
            theme={theme}
            onSummarize={onSummarize}
            onChatWithNote={onChatWithNote}
            onGenerateFlashcards={async () => {
              setGeneratingCards(true);
              try {
                await onGenerateFlashcards();
              } finally {
                setGeneratingCards(false);
              }
            }}
            onGenerateQuiz={async () => {
              setGeneratingQuiz(true);
              try {
                await onGenerateQuiz();
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
    </div>
  );
};

export default NoteEditorScreen;
