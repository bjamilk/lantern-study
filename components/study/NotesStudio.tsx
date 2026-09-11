import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NOTES_STUDIO_DEPTHS,
  buildFigureQuestion,
  buildSpanQuestion,
  canAskAboutHighlight,
  hasEnoughNoteStudyContent,
  highlightFromRange,
  isLectureNote,
  isWalkableAttachment,
  latestLectureTranscript,
  splitLectureNoteBody,
  type TurnIntoTargetId,
} from '@lantern/shared';
import type { SmartNotesDepth, SmartNotesRequestOptions } from '@lantern/shared/utils/smartNotes';
import {
  SMART_NOTES_CREDIT_COST,
  formatCreditCost,
  getSmartNotesCreditCost,
} from '@lantern/shared/utils/aiCredits';
import type { NoteAttachment, StudyNote } from '../../types';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import NotePdfViewer from '../NotePdfViewer';
import NoteImageGallery from '../NoteImageGallery';
import { TurnIntoMenu } from './TurnIntoMenu';
import { fetchNoteAttachmentPages } from '../../services/apiEndpoints';
import { useNotesStore } from '../../stores/notesStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useToastStore } from '../../stores/toastStore';
import { buildPageQuestion } from '../../utils/walkthroughModel';

interface NotesStudioProps {
  note: StudyNote;
  theme: 'light' | 'dark';
  turning?: boolean;
  sourceAttachment?: NoteAttachment | null;
  onTurnInto: (target: TurnIntoTargetId) => void;
  onSmartNote: (
    editorState: { title?: string; body?: string },
    options?: SmartNotesRequestOptions
  ) => Promise<unknown>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printNote(title: string, body: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><title>${escapeHtml(title || 'Note')}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:20px}pre{white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5}</style>
</head><body><h1>${escapeHtml(title || 'Untitled note')}</h1><pre>${escapeHtml(body || '')}</pre></body></html>`
  );
  doc.close();
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  window.setTimeout(() => iframe.remove(), 1200);
}

/**
 * Split notes studio for the course workspace canvas: source on the left,
 * structured notes on the right, Depth / Turn into / Print on the toolbar.
 */
export const NotesStudio: React.FC<NotesStudioProps> = ({
  note,
  theme,
  turning,
  sourceAttachment,
  onTurnInto,
  onSmartNote,
}) => {
  const saveNote = useNotesStore((s) => s.saveNote);
  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const showToast = useToastStore((s) => s.showToast);

  const [title, setTitle] = useState(note.title || '');
  const [body, setBody] = useState(note.body || '');
  const [depth, setDepth] = useState<SmartNotesDepth>('standard');
  const [highlight, setHighlight] = useState('');
  const [writing, setWriting] = useState(false);
  const [pages, setPages] = useState<Array<{ pageIndex: number; text: string; imageUrl?: string }>>(
    []
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  titleRef.current = title;
  bodyRef.current = body;

  useEffect(() => {
    setTitle(note.title || '');
    setBody(note.body || '');
    setHighlight('');
  }, [note.id, note.title, note.body]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveNote(note.id, { title: titleRef.current, body: bodyRef.current }).catch(() => undefined);
    }, 700);
  }, [note.id, saveNote]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const walkable =
    (sourceAttachment && isWalkableAttachment(sourceAttachment) ? sourceAttachment : null) ||
    note.attachments?.find(isWalkableAttachment);
  const documentAttachment =
    walkable && (walkable.type === 'pdf' || walkable.type === 'presentation')
      ? walkable
      : note.attachments?.find(
          (attachment) => attachment.type === 'pdf' || attachment.type === 'presentation'
        );
  const imageAttachments = (note.attachments || []).filter((attachment) => attachment.type === 'image');
  const hasSource = Boolean(documentAttachment || imageAttachments.length > 0);
  const lectureTranscript =
    splitLectureNoteBody(note.body || '').transcript || latestLectureTranscript(note.attachments);
  const showLectureTranscript =
    isLectureNote(note) &&
    Boolean(lectureTranscript) &&
    !splitLectureNoteBody(body).transcript &&
    !body.includes(lectureTranscript);

  useEffect(() => {
    if (!walkable?.id) {
      setPages([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      fetchNoteAttachmentPages(note.id, walkable.id, { images: true })
        .then((result) => {
          if (cancelled) return;
          setPages(Array.isArray(result.pages) ? result.pages : []);
        })
        .catch(() => {
          if (!cancelled) setPages([]);
        });
    void load();
    // First read may still be rendering page pictures; one follow-up picks them up.
    const retry = window.setTimeout(() => {
      void load();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, [note.id, walkable?.id]);

  const figuredPages = useMemo(
    () => pages.filter((page) => Boolean(page.imageUrl)),
    [pages]
  );

  const readHighlight = useCallback(() => {
    const el = notesRef.current;
    if (el && el.selectionEnd > el.selectionStart) {
      return highlightFromRange(el.value, el.selectionStart, el.selectionEnd);
    }
    return highlight;
  }, [highlight]);

  const askAboutSpan = useCallback(async () => {
    const excerpt = readHighlight();
    if (!canAskAboutHighlight(excerpt)) return;
    await setActiveNoteContext({ id: note.id, title: title || 'Untitled note' });
    openWithMessage(
      buildSpanQuestion({
        excerpt,
        noteTitle: title || note.title,
      }),
      { selectedSpan: excerpt.trim(), noteId: note.id }
    );
  }, [note.id, note.title, openWithMessage, readHighlight, setActiveNoteContext, title]);

  const askAboutFigure = useCallback(
    async (attachment: NoteAttachment) => {
      await setActiveNoteContext({ id: note.id, title: title || 'Untitled note' });
      openWithMessage(
        buildFigureQuestion({
          label: attachment.fileName || 'Photo',
          excerpt: attachment.extractedText || undefined,
        }),
        { noteId: note.id }
      );
    },
    [note.id, openWithMessage, setActiveNoteContext, title]
  );

  const askAboutPageFigure = useCallback(
    async (pageIndex: number) => {
      if (!walkable?.id) return;
      const page = pages.find((row) => row.pageIndex === pageIndex);
      await setActiveNoteContext({ id: note.id, title: title || 'Untitled note' });
      openWithMessage(
        buildPageQuestion({
          question: 'What does this figure show?',
          pageIndex,
          excerpt: page?.text || '',
          documentLabel: walkable.fileName || title || note.title,
        }),
        { attachmentId: walkable.id, pageIndex }
      );
    },
    [note.id, note.title, openWithMessage, pages, setActiveNoteContext, title, walkable]
  );

  const writeNotes = useCallback(async () => {
    const snapshot = { title: titleRef.current, body: bodyRef.current };
    if (!hasEnoughNoteStudyContent({ ...note, ...snapshot })) {
      showToast('Add or import more study content before writing notes.', 'info');
      return;
    }
    setWriting(true);
    try {
      await onSmartNote(snapshot, { depth });
      showToast('Smart Notes saved on this note.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not write notes.', 'error');
    } finally {
      setWriting(false);
    }
  }, [depth, note, onSmartNote, showToast]);

  const onBodySelect = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    setHighlight(highlightFromRange(el.value, el.selectionStart, el.selectionEnd));
  };

  useEffect(() => {
    const onSelectionChange = () => {
      const el = notesRef.current;
      if (!el || document.activeElement !== el) return;
      setHighlight(highlightFromRange(el.value, el.selectionStart, el.selectionEnd));
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const askReady = canAskAboutHighlight(highlight);
  const writeCost = formatCreditCost(getSmartNotesCreditCost(depth));

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface">
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-lantern-border px-3 py-2">
        <span className="text-label uppercase text-lantern-text-secondary">Depth</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Notes depth">
          {NOTES_STUDIO_DEPTHS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={depth === option.id}
              onClick={() => setDepth(option.id)}
              className={`min-h-[44px] rounded-full border px-3 text-body ${
                depth === option.id
                  ? 'border-lantern-primary bg-lantern-primary text-white'
                  : 'border-lantern-border bg-lantern-surface text-lantern-text hover:border-lantern-text-tertiary'
              }`}
            >
              {option.label}
              <span className="ml-1 text-caption font-normal opacity-80">
                · {formatCreditCost(SMART_NOTES_CREDIT_COST[option.id])}
              </span>
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => void writeNotes()} loading={writing} disabled={writing}>
          Write notes · {writeCost}
        </Button>
        <TurnIntoMenu disabled={turning} onSelect={onTurnInto} />
        <button
          type="button"
          onClick={() => printNote(title, body)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text hover:border-lantern-text-tertiary"
        >
          <AppIcon name="share" size={16} />
          Print
        </button>
        <button
          type="button"
          disabled={!askReady}
          onClick={() => void askAboutSpan()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text hover:border-lantern-text-tertiary disabled:opacity-50"
        >
          Ask about selection
        </button>
      </div>

      <div className={`flex-1 min-h-0 grid ${hasSource ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
        {hasSource ? (
          <div className="min-h-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-lantern-border p-3 space-y-3">
            <h2 className="text-label uppercase text-lantern-text-secondary">Source</h2>
            {documentAttachment ? (
              <NotePdfViewer noteId={note.id} attachment={documentAttachment} theme={theme} />
            ) : null}
            {imageAttachments.length > 0 ? (
              <NoteImageGallery
                noteId={note.id}
                attachments={imageAttachments}
                theme={theme}
                onAskAboutFigure={(attachment) => void askAboutFigure(attachment)}
              />
            ) : null}
            {figuredPages.length > 0 ? (
              <div>
                <h3 className="text-label uppercase text-lantern-text-secondary mb-2">Figures</h3>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {figuredPages.map((page) => (
                    <button
                      key={page.pageIndex}
                      type="button"
                      onClick={() => void askAboutPageFigure(page.pageIndex)}
                      className="shrink-0 w-28 text-left"
                      aria-label={`Ask about the figure on page ${page.pageIndex + 1}`}
                    >
                      <img
                        src={page.imageUrl}
                        alt={`Page ${page.pageIndex + 1}`}
                        className="h-36 w-28 rounded-lg border border-lantern-border object-cover bg-lantern-background"
                      />
                      <span className="mt-1 block text-caption text-lantern-text-secondary">
                        Page {page.pageIndex + 1} · Ask
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex flex-col p-3">
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              scheduleSave();
            }}
            aria-label="Note title"
            className="mb-2 w-full bg-transparent text-heading font-semibold text-lantern-text outline-none"
          />
          <textarea
            ref={notesRef}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              scheduleSave();
            }}
            onSelect={onBodySelect}
            onKeyUp={onBodySelect}
            onMouseUp={onBodySelect}
            aria-label="Structured notes"
            placeholder="Your notes sit here. Highlight a sentence and Ask, or write notes from the source."
            className="flex-1 min-h-[12rem] w-full resize-none rounded-xl border border-lantern-border bg-lantern-background p-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
          />
          {showLectureTranscript ? (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-lantern-border bg-lantern-background p-3">
              <h2 className="text-label uppercase text-lantern-text-secondary mb-2">Transcript</h2>
              <p className="text-body whitespace-pre-wrap">{lectureTranscript}</p>
            </div>
          ) : null}
          {askReady ? (
            <p className="mt-2 text-caption text-lantern-text-secondary">
              Highlighted {highlight.trim().length} characters — Ask cites that span.
            </p>
          ) : (
            <p className="mt-2 text-caption text-lantern-text-tertiary">
              Highlight a sentence in the notes to ask Lantern about it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotesStudio;
