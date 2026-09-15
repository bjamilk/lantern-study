/**
 * "Pick up where you left off": the last thing the student studied, plus the
 * server's recent materials/activities lists that the dashboard resume card
 * renders.
 *
 * Exports: `useStudyResumeStore` — the `StudyResume` fields (`lastActivity`,
 * `recentMaterials`, `recentActivities`) plus `loaded`, `recordActivity` and
 * `loadResume`.
 *
 * Touches: `localStorage[STUDY_RESUME_STORAGE_KEY]` (from @lantern/shared),
 * written directly rather than through zustand persist, and
 * `fetchStudyResume()` in services/academic.
 *
 * Gotchas:
 *  - The storage key is not user-scoped and nothing here clears it, so on a
 *    shared browser the previous student's last activity is read at store
 *    construction and shown until `loadResume` answers.
 *  - `loadResume` falls back to the STORED activity when the server sends none,
 *    so a server that has genuinely forgotten the last activity cannot clear
 *    the local one.
 *  - `recordActivity` only writes local state and storage — it does not tell
 *    the server; the server list is populated by the study endpoints
 *    themselves. `recentMaterials` is server-only and is not updated here.
 *  - Failures set `loaded: true` with whatever was already in state, so
 *    "loaded" does not mean "fetched".
 */
import { create } from 'zustand';
import {
  emptyStudyResume,
  parseStudyResumeActivity,
  STUDY_RESUME_STORAGE_KEY,
  type StudyResume,
  type StudyResumeActivity,
} from '@lantern/shared';
import { fetchStudyResume } from '../services/academic';

function readStoredActivity(): StudyResumeActivity | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return parseStudyResumeActivity(JSON.parse(localStorage.getItem(STUDY_RESUME_STORAGE_KEY) || 'null'));
  } catch {
    return null;
  }
}

interface StudyResumeState extends StudyResume {
  loaded: boolean;
  recordActivity: (activity: StudyResumeActivity) => void;
  loadResume: () => Promise<void>;
}

export const useStudyResumeStore = create<StudyResumeState>((set) => ({
  ...emptyStudyResume(),
  lastActivity: readStoredActivity(),
  loaded: false,
  recordActivity: (activity) => {
    try {
      localStorage.setItem(STUDY_RESUME_STORAGE_KEY, JSON.stringify(activity));
    } catch {
      // private mode
    }
    set((state) => ({
      lastActivity: activity,
      recentActivities: [activity, ...state.recentActivities.filter((row) => row.href !== activity.href)].slice(0, 12),
    }));
  },
  loadResume: async () => {
    try {
      const data = (await fetchStudyResume()) as StudyResume;
      set({
        lastActivity: data.lastActivity || readStoredActivity(),
        recentMaterials: data.recentMaterials || [],
        recentActivities: data.recentActivities || [],
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
}));
