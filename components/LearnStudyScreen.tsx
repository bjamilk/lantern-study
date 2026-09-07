import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLASHCARD_MODE_LABELS } from '@lantern/shared';
import { Flashcard } from '../types';
import { shuffleArray } from '../utils/helpers';
import { Button } from './ui';
import { AppIcon } from './ui/AppIcon';
import { trackStudyModeCompleted } from '../services/productAnalytics';

interface LearnStudyScreenProps {
  cards: Flashcard[];
  deckName: string;
  onExit: () => void;
  theme?: 'light' | 'dark';
}

type Phase = 'mcq' | 'typed' | 'done';

export const LearnStudyScreen: React.FC<LearnStudyScreenProps> = ({
  cards,
  deckName,
  onExit,
  theme = 'light',
}) => {
  const [queue, setQueue] = useState(() => shuffleArray(cards.filter((c) => c.front && (c.back || c.clozeText))));
  const [phase, setPhase] = useState<Phase>('mcq');
  const [typedAnswer, setTypedAnswer] = useState('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [mastered, setMastered] = useState(0);
  const isDark = theme === 'dark';
  const completionTrackedRef = useRef(false);

  const current = queue[0];
  const progress = mastered;
  const total = cards.length;

  const mcqOptions = useMemo(() => {
    if (!current || phase !== 'mcq') return [];
    const correct = current.back || current.clozeText || '';
    const distractors = shuffleArray(
      cards.filter((c) => c.id !== current.id && (c.back || c.clozeText)).map((c) => c.back || c.clozeText || '')
    ).slice(0, 3);
    return shuffleArray([correct, ...distractors]);
  }, [current, phase, cards]);

  const advance = useCallback((correct: boolean) => {
    if (!current) return;
    if (correct) {
      setMastered((m) => m + 1);
      setQueue((q) => q.slice(1));
      setPhase('mcq');
      setFeedback(null);
      setTypedAnswer('');
      if (queue.length <= 1) setPhase('done');
    } else {
      setQueue((q) => [...q.slice(1), current]);
      setPhase('mcq');
      setFeedback(null);
      setTypedAnswer('');
    }
  }, [current, queue.length]);

  useEffect(() => {
    if (phase === 'done' && !completionTrackedRef.current) {
      completionTrackedRef.current = true;
      trackStudyModeCompleted('quiz');
    }
  }, [phase]);

  const handleMcq = (option: string) => {
    const correct = current?.back || current?.clozeText || '';
    if (option === correct) {
      setFeedback('correct');
      setTimeout(() => advance(true), 600);
    } else {
      setFeedback('wrong');
      setTimeout(() => advance(false), 800);
    }
  };

  const handleTypedSubmit = () => {
    const correct = (current?.back || current?.clozeText || '').toLowerCase().trim();
    const given = typedAnswer.toLowerCase().trim();
    const isCorrect = given === correct || correct.includes(given) || given.includes(correct);
    setFeedback(isCorrect ? 'correct' : 'wrong');
    setTimeout(() => advance(isCorrect), 800);
  };

  if (!current && phase !== 'done') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-lantern-text-secondary">No cards available for Learn mode.</p>
        <Button onClick={onExit} className="ml-4">Exit</Button>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-8 ${isDark ? 'bg-lantern-background' : 'bg-lantern-background'}`}>
        <AppIcon name="checkmark-circle" size={64} className="text-emerald-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Session complete!</h2>
        <p className="text-lantern-text-secondary mb-6">Mastered {mastered} of {total} cards</p>
        <Button onClick={onExit}>Done</Button>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col ${isDark ? 'bg-lantern-background text-lantern-text' : 'bg-lantern-background text-lantern-text'}`}>
      <div className="flex items-center justify-between p-4 border-b border-lantern-border">
        <div>
          <h1 className="font-bold">{FLASHCARD_MODE_LABELS.quiz.label} — {deckName}</h1>
          <p className="text-sm text-lantern-text-secondary">{progress}/{total} mastered</p>
        </div>
        <button onClick={onExit} className="p-2 rounded-lg hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary">
          <AppIcon name="close" size={20} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-lg mx-auto w-full">
        <div className={`w-full p-6 rounded-2xl border mb-6 text-center ${isDark ? 'bg-lantern-surface border-lantern-border' : 'bg-lantern-surface border-lantern-border shadow-sm'}`}>
          <p className="text-xs uppercase tracking-wide text-lantern-text-tertiary mb-2">Question</p>
          <p className="text-xl font-semibold">{current?.front || current?.clozeText}</p>
        </div>

        {phase === 'mcq' && (
          <div className="w-full space-y-2">
            {mcqOptions.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleMcq(opt)}
                disabled={feedback !== null}
                className={`w-full p-4 rounded-xl border-2 text-left transition-colors ${
                  feedback === 'correct' && opt === (current?.back || current?.clozeText)
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                    : feedback === 'wrong'
                    ? 'border-lantern-border opacity-60'
                    : `${isDark ? 'border-lantern-border bg-lantern-surface hover:border-lantern-primary' : 'border-lantern-border bg-lantern-surface hover:border-lantern-primary/30'}`
                }`}
              >
                {opt}
              </button>
            ))}
            <button onClick={() => setPhase('typed')} className="w-full text-sm text-lantern-primary mt-2">
              Switch to typed answer →
            </button>
          </div>
        )}

        {phase === 'typed' && (
          <div className="w-full space-y-3">
            <input
              type="text"
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTypedSubmit()}
              placeholder="Type your answer..."
              className={`w-full px-4 py-3 rounded-xl border text-lg ${isDark ? 'bg-lantern-surface-secondary border-lantern-border' : 'bg-lantern-surface border-lantern-border'}`}
              autoFocus
            />
            <Button onClick={handleTypedSubmit} disabled={!typedAnswer.trim()} className="w-full">
              Check answer
            </Button>
            <button onClick={() => setPhase('mcq')} className="w-full text-sm text-lantern-text-tertiary">
              ← Back to multiple choice
            </button>
          </div>
        )}

        {feedback && (
          <p className={`mt-4 font-semibold ${feedback === 'correct' ? 'text-emerald-500' : 'text-red-500'}`}>
            {feedback === 'correct' ? 'Correct!' : `Answer: ${current?.back || current?.clozeText}`}
          </p>
        )}
      </div>
    </div>
  );
};

export default LearnStudyScreen;
