import { useCallback } from 'react';
import {
  getExtractionStatusMessage,
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
  isThinOrUnusableStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared';
import * as notesApi from '../services/notes';
import { aiGenerateFlashcards } from '../services/ai';
import { createDeck, createFlashcard, fetchAllFlashcards } from '../services/supabase';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import { useNotesStore } from '../stores/notesStore';
import { useAuthStore } from '../stores/authStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useStudyGoalsStore, buildDailyQuizQuestions } from '../stores/studyGoalsStore';
import { FlashcardType } from '../types';
import type { DailyQuizSession, Deck, NoteAttachment, StudyNote } from '../types';

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

interface UseStudyGeneratorsOptions {
  generateCards: boolean;
  generateQuiz: boolean;
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
    async (note: NoteWithAttachments): Promise<ImportAndStudyResult> => {
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
            let deck: Deck | null = null;
            try {
              deck = await createDeck(
                {
                  name: deckName,
                  description: `Generated from note: ${note.title || 'Untitled Note'}`,
                },
                userId
              );
            } catch {
              warnings.push(
                `Generated ${generated.length} flashcards but could not create a deck to save them. You can retry from the note.`
              );
            }

            if (deck) {
              let saved = 0;
              for (const card of generated) {
                try {
                  await createFlashcard({
                    deckId: deck.id,
                    type: FlashcardType.BASIC,
                    front: card.front,
                    back: card.back,
                    userId,
                  });
                  saved += 1;
                } catch {
                  // Counted below via "Saved N of M".
                }
              }

              if (saved > 0) {
                savedFlashcardCount = saved;
                savedDeck = deck;
                const flashcardStore = useFlashcardStore.getState();
                flashcardStore.updateDecks((prev) => [...prev, deck as Deck]);
                try {
                  flashcardStore.setFlashcards(await fetchAllFlashcards(undefined, userId));
                } catch {
                  // Deck is registered; cards will appear on the next flashcard refresh.
                }
                if (saved < generated.length) {
                  warnings.push(
                    `Saved ${saved} of ${generated.length} flashcards to "${deck.name || deckName}".`
                  );
                }
              } else {
                warnings.push(
                  `Generated ${generated.length} flashcards but none could be saved. You can retry from the note.`
                );
              }
            }
          }
        }
      }

      // 3) Quiz — persist via the same store path the dashboard daily-quiz widget reads
      // (mirrors useNoteHandlers.handleStartDailyQuiz's content-based path).
      if (generateQuiz && hasUsableContent) {
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
