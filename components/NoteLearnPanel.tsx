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
  onSummarize: () => Promise<string | void>;
  onChatWithNote: () => void;
  onGenerateFlashcards: () => void;
  onGenerateQuiz: () => void;
  isBusy?: boolean;
}

const NoteLearnPanel: React.FC<NoteLearnPanelProps> = ({
  note,
  studyContentLength,
  theme,
  onSummarize,
  onChatWithNote,
  onGenerateFlashcards,
  onGenerateQuiz,
  isBusy = false,
}) => {
  const [summarizing, setSummarizing] = useState(false);
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

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      await onSummarize();
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className={`rounded-xl border p-5 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-indigo-50 border-indigo-100'}`}>
      <h3 className={`text-sm font-semibold mb-4 flex items-center gap-2 ${isDark ? 'text-gray-100' : 'text-indigo-900'}`}>
        <SparklesIcon className="w-5 h-5 text-indigo-500" />
        Learn from this note
      </h3>

      {note.summary && (
        <div className={`mb-5 p-4 rounded-lg text-sm leading-relaxed ${isDark ? 'bg-gray-900 text-gray-300' : 'bg-white text-gray-700'}`}>
          <p className="font-medium mb-1 text-indigo-500">Summary</p>
          <p className="whitespace-pre-wrap">{note.summary}</p>
        </div>
      )}

      {!canGenerateStudyMaterials && (
        <p className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Need {MIN_NOTE_STUDY_CONTENT_CHARS}+ characters — add notes or wait for import/extraction.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isBusy || summarizing || contentLength < 30}
          onClick={handleSummarize}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {summarizing ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="w-4 h-4" />}
          Summarize
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={onChatWithNote}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-gray-700 text-gray-100 hover:bg-gray-600' : 'bg-white text-gray-800 hover:bg-gray-50 border border-gray-200'}`}
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
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-gray-700 text-gray-100 hover:bg-gray-600' : 'bg-white text-gray-800 hover:bg-gray-50 border border-gray-200'}`}
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
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-gray-700 text-gray-100 hover:bg-gray-600' : 'bg-white text-gray-800 hover:bg-gray-50 border border-gray-200'}`}
        >
          <QuestionMarkCircleIcon className="w-4 h-4" />
          Practice test
        </button>
      </div>
    </div>
  );
};

export default NoteLearnPanel;
