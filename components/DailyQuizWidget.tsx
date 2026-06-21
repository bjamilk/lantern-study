import React, { useEffect, useState } from 'react';
import { SparklesIcon, CheckCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import type { DailyQuizSession, StudyGoalMode } from '../types';
import { Button } from './ui';
import { isQuizAnswerCorrect, resolveQuizCorrectAnswer } from '../utils/quizAnswerHelpers';

interface DailyQuizWidgetProps {
  theme: 'light' | 'dark';
  studyGoal: StudyGoalMode;
  dailyQuiz: DailyQuizSession | null;
  progress: number;
  onStudyGoalChange: (goal: StudyGoalMode) => void;
  onStartQuiz: () => void;
  onAnswer: (questionId: string, answer: string) => void;
  onComplete: () => void;
  onRegenerateQuiz?: () => void;
  title?: string;
}

const goalLabels: Record<StudyGoalMode, string> = {
  casual: 'Casual review',
  retention: 'Long-term retention',
  exam_prep: 'Exam preparation',
};

const DailyQuizWidget: React.FC<DailyQuizWidgetProps> = ({
  theme,
  studyGoal,
  dailyQuiz,
  progress,
  onStudyGoalChange,
  onStartQuiz,
  onAnswer,
  onComplete,
  onRegenerateQuiz,
  title = 'Daily quiz',
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const isDark = theme === 'dark';

  useEffect(() => {
    if (!dailyQuiz) {
      setCurrentIndex(0);
      setSelected('');
      setFeedback(null);
      setAnswered(false);
      return;
    }
    const firstUnanswered = dailyQuiz.questions.findIndex(q => !dailyQuiz.answers[q.id]);
    setCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
    setSelected('');
    setFeedback(null);
    setAnswered(false);
  }, [dailyQuiz?.noteId, dailyQuiz?.questions.length, dailyQuiz?.completed]);

  if (!dailyQuiz) {
    return (
      <div className={`rounded-xl border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{title}</h3>
          <select
            value={studyGoal}
            onChange={e => onStudyGoalChange(e.target.value as StudyGoalMode)}
            className={`text-sm rounded-lg border px-2 py-1 ${isDark ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-200'}`}
          >
            {Object.entries(goalLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <p className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          Answer a few quick questions from your recent notes to reinforce learning.
        </p>
        <Button onClick={onStartQuiz}>
          <SparklesIcon className="w-4 h-4 mr-1" />
          Start today&apos;s quiz
        </Button>
      </div>
    );
  }

  if (dailyQuiz.completed) {
    return (
      <div className={`rounded-xl border p-4 ${isDark ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'}`}>
        <div className="flex items-center gap-2 text-green-600 font-semibold">
          <CheckCircleIcon className="w-5 h-5" />
          {title} complete!
        </div>
        <p className={`text-sm mt-2 mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {onRegenerateQuiz
            ? 'Generate a fresh set of questions from this note.'
            : 'Great work — come back tomorrow for a new set.'}
        </p>
        {onRegenerateQuiz && (
          <Button size="sm" onClick={onRegenerateQuiz}>
            <ArrowPathIcon className="w-4 h-4 mr-1" />
            Generate new set
          </Button>
        )}
      </div>
    );
  }

  const question = dailyQuiz.questions[currentIndex];
  if (!question) return null;

  const submitAnswer = () => {
    if (!selected || answered) return;
    onAnswer(question.id, selected);
    const correct = isQuizAnswerCorrect(selected, question);
    const resolvedCorrect = resolveQuizCorrectAnswer(question.correctAnswer, question.options);
    setFeedback(
      correct
        ? 'Correct!'
        : `Incorrect. The correct answer is: ${resolvedCorrect}. ${question.explanation}`
    );
    setAnswered(true);
  };

  const goToNext = () => {
    setFeedback(null);
    setSelected('');
    setAnswered(false);
    if (currentIndex < dailyQuiz.questions.length - 1) {
      setCurrentIndex(i => i + 1);
    } else {
      onComplete();
    }
  };

  const isLastQuestion = currentIndex >= dailyQuiz.questions.length - 1;

  return (
    <div className={`rounded-xl border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={`font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>{title}</h3>
        <span className="text-xs text-indigo-500">{progress}% · {goalLabels[studyGoal]}</span>
      </div>
      <p className={`text-sm mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Q{currentIndex + 1}/{dailyQuiz.questions.length}: {question.text}
      </p>
      {question.options ? (
        <div className="space-y-2 mb-3">
          {question.options.map(opt => (
            <button
              key={opt}
              type="button"
              disabled={answered}
              onClick={() => setSelected(opt)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${
                selected === opt
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                  : isDark
                    ? 'border-gray-600 text-gray-200'
                    : 'border-gray-200 text-gray-700'
              } ${answered ? 'opacity-70 cursor-default' : ''}`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <input
          value={selected}
          onChange={e => setSelected(e.target.value)}
          disabled={answered}
          className={`w-full px-3 py-2 rounded-lg border mb-3 text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-200'} ${answered ? 'opacity-70' : ''}`}
          placeholder="Your answer"
        />
      )}
      {feedback && (
        <p className={`text-sm mb-3 ${feedback.startsWith('Correct') ? 'text-green-600 dark:text-green-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
          {feedback}
        </p>
      )}
      {!answered ? (
        <Button size="sm" onClick={submitAnswer} disabled={!selected}>
          Submit
        </Button>
      ) : (
        <Button size="sm" onClick={goToNext}>
          {isLastQuestion ? 'Finish quiz' : 'Next question'}
        </Button>
      )}
    </div>
  );
};

export default DailyQuizWidget;
