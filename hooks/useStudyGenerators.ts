import { useCallback } from 'react';
import {
  aggregatePhotoOcrStatus,
  getExtractionStatusMessage,
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
  isThinOrUnusableStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared';
import * as notesApi from '../services/notes';
import { aiGenerateFlashcards } from '../services/ai';
import { saveGeneratedDeck, saveGeneratedTest } from '../services/jobArtifacts';
import type { AiJobHooks } from '../stores/aiJobRunner';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import { useNotesStore } from '../stores/notesStore';
import { useAuthStore } from '../stores/authStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useStudyGoalsStore, buildDailyQuizQuestions } from '../stores/studyGoalsStore';
import type { DailyQuizSession, Deck, NoteAttachment, StudyNote } from '../types';
import { buildDeckStudyContent, testTitleForSource } from '../utils/testGeneration';
import { testConfigForPlan, type TestPlanDraft } from '../utils/testBuilder';

export interface ImportAndStudyResult {
  noteId: string;
  noteTitle: string;
  /** True when AI Smart Notes summary was written to the note. */
  summarized?: boolean;
  /** Number of generated flashcards actually SAVED to the created deck (not just generated). */
  flashcardCount?: number;
  /** Deck the saved flashcards were persisted into. Absent when no cards were saved. */
  deckId?: string;
  deckName?: string;
  /** Number of quiz questions saved as today's daily quiz (readable from the dashboard widget). */
  quizQuestionCount?: number;
  /** Non-fatal AI generator failures to surface on the done step (REL-01). */
  warnings?: string[];
}

type NoteWithAttachments = StudyNote & { attachments?: NoteAttachment[] };

/**
 * Named stages this pipeline passes through. Named rather than numbered
 * because which stages actually run depends on the generateCards/generateQuiz
 * toggles — the caller builds the label list and maps names onto it, so the
 * two cannot drift out of step.
 */
export type StudyGeneratorStage = 'extract' | 'summary' | 'flashcards' | 'quiz' | 'saving';

export type StudyGeneratorStageReporter = (stage: StudyGeneratorStage) => void;

async function refreshNoteAfterOcr(note: NoteWithAttachments): Promise<NoteWithAttachments> {
  const source = note.sourceType;
  if (source !== 'photos' && source !== 'pdf' && source !== 'presentation') return note;
  const processing =
    source === 'photos'
      ? aggregatePhotoOcrStatus(note.attachments) === 'ocr_processing'
      : note.attachments?.[0]?.metadata?.extractionStatus === 'ocr_processing';
  const thin = isThinOrUnusableStudyContent({
    sourceType: source,
    body: note.body,
    summary: note.summary,
    attachments: note.attachments,
  });
  if (!processing && !thin) return note;
  try {
    const ocr = await notesApi.waitForNoteOcr(note.id);
    const refreshed = await notesApi.fetchNote(note.id);
    return {
      ...note,
      ...refreshed,
      attachments: ocr.attachments?.length
        ? ocr.attachments
        : refreshed.attachments ?? note.attachments,
    };
  } catch {
    return note;
  }
}

interface UseStudyGeneratorsOptions {
  generateCards: boolean;
  generateQuiz: boolean;
}

/** What the test generator produces once the test is filed. */
export interface GeneratedTestResult {
  /** The saved test's id — the thing `/study/tests/:testId` opens. */
  testId: string;
  title: string;
  questionCount: number;
}

/** Named stages the test generator passes through. */
export type TestGeneratorStage = 'reading' | 'generating' | 'saving';

/**
 * Build a test from a deck or a note, and FILE it.
 *
 * This is the from-deck / from-note half of the "New test" page, and it runs on
 * the same job runner as every other generation (Wave G): the caller passes the
 * runner's hooks straight through, so the job gets its staged progress, its
 * 90-second budget, its background notification and its resume-after-reload —
 * a test is not a second, weaker kind of generation.
 *
 * It saves through `saveGeneratedTest`, which is keyed on the job id, so a
 * retried save cannot mint a second copy of the same test.
 */
export async function runTestGenerator(
  plan: TestPlanDraft,
  deps: {
    studyGoal?: Parameters<typeof notesApi.generateDailyQuizFromContent>[1];
    onStage?: (stage: TestGeneratorStage) => void;
    hooks?: AiJobHooks;
  } = {}
): Promise<GeneratedTestResult> {
  const onStage = deps.onStage ?? (() => {});
  if (!plan.sourceId || (plan.source !== 'deck' && plan.source !== 'note')) {
    throw new Error('Pick a deck or a note to build the test from.');
  }

  onStage('reading');
  let content = '';
  if (plan.source === 'deck') {
    const cards = useFlashcardStore
      .getState()
      .flashcards.filter((card) => card.deckId === plan.sourceId);
    content = buildDeckStudyContent(cards);
    if (!content) {
      throw new Error('That deck has no cards to build questions from yet.');
    }
  } else {
    const note = await notesApi.fetchNote(plan.sourceId);
    const studyInput = {
      sourceType: note.sourceType,
      body: note.body,
      summary: note.summary,
      attachments: (note as NoteWithAttachments).attachments,
    };
    if (!hasEnoughNoteStudyContent(studyInput) || isThinOrUnusableStudyContent(studyInput)) {
      throw new Error(
        `There is not enough text in that note yet (need ${MIN_NOTE_STUDY_CONTENT_CHARS}+ characters).`
      );
    }
    content = getNoteStudyContent(studyInput);
    if (!plan.sourceTitle) plan = { ...plan, sourceTitle: note.title };
  }

  onStage('generating');
  const { questions } = await notesApi.generateDailyQuizFromContent(
    content.slice(0, 8000),
    deps.studyGoal,
    plan.questionCount
  );
  if (!questions?.length) {
    throw new Error('The generator returned no questions. Nothing was charged twice — try again.');
  }

  onStage('saving');
  const title = testTitleForSource(plan);
  const saved = await saveGeneratedTest({
    jobId: deps.hooks?.clientJobId || `test-${plan.sourceId}-${Date.now()}`,
    title,
    ...(plan.source === 'note' ? { sourceNoteId: plan.sourceId } : { sourceDeckId: plan.sourceId }),
    // Practice/exam and the clock, written into the test itself. They were
    // dropped here, so every built test launched as a plain untimed exam no
    // matter what the builder's summary line had promised.
    config: testConfigForPlan(plan),
    questions,
  });

  return { testId: saved.ref.id, title: saved.ref.name || title, questionCount: saved.saved };
}

/**
 * Shared "Import & Study" generator flow (summary + flashcards + quiz) used by
 * ImportAndStudyModal and AIToolsHub.
 *
 * Unlike the previous inline copies, this PERSISTS what it generates:
 * - Flashcards are saved into a new deck named "From: <note title>" (mirrors
 *   useNoteHandlers.handleCreateFlashcardDeckFromNote) and the flashcard store is updated.
 * - The quiz is saved via useStudyGoalsStore.setDailyQuiz — the same store path the
 *   dashboard daily-quiz widget reads — tagged with the source note title.
 *
 * Counts in the returned result reflect what was actually saved.
 */
export function useStudyGenerators({ generateCards, generateQuiz }: UseStudyGeneratorsOptions) {
  const runStudyGenerators = useCallback(
    async (
      incoming: NoteWithAttachments,
      onStage: StudyGeneratorStageReporter = () => {},
      /** From the AI job runner: the id the deck save is keyed on. */
      hooks?: AiJobHooks
    ): Promise<ImportAndStudyResult> => {
      onStage('extract');
      const note = await refreshNoteAfterOcr(incoming);
      const studyInput = {
        sourceType: note.sourceType,
        body: note.body,
        summary: note.summary,
        attachments: note.attachments,
      };
      const studyText = getNoteStudyContent(studyInput);
      const hasUsableContent =
        hasEnoughNoteStudyContent(studyInput) && !isThinOrUnusableStudyContent(studyInput);

      let summarized = false;
      let savedFlashcardCount = 0;
      let savedDeck: Deck | null = null;
      let quizQuestionCount = 0;
      const warnings: string[] = [];

      const extractionMessage = getExtractionStatusMessage(
        (note.attachments?.[0]?.metadata?.extractionStatus as
          | 'ok'
          | 'needs_ocr'
          | 'empty'
          | 'ocr_processing'
          | 'ocr_failed'
          | undefined) || null,
        note.sourceType
      );

      // 1) AI Smart Notes summary — written back onto the note.
      if (hasUsableContent) {
        onStage('summary');
        try {
          const { summary, note: updated } = await notesApi.summarizeNote(note.id);
          summarized =
            Boolean(summary?.trim()) && (summary?.trim().length || 0) >= MIN_NOTE_STUDY_CONTENT_CHARS;
          const notesState = useNotesStore.getState();
          notesState.setNotes(
            notesState.notes.map((n) =>
              n.id === updated.id
                ? {
                    ...n,
                    ...updated,
                    summary,
                    attachments: note.attachments ?? (n as NoteWithAttachments).attachments,
                  }
                : n
            )
          );
          if (notesState.selectedNote?.id === updated.id) {
            notesState.setSelectedNote({
              ...notesState.selectedNote,
              ...updated,
              summary,
              attachments: note.attachments ?? notesState.selectedNote.attachments,
            });
          }
          if (!summarized) warnings.push('Summary generation returned empty or thin content.');
        } catch {
          warnings.push('Summary generation failed. You can retry Smart Notes from the note.');
        }
      } else {
        warnings.push(
          extractionMessage ||
            `Could not extract enough text to summarize (need ${MIN_NOTE_STUDY_CONTENT_CHARS}+ characters). For scanned PDFs, wait for OCR or open the note and add content.`
        );
      }

      // 2) Flashcards — generate, then persist into a new deck (mirrors
      // useNoteHandlers.handleCreateFlashcardDeckFromNote).
      if (generateCards && hasUsableContent) {
        onStage('flashcards');
        let generated: { front: string; back: string }[] = [];
        try {
          const { flashcards } = await aiGenerateFlashcards(studyText.slice(0, 8000), {
            count: normalizeFlashcardCount(),
          });
          generated = flashcards ?? [];
          if (!generated.length) warnings.push('Flashcard generation returned no cards.');
        } catch {
          warnings.push('Flashcard generation failed. You can retry from the note.');
        }

        if (generated.length) {
          const userId = useAuthStore.getState().currentUser?.id;
          if (!userId) {
            warnings.push(
              `Generated ${generated.length} flashcards but could not save them — you appear to be signed out.`
            );
          } else {
            const deckName = `From: ${note.title || 'Untitled Note'}`.slice(0, 80);
            try {
              // One atomic request, keyed on the job. The old loop — create the
              // deck, then push cards one at a time — is what produced decks
              // reporting ten cards over six, and empty "From: …" shells when
              // the deck landed and every card did not.
              const saved = await saveGeneratedDeck({
                jobId: hooks?.clientJobId || `import-${note.id}-${Date.now()}`,
                userId,
                deckName,
                description: `Generated from note: ${note.title || 'Untitled Note'}`,
                cards: generated.map((card) => ({ front: card.front, back: card.back })),
              });
              savedFlashcardCount = saved.saved;
              savedDeck =
                useFlashcardStore.getState().decks.find((d) => d.id === saved.ref.id) ??
                ({ id: saved.ref.id, name: saved.ref.name || deckName } as Deck);
            } catch (error) {
              // Nothing was written: the request is all-or-nothing, so there is
              // no half-saved deck to warn about and no shell to clean up.
              warnings.push(
                error instanceof Error && error.message
                  ? error.message
                  : `Generated ${generated.length} flashcards but could not save them. You can retry from the note.`
              );
            }
          }
        }
      }

      // 3) Quiz — persist via the same store path the dashboard daily-quiz widget reads
      // (mirrors useNoteHandlers.handleStartDailyQuiz's content-based path).
      if (generateQuiz && hasUsableContent) {
        onStage('quiz');
        try {
          const studyGoal = useStudyGoalsStore.getState().studyGoal;
          const { questions } = await notesApi.generateDailyQuizFromContent(
            studyText.slice(0, 8000),
            studyGoal,
            5
          );
          if (questions?.length) {
            const session: DailyQuizSession = {
              date: new Date().toISOString().slice(0, 10),
              noteId: note.id,
              sourceNoteTitle: (note.title || 'Imported note').trim(),
              questions: buildDailyQuizQuestions(questions),
              answers: {},
              completed: false,
            };
            useStudyGoalsStore.getState().setDailyQuiz(session);
            quizQuestionCount = session.questions.length;
          } else {
            warnings.push('Quiz generation returned no questions.');
          }
        } catch {
          warnings.push('Quiz generation failed. You can retry from the note.');
        }
      }

      onStage('saving');
      return {
        noteId: note.id,
        noteTitle: note.title,
        summarized,
        flashcardCount: savedFlashcardCount,
        deckId: savedDeck?.id,
        deckName: savedDeck ? savedDeck.name || undefined : undefined,
        quizQuestionCount,
        warnings: warnings.length ? warnings : undefined,
      };
    },
    [generateCards, generateQuiz]
  );

  return { runStudyGenerators };
}

export default useStudyGenerators;
