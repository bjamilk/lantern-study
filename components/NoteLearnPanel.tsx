import React, { useState } from 'react';
import { MarkdownRenderer } from '@lantern/shared';
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
  theme: 'light' | 'dark';
}

const NoteLearnPanel: React.FC<NoteLearnPanelProps> = ({
  note,
  theme,
}) => {
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [narrationOpen, setNarrationOpen] = useState(false);

  // The first uploaded document on the note is the one a walk-through walks.
  // A note with only photos, audio or a video link has no pages, so the door
  // is not shown at all rather than opening onto "unsupported".
  const walkableAttachment = (note.attachments || []).find(
    (attachment) => attachment.id && WALKABLE_ATTACHMENT_TYPES.has(String(attachment.type))
  );

  const isDark = theme === 'dark';

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

      <div className="mt-3">
        <AIUsageInline />
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
