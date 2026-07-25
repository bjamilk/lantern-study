import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DailyQuizSession, StudyGoalMode } from '@lantern/shared';
import {
  generateDailyQuizFromContent,
  getNoteQuiz,
  generateNoteQuiz,
  updateNoteQuiz,
} from '../services/notes';
import { trackStudyActivity } from '../services/gamification';

const todayKey = () => new Date().toISOString().slice(0, 10);

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

function withSourceTitle(
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
      name: 'lantern-mobile-study-goals',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        studyGoal: state.studyGoal,
        dailyQuiz: state.dailyQuiz,
        dailyQuizProgress: state.dailyQuizProgress,
      }),
    }
  )
);
