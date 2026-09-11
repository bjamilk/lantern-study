import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendEssayAttempt,
  composeEssayNoteBody,
  currentEssayAttempt,
  essayAttemptLabel,
  essayDraftTooThin,
  essayFromMaterial,
  essaySourceNotes,
  essayStudioPriceLine,
  getNoteStudyContent,
  isEssayGraderMissing,
  isEssayNote,
  newEssayNoteTitle,
  parseEssayNoteBody,
  selectEssayAttempt,
  startEssaySession,
  studySetNotePayload,
  type EssaySession,
} from '@lantern/shared';
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyNote } from '../../types';
import { Button, Textarea } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { useNotesStore } from '../../stores/notesStore';
import { useToastStore } from '../../stores/toastStore';
import { aiGradeEssay } from '../../services/ai';

interface EssayStudioProps {
  courseId: string;
  studySetId?: string;
  notes: StudyNote[];
  selectedNote: StudyNote | null;
  onNoteReady: (noteId: string) => Promise<void>;
  onImportPhoto?: () => void;
}

export function EssayStudio({
  courseId,
  studySetId,
  notes,
  selectedNote,
  onNoteReady,
  onImportPhoto,
}: EssayStudioProps) {
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const showToast = useToastStore((s) => s.showToast);

  const essays = useMemo(() => notes.filter(isEssayNote), [notes]);
  const sources = useMemo(() => essaySourceNotes(notes), [notes]);
  const resumed = selectedNote && isEssayNote(selectedNote) ? parseEssayNoteBody(selectedNote.body) : null;

  const [session, setSession] = useState<EssaySession | null>(resumed);
  const [essayNoteId, setEssayNoteId] = useState<string | null>(
    resumed && selectedNote ? selectedNote.id : null
  );
  const [sourceId, setSourceId] = useState(sources[0]?.id || '');
  const [grading, setGrading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const essayNoteIdRef = useRef(essayNoteId);
  essayNoteIdRef.current = essayNoteId;

  const resumeBody = selectedNote && isEssayNote(selectedNote) ? selectedNote.body : '';
  useEffect(() => {
    if (sourceId && sources.some((note) => note.id === sourceId)) return;
    setSourceId(sources[0]?.id || '');
  }, [sourceId, sources]);
  useEffect(() => {
    if (!selectedNote || !isEssayNote(selectedNote)) return;
    const parsed = parseEssayNoteBody(selectedNote.body);
    if (!parsed) return;
    setSession(parsed);
    setEssayNoteId(selectedNote.id);
  }, [selectedNote?.id, resumeBody]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const persist = useCallback(
    (next: EssaySession, noteId: string | null) => {
      if (!noteId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveNote(noteId, { body: composeEssayNoteBody(next) }).catch(() => undefined);
      }, 600);
    },
    [saveNote]
  );

  const updateSession = useCallback(
    (recipe: (current: EssaySession) => EssaySession) => {
      setSession((current) => {
        const base = current ?? startEssaySession({});
        const next = recipe(base);
        persist(next, essayNoteIdRef.current);
        return next;
      });
    },
    [persist]
  );

  const loadFromNote = (note: StudyNote) => {
    const text = getNoteStudyContent(note);
    updateSession((current) => ({
      ...current,
      sourceNoteId: note.id,
      sourceTitle: note.title || 'Untitled note',
      draft: text,
    }));
  };

  const loadFromFile = async (file: File) => {
    if (file.type.startsWith('image/')) {
      showToast('Import the photo as a note in this course, then load it here.', 'info');
      return;
    }
    const text = await file.text();
    updateSession((current) => ({
      ...current,
      sourceTitle: file.name.replace(/\.[^.]+$/, '') || 'Draft',
      draft: text,
    }));
  };

  const grade = async () => {
    const current = session ?? startEssaySession({});
    if (essayDraftTooThin(current.draft)) {
      showToast('Paste at least a short paragraph first.', 'info');
      return;
    }
    setGrading(true);
    try {
      const source = sources.find((note) => note.id === sourceId);
      const sourceNotes = source ? getNoteStudyContent(source) : '';
      let review: { overall: number; scores: EssaySession['attempts'][number]['scores']; feedback: string };
      try {
        const generated = await aiGradeEssay(current.draft, {
          rubricText: current.rubricText || undefined,
          prompt: current.prompt || undefined,
          sourceNotes: sourceNotes || undefined,
          sourceTitle: current.sourceTitle,
        });
        review = {
          overall: generated.overall,
          scores: generated.scores,
          feedback: generated.feedback,
        };
      } catch (error) {
        if (!isEssayGraderMissing(error)) throw error;
        const local = essayFromMaterial({
          draft: current.draft,
          rubricText: current.rubricText,
          prompt: current.prompt,
          sourceTitle: current.sourceTitle,
        });
        review = { overall: local.overall, scores: local.scores, feedback: local.feedback };
      }
      const next = appendEssayAttempt(current, review);
      let noteId = essayNoteId;
      if (!noteId) {
        const created = await createNote({
          title: newEssayNoteTitle(current.sourceTitle),
          body: composeEssayNoteBody(next),
          ...studySetNotePayload({ courseId, studySetId }),
        });
        noteId = created.id;
        setEssayNoteId(created.id);
        await onNoteReady(created.id);
      } else {
        persist(next, noteId);
      }
      setSession(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not grade the draft.', 'error');
    } finally {
      setGrading(false);
    }
  };

  const open = session ?? startEssaySession({});
  const attempt = currentEssayAttempt(open);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4">
      <div>
        <h2 className="text-heading">Essay</h2>
        <p className="text-body text-lantern-text-secondary mt-1">{essayStudioPriceLine()}</p>
      </div>
      {essays.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-label uppercase text-lantern-text-secondary">History</h3>
          {essays.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => void onNoteReady(note.id)}
              className={`w-full text-left rounded-xl border px-3 py-2 min-h-[44px] ${
                essayNoteId === note.id
                  ? `${FEATURE_TINT_BG.tests} ${FEATURE_INK_TEXT.tests} border-transparent`
                  : 'border-lantern-border hover:bg-lantern-background-secondary'
              }`}
            >
              <span className="text-body font-semibold">{note.title || 'Essay'}</span>
            </button>
          ))}
        </div>
      ) : null}
      <label className="block text-caption text-lantern-text-secondary" htmlFor="essay-prompt">
        Assignment prompt (optional)
      </label>
      <Textarea
        id="essay-prompt"
        value={open.prompt}
        onChange={(event) => updateSession((current) => ({ ...current, prompt: event.target.value }))}
        rows={2}
        className="text-body"
      />
      <label className="block text-caption text-lantern-text-secondary" htmlFor="essay-draft">
        Draft
      </label>
      <Textarea
        id="essay-draft"
        value={open.draft}
        onChange={(event) => updateSession((current) => ({ ...current, draft: event.target.value }))}
        rows={8}
        className="text-body"
        placeholder="Paste the assignment here, or load a note."
      />
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex min-h-[44px] items-center rounded-full border border-lantern-border px-3 text-caption font-medium cursor-pointer">
          Upload a text file
          <input
            type="file"
            accept=".txt,.md,text/plain,image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void loadFromFile(file);
            }}
          />
        </label>
        {sources.length > 0 ? (
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 text-body"
            aria-label="Load draft from a note"
          >
            {sources.map((note) => (
              <option key={note.id} value={note.id}>
                {note.title || 'Untitled note'}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-caption text-lantern-text-secondary">
            Import a photo as a note to load camera text. Paste still works without one.
          </p>
        )}
        {sourceId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const note = sources.find((row) => row.id === sourceId);
              if (note) loadFromNote(note);
            }}
          >
            Load from note
          </Button>
        ) : null}
        {onImportPhoto ? (
          <Button size="sm" variant="secondary" onClick={onImportPhoto}>
            Import a photo
          </Button>
        ) : null}
      </div>
      <label className="block text-caption text-lantern-text-secondary" htmlFor="essay-rubric">
        Rubric (optional, one criterion per line)
      </label>
      <Textarea
        id="essay-rubric"
        value={open.rubricText}
        onChange={(event) => updateSession((current) => ({ ...current, rubricText: event.target.value }))}
        rows={4}
        className="text-body"
        placeholder="- Definition&#10;- Treatment&#10;- Signs"
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={grading} onClick={() => void grade()}>
          {grading
            ? 'Grading…'
            : attempt
              ? `Regrade · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`
              : `Grade · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
        </Button>
        {attempt ? (
          <Button
            variant="secondary"
            onClick={() =>
              updateSession((current) => ({
                ...current,
                draft: '',
                currentIndex: current.attempts.length - 1,
              }))
            }
          >
            New draft
          </Button>
        ) : null}
      </div>
      {attempt ? (
        <section className="space-y-3 rounded-xl border border-lantern-border p-3">
          <p className="text-label uppercase text-lantern-text-secondary">Practice score</p>
          <p className={`text-title ${FEATURE_INK_TEXT.tests}`}>{attempt.overall} / 100</p>
          <p className="text-caption text-lantern-text-secondary">Practice feedback, not an official grade.</p>
          <ul className="space-y-2">
            {attempt.scores.map((row) => (
              <li key={row.criterionId} className="text-body">
                <span className="font-semibold">
                  {row.label} · {row.score}/{row.max}
                </span>
                {row.comment ? (
                  <span className="text-caption text-lantern-text-secondary block">{row.comment}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-body">{attempt.feedback}</p>
          {open.attempts.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {open.attempts.map((row, index) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => updateSession((current) => selectEssayAttempt(current, index))}
                  aria-pressed={index === open.currentIndex}
                  className={`min-h-[44px] rounded-full border px-3 text-caption font-medium ${
                    index === open.currentIndex
                      ? `${FEATURE_TINT_BG.tests} ${FEATURE_INK_TEXT.tests} border-transparent`
                      : 'border-lantern-border text-lantern-text-secondary'
                  }`}
                >
                  {essayAttemptLabel(row, index)}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
