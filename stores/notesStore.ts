import { create } from 'zustand';
import type { NoteAttachment, NoteComment, NoteFolder, StudyNote } from '../types';
import { mergeNoteComments } from '@lantern/shared';
import * as notesApi from '../services/notes';

let loadNoteSeq = 0;
const saveChains = new Map<string, Promise<unknown>>();
const saveGenerations = new Map<string, number>();

interface NotesState {
  folders: NoteFolder[];
  notes: StudyNote[];
  selectedNote: (StudyNote & { attachments?: NoteAttachment[] }) | null;
  comments: NoteComment[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  selectedFolderId: string | null;

  setFolders: (folders: NoteFolder[]) => void;
  setSelectedFolderId: (id: string | null) => void;
  setNotes: (notes: StudyNote[]) => void;
  setSelectedNote: (note: NotesState['selectedNote']) => void;
  setComments: (comments: NoteComment[]) => void;
  setLoading: (v: boolean) => void;
  setSaving: (v: boolean) => void;
  setError: (e: string | null) => void;

  loadFolders: () => Promise<void>;
  loadNotes: (options?: { folderId?: string }) => Promise<void>;
  loadNote: (noteId: string) => Promise<boolean>;
  createFolder: (name: string, color?: string) => Promise<NoteFolder>;
  updateFolder: (
    folderId: string,
    updates: { name?: string; color?: string },
  ) => Promise<NoteFolder>;
  removeFolder: (folderId: string) => Promise<void>;
  createNote: (payload?: Partial<StudyNote>) => Promise<StudyNote>;
  saveNote: (noteId: string, updates: Partial<StudyNote>) => Promise<StudyNote>;
  removeNote: (noteId: string) => Promise<void>;
  loadComments: (noteId: string) => Promise<void>;
  postComment: (noteId: string, comment: string) => Promise<void>;
  reset: () => void;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  folders: [],
  notes: [],
  selectedNote: null,
  comments: [],
  isLoading: false,
  isSaving: false,
  error: null,
  selectedFolderId: null,

  setFolders: (folders) => set({ folders }),
  setSelectedFolderId: (selectedFolderId) => set({ selectedFolderId }),
  setNotes: (notes) => set({ notes }),
  setSelectedNote: (selectedNote) => set({ selectedNote }),
  setComments: (comments) => set({ comments }),
  setLoading: (isLoading) => set({ isLoading }),
  setSaving: (isSaving) => set({ isSaving }),
  setError: (error) => set({ error }),

  loadFolders: async () => {
    try {
      const folders = await notesApi.fetchNoteFolders();
      set({ folders });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadNotes: async (options) => {
    set({ isLoading: true, error: null });
    try {
      const notes = await notesApi.fetchNotes(options);
      set({ notes, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  loadNote: async (noteId) => {
    const requestId = ++loadNoteSeq;
    set({ isLoading: true, error: null });
    try {
      const note = await notesApi.fetchNote(noteId);
      if (requestId !== loadNoteSeq) return false;
      set({ selectedNote: note, isLoading: false });
      return true;
    } catch (e: any) {
      if (requestId !== loadNoteSeq) return false;
      set({
        error: e.message,
        isLoading: false,
        selectedNote: get().selectedNote?.id === noteId ? null : get().selectedNote,
      });
      return false;
    }
  },

  createFolder: async (name, color) => {
    try {
      const folder = await notesApi.createNoteFolder({ name, color });
      set({ folders: [...get().folders, folder], error: null });
      return folder;
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  updateFolder: async (folderId, updates) => {
    try {
      const folder = await notesApi.updateNoteFolder(folderId, updates);
      set({
        folders: get().folders.map((f) => (f.id === folderId ? folder : f)),
        error: null,
      });
      return folder;
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  removeFolder: async (folderId) => {
    try {
      await notesApi.deleteNoteFolder(folderId);
      const { selectedFolderId, notes } = get();
      set({
        folders: get().folders.filter((f) => f.id !== folderId),
        selectedFolderId:
          selectedFolderId === folderId ? null : selectedFolderId,
        // DB clears folder_id on delete; mirror that locally so chips stay accurate.
        notes: notes.map((n) =>
          n.folderId === folderId ? { ...n, folderId: undefined } : n,
        ),
        error: null,
      });
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  createNote: async (payload) => {
    try {
      const note = await notesApi.createNote(payload || { title: 'Untitled Note', body: '' });
      set({ notes: [note, ...get().notes], error: null });
      return note;
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  saveNote: async (noteId, updates) => {
    const state = get();
    if (state.selectedNote?.id !== noteId && !state.notes.some((n) => n.id === noteId)) {
      return null as unknown as StudyNote;
    }

    const generation = (saveGenerations.get(noteId) ?? 0) + 1;
    saveGenerations.set(noteId, generation);

    const runSave = async () => {
      const latest = get();
      if (latest.selectedNote?.id !== noteId && !latest.notes.some((n) => n.id === noteId)) {
        return null as unknown as StudyNote;
      }
      set({ isSaving: true, error: null });
      try {
        const saved = await notesApi.updateNote(noteId, updates);
        if (saveGenerations.get(noteId) !== generation) {
          return saved;
        }
        set({
          notes: get().notes.map(n => (n.id === noteId ? { ...n, ...saved } : n)),
          selectedNote:
            get().selectedNote?.id === noteId
              ? {
                  ...get().selectedNote!,
                  ...saved,
                  attachments: get().selectedNote!.attachments,
                }
              : get().selectedNote,
          isSaving: false,
        });
        return saved;
      } catch (e: any) {
        if (saveGenerations.get(noteId) !== generation) {
          throw e;
        }
        const isNotFound = /not found|404/i.test(e.message || '');
        set({
          error: isNotFound ? null : e.message,
          isSaving: false,
          ...(isNotFound
            ? {
                notes: get().notes.filter(n => n.id !== noteId),
                selectedNote: get().selectedNote?.id === noteId ? null : get().selectedNote,
              }
            : {}),
        });
        if (!isNotFound) throw e;
        return null as unknown as StudyNote;
      }
    };

    const previous = saveChains.get(noteId) || Promise.resolve();
    const next = previous.then(runSave, runSave);
    saveChains.set(noteId, next.catch(() => {}));
    return next;
  },

  removeNote: async (noteId) => {
    await notesApi.deleteNote(noteId);
    set({
      notes: get().notes.filter(n => n.id !== noteId),
      selectedNote: get().selectedNote?.id === noteId ? null : get().selectedNote,
    });
  },

  loadComments: async (noteId) => {
    const comments = await notesApi.fetchNoteComments(noteId);
    set((state) => {
      if (state.selectedNote?.id !== noteId) return state;
      const currentForNote = state.comments.filter((comment) => comment.noteId === noteId);
      return { comments: mergeNoteComments(currentForNote, comments) };
    });
  },

  postComment: async (noteId, comment) => {
    const created = await notesApi.addNoteComment(noteId, comment);
    set((state) => ({
      comments: mergeNoteComments(
        state.comments.filter((existing) => existing.noteId === noteId),
        [created]
      ),
    }));
  },

  reset: () =>
    set({
      folders: [],
      notes: [],
      selectedNote: null,
      comments: [],
      isLoading: false,
      isSaving: false,
      error: null,
      selectedFolderId: null,
    }),
}));
