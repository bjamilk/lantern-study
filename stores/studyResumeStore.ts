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
