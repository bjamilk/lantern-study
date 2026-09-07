import { create } from 'zustand';
import type { NoteAttachment, NoteComment, NoteFolder, StudyNote } from '../types';
import { mergeNoteComments } from '@lantern/shared';
import * as notesApi from '../services/notes';

let loadNoteSeq = 0;

/**
 * In-flight list requests, shared between callers.
 *
 * Opening Notes fires several asks for the same two lists at once (route
 * hydration, the screen, `navigateToNotes`), and each used to be its own GET.
 * Holding the promise means they all await one request; it is released as soon
 * as that request settles, so a later, genuinely new ask still refetches.
 */
let foldersInFlight: Promise<void> | null = null;
let notesInFlight: Promise<void> | null = null;
let notesInFlightKey: string | null = null;
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
  /** Course chip filter (Notes list) — threaded into every loadNotes() as `courseId`. */
  courseFilterId: string | null;
  /**
   * Topic chip filter, one level under `courseFilterId` (Phase 1 · A). Only
   * meaningful with a real course, and cleared whenever the course changes.
   */
  topicFilterId: string | null;
  /**
   * Increments whenever a save loses an optimistic-concurrency race and the
   * authoritative note is reloaded over the user's superseded edits. The editor
   * watches this to override its local title/body with the reloaded copy.
   */
  conflictReloadToken: number;

  setFolders: (folders: NoteFolder[]) => void;
  setSelectedFolderId: (id: string | null) => void;
  /** Select a course chip (null = All) and reload the list with that filter. */
  setCourseFilter: (courseId: string | null) => Promise<void>;
  /**
   * Set course + topic together and reload once. The Library rail can change
   * only the topic, which `setCourseFilter` alone would treat as a no-op.
   */
  setTopicFilter: (courseId: string | null, topicId: string | null) => Promise<void>;
  setNotes: (notes: StudyNote[]) => void;
  setSelectedNote: (note: NotesState['selectedNote']) => void;
  setComments: (comments: NoteComment[]) => void;
  setLoading: (v: boolean) => void;
  setSaving: (v: boolean) => void;
  setError: (e: string | null) => void;

  loadFolders: () => Promise<void>;
  loadNotes: (options?: { folderId?: string; courseId?: string | null; topicId?: string | null }) => Promise<void>;
  loadNote: (noteId: string) => Promise<boolean>;
  /** `parentId` nests the new folder one level under an existing one (note_folders.parent_id). */
  createFolder: (name: string, color?: string, parentId?: string | null) => Promise<NoteFolder>;
  updateFolder: (
    folderId: string,
    updates: { name?: string; color?: string },
  ) => Promise<NoteFolder>;
  removeFolder: (folderId: string) => Promise<void>;
  createNote: (payload?: Partial<StudyNote>) => Promise<StudyNote>;
  saveNote: (noteId: string, updates: Partial<StudyNote>) => Promise<StudyNote>;
  /** Move notes into a folder, or `null` for All notes (unfiled). */
  moveNotesToFolder: (noteIds: string[], folderId: string | null) => Promise<void>;
  removeNote: (noteId: string) => Promise<void>;
  /** Permanently delete notes via the same DELETE path as single-note delete. */
  removeNotes: (noteIds: string[]) => Promise<void>;
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
  courseFilterId: null,
  topicFilterId: null,
  conflictReloadToken: 0,

  setFolders: (folders) => set({ folders }),
  setSelectedFolderId: (selectedFolderId) => set({ selectedFolderId }),
  setCourseFilter: async (courseId) => {
    if (get().courseFilterId === (courseId || null)) return;
    // A topic belongs to exactly one course, so changing course drops it.
    set({ courseFilterId: courseId || null, topicFilterId: null });
    await get().loadNotes();
  },
  setTopicFilter: async (courseId, topicId) => {
    const nextCourse = courseId || null;
    const nextTopic = nextCourse ? topicId || null : null;
    if (get().courseFilterId === nextCourse && get().topicFilterId === nextTopic) return;
    set({ courseFilterId: nextCourse, topicFilterId: nextTopic });
    await get().loadNotes();
  },
  setNotes: (notes) => set({ notes }),
  setSelectedNote: (selectedNote) => set({ selectedNote }),
  setComments: (comments) => set({ comments }),
  setLoading: (isLoading) => set({ isLoading }),
  setSaving: (isSaving) => set({ isSaving }),
  setError: (error) => set({ error }),

  /**
   * The folder list, fetched once per burst.
   *
   * Several things ask for it at the same moment on a Notes open — route
   * hydration, the screen itself, a navigation helper — and each was a
   * separate GET. The in-flight promise is shared instead: callers all await
   * the same request, and a genuinely later call still refetches.
   */
  loadFolders: async () => {
    if (foldersInFlight) return foldersInFlight;
    foldersInFlight = (async () => {
      try {
        const folders = await notesApi.fetchNoteFolders();
        set({ folders });
      } catch (e: any) {
        set({ error: e.message });
      } finally {
        foldersInFlight = null;
      }
    })();
    return foldersInFlight;
  },

  loadNotes: async (options) => {
    // Same dedupe, keyed on the filter: two callers asking for the same list at
    // the same moment share one request, while a different course/topic (or an
    // explicit override) is a different question and gets its own.
    const key = JSON.stringify([
      options && 'courseId' in options ? options.courseId : get().courseFilterId,
      options && 'topicId' in options ? options.topicId : get().topicFilterId,
      options?.folderId ?? null,
    ]);
    if (notesInFlight && notesInFlightKey === key) return notesInFlight;

    set({ isLoading: true, error: null });
    // The course chip is sticky: callers that just say loadNotes() keep the
    // filter the user picked; an explicit courseId (or null) overrides it.
    const courseId = options && 'courseId' in options ? options.courseId : get().courseFilterId;
    const topicId = options && 'topicId' in options ? options.topicId : get().topicFilterId;
    const requestedCourse = get().courseFilterId;
    const requestedTopic = get().topicFilterId;

    notesInFlightKey = key;
    notesInFlight = (async () => {
      try {
        const notes = await notesApi.fetchNotes({
          ...options,
          courseId: courseId || undefined,
          topicId: topicId || undefined,
        });
        // A chip change mid-flight wins; drop the stale response. Both halves
        // are compared — the course often stays put while only the topic moves.
        if (get().courseFilterId !== requestedCourse || get().topicFilterId !== requestedTopic) {
          return;
        }
        set({ notes, isLoading: false });
      } catch (e: any) {
        set({ error: e.message, isLoading: false });
      } finally {
        notesInFlight = null;
        notesInFlightKey = null;
      }
    })();
    return notesInFlight;
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

  createFolder: async (name, color, parentId) => {
    try {
      const folder = await notesApi.createNoteFolder({
        name,
        color,
        ...(parentId ? { parentId } : {}),
      });
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

      // Thread the FRESHEST version into content edits (title/body) so the
      // server's optimistic-concurrency check catches a cross-user overwrite.
      // Reading it HERE — inside the serialized save chain, after any prior save
      // merged its new version into the store — is what keeps a user's own rapid
      // autosaves from 409-ing against themselves. Non-content saves (pin,
      // archive, move) skip CAS: they touch single columns and must not conflict.
      const isContentEdit = 'title' in updates || 'body' in updates;
      let effectiveUpdates: Partial<StudyNote> = updates;
      if (isContentEdit && updates.version == null) {
        const freshNote =
          latest.selectedNote?.id === noteId
            ? latest.selectedNote
            : latest.notes.find((n) => n.id === noteId);
        if (freshNote?.version != null) {
          effectiveUpdates = { ...updates, version: freshNote.version };
        }
      }

      set({ isSaving: true, error: null });
      try {
        const saved = await notesApi.updateNote(noteId, effectiveUpdates);
        if (saveGenerations.get(noteId) !== generation) {
          return saved;
        }
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
          selectedNote:
            get().selectedNote?.id === noteId
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
      } catch (e: any) {
        if (saveGenerations.get(noteId) !== generation) {
          throw e;
        }

        const isConflict =
          e?.code === 'version_conflict' ||
          /updated elsewhere|version conflict|version_conflict/i.test(e?.message || '');
        if (isConflict) {
          // Someone else changed this note while the user was editing. Do NOT
          // keep the user's now-stale copy silently: pull the authoritative note
          // into the store and bump conflictReloadToken so the editor overrides
          // its local text with the latest, then throw a conflict-coded error so
          // handleAutoSave can toast the user that their edits were superseded.
          const currentFromError =
            e?.current && typeof e.current === 'object' ? (e.current as StudyNote) : null;
          const authoritative =
            currentFromError ?? (await notesApi.fetchNote(noteId).catch(() => null));
          if (authoritative && saveGenerations.get(noteId) === generation) {
            set({
              notes: get().notes.map((n) =>
                n.id === noteId
                  ? {
                      ...n,
                      ...authoritative,
                      accessRole: authoritative.accessRole ?? n.accessRole,
                      owner: authoritative.owner ?? n.owner,
                    }
                  : n,
              ),
              selectedNote:
                get().selectedNote?.id === noteId
                  ? {
                      ...get().selectedNote!,
                      ...authoritative,
                      accessRole: authoritative.accessRole ?? get().selectedNote!.accessRole,
                      owner: authoritative.owner ?? get().selectedNote!.owner,
                      attachments: get().selectedNote!.attachments,
                    }
                  : get().selectedNote,
              conflictReloadToken: get().conflictReloadToken + 1,
              isSaving: false,
              error: null,
            });
          } else {
            set({ isSaving: false });
          }
          const conflictErr = new Error(
            'This note changed elsewhere — reloading the latest version',
          ) as Error & { code?: string };
          conflictErr.code = 'version_conflict';
          throw conflictErr;
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

  moveNotesToFolder: async (noteIds, folderId) => {
    const uniqueIds = [...new Set(noteIds)].filter(Boolean);
    if (uniqueIds.length === 0) return;

    const results = await Promise.allSettled(
      uniqueIds.map((noteId) => notesApi.updateNote(noteId, { folderId })),
    );

    const savedById = new Map<string, StudyNote>();
    const failures: string[] = [];
    results.forEach((result, index) => {
      const noteId = uniqueIds[index];
      if (result.status === 'fulfilled') {
        savedById.set(noteId!, result.value);
      } else {
        failures.push(
          result.reason instanceof Error ? result.reason.message : 'Failed to move note',
        );
      }
    });

    if (savedById.size > 0) {
      const resolvedFolderId = folderId === null ? undefined : folderId;
      set({
        notes: get().notes.map((n) => {
          const saved = savedById.get(n.id);
          if (!saved) return n;
          return {
            ...n,
            ...saved,
            folderId: resolvedFolderId,
            accessRole: saved.accessRole ?? n.accessRole,
            owner: saved.owner ?? n.owner,
          };
        }),
        selectedNote: (() => {
          const current = get().selectedNote;
          if (!current || !savedById.has(current.id)) return current;
          const saved = savedById.get(current.id)!;
          return {
            ...current,
            ...saved,
            folderId: resolvedFolderId,
            accessRole: saved.accessRole ?? current.accessRole,
            owner: saved.owner ?? current.owner,
            attachments: current.attachments,
          };
        })(),
        error: failures.length > 0 ? failures[0] : null,
      });
    }

    if (failures.length > 0 && savedById.size === 0) {
      set({ error: failures[0] });
      throw new Error(failures[0]);
    }
    if (failures.length > 0) {
      throw new Error(
        savedById.size > 0
          ? `Moved ${savedById.size} note(s); ${failures.length} failed.`
          : failures[0],
      );
    }
  },

  removeNote: async (noteId) => {
    await notesApi.deleteNote(noteId);
    set({
      notes: get().notes.filter(n => n.id !== noteId),
      selectedNote: get().selectedNote?.id === noteId ? null : get().selectedNote,
    });
  },

  removeNotes: async (noteIds) => {
    const uniqueIds = [...new Set(noteIds)].filter(Boolean);
    if (uniqueIds.length === 0) return;

    const results = await Promise.allSettled(
      uniqueIds.map((noteId) => notesApi.deleteNote(noteId)),
    );

    const deletedIds = new Set<string>();
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        deletedIds.add(uniqueIds[index]!);
      } else {
        failures.push(
          result.reason instanceof Error ? result.reason.message : 'Failed to delete note',
        );
      }
    });

    if (deletedIds.size > 0) {
      const selected = get().selectedNote;
      set({
        notes: get().notes.filter((n) => !deletedIds.has(n.id)),
        selectedNote: selected && deletedIds.has(selected.id) ? null : selected,
        error: failures.length > 0 ? failures[0] : null,
      });
    }

    if (failures.length > 0 && deletedIds.size === 0) {
      set({ error: failures[0] });
      throw new Error(failures[0]);
    }
    if (failures.length > 0) {
      throw new Error(
        deletedIds.size > 0
          ? `Deleted ${deletedIds.size} note(s); ${failures.length} failed.`
          : failures[0],
      );
    }
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
      courseFilterId: null,
      topicFilterId: null,
      conflictReloadToken: 0,
    }),
}));
