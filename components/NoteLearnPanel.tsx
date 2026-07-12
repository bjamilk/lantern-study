import React, { useState } from 'react';
import { getNoteStudyContent, hasEnoughNoteStudyContent, MIN_NOTE_STUDY_CONTENT_CHARS } from '@lantern/shared';
import {
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  RectangleStackIcon,
  QuestionMarkCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import type { StudyNote } from '../types';

interface NoteLearnPanelProps {
  note: StudyNote & { attachments?: Array<{ extractedText?: string | null }> };
  studyContentLength?: number;
  theme: 'light' | 'dark';
  onSmartNote: (editorState?: { title?: string; body?: string }) => Promise<string | void>;
  onChatWithNote: () => void;
  onGenerateFlashcards: () => void;
  onGenerateQuiz: () => void;
  isBusy?: boolean;
}

const NoteLearnPanel: React.FC<NoteLearnPanelProps> = ({
  note,
  studyContentLength,
  theme,
  onSmartNote,
  onChatWithNote,
  onGenerateFlashcards,
  onGenerateQuiz,
  isBusy = false,
}) => {
  const [smartNoting, setSmartNoting] = useState(false);
  const isDark = theme === 'dark';
  const studyContent = getNoteStudyContent({
    sourceType: note.sourceType,
    body: note.body,
    summary: note.summary,
    attachments: note.attachments,
  });
  const contentLength = studyContentLength ?? studyContent.length;
  const canGenerateStudyMaterials = hasEnoughNoteStudyContent({
    sourceType: note.sourceType,
    body: note.body,
    summary: note.summary,
    attachments: note.attachments,
  });

  const handleSmartNote = async () => {
    setSmartNoting(true);
    try {
      await onSmartNote({ title: note.title, body: note.body });
    } finally {
      setSmartNoting(false);
    }
  };

  return (
    <div className={`rounded-xl border p-5 ${isDark ? 'bg-lantern-surface border-lantern-border' : 'bg-lantern-primary-background border-lantern-primary/20'}`}>
      <h3 className={`text-sm font-semibold mb-4 flex items-center gap-2 ${isDark ? 'text-lantern-text' : 'text-lantern-primary-dark'}`}>
        <SparklesIcon className="w-5 h-5 text-lantern-primary" />
        Learn from this note
      </h3>

      {note.summary && (
        <div className={`mb-5 p-4 rounded-lg text-sm leading-relaxed ${isDark ? 'bg-lantern-background text-lantern-text-tertiary' : 'bg-lantern-surface text-lantern-text'}`}>
          <p className="font-medium mb-1 text-lantern-primary">Smart Notes</p>
          <p className="whitespace-pre-wrap">{note.summary}</p>
        </div>
      )}

      {!canGenerateStudyMaterials && (
        <p className={`text-xs mb-3 ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
          Need {MIN_NOTE_STUDY_CONTENT_CHARS}+ characters — add notes or wait for import/extraction.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isBusy || smartNoting || contentLength < 30}
          onClick={handleSmartNote}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-lantern-primary text-white hover:bg-lantern-primary-dark disabled:opacity-50"
        >
          {smartNoting ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="w-4 h-4" />}
          Smart Note
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={onChatWithNote}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-border' : 'bg-lantern-surface text-lantern-text hover:bg-lantern-background border border-lantern-border'}`}
        >
          <ChatBubbleLeftRightIcon className="w-4 h-4" />
          Chat
        </button>
        <button
          type="button"
          disabled={isBusy || !canGenerateStudyMaterials}
          onClick={onGenerateFlashcards}
          title={
            canGenerateStudyMaterials
              ? undefined
              : `Add at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content`
          }
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-border' : 'bg-lantern-surface text-lantern-text hover:bg-lantern-background border border-lantern-border'}`}
        >
          <RectangleStackIcon className="w-4 h-4" />
          Flashcards
        </button>
        <button
          type="button"
          disabled={isBusy || !canGenerateStudyMaterials}
          onClick={onGenerateQuiz}
          title={
            canGenerateStudyMaterials
              ? undefined
              : `Add at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content`
          }
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-border' : 'bg-lantern-surface text-lantern-text hover:bg-lantern-background border border-lantern-border'}`}
        >
          <QuestionMarkCircleIcon className="w-4 h-4" />
          Practice test
        </button>
      </div>
    </div>
  );
};

export default NoteLearnPanel;
