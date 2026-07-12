import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DailyQuizSession, StudyGoalMode } from '@lantern/shared';
import { Card, Button } from './ui';

const GOAL_LABELS: Record<StudyGoalMode, string> = {
  casual: 'Casual review',
  retention: 'Long-term retention',
  exam_prep: 'Exam preparation',
};

interface Props {
  studyGoal: StudyGoalMode;
  dailyQuiz: DailyQuizSession | null;
  progress: number;
  loading?: boolean;
  onStudyGoalChange: (goal: StudyGoalMode) => void;
  onStartQuiz: () => void;
  onAnswer: (questionId: string, answer: string) => void;
  onComplete: () => void;
}

export function DailyQuizWidget({
  studyGoal,
  dailyQuiz,
  progress,
  loading,
  onStudyGoalChange,
  onStartQuiz,
  onAnswer,
  onComplete,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!dailyQuiz) {
      setCurrentIndex(0);
      setFeedback(null);
    }
  }, [dailyQuiz?.date, dailyQuiz?.completed]);

  if (!dailyQuiz) {
    return (
      <Card className="mb-4 p-4">
        <Text className="font-semibold text-lantern-text mb-2">Daily quiz</Text>
        <Text className="text-sm text-lantern-text-secondary mb-3">
          Quick questions from your notes to reinforce learning.
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-3">
          {(Object.keys(GOAL_LABELS) as StudyGoalMode[]).map(goal => (
            <Pressable
              key={goal}
              onPress={() => onStudyGoalChange(goal)}
              className={`px-3 py-1.5 rounded-full border ${
                studyGoal === goal
                  ? 'bg-lantern-primary-background dark:bg-lantern-primary-dark/40 border-lantern-primary'
                  : 'border-lantern-border'
              }`}
            >
              <Text className="text-xs text-lantern-text">{GOAL_LABELS[goal]}</Text>
            </Pressable>
          ))}
        </View>
        <Button fullWidth loading={loading} onPress={onStartQuiz}>
          Start today&apos;s quiz
        </Button>
      </Card>
    );
  }

  if (dailyQuiz.completed) {
    return (
      <Card className="mb-4 p-4 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
        <View className="flex-row items-center gap-2">
          <Ionicons name="checkmark-circle" size={22} color="#10b981" />
          <Text className="font-semibold text-emerald-700 dark:text-emerald-300">Daily quiz complete!</Text>
        </View>
        <Text className="text-sm text-lantern-text-secondary mt-2">Come back tomorrow for a new set.</Text>
      </Card>
    );
  }

  const question = dailyQuiz.questions[currentIndex];
  if (!question) return null;
  const alreadyAnswered = dailyQuiz.answers[question.id];

  const handleSelect = (option: string) => {
    if (alreadyAnswered) return;
    const correct =
      option.trim().toLowerCase() === String(question.correctAnswer).trim().toLowerCase();
    setFeedback(correct ? 'Correct!' : `Incorrect — ${question.correctAnswer}`);
    onAnswer(question.id, option);
    if (currentIndex + 1 >= dailyQuiz.questions.length) {
      setTimeout(onComplete, 600);
    } else {
      setTimeout(() => {
        setCurrentIndex(i => i + 1);
        setFeedback(null);
      }, 700);
    }
  };

  return (
    <Card className="mb-4 p-4">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="font-semibold text-lantern-text">Daily quiz</Text>
        <Text className="text-xs text-lantern-text-secondary">{progress}% · Q{currentIndex + 1}/{dailyQuiz.questions.length}</Text>
      </View>
      <Text className="text-sm text-lantern-text mb-3">{question.text}</Text>
      <View className="gap-2">
        {(question.options || []).map(opt => (
          <Pressable
            key={opt}
            onPress={() => handleSelect(opt)}
            disabled={!!alreadyAnswered}
            className="px-3 py-2.5 rounded-xl border border-lantern-border bg-lantern-background-secondary"
          >
            <Text className="text-sm text-lantern-text">{opt}</Text>
          </Pressable>
        ))}
      </View>
      {feedback ? (
        <Text className={`text-sm mt-3 ${feedback.startsWith('Correct') ? 'text-emerald-600' : 'text-red-500'}`}>
          {feedback}
        </Text>
      ) : loading ? (
        <ActivityIndicator className="mt-3" color="#6366f1" />
      ) : null}
    </Card>
  );
}
