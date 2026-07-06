import { useCallback, useRef } from 'react';
import { getNoteStudyContent, hasEnoughNoteStudyContent, MIN_NOTE_STUDY_CONTENT_CHARS } from '@lantern/shared';
import { useNotesStore } from '../stores/notesStore';
import { useStudyGoalsStore, buildDailyQuizQuestions } from '../stores/studyGoalsStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useAppNavigation } from './useAppNavigation';
import { runNoteFileImport } from '../utils/runNoteFileImport';
import { AppMode, FlashcardType } from '../types';
import * as notesApi from '../services/notes';
import { aiGenerateQuestions } from '../services/ai';
import { createDeck, createFlashcard, fetchFlashcards } from '../services/supabase';
import { trackQuestProgress } from '../services/questProgress';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';

const INSUFFICIENT_STUDY_CONTENT_MESSAGE = `Note needs at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content. For presentations, wait for slide text extraction or add your own notes.`;

export function useNoteHandlers(currentUserId?: string) {
  const {
    loadFolders,
    loadNotes,
    loadNote,
    createNote,
    createFolder,
    saveNote,
    removeNote,
    selectedNote,
    setSelectedNote,
    loadComments,
    postComment,
  } = useNotesStore();
  const { setStudyGoal, setDailyQuiz, studyGoal } = useStudyGoalsStore();
  const { openWithMessage } = useCompanionStore();
  const { navigateTo } = useAppNavigation();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigateToNotes = useCallback(() => {
    navigateTo(AppMode.NOTES);
    void loadFolders();
    void loadNotes();
  }, [navigateTo, loadFolders, loadNotes]);

  const openNote = useCallback(
    async (noteId: string) => {
      const loaded = await loadNote(noteId);
      if (!loaded || useNotesStore.getState().selectedNote?.id !== noteId) return;
      navigateTo(AppMode.NOTE_EDITOR, { noteId });
      void loadComments(noteId);
      try {
        const session = await notesApi.getNoteQuiz(noteId);
        setDailyQuiz(session);
      } catch {
        // Quiz fetch is optional; editor still works without it
      }
    },
    [loadNote, navigateTo, loadComments, setDailyQuiz]
  );

  const handleCreateNote = useCallback(async () => {
    const note = await createNote({ title: 'Untitled Note', body: '' });
    setSelectedNote(note);
    navigateTo(AppMode.NOTE_EDITOR, { noteId: note.id });
    trackQuestProgress('create_note');
    return note;
  }, [createNote, setSelectedNote, navigateTo]);

  const cancelAutoSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const handleAutoSave = useCallback(
    (noteId: string, updates: { title?: string; body?: string }) => {
      cancelAutoSave();
      const state = useNotesStore.getState();
      if (state.selectedNote?.id !== noteId && !state.notes.some((n) => n.id === noteId)) {
        return;
      }
      saveTimer.current = setTimeout(() => {
        const latest = useNotesStore.getState();
        if (latest.selectedNote?.id !== noteId && !latest.notes.some((n) => n.id === noteId)) {
          return;
        }
        void saveNote(noteId, updates).catch(() => {
          // Auto-save failures (e.g. note deleted) are non-fatal
        });
      }, 800);
    },
    [saveNote, cancelAutoSave]
  );

  const handleSummarize = useCallback(async (noteId: string) => {
    const result = await notesApi.summarizeNote(noteId);
    setSelectedNote({ ...selectedNote!, ...result.note, summary: result.summary });
    return result.summary;
  }, [selectedNote, setSelectedNote]);

  const handleChatWithNote = useCallback(() => {
    if (!selectedNote) return;
    openWithMessage(
      `I want to study my note "${selectedNote.title}". Ask me questions about it or help me understand key concepts based on this material.`
    );
  }, [selectedNote, openWithMessage]);

  const handleGenerateFlashcards = useCallback(
    async (_deckId: string, count: number = 10) => {
      if (!selectedNote) return [];
      cancelAutoSave();
      await saveNote(selectedNote.id, { title: selectedNote.title, body: selectedNote.body });
      await loadNote(selectedNote.id);
      const note = useNotesStore.getState().selectedNote;
      if (!note || !hasEnoughNoteStudyContent(note)) {
        throw new Error(INSUFFICIENT_STUDY_CONTENT_MESSAGE);
      }
      const cardCount = normalizeFlashcardCount(count);
      const result = await notesApi.generateFlashcardsFromNote(note.id, { count: cardCount });
      return result.flashcards || [];
    },
    [selectedNote, cancelAutoSave, saveNote, loadNote]
  );

  const handleCreateFlashcardDeckFromNote = useCallback(
    async (
      count: number = 10,
      editorState?: { title?: string; body?: string }
    ) => {
      if (!selectedNote || !currentUserId) return null;
      cancelAutoSave();
      if (editorState) {
        await saveNote(selectedNote.id, editorState);
      }
      await loadNote(selectedNote.id);
      const note = useNotesStore.getState().selectedNote;
      if (!note || !hasEnoughNoteStudyContent(note)) {
        throw new Error(INSUFFICIENT_STUDY_CONTENT_MESSAGE);
      }

      const cardCount = normalizeFlashcardCount(count);
      const { flashcards: generated } = await notesApi.generateFlashcardsFromNote(note.id, {
        count: cardCount,
      });
      if (!generated?.length) {
        throw new Error('Could not generate flashcards from this note.');
      }

      const deckName = `From: ${note.title || 'Untitled Note'}`.slice(0, 80);
      const deck = await createDeck(
        {
          name: deckName,
          description: `Generated from note: ${note.title || 'Untitled Note'}`,
        },
        currentUserId
      );

      for (const card of generated) {
        await createFlashcard({
          deckId: deck.id,
          type: FlashcardType.BASIC,
          front: card.front,
          back: card.back,
          userId: currentUserId,
        });
      }

      const flashcardStore = useFlashcardStore.getState();
      flashcardStore.updateDecks((prev) => [...prev, deck]);
      const fetchedFlashcards = await fetchFlashcards(undefined, currentUserId);
      flashcardStore.setFlashcards(
        fetchedFlashcards.map((fc: any) => ({
          id: fc.id,
          deckId: fc.deck_id,
          type: fc.type,
          front: fc.front,
          back: fc.back,
          clozeText: fc.cloze_text,
          imageUrl: fc.image_url,
          occlusionData: fc.occlusion_data,
          srsData: fc.srs_data,
          tags: fc.tags,
          createdAt: fc.created_at,
        }))
      );

      return { deck, count: generated.length };
    },
    [selectedNote, currentUserId, cancelAutoSave, saveNote, loadNote]
  );

  const handleGenerateQuestions = useCallback(
    async (count: number = 10) => {
      if (!selectedNote) return [];
      if (!hasEnoughNoteStudyContent(selectedNote)) {
        throw new Error(INSUFFICIENT_STUDY_CONTENT_MESSAGE);
      }
      const content = getNoteStudyContent(selectedNote);
      const result = await aiGenerateQuestions(content.slice(0, 8000), { count });
      return result.questions || [];
    },
    [selectedNote]
  );

  const handleStartDailyQuiz = useCallback(
    async (content: string, noteId?: string) => {
      const result = await notesApi.generateDailyQuizFromContent(content, studyGoal, 5);
      const questions = buildDailyQuizQuestions(result.questions);
      const session = {
        date: new Date().toISOString().slice(0, 10),
        noteId,
        questions,
        answers: {},
        completed: false,
      };
      setDailyQuiz(session);
      return session;
    },
    [studyGoal, setDailyQuiz]
  );

  const handleStartNoteQuiz = useCallback(
    async () => {
      if (!selectedNote) return null;
      if (!hasEnoughNoteStudyContent(selectedNote)) {
        throw new Error(INSUFFICIENT_STUDY_CONTENT_MESSAGE);
      }
      const session = await notesApi.generateNoteQuiz(selectedNote.id, studyGoal, 5);
      setDailyQuiz(session);
      return session;
    },
    [selectedNote, studyGoal, setDailyQuiz]
  );

  const handlePdfImport = useCallback(
    async (file: File, folderId?: string) =>
      runNoteFileImport({
        file,
        kind: 'pdf',
        folderId,
        setSelectedNote,
        loadNote,
        loadNotes,
        navigateToEditor: (noteId) => navigateTo(AppMode.NOTE_EDITOR, { noteId }),
      }),
    [setSelectedNote, loadNote, loadNotes, navigateTo]
  );

  const handlePresentationImport = useCallback(
    async (file: File, folderId?: string) =>
      runNoteFileImport({
        file,
        kind: 'presentation',
        folderId,
        setSelectedNote,
        loadNote,
        loadNotes,
        navigateToEditor: (noteId) => navigateTo(AppMode.NOTE_EDITOR, { noteId }),
      }),
    [setSelectedNote, loadNote, loadNotes, navigateTo]
  );

  const handleShareWithGroup = useCallback(
    async (noteId: string, groupId: string) => {
      return notesApi.shareNoteWithGroup(noteId, groupId);
    },
    []
  );

  const handleAddCollaborator = useCallback(
    async (noteId: string, userId: string) => {
      return notesApi.addNoteCollaborator(noteId, userId, 'editor');
    },
    []
  );

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      cancelAutoSave();
      setSelectedNote(null);
      await removeNote(noteId);
    },
    [cancelAutoSave, removeNote, setSelectedNote]
  );

  return {
    navigateToNotes,
    openNote,
    handleCreateNote,
    handleCreateFolder: createFolder,
    handleAutoSave,
    cancelAutoSave,
    handleSummarize,
    handleChatWithNote,
    handleGenerateFlashcards,
    handleCreateFlashcardDeckFromNote,
    handleGenerateQuestions,
    handleStartNoteQuiz,
    handlePdfImport,
    handlePresentationImport,
    handleStartDailyQuiz,
    handleShareWithGroup,
    handleAddCollaborator,
    handleDeleteNote,
    handlePostComment: postComment,
    setStudyGoal,
    studyGoal,
  };
}
