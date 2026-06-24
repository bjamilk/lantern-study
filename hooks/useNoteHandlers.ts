import { useCallback, useRef } from 'react';
import { useNotesStore } from '../stores/notesStore';
import { useStudyGoalsStore, buildDailyQuizQuestions } from '../stores/studyGoalsStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useUIStore } from '../stores/uiStore';
import { useAppNavigation } from './useAppNavigation';
import { AppMode, FlashcardType, type NoteAttachment } from '../types';
import * as notesApi from '../services/notes';
import { aiGenerateFlashcards, aiGenerateQuestions } from '../services/ai';
import { createDeck, createFlashcard, fetchFlashcards } from '../services/supabase';
import { trackQuestProgress } from '../services/questProgress';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';

function getNoteStudyContent(
  note: { body?: string; summary?: string; attachments?: NoteAttachment[] }
): string {
  const body = note.body?.trim();
  if (body) return body;
  const extracted = (note.attachments || [])
    .map((a) => a.extractedText?.trim())
    .filter(Boolean)
    .join('\n\n');
  if (extracted) return extracted;
  return note.summary?.trim() || '';
}

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
      await loadNote(noteId);
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

  const handleAutoSave = useCallback(
    (noteId: string, updates: { title?: string; body?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveNote(noteId, updates).catch(() => {
          // Auto-save failures (e.g. note deleted) are non-fatal
        });
      }, 800);
    },
    [saveNote]
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
      if (!currentUserId) throw new Error('Not signed in');
      const { fileUrl, extractedText, storagePath } = await notesApi.uploadNotePdf(currentUserId, file);
      const note = await createNote({
        title: file.name.replace(/\.pdf$/i, ''),
        body: extractedText,
        folderId,
        sourceType: 'pdf',
      });
      await notesApi.addNoteAttachment(note.id, {
        type: 'pdf',
        fileUrl,
        fileName: file.name,
        extractedText,
        metadata: { storagePath },
      });
      await loadNotes();
      return note;
    },
    [currentUserId, createNote, loadNotes]
  );

  const handlePresentationImport = useCallback(
    async (file: File, folderId?: string) => {
      const result = await notesApi.uploadPresentationViaApi(file, folderId);
      await loadNotes();
      return result.note;
    },
    [loadNotes]
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

  return {
    navigateToNotes,
    openNote,
    handleCreateNote,
    handleCreateFolder: createFolder,
    handleAutoSave,
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
    handleDeleteNote: removeNote,
    handlePostComment: postComment,
    setStudyGoal,
    studyGoal,
  };
}
