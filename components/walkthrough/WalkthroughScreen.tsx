import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';

import { AppIcon } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import Modal from '../ui/Modal';
import VoiceInputButton from '../VoiceInputButton';
import AIUsageInline from '../AIUsageInline';
import { fetchNoteAttachmentPages, type NoteAttachmentPagesResult } from '../../services/apiEndpoints';
import NarrationPlayer from '../narration/NarrationPlayer';
import { aiGenerateQuestions, type AIGeneratedQuestion } from '../../services/ai';
import { useCompanionStore } from '../../stores/companionStore';
import {
  WALKTHROUGH_GROUNDING_LABELS,
  buildPageQuestion,
  checkpointDue,
  checkpointPageIndexes,
  clampPageIndex,
  nextUndonePageIndex,
  pageExcerpt,
  pageGrounding,
  pageHasText,
  pageHeadings,
  pagesUnavailableMessage,
  shouldRetryPages,
  stepPageIndex,
  walkthroughProgress,
  type PageHeading,
} from '../../utils/walkthroughModel';
import {
  EMPTY_RECORD,
  loadWalkthroughRecord,
  saveWalkthroughRecord,
  walkthroughProgressIsPersistent,
} from './walkthroughProgress';

export interface WalkthroughScreenProps {
  isOpen: boolean;
  onClose: () => void;
  noteId: string;
  noteTitle: string;
  attachmentId: string;
  /** File name of the document, used in headings and in the tutor question. */
  documentLabel?: string;
  theme?: 'light' | 'dark';
}

const QUIZ_COST = AI_CREDIT_COSTS.generate_questions;
/** A per-page check is a check, not an exam. */
const QUIZ_QUESTION_COUNT = 4;
/** How long to wait before re-asking for a deck that is still converting. */
const RETRY_DELAY_MS = 6000;

/**
 * Walk me through this document, one page at a time.
 *
 * The unit is the PAGE. Everything on this screen is scoped to the page the
 * student is looking at: the picture, the text, the question they ask the
 * tutor, and the quick check they can generate. That scoping is what makes
 * the honesty claims cheap — the tutor is handed this page and nothing else,
 * so "answering from this page" is a statement about what was sent, and a page
 * with no readable text flips it to general because there was nothing to send.
 *
 * Progression is the student's. Marking a page done is a bookmark, not a gate;
 * the optional check after every N pages is offered and can be dismissed, and
 * nothing here ever refuses to turn the page.
 */
const WalkthroughScreen: React.FC<WalkthroughScreenProps> = ({
  isOpen,
  onClose,
  noteId,
  noteTitle,
  attachmentId,
  documentLabel,
  theme = 'light',
}) => {
  const isDark = theme === 'dark';

  const [result, setResult] = useState<NoteAttachmentPagesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [record, setRecord] = useState(() => ({ ...EMPTY_RECORD }));
  const [pageIndex, setPageIndex] = useState(0);
  const [planOpen, setPlanOpen] = useState(true);

  const [question, setQuestion] = useState('');
  const [checkQuestions, setCheckQuestions] = useState<AIGeneratedQuestion[] | null>(null);
  const [checkLabel, setCheckLabel] = useState('');
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [dismissedCheckpoint, setDismissedCheckpoint] = useState<number | null>(null);
  const [narrationOpen, setNarrationOpen] = useState(false);

  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  /**
   * The companion drawer opens ABOVE this modal (z-70 over z-60), and both
   * layers listen for Escape on `document`. Without this, dismissing the chat
   * would close the walk-through underneath it in the same keypress. `loading`
   * is the Modal's existing "not dismissable right now" switch — it gates
   * Escape and backdrop clicks and renders nothing — so the walk-through waits
   * while the chat is on top. Its own close button is unaffected.
   */
  const companionOpen = useCompanionStore((s) => s.isOpen);

  const persistent = useMemo(() => walkthroughProgressIsPersistent(), []);
  const doneSet = useMemo(() => new Set(record.done), [record.done]);
  const checkedSet = useMemo(() => new Set(record.checked), [record.checked]);

  // Stable identity: without the memo every render hands `pageHeadings` a new
  // empty array and re-derives the whole plan panel for nothing.
  const pages = useMemo(() => result?.pages ?? [], [result]);
  const headings: PageHeading[] = useMemo(() => pageHeadings(pages), [pages]);
  const progress = useMemo(() => walkthroughProgress(headings, doneSet), [headings, doneSet]);

  const currentPage = pages.find((p) => p.pageIndex === pageIndex);
  const currentHeading = headings.find((h) => h.pageIndex === pageIndex);
  const excerpt = useMemo(() => pageExcerpt(pages, pageIndex), [pages, pageIndex]);
  const grounding = pageGrounding(headings, pageIndex);
  const hasText = pageHasText(headings, pageIndex);

  const unavailable = result ? pagesUnavailableMessage(result.reason, result.pageCount) : null;

  // ── Load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !noteId || !attachmentId) return;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // images=1: this screen shows the page, so it is worth waiting for a
        // render. The plan panel alone would not ask for pictures.
        const next = await fetchNoteAttachmentPages(noteId, attachmentId, {
          images: true,
          signal: controller.signal,
        });
        if (cancelled) return;
        setResult(next);
        // Only a deck that is still converting resolves on its own. Every
        // other empty answer is a settled state and re-asking would be a loop.
        if (next.pageCount === 0 && shouldRetryPages(next.reason)) {
          retryTimer = setTimeout(() => void load(), RETRY_DELAY_MS);
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load this document.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isOpen, noteId, attachmentId]);

  // Resume where they left off, clamped onto the document as it is NOW: a
  // re-upload with fewer pages must not open on a page that no longer exists.
  useEffect(() => {
    if (!isOpen) return;
    const stored = loadWalkthroughRecord(attachmentId);
    setRecord(stored);
    setPageIndex(stored.lastPageIndex);
  }, [isOpen, attachmentId]);

  useEffect(() => {
    if (!result) return;
    setPageIndex((current) => clampPageIndex(result.pageCount, current));
  }, [result]);

  const persist = useCallback(
    (next: typeof EMPTY_RECORD) => {
      setRecord(next);
      saveWalkthroughRecord(attachmentId, next);
    },
    [attachmentId]
  );

  const goToPage = useCallback(
    (next: number) => {
      const clamped = clampPageIndex(result?.pageCount ?? 0, next);
      setPageIndex(clamped);
      setCheckError(null);
      persist({ ...record, lastPageIndex: clamped });
    },
    [persist, record, result]
  );

  const toggleDone = useCallback(() => {
    const done = new Set(doneSet);
    if (done.has(pageIndex)) done.delete(pageIndex);
    else done.add(pageIndex);
    persist({ ...record, done: [...done], lastPageIndex: pageIndex });
  }, [doneSet, pageIndex, persist, record]);

  // ── Keyboard paging ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || companionOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      // Never steal arrows from a composer or a select — the student is
      // moving a text cursor, not turning a page.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      goToPage(stepPageIndex(result?.pageCount ?? 0, pageIndex, event.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, companionOpen, goToPage, pageIndex, result]);

  // ── Ask the tutor about THIS page ──────────────────────────────────────
  const askAboutPage = useCallback(async () => {
    const asked = question.trim();
    if (!asked) return;
    setQuestion('');
    // Attach the note first so the reply lands on this note's thread. The page
    // text rides with the question, and the page scope rides with THIS send
    // only: on a note the student owns the server grounds the reply in that
    // one page (or in nothing, on a blank page), instead of the whole note.
    await setActiveNoteContext({ id: noteId, title: noteTitle || 'Untitled note' });
    openWithMessage(
      buildPageQuestion({
        question: asked,
        pageIndex,
        excerpt,
        documentLabel: documentLabel || noteTitle,
      }),
      { attachmentId, pageIndex }
    );
  }, [attachmentId, documentLabel, excerpt, noteId, noteTitle, openWithMessage, pageIndex, question, setActiveNoteContext]);

  // ── Quick check ────────────────────────────────────────────────────────
  const runCheck = useCallback(
    async (indexes: number[], label: string) => {
      const text = indexes
        .map((index) => pageExcerpt(pages, index))
        .filter(Boolean)
        .join('\n\n');
      if (!text) return;
      setCheckBusy(true);
      setCheckError(null);
      setCheckQuestions(null);
      setRevealed(new Set());
      try {
        const { questions } = await aiGenerateQuestions(text, { count: QUIZ_QUESTION_COUNT });
        setCheckQuestions(questions);
        setCheckLabel(label);
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : 'Could not build a check just now.');
      } finally {
        setCheckBusy(false);
      }
    },
    [pages]
  );

  const everyN = record.checkEveryN;
  const showCheckpoint =
    checkpointDue({ headings, pageIndex, everyN, done: doneSet, satisfied: checkedSet }) &&
    dismissedCheckpoint !== pageIndex;
  const checkpointPages = checkpointPageIndexes(headings, pageIndex, everyN);

  const acceptCheckpoint = useCallback(() => {
    persist({ ...record, checked: [...new Set([...record.checked, pageIndex])] });
    void runCheck(
      checkpointPages,
      `Pages ${checkpointPages[0] + 1}–${checkpointPages[checkpointPages.length - 1] + 1}`
    );
  }, [checkpointPages, pageIndex, persist, record, runCheck]);

  const nextUndone = nextUndonePageIndex(headings, doneSet, pageIndex);

  if (!isOpen) return null;

  const panelTone = isDark ? 'bg-lantern-background' : 'bg-lantern-surface';
  const subtleText = isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="walkthrough-title"
      maxWidthClass="max-w-5xl"
      panelClassName="p-0"
      loading={companionOpen || narrationOpen}
    >
      <div className="flex flex-col">
        <header className="flex items-start gap-3 border-b border-lantern-border p-4">
          <FeatureDisc feature="notes" size={32} icon={<AppIcon name="book-open" size={18} />} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 id="walkthrough-title" className="truncate text-heading font-semibold text-lantern-text">
              Walk me through {documentLabel || noteTitle}
            </h2>
            <p className={`text-caption ${subtleText}`}>
              {result && result.pageCount > 0
                ? `Page ${pageIndex + 1} of ${result.pageCount} · ${progress.doneCount} marked done`
                : 'One page at a time'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close walk-through"
            className="rounded-lg p-2 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
          >
            <AppIcon name="close" size={18} />
          </button>
        </header>

        {result && result.pageCount > 0 && (
          <div className="h-1 w-full bg-lantern-border" aria-hidden="true">
            <div
              className="h-1 bg-lantern-feature-notes-ink transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        )}

        <div className="flex flex-col gap-4 p-4 lg:flex-row">
          {/* ── Plan panel ─────────────────────────────────────────────── */}
          <aside className="lg:w-72 lg:shrink-0">
            <button
              type="button"
              onClick={() => setPlanOpen((open) => !open)}
              aria-expanded={planOpen}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-label uppercase tracking-wide text-lantern-text-secondary hover:bg-lantern-background-secondary"
            >
              Plan
              <AppIcon name={planOpen ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>
            {planOpen && (
              <>
                <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                  {headings.map((heading) => {
                    const isCurrent = heading.pageIndex === pageIndex;
                    const isDone = doneSet.has(heading.pageIndex);
                    return (
                      <li key={heading.pageIndex}>
                        <button
                          type="button"
                          onClick={() => goToPage(heading.pageIndex)}
                          aria-current={isCurrent ? 'true' : undefined}
                          className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-caption ${
                            isCurrent
                              ? 'bg-lantern-feature-notes-tint text-lantern-text'
                              : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'
                          }`}
                        >
                          <AppIcon
                            name={isDone ? 'checkmark-circle' : 'ellipse'}
                            size={14}
                            className={`mt-0.5 shrink-0 ${isDone ? 'text-lantern-feature-notes-ink' : 'text-lantern-text-tertiary'}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="mr-1 text-lantern-text-tertiary">{heading.pageIndex + 1}.</span>
                            {/* A guessed title is styled as a guess, not as a
                                heading the document actually has. */}
                            <span className={heading.isDerived ? 'font-medium text-lantern-text' : 'italic'}>
                              {heading.title}
                            </span>
                            {!heading.hasText && (
                              <span className={`ml-1 ${subtleText}`}>· no readable text</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {headings.length > 0 && (
                  <p className={`mt-2 px-2 text-caption ${subtleText}`}>
                    {persistent
                      ? 'Done marks are saved on this device.'
                      : 'This browser cannot save your place, so done marks last until you close this page.'}
                  </p>
                )}
                {result && result.pageCount >= result.maxPages && result.maxPages > 0 && (
                  <p className={`mt-1 px-2 text-caption ${subtleText}`}>
                    Only the first {result.maxPages} pages were read from this file.
                  </p>
                )}
              </>
            )}
          </aside>

          {/* ── Page viewer ────────────────────────────────────────────── */}
          <section className="min-w-0 flex-1 space-y-3">
            {loading && !result && (
              <p className={`text-body ${subtleText}`}>Opening the document…</p>
            )}
            {loadError && (
              <p className="text-body text-lantern-error" role="alert">
                {loadError}
              </p>
            )}
            {result && unavailable && (
              <div className={`rounded-lg border border-lantern-border p-4 ${panelTone}`}>
                <p className="text-body text-lantern-text">{unavailable}</p>
                {shouldRetryPages(result.reason) && (
                  <p className={`mt-1 text-caption ${subtleText}`}>Checking again in a few seconds…</p>
                )}
              </div>
            )}

            {result && !unavailable && (
              <>
                <div className={`rounded-lg border border-lantern-border ${panelTone}`}>
                  <div className="flex items-center justify-between gap-2 border-b border-lantern-border px-3 py-2">
                    <p className="min-w-0 flex-1 truncate text-body font-medium text-lantern-text">
                      {currentHeading?.title || `Page ${pageIndex + 1}`}
                    </p>
                    {/* Read this page aloud. The reader opens ON this page and
                        shares the pages already fetched here, so it costs no
                        second round trip and no second set of signed URLs. */}
                    <button
                      type="button"
                      onClick={() => setNarrationOpen(true)}
                      aria-label="Read this page aloud"
                      title="Read aloud"
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-lantern-border px-2 py-1 text-caption text-lantern-text-secondary hover:text-lantern-text"
                    >
                      <AppIcon name="volume-medium" size={14} />
                      Read aloud
                    </button>
                    <button
                      type="button"
                      onClick={toggleDone}
                      aria-pressed={doneSet.has(pageIndex)}
                      className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-caption ${
                        doneSet.has(pageIndex)
                          ? 'border-lantern-feature-notes-ink text-lantern-feature-notes-ink'
                          : 'border-lantern-border text-lantern-text-secondary hover:text-lantern-text'
                      }`}
                    >
                      <AppIcon name="checkmark-circle" size={14} />
                      {doneSet.has(pageIndex) ? 'Done' : 'Mark done'}
                    </button>
                  </div>

                  <div className="max-h-[46vh] overflow-y-auto p-3">
                    {currentPage?.imageUrl ? (
                      <img
                        src={currentPage.imageUrl}
                        alt={`Page ${pageIndex + 1} of ${documentLabel || noteTitle}`}
                        className="mx-auto w-full max-w-2xl rounded-lg border border-lantern-border"
                      />
                    ) : currentPage?.text?.trim() ? (
                      // No picture was rendered for this page — the text is
                      // the page, not a placeholder for one.
                      <p className="whitespace-pre-wrap text-body text-lantern-text">{currentPage.text}</p>
                    ) : (
                      <p className={`text-body ${subtleText}`}>
                        This page has no readable text, and no picture of it was stored.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-lantern-border px-3 py-2">
                    <button
                      type="button"
                      onClick={() => goToPage(stepPageIndex(result.pageCount, pageIndex, -1))}
                      disabled={pageIndex <= 0}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-caption text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-40"
                    >
                      <AppIcon name="chevron-back" size={14} />
                      Previous
                    </button>
                    <span className={`text-caption ${subtleText}`}>
                      Page {pageIndex + 1} of {result.pageCount} · ← → to page
                    </span>
                    <button
                      type="button"
                      onClick={() => goToPage(stepPageIndex(result.pageCount, pageIndex, 1))}
                      disabled={pageIndex >= result.pageCount - 1}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-caption text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-40"
                    >
                      Next
                      <AppIcon name="chevron-forward" size={14} />
                    </button>
                  </div>
                </div>

                {/* ── Ask about this page ────────────────────────────── */}
                <div className={`rounded-lg border border-lantern-border p-3 ${panelTone}`}>
                  <div className="flex items-center gap-2">
                    <AppIcon
                      name={grounding === 'page' ? 'document-text' : 'information-circle'}
                      size={14}
                      className={grounding === 'page' ? 'text-lantern-feature-ai-ink' : 'text-lantern-text-tertiary'}
                    />
                    <span className={`text-caption ${grounding === 'page' ? 'text-lantern-text' : subtleText}`}>
                      {WALKTHROUGH_GROUNDING_LABELS[grounding]}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <textarea
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void askAboutPage();
                        }
                      }}
                      rows={2}
                      placeholder="Ask about this page…"
                      aria-label="Ask about this page"
                      className="min-w-0 flex-1 resize-none rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
                    />
                    {/* Speaking the question is free on web: the browser's own
                        recogniser transcribes it, so no AI use is spent. */}
                    <VoiceInputButton
                      onTranscriptUpdate={(transcript) =>
                        setQuestion((prev) => (prev ? `${prev} ${transcript}` : transcript))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void askAboutPage()}
                      disabled={!question.trim()}
                      className="shrink-0 rounded-lg bg-lantern-primary-fill px-3 py-2 text-body font-medium text-white disabled:opacity-50"
                    >
                      Ask
                    </button>
                  </div>
                  <p className={`mt-1 text-caption ${subtleText}`}>
                    Speaking your question is free. The answer opens in the Lantern chat.
                  </p>
                </div>

                {/* ── Check ─────────────────────────────────────────────── */}
                {showCheckpoint && (
                  <div className="rounded-lg border border-lantern-feature-tests-ink/40 bg-lantern-feature-tests-tint p-3">
                    <p className="text-body text-lantern-text">
                      You have read {everyN} pages. Want a quick check on{' '}
                      {checkpointPages.length === 1
                        ? `page ${checkpointPages[0] + 1}`
                        : `pages ${checkpointPages[0] + 1}–${checkpointPages[checkpointPages.length - 1] + 1}`}
                      ?
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={acceptCheckpoint}
                        disabled={checkBusy}
                        className="rounded-lg bg-lantern-primary-fill px-3 py-1.5 text-body font-medium text-white disabled:opacity-50"
                      >
                        Check me · {formatCreditCost(QUIZ_COST)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDismissedCheckpoint(pageIndex)}
                        className="rounded-lg px-3 py-1.5 text-body text-lantern-text-secondary hover:text-lantern-text"
                      >
                        Keep reading
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runCheck([pageIndex], `Page ${pageIndex + 1}`)}
                    disabled={!hasText || checkBusy}
                    title={
                      hasText
                        ? `Costs ${formatCreditCost(QUIZ_COST)}`
                        : 'This page has no readable text to quiz on'
                    }
                    className="flex items-center gap-2 rounded-lg border border-lantern-border px-3 py-2 text-body font-medium text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-50"
                  >
                    <AppIcon name="help-circle" size={16} className="text-lantern-feature-tests-ink" />
                    {checkBusy ? 'Building a check…' : `Quiz me on this page · ${formatCreditCost(QUIZ_COST)}`}
                  </button>
                  {nextUndone !== null && nextUndone !== pageIndex && (
                    <button
                      type="button"
                      onClick={() => goToPage(nextUndone)}
                      className="rounded-lg px-3 py-2 text-body text-lantern-text-secondary hover:text-lantern-text"
                    >
                      Next unread page ({nextUndone + 1})
                    </button>
                  )}
                  {progress.allDone && (
                    <span className={`text-caption ${subtleText}`}>Every page is marked done.</span>
                  )}
                </div>

                <AIUsageInline cost={QUIZ_COST} />

                {checkError && (
                  <p className="text-body text-lantern-error" role="alert">
                    {checkError}
                  </p>
                )}

                {checkQuestions && checkQuestions.length > 0 && (
                  <div className={`space-y-3 rounded-lg border border-lantern-border p-3 ${panelTone}`}>
                    <p className="text-body font-medium text-lantern-text">Quick check · {checkLabel}</p>
                    {checkQuestions.map((item, index) => (
                      <div key={`${index}-${item.text.slice(0, 24)}`} className="space-y-1">
                        <p className="text-body text-lantern-text">
                          {index + 1}. {item.text}
                        </p>
                        {item.options && item.options.length > 0 && (
                          <ul className={`ml-4 list-disc text-caption ${subtleText}`}>
                            {item.options.map((option) => (
                              <li key={option}>{option}</li>
                            ))}
                          </ul>
                        )}
                        {revealed.has(index) ? (
                          <p className="text-caption text-lantern-text">
                            <span className="font-medium">Answer:</span> {item.correctAnswer}
                            {item.explanation ? ` — ${item.explanation}` : ''}
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRevealed((prev) => new Set(prev).add(index))}
                            className="text-caption font-medium text-lantern-primary"
                          >
                            Show answer
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {checkQuestions && checkQuestions.length === 0 && (
                  <p className={`text-body ${subtleText}`}>
                    There was not enough on {checkLabel.toLowerCase()} to build a check.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
      {narrationOpen && (
        <NarrationPlayer
          isOpen={narrationOpen}
          onClose={() => setNarrationOpen(false)}
          noteId={noteId}
          noteTitle={noteTitle}
          attachmentId={attachmentId}
          documentLabel={documentLabel}
          initialPageIndex={pageIndex}
          pageCountHint={result?.pageCount}
          theme={theme}
        />
      )}
    </Modal>
  );
};

export default WalkthroughScreen;
