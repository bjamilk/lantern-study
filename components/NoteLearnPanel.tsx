import React, { useState } from 'react';
import {
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
  MarkdownRenderer,
} from '@lantern/shared';
import {
  SMART_NOTES_GUIDANCE_MAX_CHARS,
  type SmartNotesDepth,
  type SmartNotesRequestOptions,
} from '@lantern/shared/utils/smartNotes';
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
  onSmartNote: (
    editorState?: { title?: string; body?: string },
    options?: SmartNotesRequestOptions
  ) => Promise<string | void>;
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
  const [guidance, setGuidance] = useState('');
  const [depth, setDepth] = useState<SmartNotesDepth>('standard');
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
      await onSmartNote(
        { title: note.title, body: note.body },
        { guidance: guidance.trim() || undefined, depth }
      );
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
          <p className="font-medium mb-2 text-lantern-primary">Smart Notes</p>
          <div
            className={`smart-notes-md prose prose-sm max-w-none ${
              isDark
                ? 'prose-invert prose-headings:text-lantern-text prose-p:text-lantern-text-tertiary prose-li:text-lantern-text-tertiary prose-strong:text-lantern-text'
                : 'prose-slate prose-headings:text-lantern-text prose-p:text-lantern-text prose-li:text-lantern-text'
            }`}
          >
            <MarkdownRenderer content={note.summary} enableMath={false} />
          </div>
        </div>
      )}

      {!canGenerateStudyMaterials && (
        <p className={`text-xs mb-3 ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
          Need {MIN_NOTE_STUDY_CONTENT_CHARS}+ characters — add notes or wait for import/extraction.
        </p>
      )}

      <div className="mb-3 space-y-2">
        <input
          type="text"
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          maxLength={SMART_NOTES_GUIDANCE_MAX_CHARS}
          placeholder='Optional guidance — e.g. "focus on clinical applications"'
          className={`w-full px-3 py-2 rounded-lg text-sm border ${
            isDark
              ? 'bg-lantern-background border-lantern-border text-lantern-text placeholder:text-lantern-text-tertiary'
              : 'bg-lantern-surface border-lantern-border text-lantern-text placeholder:text-lantern-text-secondary'
          }`}
        />
        <div className="flex gap-1" role="radiogroup" aria-label="Smart Notes depth">
          {(
            [
              ['concise', 'Concise'],
              ['standard', 'Standard'],
              ['deep', 'Deep dive'],
            ] as Array<[SmartNotesDepth, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={depth === value}
              onClick={() => setDepth(value)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                depth === value
                  ? 'bg-lantern-primary text-white border-lantern-primary'
                  : isDark
                    ? 'bg-lantern-background text-lantern-text-tertiary border-lantern-border hover:text-lantern-text'
                    : 'bg-lantern-surface text-lantern-text-secondary border-lantern-border hover:text-lantern-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {depth === 'deep' && (
          <p className={`text-[11px] ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
            Deep dive covers more of long sources and adds a review pass — generation takes longer.
          </p>
        )}
      </div>

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
