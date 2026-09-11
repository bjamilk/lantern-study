import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AppIcon } from './ui/AppIcon';
import { formatMaxNoteUploadLabel } from '@lantern/shared/utils/noteUpload';
import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import { HANDWRITING_OCR_OFF_MESSAGE } from '@lantern/shared/utils/handwritingOcr';
import { Button } from './ui';
import Modal from './ui/Modal';
import * as notesApi from '../services/notes';
import { fetchAiHealth } from '../services/supabase';
import { useUIStore } from '../stores/uiStore';
import { useNotesStore } from '../stores/notesStore';
import {
  useStudyGenerators,
  type ImportAndStudyResult,
  type StudyGeneratorStage,
} from '../hooks/useStudyGenerators';
import { runAiJob } from '../stores/aiJobRunner';
import { useAiJobUserId } from '../hooks/useAiJobs';
import { SMART_NOTES_CREDIT_COST, AI_CREDIT_COSTS } from '@lantern/shared/utils/aiCredits';
import type { NoteAttachment, StudyNote } from '../types';

export type { ImportAndStudyResult } from '../hooks/useStudyGenerators';

interface ImportAndStudyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: ImportAndStudyResult) => void;
  onOpenNote: (noteId: string) => void;
  onTurnIntoStudyProduct?: (result: ImportAndStudyResult) => void;
  /** File the imported note under this course (course workspace Import). */
  courseId?: string | null;
  /** File the imported note into a study set. Course remains optional. */
  studySetId?: string | null;
  /** Focus the matching file control when a set-home chip opened this modal. */
  source?: 'pdf' | 'ppt' | 'audio' | 'video' | 'youtube' | 'paste' | null;
}

type Step = 'input' | 'processing' | 'done';

export const ImportAndStudyModal: React.FC<ImportAndStudyModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  onOpenNote,
  onTurnIntoStudyProduct,
  courseId,
  studySetId,
  source = null,
}) => {
  const [step, setStep] = useState<Step>('input');
  const [textContent, setTextContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAndStudyResult | null>(null);
  const [generateCards, setGenerateCards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);
  const [handwritingOcrOff, setHandwritingOcrOff] = useState(false);
  const setImportProgress = useUIStore((s) => s.setImportProgress);
  const loadNote = useNotesStore((s) => s.loadNote);
  const aiUserId = useAiJobUserId();
  /**
   * Set when the student sends a run to the background. The job still
   * completes and still calls onComplete — we just stop steering this modal,
   * so reopening it does not drop them on a stale "done" screen.
   */
  const backgroundedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    // A fresh open is steerable again, whatever the last run did.
    backgroundedRef.current = false;
    void fetchAiHealth()
      .then((h) => setHandwritingOcrOff(h.handwritingOcr === 'off' || h.gemini === 'off'))
      .catch(() => setHandwritingOcrOff(false));
  }, [isOpen]);

  const reset = () => {
    setStep('input');
    setTextContent('');
    setError(null);
    setResult(null);
  };

  const handleClose = () => {
    if (step === 'processing') backgroundedRef.current = true;
    reset();
    onClose();
  };

  const { runStudyGenerators: runGenerators } = useStudyGenerators({ generateCards, generateQuiz });

  /**
   * Runs the generator pipeline as a tracked AI job.
   *
   * The work is handed to the module-level runner rather than awaited by this
   * component, so closing the modal (or navigating away entirely) no longer
   * throws away a generation the student has already paid credits for — the
   * progress panel picks it up and the result still lands.
   */
  const runStudyGenerators = useCallback(
    async (note: StudyNote & { attachments?: NoteAttachment[] }) => {
      if (!aiUserId) {
        // Signed out: fall back to the plain path rather than filing a job
        // against nobody, which no panel would ever show.
        const res = await runGenerators(note);
        setResult(res);
        setStep('done');
        onComplete(res);
        return;
      }

      // Stage labels mirror what actually runs, so the bar cannot promise a
      // step the student switched off.
      const stageNames: StudyGeneratorStage[] = ['extract', 'summary'];
      const stageLabels = ['Reading your material', 'Writing Smart Notes'];
      if (generateCards) {
        stageNames.push('flashcards');
        stageLabels.push('Building flashcards');
      }
      if (generateQuiz) {
        stageNames.push('quiz');
        stageLabels.push('Writing quiz questions');
      }
      stageNames.push('saving');
      stageLabels.push('Saving to your library');

      const creditCost =
        SMART_NOTES_CREDIT_COST.standard +
        (generateCards ? AI_CREDIT_COSTS.generate_flashcards : 0) +
        (generateQuiz ? AI_CREDIT_COSTS.generate_questions : 0);

      const res = await runAiJob(
        {
          userId: aiUserId,
          kind: 'import_study',
          title: note.title || 'Imported note',
          stages: stageLabels,
          creditCost,
          target: { path: `/notes/${note.id}`, label: 'Open note' },
        },
        (report, hooks) =>
          runGenerators(
            note,
            (stage) => {
              const index = stageNames.indexOf(stage);
              if (index >= 0) report(index);
            },
            // The job id is the deck save's idempotency key, so a retried save
            // replays the first write instead of making a second deck.
            hooks
          )
      );

      if (!backgroundedRef.current) {
        setResult(res);
        setStep('done');
      }
      onComplete(res);
    },
    [runGenerators, onComplete, aiUserId, generateCards, generateQuiz]
  );

  const fileImportedNote = useCallback(
    async (note: StudyNote): Promise<StudyNote> => {
      const needsCourse = Boolean(courseId && note.courseId !== courseId);
      const needsSet = Boolean(studySetId && note.studySetId !== studySetId);
      if (!needsCourse && !needsSet) return note;
      const updated = await notesApi.updateNote(note.id, {
        ...(needsCourse ? { courseId } : {}),
        ...(needsSet ? { studySetId } : {}),
      });
      const notesState = useNotesStore.getState();
      notesState.setNotes([updated, ...notesState.notes.filter((n) => n.id !== updated.id)]);
      if (notesState.selectedNote?.id === updated.id) {
        notesState.setSelectedNote({
          ...notesState.selectedNote,
          courseId: updated.courseId,
          studySetId: updated.studySetId,
        });
      }
      return { ...note, ...updated };
    },
    [courseId, studySetId]
  );

  const processContent = useCallback(
    async (body: string, title: string, sourceType: string) => {
      setStep('processing');
      setError(null);
      try {
        const created = await notesApi.createNote({
          title,
          body,
          sourceType: sourceType as StudyNote['sourceType'],
          ...(courseId ? { courseId } : {}),
          ...(studySetId ? { studySetId } : {}),
        });
        const note = await fileImportedNote(created);
        await runStudyGenerators(note);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Import failed');
        setStep('input');
      }
    },
    [runStudyGenerators, fileImportedNote, courseId, studySetId]
  );

  const handlePdf = async (file: File) => {
    setStep('processing');
    setError(null);
    try {
      const { note, attachment } = await notesApi.uploadNotePdfViaApi(
        file,
        undefined,
        setImportProgress
      );
      const notesState = useNotesStore.getState();
      notesState.setNotes([note, ...notesState.notes.filter((n) => n.id !== note.id)]);
      const filed = await fileImportedNote(note);
      await loadNote(filed.id);
      useUIStore.getState().clearImportProgress();
      await runStudyGenerators({ ...filed, attachments: [attachment] });
    } catch (e: unknown) {
      useUIStore.getState().clearImportProgress();
      setError(e instanceof Error ? e.message : 'PDF import failed');
      setStep('input');
    }
  };

  const handlePresentation = async (file: File) => {
    setStep('processing');
    setError(null);
    try {
      const { note, attachment } = await notesApi.uploadPresentationViaApi(
        file,
        undefined,
        setImportProgress
      );
      const notesState = useNotesStore.getState();
      notesState.setNotes([note, ...notesState.notes.filter((n) => n.id !== note.id)]);
      const filed = await fileImportedNote(note);
      await loadNote(filed.id);
      const loaded = useNotesStore.getState().selectedNote;
      if (loaded?.id === filed.id && (!loaded.attachments || loaded.attachments.length === 0)) {
        notesState.setSelectedNote({ ...loaded, attachments: [attachment] });
      }
      useUIStore.getState().clearImportProgress();
      await runStudyGenerators({
        ...useNotesStore.getState().selectedNote!,
        attachments: useNotesStore.getState().selectedNote?.attachments ?? [attachment],
      });
    } catch (e: unknown) {
      useUIStore.getState().clearImportProgress();
      setError(e instanceof Error ? e.message : 'PowerPoint import failed');
      setStep('input');
    }
  };

  const handlePhotos = async (files: File[]) => {
    if (files.length === 0) return;
    setStep('processing');
    setError(null);
    try {
      const { note, attachments } = await notesApi.uploadNoteImagesViaApi(
        files,
        undefined,
        setImportProgress,
        defaultPhotoNoteTitle()
      );
      const notesState = useNotesStore.getState();
      notesState.setNotes([note, ...notesState.notes.filter((n) => n.id !== note.id)]);
      const filed = await fileImportedNote(note);
      await loadNote(filed.id);
      const loaded = useNotesStore.getState().selectedNote;
      if (loaded?.id === filed.id && (!loaded.attachments || loaded.attachments.length === 0)) {
        notesState.setSelectedNote({ ...loaded, attachments });
      }
      useUIStore.getState().clearImportProgress();
      await runStudyGenerators({
        ...useNotesStore.getState().selectedNote!,
        attachments: useNotesStore.getState().selectedNote?.attachments ?? attachments,
      });
    } catch (e: unknown) {
      useUIStore.getState().clearImportProgress();
      setError(e instanceof Error ? e.message : 'Photo import failed');
      setStep('input');
    }
  };

  const handleTextSubmit = () => {
    if (!textContent.trim()) return;
    void processContent(textContent.trim(), 'Imported Notes', 'typed');
  };

  if (!isOpen) return null;

  const isBusy = step === 'processing';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabelledBy="import-study-title"
      maxWidthClass="max-w-lg"
      loading={isBusy}
      closeOnBackdrop={!isBusy}
      panelClassName="!p-0 overflow-hidden"
    >
        <div className="flex items-center justify-between p-4 border-b border-lantern-border">
          <h2 id="import-study-title" className="text-lg font-bold flex items-center gap-2 text-lantern-text">
            <AppIcon name="sparkles" size={20} className="text-lantern-primary" aria-hidden />
            Import & Study
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-lantern-background-secondary disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close import and study dialog"
          >
            <AppIcon name="close" size={20} aria-hidden />
          </button>
        </div>

        <div className="p-4 space-y-4 bg-lantern-surface">
          {step === 'input' && (
            <>
              <p className="text-sm text-lantern-text-secondary">
                Drop content in once — get a note plus optional flashcards and quiz.
              </p>

              <p className="text-xs text-lantern-text-muted">
                {formatMaxNoteUploadLabel()}
              </p>

              {handwritingOcrOff ? (
                <p
                  role="status"
                  className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2"
                >
                  {HANDWRITING_OCR_OFF_MESSAGE}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3">
                {(!source || source === 'pdf' || source === 'audio' || source === 'video') ? (
                <label className="flex-1 min-w-[120px] flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="document-upload" size={32} className="text-lantern-primary" aria-hidden />
                  <span className="text-sm font-medium text-lantern-text">Upload PDF</span>
                  <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePdf(f); e.target.value = ''; }} />
                </label>
                ) : null}
                {(!source || source === 'ppt') ? (
                <label className="flex-1 min-w-[120px] flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="document-upload" size={32} className="text-lantern-accent" aria-hidden />
                  <span className="text-sm font-medium text-lantern-text">PowerPoint</span>
                  <input type="file" accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePresentation(f); e.target.value = ''; }} />
                </label>
                ) : null}
                {(!source || source === 'audio' || source === 'video') ? (
                <label className="flex-1 min-w-[120px] flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="image" size={32} className="text-lantern-primary" aria-hidden />
                  <span className="text-sm font-medium text-lantern-text">Photos</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) void handlePhotos(files); e.target.value = ''; }} />
                </label>
                ) : null}
                {!source ? (
                <label className="flex-1 min-w-[120px] flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="image" size={32} className="text-lantern-accent" aria-hidden />
                  <span className="text-sm font-medium text-lantern-text">Camera</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) void handlePhotos(files); e.target.value = ''; }} />
                </label>
                ) : null}
              </div>

              <textarea
                placeholder="Or paste lecture notes / text..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={4}
                aria-label="Paste notes or text to import"
                className="w-full px-3 py-2 rounded-lg border text-sm resize-none border-lantern-border bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
              />

              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateCards} onChange={(e) => setGenerateCards(e.target.checked)} />
                  Generate flashcards
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateQuiz} onChange={(e) => setGenerateQuiz(e.target.checked)} />
                  Generate quiz
                </label>
              </div>

              {textContent.trim() && (
                <Button onClick={handleTextSubmit} className="w-full">Import text</Button>
              )}

              {error && <p className="text-sm text-lantern-error">{error}</p>}
            </>
          )}

          {step === 'processing' && (
            <div className="py-8 text-center">
              <div className="animate-spin w-10 h-10 border-4 border-lantern-primary border-t-transparent rounded-full mx-auto mb-4" aria-hidden />
              <p className="font-medium text-lantern-text">Creating your study materials...</p>
              <p className="text-sm text-lantern-text-muted mt-1">Summary + flashcards + quiz</p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-4 px-3 py-1.5 rounded-lg text-caption font-medium border border-lantern-border text-lantern-text"
              >
                Continue in background
              </button>
            </div>
          )}

          {step === 'done' && result && (
            <div className="py-4 text-center space-y-4">
              <div className="text-4xl" aria-hidden>{result.warnings?.length ? '!' : '✓'}</div>
              <p className="font-semibold text-lantern-text">
                {result.warnings?.length ? `${result.noteTitle} imported` : `${result.noteTitle} ready!`}
              </p>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-lantern-text-muted">
                {result.summarized ? <span>AI summary saved</span> : null}
                {result.flashcardCount ? (
                  <span>{result.flashcardCount} flashcards saved</span>
                ) : null}
                {result.quizQuestionCount ? <span>{result.quizQuestionCount}-question quiz ready</span> : null}
                {!result.summarized && !result.flashcardCount && !result.quizQuestionCount && !result.warnings?.length ? (
                  <span>Note saved</span>
                ) : null}
              </div>
              {result.flashcardCount && result.deckName ? (
                <p className="text-sm text-lantern-text-secondary">
                  Cards saved to deck <span className="font-semibold text-lantern-text">“{result.deckName}”</span> — find it in your Library.
                </p>
              ) : null}
              {result.warnings?.length ? (
                <div role="status" aria-live="polite" className="text-left text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 space-y-1">
                  {result.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              ) : null}
              <Button onClick={() => { onOpenNote(result.noteId); handleClose(); }} className="w-full">
                Open note
              </Button>
              {onTurnIntoStudyProduct ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onTurnIntoStudyProduct(result);
                    handleClose();
                  }}
                  className="w-full"
                >
                  Turn this into a Study Product
                </Button>
              ) : null}
            </div>
          )}
        </div>
    </Modal>
  );
};

export default ImportAndStudyModal;
