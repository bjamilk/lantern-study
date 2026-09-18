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
import { NOTES_STUDIO_DEPTHS } from '@lantern/shared/learning';
import type { SmartNotesDepth } from '@lantern/shared/utils/smartNotes';
import {
  TOPIC_SKILL_LEVELS,
  normalizeTopicBrief,
  splitNoteBodyByChapters,
  topicBriefError,
  type StudyUploadSource,
  type TopicBrief,
  type TopicSkillLevel,
} from '@lantern/shared';
import { createDeckWithCards } from '../services/apiEndpoints';
import { parseCardExport } from './study/CreateFromSource';
import { DOCX_MIME, routeUploadFiles } from './study/uploadDoors';

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
  source?: StudyUploadSource | null;
  /** Record lecture lives in Lecture studio, not this modal. */
  onRecordLecture?: () => void;
  /** Empty-set starter notes from a topic, subject and level. */
  onGenerateFromTopic?: (brief: TopicBrief) => Promise<void> | void;
  /**
   * Files the student already chose before this opened — the Upload Materials
   * page's dropzone. They go straight into the SAME handlers the modal's own
   * file inputs use, so the accepted types, the 25 MB limit, the progress bar
   * and the generator pipeline are one implementation and not two.
   *
   * Consumed once per open. `onInitialFilesConsumed` lets the caller clear its
   * own state so reopening the modal does not re-upload yesterday's file.
   */
  initialFiles?: File[] | null;
  onInitialFilesConsumed?: () => void;
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
  onRecordLecture,
  onGenerateFromTopic,
  initialFiles = null,
  onInitialFilesConsumed,
}) => {
  const [step, setStep] = useState<Step>('input');
  const [textContent, setTextContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAndStudyResult | null>(null);
  const [generateCards, setGenerateCards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);
  const [handwritingOcrOff, setHandwritingOcrOff] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [ankiText, setAnkiText] = useState('');
  const [noteDepth, setNoteDepth] = useState<SmartNotesDepth>('standard');
  const [extractImages, setExtractImages] = useState(true);
  const [chapterSplit, setChapterSplit] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const [topicSubject, setTopicSubject] = useState('');
  const [topicLevel, setTopicLevel] = useState<TopicSkillLevel>('intermediate');
  const [topicBusy, setTopicBusy] = useState(false);
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
    setYoutubeUrl('');
    setAnkiText('');
    setTopicTitle('');
    setTopicSubject('');
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
        const res = await runGenerators(note, undefined, undefined, {
          depth: noteDepth,
          extractImages,
        });
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
            hooks,
            { depth: noteDepth, extractImages }
          )
      );

      if (!backgroundedRef.current) {
        setResult(res);
        setStep('done');
      }
      onComplete(res);
    },
    [runGenerators, onComplete, aiUserId, generateCards, generateQuiz, noteDepth, extractImages]
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
        const parts = chapterSplit ? splitNoteBodyByChapters(title, body) : [{ title, body }];
        let first: StudyNote | null = null;
        for (const part of parts) {
          const created = await notesApi.createNote({
            title: part.title,
            body: part.body,
            sourceType: sourceType as StudyNote['sourceType'],
            ...(courseId ? { courseId } : {}),
            ...(studySetId ? { studySetId } : {}),
          });
          const filed = await fileImportedNote(created);
          if (!first) first = filed;
        }
        if (!first) throw new Error('Import failed');
        await runStudyGenerators(first);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Import failed');
        setStep('input');
      }
    },
    [runStudyGenerators, fileImportedNote, courseId, studySetId, chapterSplit]
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

  /**
   * A Word document (.docx).
   *
   * It goes through `processContent`, the SAME path as the paste door, because
   * the server hands back text rather than a stored file: a Word document has
   * no page model and no preview, so there is nothing to attach. That also
   * means chapter splitting, course/set filing and the generator run all come
   * free from the existing path instead of being re-implemented here.
   */
  const handleDocument = async (file: File) => {
    setStep('processing');
    setError(null);
    try {
      const { title, text, truncated } = await notesApi.extractDocumentTextViaApi(
        file,
        setImportProgress
      );
      useUIStore.getState().clearImportProgress();
      // A truncated document is not an error — the note is real, it is just the
      // first N characters. Saying so IN the note is the only way the student
      // ever finds out; a toast is gone by the time they read it, and silence
      // would let them revise from a document that quietly stops halfway.
      const body = truncated
        ? `${text}\n\n---\n\n[This document was longer than Lantern reads in one note. Everything above is the start of “${file.name}”; split the rest into a second file to bring it in.]`
        : text;
      await processContent(body, title, 'import');
    } catch (e: unknown) {
      useUIStore.getState().clearImportProgress();
      setError(e instanceof Error ? e.message : 'Word document import failed');
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

  const handleYoutube = async () => {
    if (!youtubeUrl.trim()) return;
    setStep('processing');
    setError(null);
    try {
      const created = await notesApi.createNoteFromYoutube(youtubeUrl.trim());
      const note = created.note;
      if (!note?.id) throw new Error('Could not file that video.');
      const filed = await fileImportedNote(note);
      await loadNote(filed.id);
      await runStudyGenerators(filed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'YouTube import failed');
      setStep('input');
    }
  };

  const handleBlank = async () => {
    setStep('processing');
    setError(null);
    try {
      const created = await notesApi.createNote({
        title: 'Untitled note',
        body: '',
        sourceType: 'typed',
        ...(courseId ? { courseId } : {}),
        ...(studySetId ? { studySetId } : {}),
      });
      const filed = await fileImportedNote(created);
      onOpenNote(filed.id);
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create a blank note');
      setStep('input');
    }
  };

  const handleAnki = async () => {
    const cards = parseCardExport(ankiText);
    if (cards.length === 0) {
      setError('Paste Anki or Quizlet text: one card per line, front and back separated by a tab.');
      return;
    }
    setStep('processing');
    setError(null);
    try {
      await createDeckWithCards({
        name: 'Imported cards',
        studySetId: studySetId || undefined,
        cards: cards.map((card) => ({ type: 'BASIC' as const, front: card.front, back: card.back })),
      });
      const res = {
        noteId: '',
        noteTitle: 'Imported cards',
        summarized: false,
        flashcardCount: cards.length,
        quizQuestionCount: 0,
        deckName: 'Imported cards',
      };
      setResult(res);
      setStep('done');
      onComplete(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Card import failed');
      setStep('input');
    }
  };

  const handleTopic = async () => {
    if (!onGenerateFromTopic) return;
    const brief = normalizeTopicBrief({ title: topicTitle, subject: topicSubject, level: topicLevel });
    if (!brief) {
      setError(topicBriefError(topicTitle) || 'Name the topic first.');
      return;
    }
    setTopicBusy(true);
    setError(null);
    try {
      await onGenerateFromTopic(brief);
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not generate from that topic.');
    } finally {
      setTopicBusy(false);
    }
  };

  useEffect(() => {
    if (isOpen && source === 'lecture' && onRecordLecture) {
      onRecordLecture();
    }
  }, [isOpen, source, onRecordLecture]);

  /**
   * Files handed over by the Upload Materials page's dropzone.
   *
   * The ref is what makes this run once: the effect's own `setStep` re-renders
   * the modal, and without the guard the same File would be uploaded on every
   * render for as long as the prop stayed set. `handlers` is deliberately NOT
   * in the dependency list — they are recreated each render, and depending on
   * them is the same infinite upload by another route.
   */
  const consumedFilesRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      consumedFilesRef.current = false;
      return;
    }
    if (consumedFilesRef.current) return;
    const files = initialFiles ?? [];
    if (files.length === 0) return;
    consumedFilesRef.current = true;
    onInitialFilesConsumed?.();
    const routed = routeUploadFiles(files);
    if (routed.kind === 'pdf') void handlePdf(routed.file);
    else if (routed.kind === 'presentation') void handlePresentation(routed.file);
    else if (routed.kind === 'document') void handleDocument(routed.file);
    else if (routed.kind === 'images') void handlePhotos(routed.files);
    else setError(routed.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above.
  }, [isOpen, initialFiles]);

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
          <h2 id="import-study-title" className="text-heading font-bold flex items-center gap-2 text-lantern-text">
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
              <p className="text-body text-lantern-text-secondary">
                Drop content in once — get a note plus optional flashcards and quiz.
              </p>

              <p className="text-caption text-lantern-text-muted">
                {formatMaxNoteUploadLabel()}
              </p>

              {handwritingOcrOff ? (
                <p
                  role="status"
                  className="text-caption text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2"
                >
                  {HANDWRITING_OCR_OFF_MESSAGE}
                </p>
              ) : null}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(!source || source === 'pdf') ? (
                <label className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="document-upload" size={24} className="text-lantern-primary" aria-hidden />
                  <span className="text-body font-medium text-lantern-text">PDF</span>
                  <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePdf(f); e.target.value = ''; }} />
                </label>
                ) : null}
                {(!source || source === 'ppt') ? (
                <label className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="document-upload" size={24} className="text-lantern-accent" aria-hidden />
                  <span className="text-body font-medium text-lantern-text">PowerPoint</span>
                  <input type="file" accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePresentation(f); e.target.value = ''; }} />
                </label>
                ) : null}
                {(!source || source === 'docx') ? (
                <label className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="document-attach" size={24} className="text-lantern-primary" aria-hidden />
                  <span className="text-body font-medium text-lantern-text">Word (.docx)</span>
                  <input type="file" accept={`.docx,${DOCX_MIME}`} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleDocument(f); e.target.value = ''; }} />
                </label>
                ) : null}
                {(!source || source === 'photo' || source === 'audio' || source === 'video') ? (
                <label className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="image" size={24} className="text-lantern-primary" aria-hidden />
                  <span className="text-body font-medium text-lantern-text">{source === 'photo' ? 'Photo / handwriting' : 'Images'}</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) void handlePhotos(files); e.target.value = ''; }} />
                </label>
                ) : null}
                {(!source || source === 'photo') ? (
                <label className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed cursor-pointer hover:border-lantern-primary border-lantern-border min-h-[44px]">
                  <AppIcon name="image" size={24} className="text-lantern-accent" aria-hidden />
                  <span className="text-body font-medium text-lantern-text">Camera</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) void handlePhotos(files); e.target.value = ''; }} />
                </label>
                ) : null}
                {(!source || source === 'blank') ? (
                <button
                  type="button"
                  onClick={() => void handleBlank()}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed hover:border-lantern-primary border-lantern-border min-h-[44px]"
                >
                  <AppIcon name="document-text" size={24} className="text-lantern-primary" aria-hidden />
                  <span className="text-body font-medium text-lantern-text">Blank note</span>
                </button>
                ) : null}
                {onRecordLecture && (!source || source === 'audio' || source === 'lecture') ? (
                <button
                  type="button"
                  onClick={onRecordLecture}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed hover:border-lantern-primary border-lantern-border min-h-[44px]"
                >
                  <AppIcon name="mic" size={24} className="text-lantern-primary" aria-hidden />
                  <span className="text-body font-medium text-lantern-text">Record lecture</span>
                </button>
                ) : null}
              </div>

              {(!source || source === 'youtube' || source === 'video') ? (
                <div className="space-y-2">
                  <label className="block text-body font-medium text-lantern-text" htmlFor="import-youtube">
                    YouTube
                  </label>
                  <input
                    id="import-youtube"
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v="
                    className="w-full px-3 py-2 rounded-lg border text-body border-lantern-border bg-lantern-surface text-lantern-text"
                  />
                  {youtubeUrl.trim() ? (
                    <Button onClick={() => void handleYoutube()} className="w-full">
                      Add video
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {(!source || source === 'anki') ? (
                <div className="space-y-2">
                  <label className="block text-body font-medium text-lantern-text" htmlFor="import-anki">
                    Anki / Quizlet
                  </label>
                  <textarea
                    id="import-anki"
                    value={ankiText}
                    onChange={(e) => setAnkiText(e.target.value)}
                    rows={4}
                    placeholder="One card per line, term and definition separated by a tab"
                    className="w-full px-3 py-2 rounded-lg border text-body resize-none border-lantern-border bg-lantern-surface text-lantern-text"
                  />
                  {ankiText.trim() ? (
                    <Button onClick={() => void handleAnki()} className="w-full">
                      Import cards
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <textarea
                placeholder="Or paste lecture notes / text..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={4}
                aria-label="Paste notes or text to import"
                className="w-full px-3 py-2 rounded-lg border text-body resize-none border-lantern-border bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
              />

              <div>
                <p className="text-caption text-lantern-text-muted mb-2">Notes depth on ingest</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Notes depth">
                  {NOTES_STUDIO_DEPTHS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={noteDepth === option.id}
                      onClick={() => setNoteDepth(option.id)}
                      className={`min-h-[36px] rounded-full border px-3 text-caption ${
                        noteDepth === option.id
                          ? 'border-lantern-text font-semibold'
                          : 'border-lantern-border text-lantern-text-secondary'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-body cursor-pointer">
                <input type="checkbox" checked={extractImages} onChange={(e) => setExtractImages(e.target.checked)} />
                Extract images from PDFs and slides
              </label>
              <label className="flex items-center gap-2 text-body cursor-pointer">
                <input type="checkbox" checked={chapterSplit} onChange={(e) => setChapterSplit(e.target.checked)} />
                Split pasted text on chapter or section headings
              </label>

              {onGenerateFromTopic && (!source || source === 'paste') ? (
                <div className="rounded-xl border border-lantern-border p-3 space-y-2">
                  <p className="text-body font-medium text-lantern-text">Generate 3–8 notes from a topic</p>
                  <input
                    value={topicTitle}
                    onChange={(e) => setTopicTitle(e.target.value)}
                    placeholder="Topic"
                    className="w-full px-3 py-2 rounded-lg border text-body border-lantern-border bg-lantern-surface"
                  />
                  <input
                    value={topicSubject}
                    onChange={(e) => setTopicSubject(e.target.value)}
                    placeholder="Subject (optional)"
                    className="w-full px-3 py-2 rounded-lg border text-body border-lantern-border bg-lantern-surface"
                  />
                  <div className="flex flex-wrap gap-2">
                    {TOPIC_SKILL_LEVELS.map((level) => (
                      <button
                        key={level.id}
                        type="button"
                        aria-pressed={topicLevel === level.id}
                        onClick={() => setTopicLevel(level.id)}
                        className={`min-h-[36px] rounded-full border px-3 text-caption ${
                          topicLevel === level.id
                            ? 'border-lantern-text font-semibold'
                            : 'border-lantern-border text-lantern-text-secondary'
                        }`}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                  <Button disabled={topicBusy} onClick={() => void handleTopic()} className="w-full">
                    {topicBusy ? 'Generating…' : 'Generate starter notes'}
                  </Button>
                </div>
              ) : null}

              <div className="flex gap-4 text-body">
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

              {error && <p className="text-body text-lantern-error">{error}</p>}
            </>
          )}

          {step === 'processing' && (
            <div className="py-8 text-center">
              <div className="animate-spin w-10 h-10 border-4 border-lantern-primary border-t-transparent rounded-full mx-auto mb-4" aria-hidden />
              <p className="font-medium text-lantern-text">Creating your study materials...</p>
              <p className="text-body text-lantern-text-muted mt-1">Summary + flashcards + quiz</p>
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
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-body text-lantern-text-muted">
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
                <p className="text-body text-lantern-text-secondary">
                  Cards saved to deck <span className="font-semibold text-lantern-text">“{result.deckName}”</span> — find it in your Library.
                </p>
              ) : null}
              {result.warnings?.length ? (
                <div role="status" aria-live="polite" className="text-left text-body text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 space-y-1">
                  {result.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              ) : null}
              {result.noteId ? (
                <Button onClick={() => { onOpenNote(result.noteId); handleClose(); }} className="w-full">
                  Open note
                </Button>
              ) : (
                <Button onClick={handleClose} className="w-full">
                  Done
                </Button>
              )}
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
