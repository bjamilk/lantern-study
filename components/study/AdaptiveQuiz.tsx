import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ADAPTIVE_CONFIDENCE_CHOICES,
  ADAPTIVE_PAUSE_AFTER_MISSES,
  advanceAdaptiveQuiz,
  adaptiveDots,
  buildQuestionAsk,
  canConfirmAnswer,
  confirmAdaptiveAnswer,
  currentAdaptiveItem,
  itemsFromUnknownQuestions,
  masteryPercent,
  rateAdaptiveConfidence,
  resolveAdaptiveCorrectAnswer,
  resumeAdaptiveQuiz,
  setAdaptiveDraft,
  startAdaptiveQuiz,
  type AdaptiveConfidence,
  type AdaptiveQuizItem,
  type AdaptiveQuizSession,
} from '@lantern/shared';
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyNote } from '../../types';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { getNoteQuiz, updateNoteQuiz } from '../../services/notes';
import { fetchTestSessionById } from '../../services/supabase';
import { useCompanionStore } from '../../stores/companionStore';

/**
 * Where a half-finished adaptive session lives between page loads.
 *
 * The session was `useState` and nothing else: a reload — a deploy, a crash, a
 * stray ⌘R — threw away a twenty-question attempt, with the mastery it had
 * earned, and dropped the student back on "Write questions". There is no
 * server endpoint that stores an adaptive session, but the note's quiz row
 * already has an `answers` map that PATCH writes verbatim, so the progress
 * rides in it under a reserved key alongside the per-question answers.
 *
 * The key is prefixed so it can never collide with a question id, and the
 * whole blob is discarded rather than half-applied if the note's questions
 * have changed underneath it — resuming into a pool that no longer matches
 * would show the student a question they never saw at a mastery they never
 * earned.
 */
export const ADAPTIVE_PROGRESS_KEY = '__adaptive_progress_v1';

interface AdaptiveProgress {
  v: 1;
  /** The pool this progress was taken against; a mismatch invalidates it. */
  itemIds: string[];
  queue: string[];
  cursor: number;
  phase: AdaptiveQuizSession['phase'];
  draft: string;
  lockedAnswer: string;
  lastGrade: AdaptiveQuizSession['lastGrade'];
  attempts: AdaptiveQuizSession['attempts'];
  consecutiveMisses: number;
}

/**
 * The `answers` map to PATCH for this session.
 *
 * Graded answers are written under their own question ids too, so the row
 * stays readable to anything that already understands a quiz's answers; the
 * reserved key carries the parts a plain answer map cannot express — queue
 * order, cursor, phase and confidence.
 */
export function encodeAdaptiveProgress(
  session: AdaptiveQuizSession
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const attempt of session.attempts) {
    answers[attempt.itemId] = attempt.answer;
  }
  const progress: AdaptiveProgress = {
    v: 1,
    itemIds: session.items.map((item) => item.id),
    queue: session.queue,
    cursor: session.cursor,
    phase: session.phase,
    draft: session.draft,
    lockedAnswer: session.lockedAnswer,
    lastGrade: session.lastGrade,
    attempts: session.attempts,
    consecutiveMisses: session.consecutiveMisses,
  };
  answers[ADAPTIVE_PROGRESS_KEY] = JSON.stringify(progress);
  return answers;
}

/**
 * Rebuild a session from a stored answers map, or null when there is nothing
 * trustworthy to resume.
 *
 * `items` come from the freshly loaded pool rather than from storage, so the
 * stems and options a resumed session shows are always the current ones.
 */
export function decodeAdaptiveProgress(
  answers: Record<string, string> | null | undefined,
  items: AdaptiveQuizItem[]
): AdaptiveQuizSession | null {
  const raw = answers?.[ADAPTIVE_PROGRESS_KEY];
  if (!raw || items.length === 0) return null;

  let parsed: AdaptiveProgress;
  try {
    parsed = JSON.parse(raw) as AdaptiveProgress;
  } catch {
    return null;
  }

  if (!parsed || parsed.v !== 1) return null;
  if (!Array.isArray(parsed.itemIds) || !Array.isArray(parsed.queue)) return null;
  if (!Array.isArray(parsed.attempts)) return null;

  // The pool must be the same pool, in the same order. Regenerated questions
  // mean the stored cursor points at something else entirely.
  const poolIds = items.map((item) => item.id);
  if (parsed.itemIds.length !== poolIds.length) return null;
  if (parsed.itemIds.some((id, index) => id !== poolIds[index])) return null;

  const known = new Set(poolIds);
  if (parsed.queue.length === 0 || parsed.queue.some((id) => !known.has(id))) return null;
  if (parsed.attempts.some((attempt) => !known.has(attempt.itemId))) return null;

  if (typeof parsed.cursor !== 'number' || parsed.cursor < 0) return null;
  if (parsed.cursor >= parsed.queue.length && parsed.phase !== 'done') return null;

  // A finished quiz is not something to resume into; the student gets a fresh
  // one, which is what the "Quiz again" button would have given them anyway.
  if (parsed.phase === 'done') return null;

  return {
    items,
    queue: parsed.queue,
    cursor: parsed.cursor,
    phase: parsed.phase,
    draft: typeof parsed.draft === 'string' ? parsed.draft : '',
    lockedAnswer: typeof parsed.lockedAnswer === 'string' ? parsed.lockedAnswer : '',
    lastGrade: parsed.lastGrade ?? null,
    attempts: parsed.attempts,
    consecutiveMisses:
      typeof parsed.consecutiveMisses === 'number' ? parsed.consecutiveMisses : 0,
  };
}

interface AdaptiveQuizProps {
  courseId: string;
  theme: 'light' | 'dark';
  notes: StudyNote[];
  selectedNoteId?: string | null;
  testIds: string[];
  canWalkthrough: boolean;
  writing?: boolean;
  seedItems?: AdaptiveQuizItem[] | null;
  onWriteQuestions: (noteId: string) => Promise<unknown[]>;
  onOpenNotes: () => void;
  onOpenWalkthrough: () => void;
  preferredTestId?: string | null;
  onComplete?: (result: { mastery: number; sourceNoteId: string | null }) => void;
}

function poolFromUnknown(payload: unknown): AdaptiveQuizItem[] {
  if (Array.isArray(payload)) return itemsFromUnknownQuestions(payload);
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.questions)) return itemsFromUnknownQuestions(record.questions);
  }
  return [];
}

const DOT_CLASS: Record<string, string> = {
  unseen: 'border-lantern-border bg-transparent',
  current: 'border-lantern-feature-tests-ink bg-lantern-feature-tests-ink',
  correct: 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint',
  missed: 'border-lantern-warning bg-lantern-warning/20',
  requeued: 'border-lantern-feature-tests-ink bg-lantern-surface',
};

export const AdaptiveQuiz: React.FC<AdaptiveQuizProps> = ({
  courseId,
  notes,
  selectedNoteId,
  testIds,
  canWalkthrough,
  writing,
  seedItems,
  onWriteQuestions,
  onOpenNotes,
  onOpenWalkthrough,
  preferredTestId,
  onComplete,
}) => {
  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const [session, setSession] = useState<AdaptiveQuizSession | null>(null);
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceNoteId, setSourceNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const completedRef = useRef(false);
  /**
   * The note whose quiz row this session may be written back to.
   *
   * Set ONLY when the questions came from that note's own quiz. A session
   * seeded from a lesson or read out of a test session has no row of its own,
   * and writing its progress into some unrelated note's answers would corrupt
   * that note's quiz — so those sessions stay unpersisted rather than
   * persisted to the wrong place.
   */
  const [persistNoteId, setPersistNoteId] = useState<string | null>(null);

  const noteOrder = useMemo(() => {
    const selected = notes.find((note) => note.id === selectedNoteId);
    return selected ? [selected, ...notes.filter((note) => note.id !== selected.id)] : notes;
  }, [notes, selectedNoteId]);

  const loadExisting = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (seedItems && seedItems.length > 0) {
        setSourceTitle('This lesson');
        setSourceNoteId(noteOrder[0]?.id ?? null);
        setPersistNoteId(null);
        completedRef.current = false;
        setSession(startAdaptiveQuiz(seedItems));
        return;
      }
      for (const note of noteOrder) {
        const quiz = await getNoteQuiz(note.id).catch(() => null);
        const items = poolFromUnknown(quiz);
        if (items.length > 0) {
          setSourceTitle(note.title || 'Untitled note');
          setSourceNoteId(note.id);
          setPersistNoteId(note.id);
          completedRef.current = false;
          // A session left half-finished before a reload resumes at the same
          // question with the mastery it had earned; anything that no longer
          // matches the pool starts clean.
          setSession(decodeAdaptiveProgress(quiz?.answers, items) ?? startAdaptiveQuiz(items));
          return;
        }
      }
      const orderedTests = preferredTestId
        ? [preferredTestId, ...testIds.filter((id) => id !== preferredTestId)]
        : testIds;
      for (const testId of orderedTests) {
        const row = await fetchTestSessionById(testId);
        const items = poolFromUnknown(row?.session?.questions ?? row?.questions);
        if (items.length > 0) {
          const title =
            (row?.session?.config && typeof row.session.config.name === 'string'
              ? row.session.config.name
              : null) || 'This course';
          setSourceTitle(title);
          setSourceNoteId(
            typeof row?.session?.config?.sourceNoteId === 'string'
              ? row.session.config.sourceNoteId
              : noteOrder[0]?.id ?? null
          );
          setPersistNoteId(null);
          completedRef.current = false;
          setSession(startAdaptiveQuiz(items));
          return;
        }
      }
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load a quiz.');
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [noteOrder, preferredTestId, seedItems, testIds]);

  useEffect(() => {
    void loadExisting();
  }, [courseId, loadExisting]);

  const writeFromNote = async (noteId: string) => {
    setError(null);
    try {
      const rows = await onWriteQuestions(noteId);
      const items = poolFromUnknown(rows);
      if (items.length === 0) {
        setError('Could not write questions from that note.');
        return;
      }
      const note = notes.find((row) => row.id === noteId);
      setSourceTitle(note?.title || 'Untitled note');
      setSourceNoteId(noteId);
      setPersistNoteId(noteId);
      completedRef.current = false;
      setSession(startAdaptiveQuiz(items));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write questions.');
    }
  };

  /**
   * Write the session back, best effort.
   *
   * Fire-and-forget on purpose: a failed save must never block the student's
   * next question or raise an error over a quiz that is working. The cost of
   * losing one write is one question's worth of progress, because the next
   * rating writes the whole session again.
   */
  const persistSession = useCallback(
    (next: AdaptiveQuizSession) => {
      if (!persistNoteId) return;
      void updateNoteQuiz(persistNoteId, {
        answers: encodeAdaptiveProgress(next),
        completed: next.phase === 'done',
      }).catch(() => {
        /* the next rating writes it again */
      });
    },
    [persistNoteId]
  );

  useEffect(() => {
    if (!session || session.phase !== 'done' || completedRef.current) return;
    completedRef.current = true;
    onComplete?.({ mastery: masteryPercent(session), sourceNoteId });
  }, [onComplete, session, sourceNoteId]);

  const item = session ? currentAdaptiveItem(session) : null;
  const mastery = session ? masteryPercent(session) : 0;
  const dots = session ? adaptiveDots(session) : [];
  const options =
    item?.kind === 'true_false' ? item.options || ['True', 'False'] : item?.options || [];
  const typed = item?.kind === 'fill_in_blank' || item?.kind === 'short_answer';
  const askReady = Boolean(item?.stem);
  const confirmReady = Boolean(item && canConfirmAnswer(item.kind, session?.draft || ''));

  const askAboutQuestion = async () => {
    if (!item) return;
    if (sourceNoteId) {
      await setActiveNoteContext({ id: sourceNoteId, title: sourceTitle || 'Untitled note' });
    }
    openWithMessage(buildQuestionAsk({ stem: item.stem, explanation: item.explanation, noteTitle: sourceTitle }), {
      questionStem: item.stem,
      noteId: sourceNoteId || undefined,
    });
  };

  const header = item
    ? `Q${session!.items.findIndex((row) => row.id === item.id) + 1} of ${session!.items.length} · mastery ${mastery}%`
    : session?.phase === 'done'
      ? `Mastery ${mastery}%`
      : 'Adaptive quiz';

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface">
      <div className="shrink-0 border-b border-lantern-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-heading font-semibold text-lantern-text">{header}</h2>
            <p className="text-caption text-lantern-text-secondary">
              Confirm, then say how sure you are. This is not a practice test.
            </p>
          </div>
          <button
            type="button"
            disabled={!askReady}
            onClick={() => void askAboutQuestion()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text hover:border-lantern-text-tertiary disabled:opacity-50"
          >
            <AppIcon name="sparkles" size={16} />
            This question
          </button>
        </div>
        {dots.length > 0 ? (
          <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Mastery dots">
            {dots.map((dot) => (
              <li key={dot.itemId}>
                <span
                  className={`block h-2.5 w-2.5 rounded-full border ${DOT_CLASS[dot.state]}`}
                  aria-label={dot.state}
                />
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <p className="text-body text-lantern-text-secondary">Looking for questions in this course…</p>
        ) : null}
        {error ? <p className="text-body text-lantern-warning">{error}</p> : null}

        {!loading && !session ? (
          <div className="space-y-3">
            <p className="text-body text-lantern-text-secondary">
              Start from a note in this course. Existing questions are reused; writing new ones
              uses {formatCreditCost(AI_CREDIT_COSTS.generate_questions)}.
            </p>
            {noteOrder.length === 0 ? (
              <p className="text-body text-lantern-text-secondary">Import or create a note first.</p>
            ) : (
              noteOrder.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  disabled={writing}
                  onClick={() => void writeFromNote(note.id)}
                  className="w-full min-h-[44px] rounded-xl border border-lantern-border px-3 py-2 text-left text-body hover:bg-lantern-background-secondary disabled:opacity-50"
                >
                  Write questions · {note.title || 'Untitled note'}
                </button>
              ))
            )}
          </div>
        ) : null}

        {session && item && session.phase !== 'done' ? (
          <div className="space-y-4">
            {item.topic ? (
              <p className="text-label uppercase text-lantern-text-secondary">{item.topic}</p>
            ) : null}
            <p className="text-body text-lantern-text">{item.stem}</p>

            {session.phase === 'answer' ? (
              typed ? (
                <textarea
                  value={session.draft}
                  onChange={(event) => setSession(setAdaptiveDraft(session, event.target.value))}
                  aria-label={item.kind === 'fill_in_blank' ? 'Fill in the blank' : 'Short answer'}
                  className="min-h-[6rem] w-full rounded-xl border border-lantern-border bg-lantern-background p-3 text-body text-lantern-text"
                />
              ) : (
                <div className="space-y-2" role="radiogroup" aria-label="Answers">
                  {options.map((option) => {
                    const selected = session.draft === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setSession(setAdaptiveDraft(session, option))}
                        className={`w-full min-h-[44px] rounded-xl border px-3 py-2 text-left text-body ${
                          selected
                            ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint text-lantern-text'
                            : 'border-lantern-border bg-lantern-surface text-lantern-text hover:border-lantern-text-tertiary'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              <p className="text-body text-lantern-text-secondary">Your answer: {session.lockedAnswer}</p>
            )}

            {session.phase === 'answer' ? (
              <Button
                disabled={!confirmReady}
                onClick={() => setSession(confirmAdaptiveAnswer(session))}
              >
                Confirm answer
              </Button>
            ) : null}

            {session.phase === 'confidence' ? (
              <div>
                <p className="mb-2 text-label uppercase text-lantern-text-secondary">
                  How sure are you?
                </p>
                <div className="flex flex-wrap gap-2">
                  {ADAPTIVE_CONFIDENCE_CHOICES.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => {
                        const next = rateAdaptiveConfidence(
                          session,
                          choice.id as AdaptiveConfidence
                        );
                        setSession(next);
                        persistSession(next);
                      }}
                      className="min-h-[44px] rounded-full border border-lantern-border bg-lantern-surface px-3 text-body text-lantern-text hover:border-lantern-text-tertiary"
                    >
                      {choice.label}
                      <span className="ml-1 text-caption text-lantern-text-secondary">
                        · {choice.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {session.phase === 'feedback' || session.phase === 'paused' ? (
              <div className="space-y-2 rounded-xl border border-lantern-border bg-lantern-background p-3">
                <p className="text-body font-semibold text-lantern-text">
                  {session.lastGrade?.correct ? 'Right' : 'Not quite'}
                  {session.lastGrade
                    ? ` · confidence ${session.lastGrade.confidence}`
                    : ''}
                </p>
                {!session.lastGrade?.correct ? (
                  <p className="text-body text-lantern-text-secondary">
                    Answer: {resolveAdaptiveCorrectAnswer(item.correctAnswer, item.options)}
                  </p>
                ) : null}
                {item.explanation ? (
                  <p className="text-body text-lantern-text">{item.explanation}</p>
                ) : (
                  <p className="text-caption text-lantern-text-tertiary">
                    No stored explanation — ask about this question.
                  </p>
                )}
              </div>
            ) : null}

            {session.phase === 'feedback' ? (
              <Button
                onClick={() => {
                  const next = advanceAdaptiveQuiz(session);
                  setSession(next);
                  // Advancing off the last question is what makes the quiz
                  // done; without this write the row never records that.
                  persistSession(next);
                }}
              >
                Next
              </Button>
            ) : null}

            {session.phase === 'paused' ? (
              <div className="space-y-3 rounded-xl border border-lantern-border p-3">
                <p className="text-body text-lantern-text">
                  {ADAPTIVE_PAUSE_AFTER_MISSES} misses in a row. Review the notes
                  {canWalkthrough ? ' or walk through the source' : ''}, then come back.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={onOpenNotes}>Back to notes</Button>
                  {canWalkthrough ? (
                    <Button variant="secondary" onClick={onOpenWalkthrough}>
                      Walkthrough
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => setSession(resumeAdaptiveQuiz(session))}>
                    Keep going
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {session?.phase === 'done' ? (
          <div className="space-y-3">
            <p className="text-body text-lantern-text">
              Quiz finished · mastery {mastery}%. Practice tests are still under Test if you want
              exam conditions.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void loadExisting()}>Quiz again</Button>
              <Button variant="secondary" onClick={onOpenNotes}>
                Back to notes
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AdaptiveQuiz;
