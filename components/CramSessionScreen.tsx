import React, { useState, useEffect } from 'react';
import { Deck, Flashcard, FlashcardSession, FlashcardType } from '../types';
import { ArrowUturnLeftIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { escapeHtml } from '../utils/helpers';

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
            <img src={card.imageUrl} alt="Flashcard" className="max-w-full max-h-64 rounded-lg object-contain" />
          )}
          <p className="text-lg md:text-xl text-gray-800 dark:text-gray-200">{showAnswer ? card.back : card.front}</p>
        </div>
      );
    }

    if (card.type === FlashcardType.CLOZE) {
      const clozeRegex = /\{\{c1::(.*?)\}\}/g;
      const content = escapeHtml(card.clozeText || '');
      if (showAnswer) {
        const revealedText = content.replace(clozeRegex, '<strong class="text-blue-600 dark:text-blue-400">$1</strong>');
        return <div className="text-lg md:text-xl" dangerouslySetInnerHTML={{ __html: revealedText }} />;
      } else {
        const hiddenText = content.replace(clozeRegex, '<span class="px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded">[...]</span>');
        return <div className="text-lg md:text-xl" dangerouslySetInnerHTML={{ __html: hiddenText }} />;
      }
    }

    if (card.type === FlashcardType.IMAGE_OCCLUSION) {
      const overlayOpacity = showAnswer ? 0 : 1;
      const overlayTransition = 'transition-opacity duration-500 ease-out';

      return (
        <div className="flex flex-col items-center gap-3">
          {card.front ? <p className="text-lg md:text-xl text-gray-800 dark:text-gray-200">{card.front}</p> : null}
          {card.imageUrl ? (
            <div className="relative inline-block max-w-full">
              <img
                src={card.imageUrl}
                alt="Flashcard"
                className="block max-w-full max-h-[400px] h-auto rounded-lg shadow-sm"
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

              {card.occlusionData?.type === 'freeform' && card.occlusionData.freeform?.points && (
                <svg className={`${overlayTransition} absolute inset-0 w-full h-full pointer-events-none`} style={{ opacity: overlayOpacity }}>
                  <polyline
                    points={card.occlusionData.freeform.points.map(p => `${p.x * 100},${p.y * 100}`).join(' ')}
                    className="fill-black/50 stroke-white/70 stroke-2"
                  />
                </svg>
              )}

              {card.occlusionData?.type === 'blur' && (Array.isArray(card.occlusionData.blur) ? card.occlusionData.blur : [card.occlusionData.blur]).map((blur, idx) => (
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
            <div className="text-sm text-gray-500 dark:text-gray-400">No image provided.</div>
          )}
        </div>
      );
    }

    // Unknown type
    return <p className="text-lg md:text-xl text-gray-800 dark:text-gray-200">{card.front}</p>;
  };

  if (isSessionComplete) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-2xl font-bold text-purple-500">Cram Session Complete!</h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">You reviewed {session.cardQueue.length} cards.</p>
        <div className="my-6 text-xl">
            <p>Correct: <span className="font-bold text-green-500">{correctCount}</span></p>
            <p>Incorrect: <span className="font-bold text-red-500">{incorrectCards.length}</span></p>
        </div>
        <div className="flex space-x-4">
            <button
              onClick={() => onEndSession({ correct: correctCount, incorrect: incorrectCards.length })}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center font-semibold"
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
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-gray-100 dark:bg-slate-900">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-xl font-semibold text-purple-600 dark:text-purple-400">Cramming: {session.deck.name}</h1>
          {timeLeft !== null && (
            <div className="mt-1 text-sm font-medium text-gray-500 dark:text-gray-400">
              Time left: <span className={isTimeLow ? 'text-rose-600 dark:text-rose-400' : ''}>{formatTime(timeLeft)}</span>
            </div>
          )}
        </div>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full">
          {currentIndex + 1} / {session.cardQueue.length}
        </span>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center">
        <div className="w-full max-w-2xl min-h-[300px] bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col justify-between">
          <div className="text-center flex-grow flex flex-col justify-center items-center">
            {renderCardContent(currentCard, false)}
            
            {isAnswerShown && (
              <>
                <hr className="w-1/4 my-4 border-gray-300 dark:border-gray-600" />
                {renderCardContent(currentCard, true)}
              </>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            {!isAnswerShown ? (
              <button
                onClick={() => setIsAnswerShown(true)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-lg font-semibold transition"
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
          </div>
        </div>
      </div>
      <div className="flex-shrink-0 text-center pb-4">
        <button onClick={() => onEndSession({ correct: correctCount, incorrect: incorrectCards.length })} className="text-sm text-gray-500 dark:text-gray-400 hover:underline">End Cram Session</button>
      </div>
    </div>
  );
};

export default CramSessionScreen;
