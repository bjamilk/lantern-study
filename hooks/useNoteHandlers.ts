import { useCallback, useRef } from 'react';
import {
  getNoteStudyContent,
  getNoteStudyContentForSmartNotes,
  hasEnoughNoteStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from '@lantern/shared';
import { useNotesStore } from '../stores/notesStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useStudyGoalsStore, buildDailyQuizQuestions } from '../stores/studyGoalsStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useCompanionStore } from '../stores/companionStore';
import { useAppNavigation } from './useAppNavigation';
import { runNoteFileImport, runNoteYoutubeImport } from '../utils/runNoteFileImport';
import { runNoteImagesImport } from '../utils/runNoteImagesImport';
import { AppMode } from '../types';
import * as notesApi from '../services/notes';
import { aiGenerateQuestions } from '../services/ai';
import { saveGeneratedDeck, saveGeneratedTest } from '../services/jobArtifacts';
import type { AiJobHooks } from '../stores/aiJobRunner';
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
  const { open, setActiveNoteContext } = useCompanionStore();
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

  /** `title` is for the doors that create a note FOR something (the lecture
   *  recorder), so the note is recognisable in the list a week later. */
  const handleCreateNote = useCallback(async (
    title?: string,
    options?: { courseId?: string | null; studySetId?: string | null }
  ) => {
    const note = await createNote({
      title: title || 'Untitled Note',
      body: '',
      ...(options?.courseId ? { courseId: options.courseId } : {}),
      ...(options?.studySetId ? { studySetId: options.studySetId } : {}),
    });
    setSelectedNote(note);
    if (!options?.studySetId) {
      navigateTo(AppMode.NOTE_EDITOR, { noteId: note.id });
    }
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
      const smartNotesSource = getNoteStudyContentForSmartNotes(note, options?.sources);
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
    void setActiveNoteContext({
      id: selectedNote.id,
      title: selectedNote.title || 'Untitled note',
      scopeId: selectedNote.studySetId ?? selectedNote.courseId ?? null,
    });
    open();
  }, [selectedNote, open, setActiveNoteContext]);

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

  /**
   * Generate a deck from a note, and file it in ONE server request.
   *
   * The old flow made the deck client-side — `POST /decks`, then a
   * `POST /flashcards` per card — so a dropped connection halfway left a deck
   * announcing ten cards over six, and a run that failed entirely left an empty
   * "From: …" shell whenever the compensating delete also failed. Nothing is
   * created until the cards exist, the save is the atomic
   * `POST /decks/with-cards` keyed on the job id, and nothing is written
   * locally until the server has answered.
   *
   * `hooks` comes from the AI job runner: its `clientJobId` is the idempotency
   * key, so retrying the save replays the first write rather than making a
   * second deck.
   */
  const handleCreateFlashcardDeckFromNote = useCallback(
    async (
      count: number = 10,
      editorState?: { title?: string; body?: string },
      hooks?: AiJobHooks
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
      const { flashcards: generated } = await notesApi.generateFlashcardsFromNote(
        note.id,
        { count: cardCount },
        hooks && {
          onServerJob: hooks.onServerJob,
          onServerProgress: hooks.onServerProgress,
        }
      );
      if (!generated?.length) {
        throw new Error('Could not generate flashcards from this note.');
      }

      const deckName = `From: ${note.title || 'Untitled Note'}`.slice(0, 80);

      // No job to key the save on (a signed-out or untracked call site): the
      // request is still atomic, keyed on the note and this attempt.
      const saveKey = hooks?.clientJobId || `note-${note.id}-${Date.now()}`;
      const saved = await saveGeneratedDeck({
        jobId: saveKey,
        userId: currentUserId,
        deckName,
        description: `Generated from note: ${note.title || 'Untitled Note'}`,
        cards: generated.map((card) => ({ front: card.front, back: card.back })),
        courseId: note.courseId,
        studySetId: note.studySetId,
      });

      const deck = useFlashcardStore
        .getState()
        .decks.find((d) => d.id === saved.ref.id) ?? {
        id: saved.ref.id,
        name: saved.ref.name || deckName,
      };

      return {
        deck,
        ref: saved.ref,
        count: generated.length,
        savedCount: saved.saved,
      };
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

  /**
   * Generate a note's quiz — and file it as a test the student can actually
   * find again.
   *
   * The quiz itself lives on the note, which is right for the panel under the
   * editor. It was also the whole of the delivery: nothing was written to the
   * Tests list, so a finished job could only ever send the student back to the
   * note, and a reload had nothing to point at. It is now also saved through
   * `POST /tests/personal` with `sourceJobId`, which is what lets the SERVER
   * stamp the test onto the job record — so the job knows which test it became
   * and Open lands on it.
   *
   * A failed test save is not a failed quiz: the questions are on the note and
   * on the job record, so the run keeps its result and the save can be finished
   * later at no further charge.
   */
  const handleStartNoteQuiz = useCallback(
    async (
      editorState?: { title?: string; body?: string },
      hooks?: AiJobHooks,
      options?: { replace?: boolean }
    ) => {
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
      // A finished or started quiz is protected on the server. Clearing it
      // first is what lets "Generate new set" actually write new questions.
      if (options?.replace) {
        try {
          await notesApi.updateNoteQuiz(note.id, { answers: {}, completed: false });
        } catch {
          // No quiz saved yet — generate will create one.
        }
      }
      const session = await notesApi.generateNoteQuiz(
        note.id,
        studyGoal,
        5,
        hooks && {
          onServerJob: hooks.onServerJob,
          onServerProgress: hooks.onServerProgress,
        }
      );
      const withTitle = {
        ...session,
        noteId: session.noteId || note.id,
        sourceNoteTitle: note.title,
      };
      setDailyQuiz(withTitle);

      const questions = Array.isArray(session?.questions) ? session.questions : [];
      if (hooks?.clientJobId && questions.length > 0) {
        await saveGeneratedTest({
          jobId: hooks.clientJobId,
          title: `Quiz: ${note.title || 'Untitled Note'}`.slice(0, 120),
          sourceNoteId: note.id,
          stayOnNoteId: note.id,
          config: {
            sourceNoteId: note.id,
            sourceNoteTitle: note.title,
          },
          questions,
          courseId: note.courseId,
          studySetId: note.studySetId,
        });
      }
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

  /**
   * "Move to course…" (Phase 1 · B): PATCH /notes/:id { courseId } via
   * saveNote (single-column save, no CAS). When a course filter is active the
   * list is reloaded so a note moved out of scope disappears; the Library
   * overview counts are marked stale.
   */
  const handleMoveNoteToCourse = useCallback(
    async (noteId: string, courseId: string | null, topicId: string | null = null) => {
      // Leaving the course clears the topic — the server refuses a topic
      // without one, and a topic from the old course would be wrong anyway.
      await saveNote(noteId, { courseId, topicId: courseId ? topicId : null });
      useLibraryStore.getState().invalidateOverview();
      if (useNotesStore.getState().courseFilterId) {
        await loadNotes();
      }
    },
    [saveNote, loadNotes],
  );

  const handleMoveNotesToCourse = useCallback(
    async (noteIds: string[], courseId: string | null, topicId: string | null = null) => {
      if (noteIds.length === 0) return;
      if (noteIds.length === 1) {
        await handleMoveNoteToCourse(noteIds[0], courseId, topicId);
        return;
      }
      const results = await Promise.allSettled(
        noteIds.map((noteId) => saveNote(noteId, { courseId, topicId: courseId ? topicId : null })),
      );
      useLibraryStore.getState().invalidateOverview();
      if (useNotesStore.getState().courseFilterId) {
        await loadNotes();
      }
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed > 0) {
        throw new Error(
          failed === noteIds.length
            ? 'Could not move notes to this course.'
            : `${failed} of ${noteIds.length} notes could not be moved.`,
        );
      }
    },
    [handleMoveNoteToCourse, saveNote, loadNotes],
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
    handleMoveNoteToCourse,
    handleMoveNotesToCourse,
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
