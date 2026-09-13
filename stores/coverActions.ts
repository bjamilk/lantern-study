/**
 * Deck / note cover mutations.
 *
 * WHY THIS IS A STORE MODULE AND NOT A COMPONENT CONCERN. A cover is shown on
 * four surfaces at once — the deck card, the deck header, the note row, the
 * note editor — all reading the same store rows. So the mutation has to land
 * in the store, not in the screen that happened to open the picker, or the
 * card behind the dialog keeps its old tile until a refetch.
 *
 * OPTIMISM. The picker already holds a data: URL for its preview, so the store
 * takes that as the cover the instant Save is pressed and swaps in the real
 * storage path when the server answers. `useResolvedStorageUrl` passes data:
 * URLs straight through, so the same <img> renders both. On failure the
 * previous cover is put back and the error is rethrown for the dialog to show.
 */
import { createApiClient, createApiEndpoints } from '@lantern/shared/api';
import type { Deck, StudyNote } from '../types';
import { getApiRoot, getAuthHeaders } from '../services/supabase';
import { isCookieAuthEnabled } from '../services/authCookieSession';
import { useFlashcardStore } from './flashcardStore';
import { useNotesStore } from './notesStore';
import { useStudySetStore } from './studySetStore';

/**
 * Web's own client, configured exactly as services/apiEndpoints.ts configures
 * it: web auth headers, the surface stamp Phase 1 · C reads, and cookie
 * credentials ONLY in cookie-auth mode — sending them in token mode attaches
 * credentials to a cross-origin API that has none.
 */
const client = createApiClient({
  getBaseUrl: () => getApiRoot(),
  getAuthHeaders: async () => ({
    ...(await getAuthHeaders()),
    'X-Lantern-Surface': 'web',
  }),
  ...(isCookieAuthEnabled() ? { credentials: 'include' as const } : {}),
});

const endpoints = createApiEndpoints(client);

/**
 * What a successful upload returns. Declared here rather than imported from
 * the shared barrel, which does not re-export the type: `coverPath` is the
 * durable value, the two URLs are 24h-signed and must never be persisted.
 */
export interface CoverImageResult {
  coverPath: string;
  coverUrl: string;
  coverThumbUrl: string | null;
}

export interface CoverPatch {
  coverPath?: string | null;
  coverUrl?: string | null;
  coverThumbUrl?: string | null;
}

const CLEARED: CoverPatch = { coverPath: null, coverUrl: null, coverThumbUrl: null };

/**
 * Read a picked file as the bare base64 payload the route expects (no
 * `data:…;base64,` prefix — the server decodes the string as-is).
 */
export function readFileAsBase64(file: File): Promise<{ base64Data: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) {
        reject(new Error('Could not read that file.'));
        return;
      }
      resolve({ base64Data: dataUrl.slice(comma + 1), dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- decks

function currentDeckCover(deckId: string): CoverPatch {
  const deck = useFlashcardStore.getState().decks.find((d: Deck) => d.id === deckId);
  return {
    coverPath: deck?.coverPath ?? null,
    coverUrl: deck?.coverUrl ?? null,
    coverThumbUrl: deck?.coverThumbUrl ?? null,
  };
}

function patchDeckCover(deckId: string, patch: CoverPatch): void {
  useFlashcardStore.getState().updateDeckInState(deckId, patch as Partial<Deck>);
}

export async function applyDeckCover(deckId: string, file: File): Promise<CoverImageResult> {
  const previous = currentDeckCover(deckId);
  const { base64Data, dataUrl } = await readFileAsBase64(file);
  patchDeckCover(deckId, { coverPath: dataUrl, coverUrl: dataUrl, coverThumbUrl: dataUrl });
  try {
    const result = await endpoints.uploadDeckCover(deckId, {
      base64Data,
      fileName: file.name || 'cover.png',
      contentType: file.type,
    });
    patchDeckCover(deckId, result);
    return result;
  } catch (err) {
    patchDeckCover(deckId, previous);
    throw err;
  }
}

export async function removeDeckCover(deckId: string): Promise<void> {
  const previous = currentDeckCover(deckId);
  patchDeckCover(deckId, CLEARED);
  try {
    await endpoints.clearDeckCover(deckId);
  } catch (err) {
    patchDeckCover(deckId, previous);
    throw err;
  }
}

// ---------------------------------------------------------------- notes

function currentNoteCover(noteId: string): CoverPatch {
  const state = useNotesStore.getState();
  const note =
    state.notes.find((n: StudyNote) => n.id === noteId) ||
    (state.selectedNote?.id === noteId ? state.selectedNote : null);
  return {
    coverPath: note?.coverPath ?? null,
    coverUrl: note?.coverUrl ?? null,
    coverThumbUrl: note?.coverThumbUrl ?? null,
  };
}

/**
 * Patch the list row AND the open note together. They are separate objects in
 * this store, so touching only `notes` leaves the editor's banner stale (and
 * only `selectedNote` leaves the row behind it stale).
 */
function patchNoteCover(noteId: string, patch: CoverPatch): void {
  useNotesStore.setState((state) => ({
    notes: state.notes.map((n: StudyNote) => (n.id === noteId ? { ...n, ...patch } : n)),
    selectedNote:
      state.selectedNote && state.selectedNote.id === noteId
        ? { ...state.selectedNote, ...patch }
        : state.selectedNote,
  }));
}

export async function applyNoteCover(noteId: string, file: File): Promise<CoverImageResult> {
  const previous = currentNoteCover(noteId);
  const { base64Data, dataUrl } = await readFileAsBase64(file);
  patchNoteCover(noteId, { coverPath: dataUrl, coverUrl: dataUrl, coverThumbUrl: dataUrl });
  try {
    const result = await endpoints.uploadNoteCover(noteId, {
      base64Data,
      fileName: file.name || 'cover.png',
      contentType: file.type,
    });
    patchNoteCover(noteId, result);
    return result;
  } catch (err) {
    patchNoteCover(noteId, previous);
    throw err;
  }
}

export async function removeNoteCover(noteId: string): Promise<void> {
  const previous = currentNoteCover(noteId);
  patchNoteCover(noteId, CLEARED);
  try {
    await endpoints.clearNoteCover(noteId);
  } catch (err) {
    patchNoteCover(noteId, previous);
    throw err;
  }
}

// ----------------------------------------------------------- study sets

/**
 * A study set's cover is the one StudyFetch actually gives a student, and it
 * is read on more surfaces than either of the two above: the hub card, the
 * room header chip, every switcher row, the rail pill, the Home set cards.
 * They all read `useStudySetStore`, so — exactly as for decks — the mutation
 * belongs in the store and not in the modal that happened to open the picker.
 *
 * Only `coverPath` is patched here. A `StudySet` carries no `coverUrl` field;
 * every surface re-signs the path through `useResolvedStorageUrl`, which
 * passes the optimistic data: URL straight through until the upload lands.
 */
function currentStudySetCover(setId: string): string | null {
  return useStudySetStore.getState().sets.find((row) => row.id === setId)?.coverPath ?? null;
}

function patchStudySetCover(setId: string, coverPath: string | null): void {
  useStudySetStore.setState((state) => ({
    sets: state.sets.map((row) => (row.id === setId ? { ...row, coverPath } : row)),
  }));
}

export async function setStudySetCover(setId: string, file: File): Promise<CoverImageResult> {
  const previous = currentStudySetCover(setId);
  const { base64Data, dataUrl } = await readFileAsBase64(file);
  patchStudySetCover(setId, dataUrl);
  try {
    const result = await endpoints.uploadStudySetCover(setId, {
      base64Data,
      fileName: file.name || 'cover.png',
      contentType: file.type,
    });
    patchStudySetCover(setId, result.coverPath);
    return result;
  } catch (err) {
    patchStudySetCover(setId, previous);
    throw err;
  }
}

export async function removeStudySetCover(setId: string): Promise<void> {
  const previous = currentStudySetCover(setId);
  patchStudySetCover(setId, null);
  try {
    await endpoints.clearStudySetCover(setId);
  } catch (err) {
    patchStudySetCover(setId, previous);
    throw err;
  }
}

export type CoverTargetKind = 'deck' | 'note' | 'study-set';

export function applyCover(kind: CoverTargetKind, id: string, file: File): Promise<CoverImageResult> {
  if (kind === 'deck') return applyDeckCover(id, file);
  if (kind === 'study-set') return setStudySetCover(id, file);
  return applyNoteCover(id, file);
}

export function removeCover(kind: CoverTargetKind, id: string): Promise<void> {
  if (kind === 'deck') return removeDeckCover(id);
  if (kind === 'study-set') return removeStudySetCover(id);
  return removeNoteCover(id);
}

/**
 * May the signed-in user restyle this row's cover?
 *
 * The server gate is ownership (`requireDeckAccess(..., 'owner')`), so the only
 * honest client gate is the owner id. `isShared` is NOT ownership — sharing my
 * own deck with a classmate leaves it mine — and using it as a proxy hid the
 * cover entries from every deck the owner had shared out. A row that carries no
 * owner id (offline/optimistic rows) is treated as mine; the route still decides.
 */
export function canEditCover(
  ownerId: string | null | undefined,
  currentUserId: string | null | undefined
): boolean {
  if (!ownerId || !currentUserId) return true;
  return ownerId === currentUserId;
}
