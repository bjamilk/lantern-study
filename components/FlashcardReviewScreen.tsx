

import React, { useState, useEffect, useMemo } from 'react';
import { Deck, Flashcard, FlashcardComment, FlashcardSession, FlashcardType } from '../types';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { escapeHtml } from '../utils/helpers';
import { useAuthStore } from '../stores/authStore';
import { fetchFlashcardComments, addFlashcardComment } from '../services/supabase';

interface FlashcardReviewScreenProps {
  session: FlashcardSession;
  onUpdateSrs: (cardId: string, performanceRating: 'again' | 'hard' | 'good' | 'easy') => void;
  onEndSession: () => void;
}

const FlashcardReviewScreen: React.FC<FlashcardReviewScreenProps> = ({ session, onUpdateSrs, onEndSession }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnswerShown, setIsAnswerShown] = useState(false);
  const [comments, setComments] = useState<FlashcardComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const currentUser = useAuthStore(state => state.currentUser);

  const currentCard = session.cardQueue[currentIndex];
  const isSessionComplete = currentIndex >= session.cardQueue.length;

  useEffect(() => {
    // Reset answer visibility when card changes
    setIsAnswerShown(false);
  }, [currentIndex]);

  useEffect(() => {
    if (!currentCard?.id) return;

    fetchFlashcardComments(currentCard.id)
      .then(setComments)
      .catch((err) => {
        console.warn('Failed to load flashcard comments', err);
      });
  }, [currentCard?.id]);

  const handleShowAnswer = () => setIsAnswerShown(true);

  const handleRatePerformance = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    onUpdateSrs(currentCard.id, rating);
    setCurrentIndex(prev => prev + 1);
  };

  const handleSubmitComment = async () => {
    if (!currentCard?.id || !currentUser?.id || !newComment.trim()) return;
    setIsSubmittingComment(true);
    try {
      const created = await addFlashcardComment(currentCard.id, currentUser.id, newComment.trim());
      setComments(prev => [...prev, created]);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment', err);
      alert('Failed to add comment. Please try again.');
    } finally {
      setIsSubmittingComment(false);
    }
  };
  
  const renderCardContent = (card: Flashcard, showAnswer: boolean) => {
    if (card.type === FlashcardType.BASIC) {
      return (
        <div className="flex flex-col items-center gap-4">
          {card.imageUrl && !showAnswer && (
            <img src={card.imageUrl} alt="Flashcard" className="max-w-full max-h-64 rounded-lg object-contain" />
          )}
          <p className="text-lg md:text-xl text-slate-800 dark:text-slate-100">{showAnswer ? card.back : card.front}</p>
        </div>
      );
    }

    if (card.type === FlashcardType.CLOZE) {
      // Simple regex to handle {{c1::cloze text}}
      const clozeRegex = /\{\{c1::(.*?)\}\}/g;
      const content = escapeHtml(card.clozeText || '');
      if (showAnswer) {
        const revealedText = content.replace(clozeRegex, '<strong class="text-blue-600 dark:text-blue-400">$1</strong>');
        return <div className="text-lg md:text-xl text-slate-800 dark:text-slate-100" dangerouslySetInnerHTML={{ __html: revealedText }} />;
      } else {
        const hiddenText = content.replace(clozeRegex, '<span class="px-2 py-1 bg-slate-200 dark:bg-slate-600 rounded text-slate-800 dark:text-slate-200">[...]</span>');
        return <div className="text-lg md:text-xl text-slate-800 dark:text-slate-100" dangerouslySetInnerHTML={{ __html: hiddenText }} />;
      }
    }

    if (card.type === FlashcardType.IMAGE_OCCLUSION) {
      const overlayOpacity = showAnswer ? 0 : 1;
      const overlayTransition = 'transition-opacity duration-500 ease-out';
      return (
        <div className="flex flex-col items-center gap-3">
          {card.front ? <p className="text-lg md:text-xl text-slate-800 dark:text-slate-100">{card.front}</p> : null}
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
            <div className="text-sm text-slate-500 dark:text-slate-400">No image provided.</div>
          )}
        </div>
      );
    }

    return <p className="text-lg md:text-xl text-slate-800 dark:text-slate-100">{card.front}</p>;
  };

  if (isSessionComplete) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-100 dark:bg-slate-900">
        <h2 className="text-2xl font-bold text-green-500 dark:text-green-400">Session Complete!</h2>
        <p className="text-slate-600 dark:text-slate-400 mt-2">You've reviewed all due cards for this deck. Great work!</p>
        <button
          onClick={onEndSession}
          className="mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center font-semibold transition-colors"
        >
          <ArrowUturnLeftIcon className="w-5 h-5 mr-2" /> Back to Decks
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-slate-100 dark:bg-slate-900">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold text-rose-600 dark:text-rose-400">{session.deck.name}</h1>
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-200 dark:bg-slate-700 px-3 py-1 rounded-full">
          {currentIndex + 1} / {session.cardQueue.length}
        </span>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center">
        <div className="w-full max-w-2xl min-h-[300px] bg-white dark:bg-slate-800 rounded-xl shadow-lg dark:shadow-slate-900/50 p-6 flex flex-col justify-between border border-transparent dark:border-slate-700">
          {/* Card Content */}
          <div className="text-center flex-grow flex flex-col justify-center items-center">
            {renderCardContent(currentCard, false)}
            
            {isAnswerShown && (
              <>
                <hr className="w-1/4 my-4 border-slate-300 dark:border-slate-600" />
                {renderCardContent(currentCard, true)}
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
            {!isAnswerShown ? (
              <button
                onClick={handleShowAnswer}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-lg font-semibold transition-colors"
              >
                Show Answer
              </button>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onClick={() => handleRatePerformance('again')} className="py-3 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg font-semibold hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors">Again</button>
                <button onClick={() => handleRatePerformance('hard')} className="py-3 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded-lg font-semibold hover:bg-orange-200 dark:hover:bg-orange-900/60 transition-colors">Hard</button>
                <button onClick={() => handleRatePerformance('good')} className="py-3 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg font-semibold hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors">Good</button>
                <button onClick={() => handleRatePerformance('easy')} className="py-3 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg font-semibold hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors">Easy</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6 p-4 bg-white dark:bg-slate-800 rounded-xl shadow-inner border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Comments</h3>
          <span className="text-xs text-slate-400">{comments.length} comment{comments.length === 1 ? '' : 's'}</span>
        </div>

        {comments.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No comments yet. Add one to start a discussion.</p>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-sm text-slate-700 dark:text-slate-200">{c.comment}</p>
                <div className="text-xs text-slate-400 mt-1">{new Date((c as any).created_at || (c as any).createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 p-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleSubmitComment}
            disabled={isSubmittingComment || !newComment.trim()}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white rounded-md text-sm font-semibold transition-colors"
          >
            {isSubmittingComment ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>

      <div className="flex-shrink-0 text-center pb-4">
        <button onClick={onEndSession} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:underline transition-colors">End Session Early</button>
      </div>
    </div>
  );
};

export default FlashcardReviewScreen;