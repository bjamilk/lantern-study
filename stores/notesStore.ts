import { create } from 'zustand';
import type { NoteAttachment, NoteComment, NoteFolder, StudyNote } from '../types';
import * as notesApi from '../services/notes';

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
  loadNote: (noteId: string) => Promise<void>;
  createFolder: (name: string, color?: string) => Promise<NoteFolder>;
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
    set({ isLoading: true, error: null });
    try {
      const note = await notesApi.fetchNote(noteId);
      set({ selectedNote: note, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
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
    set({ isSaving: true });
    try {
      const saved = await notesApi.updateNote(noteId, updates);
      set({
        notes: get().notes.map(n => (n.id === noteId ? { ...n, ...saved } : n)),
        selectedNote:
          get().selectedNote?.id === noteId
            ? { ...get().selectedNote!, ...saved }
            : get().selectedNote,
        isSaving: false,
      });
      return saved;
    } catch (e: any) {
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
    set({ comments });
  },

  postComment: async (noteId, comment) => {
    const created = await notesApi.addNoteComment(noteId, comment);
    set({ comments: [...get().comments, created] });
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
