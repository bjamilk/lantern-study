import { useState, useCallback } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useCompanionStore } from '../stores/companionStore';
import {
  aiGenerateQuestions,
  aiGenerateFlashcards,
  aiExplainAnswer,
  aiGetStudyRecommendations,
  aiAskTutor,
  aiEnhanceFlashcard,
  AIGeneratedQuestion,
  AIGeneratedFlashcard,
  AIStudyRecommendation,
} from '../services/ai';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import { MessageType, QuestionType, QuestionStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { sendMessage } from '../services/supabase';
import { trackAIToolUsed } from '../services/productAnalytics';

export function useAIHandlers() {
  const { currentUser } = useAuthStore();
  const { selectedChat, closeModal } = useUIStore();
  const { updateMessages } = useGroupStore();
  const { openWithMessage } = useCompanionStore();

  const [isAILoading, setIsAILoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // ─── 1. Generate Questions from notes ───────────────────────

  const handleAIGenerateQuestions = useCallback(
    async (
      notes: string,
      options?: { count?: number; difficulty?: string; questionTypes?: string[]; subject?: string }
    ): Promise<AIGeneratedQuestion[]> => {
      if (!currentUser) {
        setAiError('Please sign in to generate questions.');
        return [];
      }
      if (!selectedChat || selectedChat.chatType !== 'group') {
        setAiError('Open a group chat first, then generate questions to post for voting.');
        return [];
      }
      if (notes.trim().length < 50) {
        setAiError('Paste at least 50 characters of notes, or upload a PDF/slides file.');
        return [];
      }
      setIsAILoading(true);
      setAiError(null);
      try {
        const result = await aiGenerateQuestions(notes, options);
        trackAIToolUsed('generate_questions');
        const questions = Array.isArray(result?.questions) ? result.questions : [];
        if (questions.length === 0) {
          setAiError('AI returned no questions. Try again with more detailed notes.');
          return [];
        }
        const groupId = selectedChat.id;
        let posted = 0;
        let failed = 0;

        for (const q of questions) {
          const qOptions = q.options?.map((text) => ({ id: uuidv4(), text }));
          // Robust matching: exact match, or strip letter prefixes (e.g. "A) ..." → "..."),
          // or check if option text contains/starts with the correct answer, or vice-versa
          const normalise = (s: string) => s.replace(/^[A-Da-d][).\s]+\s*/, '').trim().toLowerCase();
          const correctNorm = q.correctAnswer ? normalise(q.correctAnswer) : '';
          const correctIds = qOptions
            ?.filter((o) => {
              if (!q.correctAnswer) return false;
              // Exact match
              if (o.text === q.correctAnswer) return true;
              // Normalised match (strip "A) " prefix)
              const optNorm = normalise(o.text);
              if (optNorm === correctNorm) return true;
              // Letter-only answer like "A" matching first option, "B" second, etc.
              const letterMatch = q.correctAnswer.trim().match(/^([A-Da-d])$/);
              if (letterMatch) {
                const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65; // A=0, B=1...
                return qOptions!.indexOf(o) === idx;
              }
              // Substring containment (answer in option or option in answer)
              if (optNorm.includes(correctNorm) || correctNorm.includes(optNorm)) return true;
              return false;
            })
            .map((o) => o.id);

          const questionType =
            q.type === 'multiple_choice'
              ? QuestionType.MULTIPLE_CHOICE_SINGLE
              : q.type === 'true_false'
              ? QuestionType.TRUE_FALSE
              : q.type === 'fill_in_blank'
              ? QuestionType.FILL_IN_THE_BLANK
              : QuestionType.OPEN_ENDED;

          const questionData = {
            type: MessageType.QUESTION,
            groupId,
            questionStem: q.text,
            explanation: q.explanation,
            questionType,
            options: qOptions,
            correctAnswerIds: correctIds,
            tags: q.topic ? [q.topic] : undefined,
            questionStatus: QuestionStatus.PENDING,
            acceptableAnswers:
              questionType === QuestionType.FILL_IN_THE_BLANK
                ? [q.correctAnswer]
                : undefined,
          };

          try {
            const content = JSON.stringify({ type: MessageType.QUESTION, ...questionData });
            const saved = await sendMessage(groupId, currentUser.id, content);
            if (saved) {
              posted += 1;
              updateMessages((prev) => ({
                ...prev,
                [groupId]: [
                  ...(prev[groupId] || []),
                  {
                    id: saved.id,
                    sender: currentUser,
                    timestamp: new Date(saved.timestamp || new Date()),
                    upvotes: 0,
                    downvotes: 0,
                    ...questionData,
                  },
                ],
              }));
            } else {
              failed += 1;
            }
          } catch {
            failed += 1;
          }
        }

        if (posted === 0) {
          setAiError('Questions were generated but could not be posted to the group chat. Check your connection and try again.');
          return questions;
        }
        if (failed > 0) {
          setAiError(`Posted ${posted} question(s); ${failed} failed to send.`);
        }
        closeModal('aiGenerateQuestions');
        return questions;
      } catch (err: any) {
        setAiError(err.message || 'Failed to generate questions');
        return [];
      } finally {
        setIsAILoading(false);
      }
    },
    [currentUser, selectedChat, updateMessages, closeModal]
  );

  // ─── 2. Generate Flashcards from notes ──────────────────────

  const handleAIGenerateFlashcards = useCallback(
    async (
      notes: string,
      options?: { count?: number; style?: 'concise' | 'detailed' }
    ): Promise<AIGeneratedFlashcard[]> => {
      setIsAILoading(true);
      setAiError(null);
      try {
        const { flashcards } = await aiGenerateFlashcards(notes, {
          ...options,
          count: normalizeFlashcardCount(options?.count),
        });
        trackAIToolUsed('generate_flashcards');
        return flashcards;
      } catch (err: any) {
        setAiError(err.message || 'Failed to generate flashcards');
        return [];
      } finally {
        setIsAILoading(false);
      }
    },
    []
  );

  // ─── 3. Explain Answer → opens companion ───────────────────

  const handleAIExplainAnswer = useCallback(
    async (
      question: string,
      userAnswer: string,
      correctAnswer: string,
      options?: string[]
    ): Promise<string | null> => {
      // Build a conversational prompt for the companion
      const optionsText = options?.length
        ? `\n\nOptions:\n${options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`
        : '';
      const companionPrompt =
        `Please explain this question:\n\n"${question}"${optionsText}\n\n` +
        `My answer: ${userAnswer}\n` +
        `Correct answer: ${correctAnswer}\n\n` +
        `Why is the correct answer right, and where did I go wrong?`;

      // Open companion panel with the pre-populated message
      openWithMessage(companionPrompt);

      // Still return a short inline explanation from the API as fallback
      setIsAILoading(true);
      setAiError(null);
      try {
        const { explanation } = await aiExplainAnswer(question, userAnswer, correctAnswer, options);
        trackAIToolUsed('explain_answer');
        return explanation;
      } catch (err: any) {
        setAiError(err.message || 'Failed to explain answer');
        return null;
      } finally {
        setIsAILoading(false);
      }
    },
    [openWithMessage]
  );

  // ─── 4. Study Recommendations (Coach) ──────────────────────

  const handleAIStudyRecommendations = useCallback(
    async (performanceData: {
      recentScores: { topic: string; score: number; date: string }[];
      flashcardAccuracy: { topic: string; correctRate: number }[];
      studyHoursThisWeek: number;
    }): Promise<AIStudyRecommendation | null> => {
      setIsAILoading(true);
      setAiError(null);
      try {
        const { recommendations } = await aiGetStudyRecommendations(performanceData);
        trackAIToolUsed('study_recommendations');
        return recommendations;
      } catch (err: any) {
        setAiError(err.message || 'Failed to get recommendations');
        return null;
      } finally {
        setIsAILoading(false);
      }
    },
    []
  );

  // ─── 5. AI Tutor (ask anything) ─────────────────────────────

  const handleAIAskTutor = useCallback(
    async (
      question: string,
      context?: { subject?: string; recentTopics?: string[] }
    ): Promise<string | null> => {
      setIsAILoading(true);
      setAiError(null);
      try {
        const { answer } = await aiAskTutor(question, context);
        trackAIToolUsed('ask_tutor');
        return answer;
      } catch (err: any) {
        setAiError(err.message || 'Failed to ask tutor');
        return null;
      } finally {
        setIsAILoading(false);
      }
    },
    []
  );

  // ─── 6. Enhance Flashcard ───────────────────────────────────

  const handleAIEnhanceFlashcard = useCallback(
    async (front: string, back: string): Promise<AIGeneratedFlashcard | null> => {
      setIsAILoading(true);
      setAiError(null);
      try {
        const { enhanced } = await aiEnhanceFlashcard(front, back);
        trackAIToolUsed('enhance_flashcard');
        return enhanced;
      } catch (err: any) {
        setAiError(err.message || 'Failed to enhance flashcard');
        return null;
      } finally {
        setIsAILoading(false);
      }
    },
    []
  );

  return {
    isAILoading,
    aiError,
    setAiError,
    handleAIGenerateQuestions,
    handleAIGenerateFlashcards,
    handleAIExplainAnswer,
    handleAIStudyRecommendations,
    handleAIAskTutor,
    handleAIEnhanceFlashcard,
  };
}
