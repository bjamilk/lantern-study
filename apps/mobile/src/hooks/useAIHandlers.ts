/**
 * Mobile AI Handlers Hook
 * Wraps AI service calls with loading state, error handling.
 * Mirrors web hooks/useAIHandlers.ts adapted for React Native.
 */
import { useState, useCallback } from 'react';
import {
  aiGenerateQuestions,
  aiGenerateFlashcards,
  aiExplainAnswer,
  aiGetStudyRecommendations,
  aiAskTutor,
  aiEnhanceFlashcard,
  type AIGeneratedQuestion,
  type AIGeneratedFlashcard,
  type AIStudyRecommendation,
} from '../services/ai';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import type { AIStudyPerformanceData } from '@lantern/shared/api';
import { trackAIToolUsed } from '../services/productAnalytics';

export function useAIHandlers() {
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // ─── 1. Generate Questions from notes ────────────────────

  const handleAIGenerateQuestions = useCallback(
    async (
      notes: string,
      options?: { count?: number; difficulty?: string; questionTypes?: string[]; subject?: string }
    ): Promise<AIGeneratedQuestion[]> => {
      setIsAILoading(true);
      setAiError(null);
      try {
        const { questions } = await aiGenerateQuestions(notes, options);
        trackAIToolUsed('generate_questions');
        return questions;
      } catch (err: any) {
        setAiError(err.message || 'Failed to generate questions');
        return [];
      } finally {
        setIsAILoading(false);
      }
    },
    []
  );

  // ─── 2. Generate Flashcards from notes ──────────────────

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

  // ─── 3. Explain Answer ──────────────────────────────────

  const handleAIExplainAnswer = useCallback(
    async (
      question: string,
      userAnswer: string,
      correctAnswer: string,
      options?: string[]
    ): Promise<string | null> => {
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
    []
  );

  // ─── 4. Study Recommendations (Coach) ──────────────────

  const handleAIStudyRecommendations = useCallback(
    async (performanceData: AIStudyPerformanceData): Promise<AIStudyRecommendation | null> => {
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

  // ─── 5. AI Tutor (ask anything) ─────────────────────────

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

  // ─── 6. Enhance Flashcard ──────────────────────────────

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
