import { create } from 'zustand';
import * as notesApi from '../services/notes';
import type { NoteAttachment, NoteFolder, StudyNote } from '../services/notes';

let loadNoteSeq = 0;
const saveChains = new Map<string, Promise<unknown>>();

interface NotesState {
  folders: NoteFolder[];
  notes: StudyNote[];
  selectedNote: (StudyNote & { attachments?: NoteAttachment[] }) | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  selectedFolderId: string | null;
  loadFolders: () => Promise<void>;
  loadNotes: (folderId?: string) => Promise<void>;
  loadNote: (noteId: string) => Promise<boolean>;
  createFolder: (name: string) => Promise<NoteFolder>;
  updateFolder: (
    folderId: string,
    updates: { name?: string; color?: string },
  ) => Promise<NoteFolder>;
  removeFolder: (folderId: string) => Promise<void>;
  createNote: (payload?: Partial<StudyNote>) => Promise<StudyNote>;
  saveNote: (noteId: string, updates: Partial<StudyNote>) => Promise<StudyNote>;
  removeNote: (noteId: string) => Promise<void>;
  setSelectedFolderId: (id: string | null) => void;
  setSelectedNote: (note: (StudyNote & { attachments?: NoteAttachment[] }) | null) => void;
  setError: (e: string | null) => void;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  folders: [],
  notes: [],
  selectedNote: null,
  isLoading: false,
  isSaving: false,
  error: null,
  selectedFolderId: null,

  setSelectedFolderId: (selectedFolderId) => set({ selectedFolderId }),
  setSelectedNote: (selectedNote) => set({ selectedNote }),
  setError: (error) => set({ error }),

  loadFolders: async () => {
    try {
      const folders = await notesApi.fetchNoteFolders();
      set({ folders });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to load folders' });
    }
  },

  loadNotes: async (folderId) => {
    set({ isLoading: true, error: null });
    try {
      const notes = await notesApi.fetchNotes(folderId || undefined);
      set({ notes, isLoading: false });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to load notes', isLoading: false });
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
    } catch (e: unknown) {
      if (requestId !== loadNoteSeq) return false;
      set({
        error: e instanceof Error ? e.message : 'Failed to load note',
        isLoading: false,
        selectedNote: get().selectedNote?.id === noteId ? null : get().selectedNote,
      });
      return false;
    }
  },

  createFolder: async (name) => {
    const folder = await notesApi.createNoteFolder({ name });
    set({ folders: [...get().folders, folder] });
    return folder;
  },

  updateFolder: async (folderId, updates) => {
    const folder = await notesApi.updateNoteFolder(folderId, updates);
    set({
      folders: get().folders.map((f) => (f.id === folderId ? folder : f)),
    });
    return folder;
  },

  removeFolder: async (folderId) => {
    await notesApi.deleteNoteFolder(folderId);
    const { selectedFolderId, notes } = get();
    set({
      folders: get().folders.filter((f) => f.id !== folderId),
      selectedFolderId: selectedFolderId === folderId ? null : selectedFolderId,
      notes: notes.map((n) =>
        n.folderId === folderId ? { ...n, folderId: undefined } : n,
      ),
    });
  },

  createNote: async (payload) => {
    const note = await notesApi.createNote(payload || { title: 'Untitled Note', body: '' });
    set({ notes: [note, ...get().notes] });
    return note;
  },

  saveNote: async (noteId, updates) => {
    const state = get();
    if (state.selectedNote?.id !== noteId && !state.notes.some((n) => n.id === noteId)) {
      return null as unknown as StudyNote;
    }

    const runSave = async () => {
      const latest = get();
      if (latest.selectedNote?.id !== noteId && !latest.notes.some((n) => n.id === noteId)) {
        return null as unknown as StudyNote;
      }
      set({ isSaving: true });
      try {
        const saved = await notesApi.updateNote(noteId, updates);
        set({
          notes: get().notes.map((n) =>
            n.id === noteId
              ? {
                  ...n,
                  ...saved,
                  accessRole: saved.accessRole ?? n.accessRole,
                  owner: saved.owner ?? n.owner,
                }
              : n,
          ),
          selectedNote: get().selectedNote?.id === noteId
            ? {
                ...get().selectedNote!,
                ...saved,
                accessRole: saved.accessRole ?? get().selectedNote!.accessRole,
                owner: saved.owner ?? get().selectedNote!.owner,
                attachments: get().selectedNote!.attachments,
              }
            : get().selectedNote,
          isSaving: false,
        });
        return saved;
      } catch (e: unknown) {
        set({ isSaving: false, error: e instanceof Error ? e.message : 'Save failed' });
        throw e;
      }
    };

    const previous = saveChains.get(noteId) || Promise.resolve();
    const next = previous.then(runSave, runSave);
    saveChains.set(noteId, next.catch(() => {}));
    return next;
  },

  removeNote: async (noteId) => {
    await notesApi.deleteNote(noteId);
    set({ notes: get().notes.filter((n) => n.id !== noteId) });
  },
}));
