import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DailyQuizQuestion, DailyQuizSession, StudyGoalMode } from '../types';
import * as notesApi from '../services/notes';
import { trackStudyActivity } from '../services/studyActivity';

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
}

export const useStudyGoalsStore = create<StudyGoalsState>()(
  persist(
    (set, get) => ({
      studyGoal: 'retention',
      dailyQuiz: null,
      dailyQuizProgress: 0,

      setStudyGoal: (studyGoal) => set({ studyGoal }),

      setDailyQuiz: (dailyQuiz) => {
        const answered = dailyQuiz
          ? Object.keys(dailyQuiz.answers).length
          : 0;
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
          void notesApi.updateNoteQuiz(updated.noteId, { answers: updated.answers }).catch(() => {});
        }
      },

      completeDailyQuiz: () => {
        const quiz = get().dailyQuiz;
        if (!quiz) return;
        const completedQuiz = { ...quiz, completed: true };
        set({
          dailyQuiz: completedQuiz,
          dailyQuizProgress: 100,
        });
        if (completedQuiz.noteId) {
          void notesApi.updateNoteQuiz(completedQuiz.noteId, {
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
    }),
    { name: 'lantern-study-goals' }
  )
);

export function buildDailyQuizQuestions(raw: Array<{
  text: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
}>): DailyQuizQuestion[] {
  return raw.map((q, index) => ({
    id: `dq-${index}-${Date.now()}`,
    text: q.text,
    type: q.type as DailyQuizQuestion['type'],
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    topic: q.topic,
  }));
}
