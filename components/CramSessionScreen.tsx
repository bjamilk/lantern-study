import React, { useState, useEffect } from 'react';
import { Deck, Flashcard, FlashcardSession, FlashcardType } from '../types';
import { ArrowUturnLeftIcon, CheckIcon, XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { escapeHtml } from '../utils/helpers';
import { FLASHCARD_MODE_LABELS } from '@lantern/shared';
import { formatFreeformPointsForSvg, getBlurRegions, getFreeformPaths } from '@lantern/shared/utils';
import { useCompanionStore } from '../stores/companionStore';
import { ResolvedStorageImg } from './ui/ResolvedStorageImg';

interface CramSessionScreenProps {
  session: FlashcardSession;
  onAnswer: (cardId: string, isCorrect: boolean) => void;
  onEndSession: (stats: { correct: number, incorrect: number }) => void;
  onCramIncorrect: (incorrectCards: Flashcard[]) => void;
}

const formatTime = (totalSeconds: number): string => {
  if (totalSeconds < 0) totalSeconds = 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const CramSessionScreen: React.FC<CramSessionScreenProps> = ({ session, onAnswer, onEndSession, onCramIncorrect }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnswerShown, setIsAnswerShown] = useState(false);
  const [incorrectCards, setIncorrectCards] = useState<Flashcard[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isTimeLow, setIsTimeLow] = useState(false);

  const currentCard = session.cardQueue[currentIndex];
  const isSessionComplete = currentIndex >= session.cardQueue.length;
  const isTimedDrill = Boolean(session.endTime || session.timerSeconds);
  const modeLabel = isTimedDrill
    ? FLASHCARD_MODE_LABELS.timed_drill.label
    : FLASHCARD_MODE_LABELS.speed_run.label;

  useEffect(() => {
    // This effect runs when the session prop changes, which happens
    // when starting a new cram session (e.g., "Cram Incorrect").
    // We reset all internal state to start the new session fresh.
    setCurrentIndex(0);
    setIncorrectCards([]);
    setCorrectCount(0);
  }, [session]);

  useEffect(() => {
    // When the card or the entire session changes, hide the answer.
    setIsAnswerShown(false);
  }, [currentIndex, session]);

  useEffect(() => {
    // Timed sessions will automatically end when the timer hits zero.
    if (!session.endTime) {
      setTimeLeft(null);
      setIsTimeLow(false);
      return;
    }

    const getTimeLeft = () => {
      const endTimeMs = new Date(session.endTime!).getTime();
      const diffSeconds = Math.round((endTimeMs - Date.now()) / 1000);
      setTimeLeft(diffSeconds);

      if (session.timerSeconds) {
        setIsTimeLow(diffSeconds <= session.timerSeconds * 0.1);
      }

      if (diffSeconds <= 0) {
        onEndSession({ correct: correctCount, incorrect: incorrectCards.length });
      }
    };

    getTimeLeft();
    const timerId = setInterval(getTimeLeft, 1000);
    return () => clearInterval(timerId);
  }, [session.endTime, session.timerSeconds, correctCount, incorrectCards.length, onEndSession]);

  const handleAnswer = (isCorrect: boolean) => {
    if (!currentCard) return;
    
    onAnswer(currentCard.id, isCorrect); // This is for potential future use, not strictly needed now.

    if (isCorrect) {
      setCorrectCount(prev => prev + 1);
    } else {
      setIncorrectCards(prev => [...prev, currentCard]);
    }
    setCurrentIndex(prev => prev + 1);
  };

  const renderCardContent = (card: Flashcard, showAnswer: boolean) => {
    if (card.type === FlashcardType.BASIC) {
      return (
        <div className="flex flex-col items-center gap-4">
          {card.imageUrl && !showAnswer && (
            <ResolvedStorageImg src={card.imageUrl} alt="Flashcard" className="max-w-full max-h-64 rounded-lg object-contain" />
          )}
          <p className="text-lg md:text-xl text-lantern-text">{showAnswer ? card.back : card.front}</p>
        </div>
      );
    }

    if (card.type === FlashcardType.CLOZE) {
      const clozeRegex = /\{\{c1::(.*?)\}\}/g;
      const content = escapeHtml(card.clozeText || '');
      if (showAnswer) {
        const revealedText = content.replace(clozeRegex, '<strong class="text-lantern-primary">$1</strong>');
        return <div className="text-lg md:text-xl" dangerouslySetInnerHTML={{ __html: revealedText }} />;
      } else {
        const hiddenText = content.replace(clozeRegex, '<span class="px-2 py-1 bg-lantern-background-secondary dark:bg-lantern-border rounded">[...]</span>');
        return <div className="text-lg md:text-xl" dangerouslySetInnerHTML={{ __html: hiddenText }} />;
      }
    }

    if (card.type === FlashcardType.IMAGE_OCCLUSION) {
      const overlayOpacity = showAnswer ? 0 : 1;
      const overlayTransition = 'transition-opacity duration-500 ease-out';

      return (
        <div className="flex flex-col items-center gap-3">
          {card.front ? <p className="text-lg md:text-xl text-lantern-text">{card.front}</p> : null}
          {card.imageUrl ? (
            <div className="relative inline-block max-w-full">
              <ResolvedStorageImg
                src={card.imageUrl}
                alt="Flashcard"
                className="block max-w-full max-h-[min(70vh,560px)] h-auto rounded-lg shadow-sm"
              />

              {card.occlusionData?.type === 'rectangles' && card.occlusionData.rectangles?.map((rect, idx) => (
                <div
                  key={idx}
                  className={`${overlayTransition} absolute bg-black/70 border border-white/40`}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                    opacity: overlayOpacity,
                  }}
                />
              ))}

              {card.occlusionData?.type === 'circles' && card.occlusionData.circles?.map((circle, idx) => (
                <div
                  key={idx}
                  className={`${overlayTransition} absolute bg-black/70 border border-white/40 rounded-full`}
                  style={{
                    left: `${(circle.x - circle.radius) * 100}%`,
                    top: `${(circle.y - circle.radius) * 100}%`,
                    width: `${circle.radius * 2 * 100}%`,
                    height: `${circle.radius * 2 * 100}%`,
                    opacity: overlayOpacity,
                  }}
                />
              ))}

              {card.occlusionData?.type === 'freeform' && getFreeformPaths(card.occlusionData).length > 0 && (
                <svg
                  className={`${overlayTransition} absolute inset-0 w-full h-full pointer-events-none`}
                  style={{ opacity: overlayOpacity }}
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                >
                  {getFreeformPaths(card.occlusionData).map((path, idx) => (
                    <polygon
                      key={idx}
                      points={formatFreeformPointsForSvg(path.points)}
                      fill="rgba(0,0,0,0.7)"
                      stroke="rgba(255,255,255,0.7)"
                      strokeWidth={0.004}
                    />
                  ))}
                </svg>
              )}

              {card.occlusionData?.type === 'blur' && getBlurRegions(card.occlusionData).map((blur, idx) => (
                <div
                  key={idx}
                  className={`${overlayTransition} absolute border border-white/40`}
                  style={{
                    left: `${blur.x * 100}%`,
                    top: `${blur.y * 100}%`,
                    width: `${blur.width * 100}%`,
                    height: `${blur.height * 100}%`,
                    backdropFilter: `blur(${blur.radius * 40}px)`,
                    backgroundColor: `rgba(255,255,255,${blur.opacity ?? 0.4})`,
                    opacity: overlayOpacity,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-lantern-text-secondary">No image provided.</div>
          )}
        </div>
      );
    }

    // Unknown type
    return <p className="text-lg md:text-xl text-lantern-text">{card.front}</p>;
  };

  if (isSessionComplete) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-2xl font-bold text-lantern-primary">Cram Session Complete!</h2>
        <p className="text-lantern-text-secondary mt-2">You reviewed {session.cardQueue.length} cards.</p>
        <div className="my-6 text-xl">
            <p>Correct: <span className="font-bold text-green-500">{correctCount}</span></p>
            <p>Incorrect: <span className="font-bold text-red-500">{incorrectCards.length}</span></p>
        </div>
        <div className="flex space-x-4">
            <button
              onClick={() => onEndSession({ correct: correctCount, incorrect: incorrectCards.length })}
              className="px-6 py-3 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-md flex items-center font-semibold"
            >
              <ArrowUturnLeftIcon className="w-5 h-5 mr-2" /> Finish
            </button>
            {incorrectCards.length > 0 && (
                 <button
                    onClick={() => onCramIncorrect(incorrectCards)}
                    className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-md flex items-center font-semibold"
                >
                    Cram Incorrect ({incorrectCards.length})
                </button>
            )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-lantern-background-secondary dark:bg-lantern-background">
      <div className="min-h-full flex flex-col p-4 md:p-6">
      <div className="flex-shrink-0 flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-semibold text-lantern-primary">{modeLabel} — {session.deck.name}</h1>
          {timeLeft !== null && (
            <div className="mt-1 text-sm font-medium text-lantern-text-secondary">
              Time left: <span className={isTimeLow ? 'text-rose-600 dark:text-rose-400' : ''}>{formatTime(timeLeft)}</span>
            </div>
          )}
        </div>
        <span className="text-sm font-medium text-lantern-text-secondary bg-lantern-background-secondary dark:bg-lantern-surface-secondary px-3 py-1 rounded-full">
          {currentIndex + 1} / {session.cardQueue.length}
        </span>
      </div>

      <div className="flex-1 flex flex-col justify-safe-center items-center py-2">
        <div className="w-full max-w-2xl min-h-[300px] bg-lantern-surface dark:bg-lantern-surface rounded-xl shadow-lg p-6 flex flex-col">
          <div className="text-center flex-1 min-h-0 overflow-y-auto overscroll-y-contain flex flex-col justify-safe-center items-center pr-1">
            {renderCardContent(currentCard, false)}
            
            {isAnswerShown && (
              <>
                <hr className="w-1/4 my-4 border-lantern-border" />
                {renderCardContent(currentCard, true)}
              </>
            )}
          </div>

          <div className="flex-shrink-0 mt-6 pt-4 border-t border-lantern-border">
            {!isAnswerShown ? (
              <button
                onClick={() => setIsAnswerShown(true)}
                className="w-full py-3 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lg text-lg font-semibold transition"
              >
                Show Answer
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => handleAnswer(false)} className="py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold flex items-center justify-center">
                    <XMarkIcon className="w-6 h-6 mr-2" /> Incorrect
                </button>
                 <button onClick={() => handleAnswer(true)} className="py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center">
                    <CheckIcon className="w-6 h-6 mr-2" /> Correct
                </button>
              </div>
            )}
            {/* Leech card helper */}
            {isAnswerShown && (currentCard.srsData?.isLeech || (currentCard.srsData?.failedAttempts ?? 0) >= 3) && (
              <div className="mt-3 flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                <span className="text-sm text-amber-700 dark:text-amber-400">Keep struggling with this one?</span>
                <button
                  onClick={() => {
                    const companion = useCompanionStore.getState();
                    companion.open();
                    companion.sendMessage(`I keep getting this flashcard wrong in cram mode. Can you explain it differently and give me a mnemonic? Front: "${currentCard.front || currentCard.clozeText || ''}". Back: "${currentCard.back || ''}"`);
                  }}
                  className="ml-3 flex items-center gap-1 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-md transition-colors"
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  Ask Lantern
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex-shrink-0 text-center pb-4">
        <button onClick={() => onEndSession({ correct: correctCount, incorrect: incorrectCards.length })} className="text-sm text-lantern-text-secondary hover:underline">End Cram Session</button>
      </div>
      </div>
    </div>
  );
};

export default CramSessionScreen;
