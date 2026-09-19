/**
 * The one registry of user-scoped store resets, run on every sign-out.
 *
 * FIXED (F1) [E3 H14, high]: `handleLogout` kept a hand-maintained list of four
 * `reset()` calls and had drifted — testStore, flashcardStore, notesStore and
 * aiJobStore were never reset. Web logout is an SPA transition with no page
 * reload, so on a shared browser the previous student's decks, flashcards,
 * notes, test results and AI jobs stayed HYDRATED and rendered for whoever
 * signed in next, until each server fetch replaced them one by one. Storage was
 * cleared; the mounted copies were not.
 *
 * Exports: `USER_SCOPED_STORE_RESETS` (the registry) and
 * `resetAllUserScopedStores()`. The registry is called from the single sign-out
 * path — `apiLogoutSession()` in services/supabase.ts, which BOTH the explicit
 * logout (hooks/useAuthHandlers) and the session-expired handler (App.tsx) go
 * through — so a new sign-out path cannot miss it.
 *
 * Adding a store: if it holds anything belonging to ONE signed-in account, add
 * it here. That is the whole maintenance rule.
 *
 * Deliberately NOT reset (unsynced work, not session state):
 *  - the offline queues (`pendingSyncResults`, pending flashcard reviews,
 *    pending question-bank scores) and their owner stamp — cross-account
 *    safety there is `services/offlineQueueOwner.ts`'s job, and erasing them
 *    would destroy work the student has not uploaded yet.
 *  - RUNNING AI jobs. A job is charged when the server accepts it, so dropping
 *    the record of one still in flight is exactly the "your work was lost"
 *    message aiJobStore exists to prevent. Finished/dismissed jobs are cleared;
 *    every aiJobStore selector is already keyed by userId, so a running job
 *    belonging to the signed-out account is invisible to the next one.
 */
import { useBudgetStore } from './budgetStore';
import { useStudyGoalsStore } from './studyGoalsStore';
import { useAcademicStore } from './academicStore';
import { useLibraryStore } from './libraryStore';
import { useTestStore } from './testStore';
import { useFlashcardStore } from './flashcardStore';
import { useNotesStore } from './notesStore';
import { useAiJobStore, isJobRunning } from './aiJobStore';
import { useNoteUploadStore } from './noteUploadStore';
import { resetAIUsageState } from '../services/ai';

export interface UserScopedReset {
  /** Name only for diagnostics — a failing reset must not take the sign-out with it. */
  name: string;
  reset: () => void;
}

export const USER_SCOPED_STORE_RESETS: UserScopedReset[] = [
  { name: 'budgetStore', reset: () => useBudgetStore.getState().reset() },
  { name: 'studyGoalsStore', reset: () => useStudyGoalsStore.getState().reset() },
  { name: 'academicStore', reset: () => useAcademicStore.getState().reset() },
  { name: 'libraryStore', reset: () => useLibraryStore.getState().reset() },
  { name: 'testStore', reset: () => useTestStore.getState().reset() },
  { name: 'flashcardStore', reset: () => useFlashcardStore.getState().reset() },
  { name: 'notesStore', reset: () => useNotesStore.getState().reset() },
  {
    name: 'aiJobStore',
    reset: () =>
      useAiJobStore.setState((state) => ({ jobs: state.jobs.filter((job) => isJobRunning(job)) })),
  },
  // #144: the note-import tray. Every row is cleared rather than only the
  // finished ones — unlike an AI job an upload costs no credit and holds no
  // generated work, so there is nothing here a student could lose, and the
  // transfer itself died with the session.
  { name: 'noteUploadStore', reset: () => useNoteUploadStore.getState().reset() },
  // Not a zustand store, but the same defect class: a module global holding one
  // account's AI credit figures (E3 M11).
  { name: 'aiUsage', reset: () => resetAIUsageState() },
];

/** Reset every user-scoped store. Never throws — a sign-out must always finish. */
export function resetAllUserScopedStores(): void {
  for (const entry of USER_SCOPED_STORE_RESETS) {
    try {
      entry.reset();
    } catch (error) {
      console.warn(`[signOut] reset failed for ${entry.name}`, error);
    }
  }
}
