import { useCallback, useRef, useState } from 'react';
import { getNoteStudyContent } from '@lantern/shared';
import { useNotesStore } from '../stores/notesStore';
import { useStudyGoalsStore, buildDailyQuizQuestions } from '../stores/studyGoalsStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useUIStore } from '../stores/uiStore';
import { useAppNavigation } from './useAppNavigation';
import { AppMode, FlashcardType } from '../types';
import * as notesApi from '../services/notes';
import type { NoteImportProgress } from '../services/notes';
import { aiGenerateFlashcards, aiGenerateQuestions } from '../services/ai';
import { createDeck, createFlashcard, fetchFlashcards } from '../services/supabase';
import { trackQuestProgress } from '../services/questProgress';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';

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
  const [importProgress, setImportProgress] = useState<NoteImportProgress | null>(null);

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
      const content = getNoteStudyContent(selectedNote);
      const cardCount = normalizeFlashcardCount(count);
      const result = await aiGenerateFlashcards(content.slice(0, 8000), { count: cardCount });
      return result.flashcards || [];
    },
    [selectedNote]
  );

  const handleCreateFlashcardDeckFromNote = useCallback(
    async (count: number = 10) => {
      if (!selectedNote || !currentUserId) return null;
      const content = getNoteStudyContent(selectedNote);
      if (content.trim().length < 50) {
        throw new Error('Note needs at least 50 characters to generate flashcards.');
      }

      const cardCount = normalizeFlashcardCount(count);

      const { flashcards: generated } = await aiGenerateFlashcards(content.slice(0, 8000), { count: cardCount });
      if (!generated?.length) {
        throw new Error('Could not generate flashcards from this note.');
      }

      const deckName = `From: ${selectedNote.title || 'Untitled Note'}`.slice(0, 80);
      const deck = await createDeck(
        {
          name: deckName,
          description: `Generated from note: ${selectedNote.title || 'Untitled Note'}`,
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
    [selectedNote, currentUserId]
  );

  const handleGenerateQuestions = useCallback(
    async (count: number = 10) => {
      if (!selectedNote) return [];
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
      const content = getNoteStudyContent(selectedNote);
      if (content.trim().length < 50) {
        throw new Error('Note needs at least 50 characters to generate a quiz.');
      }
      const session = await notesApi.generateNoteQuiz(selectedNote.id, studyGoal, 5);
      setDailyQuiz(session);
      return session;
    },
    [selectedNote, studyGoal, setDailyQuiz]
  );

  const handleYouTubeImport = useCallback(
    async (url: string, folderId?: string) => {
      const note = await notesApi.importYouTubeNote(url, folderId);
      await loadNotes();
      return note;
    },
    [loadNotes]
  );

  const handlePdfImport = useCallback(
    async (file: File, folderId?: string) => {
      try {
        const result = await notesApi.uploadNotePdfViaApi(file, folderId, setImportProgress);
        await loadNotes();
        setSelectedNote({ ...result.note, attachments: [result.attachment] });
        navigateTo(AppMode.NOTE_EDITOR, { noteId: result.note.id });
        return result.note;
      } finally {
        setImportProgress(null);
      }
    },
    [loadNotes, setSelectedNote, navigateTo]
  );

  const handlePresentationImport = useCallback(
    async (file: File, folderId?: string) => {
      try {
        const result = await notesApi.uploadPresentationViaApi(file, folderId, setImportProgress);
        await loadNotes();
        setSelectedNote({ ...result.note, attachments: [result.attachment] });
        navigateTo(AppMode.NOTE_EDITOR, { noteId: result.note.id });
        return result.note;
      } finally {
        setImportProgress(null);
      }
    },
    [loadNotes, setSelectedNote, navigateTo]
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
    handleYouTubeImport,
    handlePdfImport,
    handlePresentationImport,
    handleStartDailyQuiz,
    handleShareWithGroup,
    handleAddCollaborator,
    handleDeleteNote,
    handlePostComment: postComment,
    setStudyGoal,
    studyGoal,
    importProgress,
  };
}
