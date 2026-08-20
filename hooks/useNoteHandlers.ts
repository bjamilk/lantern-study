import { useCallback, useRef } from 'react';
import {
  getNoteStudyContent,
  getNoteStudyContentForSmartNotes,
  hasEnoughNoteStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared';
import { useNotesStore } from '../stores/notesStore';
import { useStudyGoalsStore, buildDailyQuizQuestions } from '../stores/studyGoalsStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useAppNavigation } from './useAppNavigation';
import { runNoteFileImport, runNoteYoutubeImport } from '../utils/runNoteFileImport';
import { runNoteImagesImport } from '../utils/runNoteImagesImport';
import { AppMode, FlashcardType } from '../types';
import * as notesApi from '../services/notes';
import { aiGenerateQuestions } from '../services/ai';
import { createDeck, createFlashcard, deleteDeck, fetchAllFlashcards } from '../services/supabase';
import { trackQuestProgress } from '../services/questProgress';
import { trackNoteCreated } from '../services/productAnalytics';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import { useToastStore } from '../stores/toastStore';
import { useLectureRecordingStore } from '../stores/lectureRecordingStore';

const INSUFFICIENT_STUDY_CONTENT_MESSAGE = `Note needs at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content. For presentations, wait for slide text extraction or add your own notes.`;

export function useNoteHandlers(currentUserId?: string) {
  const {
    loadFolders,
    loadNotes,
    loadNote,
    createNote,
    createFolder,
    updateFolder,
    removeFolder,
    saveNote,
    moveNotesToFolder,
    removeNote,
    removeNotes,
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
    trackNoteCreated('editor');
    return note;
  }, [createNote, setSelectedNote, navigateTo]);

  const cancelAutoSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const noteMatchesUpdates = (
    note: { title: string; body: string },
    updates: { title?: string; body?: string }
  ) => {
    const nextTitle = updates.title ?? note.title;
    const nextBody = updates.body ?? note.body;
    return nextTitle === note.title && nextBody === note.body;
  };

  const handleAutoSave = useCallback(
    (noteId: string, updates: { title?: string; body?: string }) => {
      cancelAutoSave();
      const state = useNotesStore.getState();
      if (state.selectedNote?.id !== noteId && !state.notes.some((n) => n.id === noteId)) {
        return;
      }
      const stored =
        state.selectedNote?.id === noteId
          ? state.selectedNote
          : state.notes.find((n) => n.id === noteId);
      if (!stored || noteMatchesUpdates(stored, updates)) {
        return;
      }
      saveTimer.current = setTimeout(() => {
        const latest = useNotesStore.getState();
        if (latest.selectedNote?.id !== noteId && !latest.notes.some((n) => n.id === noteId)) {
          return;
        }
        const latestStored =
          latest.selectedNote?.id === noteId
            ? latest.selectedNote
            : latest.notes.find((n) => n.id === noteId);
        if (!latestStored || noteMatchesUpdates(latestStored, updates)) {
          return;
        }
        void saveNote(noteId, updates).catch((err) => {
          // A version conflict is not a failure the user must retry: saveNote has
          // already reloaded the authoritative note into the store/editor. Tell
          // them their unsaved keystrokes were superseded rather than lost silently.
          const isConflict =
            (err as { code?: string })?.code === 'version_conflict' ||
            /changed elsewhere|updated elsewhere|version_conflict/i.test(
              err instanceof Error ? err.message : ''
            );
          if (isConflict) {
            useToastStore
              .getState()
              .showToast('This note changed elsewhere — reloading the latest version', 'info');
            return;
          }
          const message = err instanceof Error ? err.message : 'Failed to save note';
          useToastStore.getState().showToast(message, 'error');
        });
      }, 800);
    },
    [saveNote, cancelAutoSave]
  );

  const handleSmartNote = useCallback(
    async (
      noteId: string,
      editorState?: { title?: string; body?: string },
      options?: import('@lantern/shared/utils/smartNotes').SmartNotesRequestOptions
    ) => {
      cancelAutoSave();
      if (editorState) {
        await saveNote(noteId, editorState);
      }
      await loadNote(noteId);
      const note = useNotesStore.getState().selectedNote;
      if (!note) throw new Error('Note not found.');
      const smartNotesSource = getNoteStudyContentForSmartNotes(note);
      if (smartNotesSource.length < MIN_NOTE_STUDY_CONTENT_CHARS) {
        throw new Error(
          `Need at least ${MIN_NOTE_STUDY_CONTENT_CHARS} characters of study content. For scanned PDFs, wait for OCR or add your own notes.`
        );
      }
      const result = await notesApi.summarizeNote(noteId, options);
      const latest = useNotesStore.getState().selectedNote;
      if (latest?.id === noteId) {
        setSelectedNote({
          ...latest,
          ...result.note,
          summary: result.summary,
        });
      }
      return result.summary;
    },
    [cancelAutoSave, saveNote, loadNote, setSelectedNote]
  );

  const handleChatWithNote = useCallback(() => {
    if (!selectedNote) return;
    const studyContent = getNoteStudyContent(selectedNote);
    openWithMessage(
      studyContent.length >= 50
        ? `Help me study my note "${selectedNote.title}". Ask me questions and explain key concepts from this material:\n\n${studyContent.slice(0, 4000)}`
        : `I want to study my note "${selectedNote.title}". Ask me questions about it or help me understand key concepts based on this material.`
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

      // Per-card creates can partially fail; settle them all so cards that DID
      // save server-side are never stranded in a deck the store doesn't know about.
      const results = await Promise.allSettled(
        generated.map((card) =>
          createFlashcard({
            deckId: deck.id,
            type: FlashcardType.BASIC,
            front: card.front,
            back: card.back,
            userId: currentUserId,
          })
        )
      );
      const savedCount = results.filter((r) => r.status === 'fulfilled').length;

      if (savedCount === 0) {
        // Nothing made it: remove the just-created empty deck (best effort) so a
        // stranded shell doesn't appear after reload, then surface a real failure.
        try {
          await deleteDeck(deck.id);
        } catch {
          // Best effort only — an empty deck may remain if this also fails.
        }
        const firstFailure = results.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected'
        )?.reason;
        throw firstFailure instanceof Error
          ? firstFailure
          : new Error('Could not save the generated flashcards.');
      }

      const flashcardStore = useFlashcardStore.getState();
      flashcardStore.updateDecks((prev) => [...prev, deck]);
      flashcardStore.setFlashcards(await fetchAllFlashcards(undefined, currentUserId));

      return { deck, count: generated.length, savedCount };
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
    async (noteId: string, sourceNoteTitle?: string) => {
      const notes = useNotesStore.getState().notes;
      const note =
        notes.find((n) => n.id === noteId) ||
        (selectedNote?.id === noteId ? selectedNote : null);
      const title = (sourceNoteTitle || note?.title || 'Selected note').trim();

      if (noteId) {
        try {
          const session = await notesApi.generateNoteQuiz(noteId, studyGoal, 5);
          const withTitle = { ...session, sourceNoteTitle: title };
          setDailyQuiz(withTitle);
          return withTitle;
        } catch {
          // Fall back to content-based generation below.
        }
      }

      const content = note ? getNoteStudyContent(note) : '';
      if (content.trim().length < MIN_NOTE_STUDY_CONTENT_CHARS) {
        throw new Error(INSUFFICIENT_STUDY_CONTENT_MESSAGE);
      }
      const result = await notesApi.generateDailyQuizFromContent(content, studyGoal, 5);
      const questions = buildDailyQuizQuestions(result.questions);
      const session = {
        date: new Date().toISOString().slice(0, 10),
        noteId,
        sourceNoteTitle: title,
        questions,
        answers: {},
        completed: false,
      };
      setDailyQuiz(session);
      return session;
    },
    [studyGoal, setDailyQuiz, selectedNote]
  );

  const handleStartNoteQuiz = useCallback(
    async (editorState?: { title?: string; body?: string }) => {
      if (!selectedNote) return null;
      cancelAutoSave();
      if (editorState) {
        await saveNote(selectedNote.id, editorState);
      }
      await loadNote(selectedNote.id);
      const note = useNotesStore.getState().selectedNote;
      if (!note || !hasEnoughNoteStudyContent(note)) {
        throw new Error(INSUFFICIENT_STUDY_CONTENT_MESSAGE);
      }
      const session = await notesApi.generateNoteQuiz(note.id, studyGoal, 5);
      const withTitle = { ...session, sourceNoteTitle: note.title };
      setDailyQuiz(withTitle);
      return withTitle;
    },
    [selectedNote, studyGoal, setDailyQuiz, cancelAutoSave, saveNote, loadNote]
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

  const handleYoutubeImport = useCallback(
    async (url: string, folderId?: string) =>
      runNoteYoutubeImport({
        url,
        folderId,
        setSelectedNote,
        loadNote,
        loadNotes,
        navigateToEditor: (noteId) => navigateTo(AppMode.NOTE_EDITOR, { noteId }),
      }),
    [setSelectedNote, loadNote, loadNotes, navigateTo]
  );

  const handlePhotosImport = useCallback(
    async (files: File[], folderId?: string) =>
      runNoteImagesImport({
        files,
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

  const handleDeleteNotes = useCallback(
    async (noteIds: string[]) => {
      cancelAutoSave();
      const uniqueIds = [...new Set(noteIds)].filter(Boolean);
      if (uniqueIds.length === 0) return;

      const lecture = useLectureRecordingStore.getState();
      if (
        lecture.noteId &&
        uniqueIds.includes(lecture.noteId) &&
        lecture.status !== 'idle'
      ) {
        lecture.discard();
      }

      const selectedId = useNotesStore.getState().selectedNote?.id;
      if (selectedId && uniqueIds.includes(selectedId)) {
        setSelectedNote(null);
      }

      await removeNotes(uniqueIds);
    },
    [cancelAutoSave, removeNotes, setSelectedNote],
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, name: string) => {
      await updateFolder(folderId, { name });
    },
    [updateFolder],
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      await removeFolder(folderId);
    },
    [removeFolder],
  );

  const handleTogglePinNote = useCallback(
    async (noteId: string, isPinned: boolean) => {
      await saveNote(noteId, { isPinned });
    },
    [saveNote],
  );

  const handleArchiveNote = useCallback(
    async (noteId: string, isArchived: boolean) => {
      await saveNote(noteId, { isArchived });
    },
    [saveNote],
  );

  const handleMoveNotesToFolder = useCallback(
    async (noteIds: string[], folderId: string | null) => {
      await moveNotesToFolder(noteIds, folderId);
    },
    [moveNotesToFolder],
  );

  return {
    navigateToNotes,
    openNote,
    handleCreateNote,
    handleCreateFolder: createFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleTogglePinNote,
    handleArchiveNote,
    handleMoveNotesToFolder,
    handleAutoSave,
    cancelAutoSave,
    handleSmartNote,
    handleChatWithNote,
    handleGenerateFlashcards,
    handleCreateFlashcardDeckFromNote,
    handleGenerateQuestions,
    handleStartNoteQuiz,
    handlePdfImport,
    handlePresentationImport,
    handlePhotosImport,
    handleYoutubeImport,
    handleStartDailyQuiz,
    handleShareWithGroup,
    handleAddCollaborator,
    handleDeleteNote,
    handleDeleteNotes,
    handlePostComment: postComment,
    setStudyGoal,
    studyGoal,
  };
}
