/**
 * The student's study-goal mode and the single AI-generated daily quiz in
 * flight, including the one generated from a specific note.
 *
 * Main exports: `useStudyGoalsStore` (`startDailyQuizFromContent`,
 * `answerDailyQuestion`, `completeDailyQuiz`, `getDailyQuizForToday`,
 * `getQuizForNote`) and the `withSourceTitle` helper.
 *
 * Touches: services/notes (`getNoteQuiz`, `generateNoteQuiz`,
 * `updateNoteQuiz`, `generateDailyQuizFromContent`), services/gamification
 * (`trackStudyActivity`), and AsyncStorage via zustand `persist` under
 * `lantern-mobile-study-goals`.
 *
 * Gotchas: exactly ONE `dailyQuiz` is held, so starting a quiz for another
 * note replaces the previous one and `getQuizForNote` then returns null for
 * it. `startDailyQuizFromContent` falls through silently on both note-quiz
 * failures to content generation, so a server error looks like a fresh quiz.
 * Answer/complete writes to the server are fire-and-forget (`.catch(() => {})`)
 * and are not retried or queued.
 */
// FIXED (F8): the persisted quiz is per account. The zustand `persist` name is
// fixed at creation, so the scoping lives in the storage adapter below: every
// read and write goes to `lantern-mobile-study-goals:<userId>`, a read before
// auth answers returns nothing rather than the last writer's quiz, and the
// store rehydrates when the scope changes. The state itself is registered in
// stores/userScopedState so the hydrated copy goes on sign-out too.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getUserScopeId,
  readScopedWithLegacyMigration,
  registerUserScoped,
  scopedKey,
  subscribeToUserScope,
} from './userScopedState';
import type { DailyQuizSession, StudyGoalMode } from '@lantern/shared';
import {
  generateDailyQuizFromContent,
  getNoteQuiz,
  generateNoteQuiz,
  updateNoteQuiz,
} from '../services/notes';
import { trackStudyActivity } from '../services/gamification';

const todayKey = () => new Date().toISOString().slice(0, 10);

/** The pre-split key. Still read once, by the first account to hydrate. */
export const STUDY_GOALS_LEGACY_KEY = 'lantern-mobile-study-goals';

/**
 * AsyncStorage behind `persist`, redirected to the signed-in account's key.
 *
 * `persist` passes the store's fixed `name`; this adapter treats it as the BASE
 * and appends the user id. With no user resolved a read yields null — the store
 * then shows its defaults rather than another student's quiz — and a write is
 * dropped, because an unscoped key is the leak being closed.
 */
const userScopedAsyncStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const userId = getUserScopeId();
    if (!userId) return null;
    return readScopedWithLegacyMigration(name, userId);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const userId = getUserScopeId();
    if (!userId) return;
    await AsyncStorage.setItem(scopedKey(name, userId), value);
  },
  removeItem: async (name: string): Promise<void> => {
    const userId = getUserScopeId();
    if (!userId) return;
    await AsyncStorage.removeItem(scopedKey(name, userId));
  },
};

interface StudyGoalsState {
  studyGoal: StudyGoalMode;
  dailyQuiz: DailyQuizSession | null;
  dailyQuizProgress: number;
  setStudyGoal: (goal: StudyGoalMode) => void;
  setDailyQuiz: (session: DailyQuizSession | null) => void;
  answerDailyQuestion: (questionId: string, answer: string) => void;
  completeDailyQuiz: () => void;
  getDailyQuizForToday: () => DailyQuizSession | null;
  getQuizForNote: (noteId: string) => DailyQuizSession | null;
  startDailyQuizFromContent: (
    content: string,
    noteId?: string,
    sourceNoteTitle?: string
  ) => Promise<void>;
}

export function withSourceTitle(
  session: DailyQuizSession,
  sourceNoteTitle?: string
): DailyQuizSession {
  const title = sourceNoteTitle?.trim();
  return title ? { ...session, sourceNoteTitle: title } : session;
}

export const useStudyGoalsStore = create<StudyGoalsState>()(
  persist(
    (set, get) => ({
      studyGoal: 'retention',
      dailyQuiz: null,
      dailyQuizProgress: 0,

      setStudyGoal: studyGoal => set({ studyGoal }),

      setDailyQuiz: dailyQuiz => {
        const answered = dailyQuiz ? Object.keys(dailyQuiz.answers).length : 0;
        set({
          dailyQuiz,
          dailyQuizProgress:
            dailyQuiz && dailyQuiz.questions.length > 0
              ? Math.round((answered / dailyQuiz.questions.length) * 100)
              : 0,
        });
      },

      answerDailyQuestion: (questionId, answer) => {
        const quiz = get().dailyQuiz;
        if (!quiz) return;
        const updated: DailyQuizSession = {
          ...quiz,
          answers: { ...quiz.answers, [questionId]: answer },
        };
        const answered = Object.keys(updated.answers).length;
        set({
          dailyQuiz: updated,
          dailyQuizProgress: Math.round((answered / updated.questions.length) * 100),
        });
        if (updated.noteId) {
          void updateNoteQuiz(updated.noteId, { answers: updated.answers }).catch(() => {});
        }
      },

      completeDailyQuiz: () => {
        const quiz = get().dailyQuiz;
        if (!quiz) return;
        const completedQuiz = { ...quiz, completed: true };
        set({ dailyQuiz: completedQuiz, dailyQuizProgress: 100 });
        if (completedQuiz.noteId) {
          void updateNoteQuiz(completedQuiz.noteId, {
            answers: completedQuiz.answers,
            completed: true,
          }).catch(() => {});
        }
        trackStudyActivity('daily_quiz', 1);
      },

      getDailyQuizForToday: () => {
        const quiz = get().dailyQuiz;
        if (!quiz || quiz.date !== todayKey()) return null;
        return quiz;
      },

      getQuizForNote: (noteId: string) => {
        const quiz = get().dailyQuiz;
        if (!quiz || quiz.noteId !== noteId) return null;
        return quiz;
      },

      startDailyQuizFromContent: async (content, noteId, sourceNoteTitle) => {
        const { studyGoal } = get();

        if (noteId) {
          try {
            const existing = await getNoteQuiz(noteId);
            if (existing && existing.date === todayKey()) {
              get().setDailyQuiz(withSourceTitle(existing, sourceNoteTitle));
              return;
            }
          } catch {
            // Fall through to generate a fresh quiz for the note.
          }

          try {
            const session = await generateNoteQuiz(noteId, studyGoal, 5);
            get().setDailyQuiz(withSourceTitle(session, sourceNoteTitle));
            return;
          } catch {
            // Fall back to content-based generation below.
          }
        }

        const result = await generateDailyQuizFromContent(content, studyGoal, 5);
        const session: DailyQuizSession = {
          noteId: noteId || '',
          sourceNoteTitle: sourceNoteTitle?.trim() || undefined,
          date: todayKey(),
          questions: result.questions.map((q, index) => {
            const anyQ = q as {
              id?: string;
              text?: string;
              question?: string;
              type?: string;
              options?: string[];
              correctAnswer: string;
              explanation?: string;
              topic?: string;
            };
            return {
              id: anyQ.id || `dq-${index}`,
              text: String(anyQ.text || anyQ.question || ''),
              type: (anyQ.type === 'true_false' || anyQ.type === 'short_answer'
                ? anyQ.type
                : 'multiple_choice') as DailyQuizSession['questions'][number]['type'],
              options: anyQ.options,
              correctAnswer: anyQ.correctAnswer,
              explanation: String(anyQ.explanation || ''),
              topic: String(anyQ.topic || ''),
            };
          }),
          answers: {},
          completed: false,
        };
        get().setDailyQuiz(session);
      },
    }),
    {
      name: STUDY_GOALS_LEGACY_KEY,
      storage: createJSONStorage(() => userScopedAsyncStorage),
      partialize: state => ({
        studyGoal: state.studyGoal,
        dailyQuiz: state.dailyQuiz,
        dailyQuizProgress: state.dailyQuizProgress,
      }),
    }
  )
);

/**
 * FIXED (F8): the quiz in memory belongs to one account too.
 *
 * `persist` hydrates at import time, long before auth answers, so the store
 * starts on its defaults. When the scope resolves (or changes hands) the state
 * is put back to those defaults and rehydrated from the new account's key —
 * B never sees a frame of A's daily quiz, and the sign-out sweep clears it.
 */
const STUDY_GOALS_INITIAL = {
  studyGoal: 'retention' as StudyGoalMode,
  dailyQuiz: null,
  dailyQuizProgress: 0,
};

registerUserScoped('studyGoals', () => {
  useStudyGoalsStore.setState(STUDY_GOALS_INITIAL);
});

subscribeToUserScope((userId) => {
  useStudyGoalsStore.setState(STUDY_GOALS_INITIAL);
  if (userId) void useStudyGoalsStore.persist.rehydrate();
});
