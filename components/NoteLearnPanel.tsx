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
  SMART_NOTES_CREDIT_COST,
  AI_CREDIT_COSTS,
  formatCreditCost,
} from '@lantern/shared/utils/aiCredits';
import { subscribeToAIUsage, getLatestAIUsage, type AIUsageInfo } from '../services/ai';
import AIUsageInline from './AIUsageInline';
import type { StudyNote } from '../types';
import { AppIcon } from './ui/AppIcon';
import { FeatureDisc } from './ui/FeatureDisc';
import WalkthroughScreen from './walkthrough/WalkthroughScreen';
import NarrationPlayer from './narration/NarrationPlayer';

/**
 * What the walk-through needs from an attachment.
 *
 * The panel used to take attachments as `{ extractedText }` alone, which is
 * all Smart Notes ever read. The walk-through works page by page, so it needs
 * to know WHICH document it is walking through — hence the id, and the type
 * that says whether the document has pages at all.
 */
type LearnAttachment = {
  id?: string;
  type?: string;
  fileName?: string;
  extractedText?: string | null;
};

/** Only uploaded documents are split into pages. */
const WALKABLE_ATTACHMENT_TYPES = new Set(['pdf', 'presentation']);

interface NoteLearnPanelProps {
  note: StudyNote & { attachments?: LearnAttachment[] };
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
  const [usage, setUsage] = useState<AIUsageInfo>(getLatestAIUsage());
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [narrationOpen, setNarrationOpen] = useState(false);

  // The first uploaded document on the note is the one a walk-through walks.
  // A note with only photos, audio or a video link has no pages, so the door
  // is not shown at all rather than opening onto "unsupported".
  const walkableAttachment = (note.attachments || []).find(
    (attachment) => attachment.id && WALKABLE_ATTACHMENT_TYPES.has(String(attachment.type))
  );

  React.useEffect(() => subscribeToAIUsage(setUsage), []);

  const remainingCredits = Math.max(0, usage.limit - usage.used);
  const smartNotesCost = SMART_NOTES_CREDIT_COST[depth];
  const shortForSmartNote = usage.limit > 0 && remainingCredits < smartNotesCost;
  const shortForOneCredit = usage.limit > 0 && remainingCredits < 1;
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
        <AppIcon name="sparkles" size={20} className="text-lantern-primary" />
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

      {walkableAttachment?.id && (
        <button
          type="button"
          onClick={() => setWalkthroughOpen(true)}
          className={`mb-4 flex w-full items-center gap-3 rounded-lg border p-3 text-left ${isDark ? 'border-lantern-border bg-lantern-background hover:bg-lantern-surface-secondary' : 'border-lantern-border bg-lantern-surface hover:bg-lantern-background'}`}
        >
          <FeatureDisc feature="notes" size={32} icon={<AppIcon name="book-open" size={18} />} />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-lantern-text">Walk me through it</span>
            <span className={`block truncate text-caption ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              {walkableAttachment.fileName || 'This document'} — one page at a time
            </span>
          </span>
          <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
        </button>
      )}

      {walkableAttachment?.id && (
        <button
          type="button"
          onClick={() => setNarrationOpen(true)}
          className={`mb-4 flex w-full items-center gap-3 rounded-lg border p-3 text-left ${isDark ? 'border-lantern-border bg-lantern-background hover:bg-lantern-surface-secondary' : 'border-lantern-border bg-lantern-surface hover:bg-lantern-background'}`}
        >
          <FeatureDisc feature="notes" size={32} icon={<AppIcon name="volume-medium" size={18} />} />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-lantern-text">Read it to me</span>
            <span className={`block truncate text-caption ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              Your device reads the pages aloud — nothing to download
            </span>
          </span>
          <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
        </button>
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
              aria-label={`${label}, ${formatCreditCost(SMART_NOTES_CREDIT_COST[value])}`}
              onClick={() => setDepth(value)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                depth === value
                  ? 'bg-lantern-primary text-white border-lantern-primary'
                  : isDark
                    ? 'bg-lantern-background text-lantern-text-tertiary border-lantern-border hover:text-lantern-text'
                    : 'bg-lantern-surface text-lantern-text-secondary border-lantern-border hover:text-lantern-text'
              }`}
            >
              {label} · {SMART_NOTES_CREDIT_COST[value]}
            </button>
          ))}
        </div>
        {depth === 'deep' && (
          <p className={`text-[11px] ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
            Deep dive covers more of long sources and adds a review pass — takes longer and costs{' '}
            {formatCreditCost(SMART_NOTES_CREDIT_COST.deep)}.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isBusy || smartNoting || contentLength < 30 || shortForSmartNote}
          onClick={handleSmartNote}
          title={
            shortForSmartNote
              ? `Needs ${formatCreditCost(smartNotesCost)} — you have ${remainingCredits} left today`
              : undefined
          }
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-lantern-primary text-white hover:bg-lantern-primary-dark disabled:opacity-50"
        >
          {smartNoting ? <AppIcon name="refresh" size={16} className="animate-spin" /> : <AppIcon name="sparkles" size={16} />}
          Smart Note
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={onChatWithNote}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-border' : 'bg-lantern-surface text-lantern-text hover:bg-lantern-background border border-lantern-border'}`}
        >
          <AppIcon name="chatbubbles" size={16} />
          Chat
        </button>
        <button
          type="button"
          disabled={isBusy || !canGenerateStudyMaterials || shortForOneCredit}
          onClick={onGenerateFlashcards}
          title={
            shortForOneCredit
              ? 'No AI credits left today'
              : canGenerateStudyMaterials
                ? `Costs ${formatCreditCost(AI_CREDIT_COSTS.generate_flashcards)}`
                : `Add at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content`
          }
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-border' : 'bg-lantern-surface text-lantern-text hover:bg-lantern-background border border-lantern-border'}`}
        >
          <AppIcon name="albums" size={16} />
          Flashcards
        </button>
        <button
          type="button"
          disabled={isBusy || !canGenerateStudyMaterials || shortForOneCredit}
          onClick={onGenerateQuiz}
          title={
            shortForOneCredit
              ? 'No AI credits left today'
              : canGenerateStudyMaterials
                ? `Costs ${formatCreditCost(AI_CREDIT_COSTS.generate_questions)}`
                : `Add at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content`
          }
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-lantern-surface-secondary text-lantern-text hover:bg-lantern-border' : 'bg-lantern-surface text-lantern-text hover:bg-lantern-background border border-lantern-border'}`}
        >
          <AppIcon name="help-circle" size={16} />
          Practice test
        </button>
      </div>

      <div className="mt-3">
        <AIUsageInline cost={smartNotesCost} />
      </div>

      {walkableAttachment?.id && narrationOpen && (
        <NarrationPlayer
          isOpen={narrationOpen}
          onClose={() => setNarrationOpen(false)}
          noteId={note.id}
          noteTitle={note.title}
          attachmentId={walkableAttachment.id}
          documentLabel={walkableAttachment.fileName}
          theme={theme}
        />
      )}

      {walkableAttachment?.id && walkthroughOpen && (
        <WalkthroughScreen
          isOpen={walkthroughOpen}
          onClose={() => setWalkthroughOpen(false)}
          noteId={note.id}
          noteTitle={note.title}
          attachmentId={walkableAttachment.id}
          documentLabel={walkableAttachment.fileName}
          theme={theme}
        />
      )}
    </div>
  );
};

export default NoteLearnPanel;
