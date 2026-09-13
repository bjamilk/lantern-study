import React, { useState } from 'react';
import { AppIcon } from './ui/AppIcon';
import { FeatureDisc } from './ui/FeatureDisc';
import WalkthroughScreen from './walkthrough/WalkthroughScreen';
import NarrationPlayer from './narration/NarrationPlayer';

type WalkableAttachment = {
  id?: string;
  type?: string;
  fileName?: string;
};

const WALKABLE_ATTACHMENT_TYPES = new Set(['pdf', 'presentation']);

export function walkableNoteAttachment(
  attachments: WalkableAttachment[] | undefined
): WalkableAttachment | undefined {
  return (attachments || []).find(
    (attachment) => attachment.id && WALKABLE_ATTACHMENT_TYPES.has(String(attachment.type))
  );
}

interface NoteDocumentActionsProps {
  noteId: string;
  noteTitle: string;
  attachments?: WalkableAttachment[];
  theme: 'light' | 'dark';
}

/** Walk / Read for an uploaded PDF or deck. Hidden when the note has no pages. */
export function NoteDocumentActions({
  noteId,
  noteTitle,
  attachments,
  theme,
}: NoteDocumentActionsProps) {
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [narrationOpen, setNarrationOpen] = useState(false);
  const walkableAttachment = walkableNoteAttachment(attachments);
  const isDark = theme === 'dark';

  if (!walkableAttachment?.id) return null;

  const tileClass = `flex w-full items-center gap-3 rounded-lg border p-3 text-left ${
    isDark
      ? 'border-lantern-border bg-lantern-background hover:bg-lantern-surface-secondary'
      : 'border-lantern-border bg-lantern-surface hover:bg-lantern-background'
  }`;

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setWalkthroughOpen(true)} className={tileClass}>
        <FeatureDisc feature="notes" size={32} icon={<AppIcon name="book-open" size={18} />} />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-lantern-text">Walk me through it</span>
          <span className={`block truncate text-caption ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
            {walkableAttachment.fileName || 'This document'} — one page at a time
          </span>
        </span>
        <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
      </button>
      <button type="button" onClick={() => setNarrationOpen(true)} className={tileClass}>
        <FeatureDisc feature="notes" size={32} icon={<AppIcon name="volume-medium" size={18} />} />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-lantern-text">Read it to me</span>
          <span className={`block truncate text-caption ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
            Your device reads the pages aloud — nothing to download
          </span>
        </span>
        <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
      </button>
      {narrationOpen && (
        <NarrationPlayer
          isOpen={narrationOpen}
          onClose={() => setNarrationOpen(false)}
          noteId={noteId}
          noteTitle={noteTitle}
          attachmentId={walkableAttachment.id}
          documentLabel={walkableAttachment.fileName}
          theme={theme}
        />
      )}
      {walkthroughOpen && (
        <WalkthroughScreen
          isOpen={walkthroughOpen}
          onClose={() => setWalkthroughOpen(false)}
          noteId={noteId}
          noteTitle={noteTitle}
          attachmentId={walkableAttachment.id}
          documentLabel={walkableAttachment.fileName}
          theme={theme}
        />
      )}
    </div>
  );
}

export default NoteDocumentActions;
