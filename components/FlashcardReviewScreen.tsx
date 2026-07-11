

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Deck, Flashcard, FlashcardComment, FlashcardSession, FlashcardType } from '../types';
import { ArrowUturnLeftIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { escapeHtml } from '../utils/helpers';
import { useAuthStore } from '../stores/authStore';
import { fetchFlashcardComments, addFlashcardComment } from '../services/supabase';
import { formatFreeformPointsForSvg, getBlurRegions, getFreeformPaths } from '@lantern/shared/utils';
import { useCompanionStore } from '../stores/companionStore';

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
  const ratedCardIdsRef = useRef(new Set<string>());
  const gradingRef = useRef(false);

  const currentCard = session.cardQueue[currentIndex];
  const isSessionComplete = currentIndex >= session.cardQueue.length;
  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < session.cardQueue.length - 1;

  useEffect(() => {
    // Reset answer visibility when card changes
    setIsAnswerShown(false);
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable;

      if (isTypingTarget || isSessionComplete) return;

      if (event.key === 'ArrowLeft' && canGoBack) {
        event.preventDefault();
        setCurrentIndex(prev => prev - 1);
        return;
      }

      if (event.key === 'ArrowRight' && canGoForward) {
        event.preventDefault();
        setCurrentIndex(prev => prev + 1);
        return;
      }

      // Space / Enter: show answer
      if ((event.key === ' ' || event.key === 'Enter') && !isAnswerShown) {
        event.preventDefault();
        setIsAnswerShown(true);
        return;
      }

      // Anki-style ratings when answer is shown
      if (isAnswerShown && currentCard) {
        if (event.repeat) return;
        if (gradingRef.current || ratedCardIdsRef.current.has(currentCard.id)) return;

        const ratingMap: Record<string, 'again' | 'hard' | 'good' | 'easy'> = {
          '1': 'again',
          '2': 'hard',
          '3': 'good',
          '4': 'easy',
        };
        const rating = ratingMap[event.key];
        if (rating) {
          event.preventDefault();
          gradingRef.current = true;
          ratedCardIdsRef.current.add(currentCard.id);
          onUpdateSrs(currentCard.id, rating);
          setCurrentIndex(prev => prev + 1);
          gradingRef.current = false;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canGoBack, canGoForward, isSessionComplete, isAnswerShown, currentCard, onUpdateSrs]);

  useEffect(() => {
    if (!currentCard?.id) return;

    fetchFlashcardComments(currentCard.id)
      .then(setComments)
      .catch((err) => {
        console.warn('Failed to load flashcard comments', err);
      });
  }, [currentCard?.id]);

  const handleShowAnswer = () => setIsAnswerShown(true);

  const handlePreviousCard = () => {
    if (!canGoBack) return;
    setCurrentIndex(prev => prev - 1);
  };

  const handleNextCard = () => {
    if (!canGoForward) return;
    setCurrentIndex(prev => prev + 1);
  };

  const handleRatePerformance = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard || gradingRef.current || ratedCardIdsRef.current.has(currentCard.id)) return;
    gradingRef.current = true;
    ratedCardIdsRef.current.add(currentCard.id);
    onUpdateSrs(currentCard.id, rating);
    setCurrentIndex(prev => prev + 1);
    gradingRef.current = false;
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
      useToastStore.getState().showToast('Failed to add comment. Please try again.', 'error');
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
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-lantern-background">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold text-rose-600 dark:text-rose-400">{session.deck.name}</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-lantern-text-secondary mr-2">{currentIndex + 1} / {session.cardQueue.length}</span>
          <button
            onClick={handlePreviousCard}
            disabled={!canGoBack}
            className="px-3 py-1 text-sm font-medium rounded-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Prev
          </button>
          <button
            onClick={handleNextCard}
            disabled={!canGoForward}
            className="px-3 py-1 text-sm font-medium rounded-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Next
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center">
        {isAnswerShown ? (
          <article
            className="w-full max-w-2xl min-h-[300px] bg-lantern-surface rounded-lantern-xl shadow-lg p-6 flex flex-col justify-between border border-lantern-border"
            aria-label="Flashcard answer"
          >
            <div
              key={`${currentCard.id}-back`}
              className="text-center flex-grow flex flex-col justify-center items-center animate-[fadeIn_0.25s_ease-out]"
            >
              {renderCardContent(currentCard, true)}
            </div>
            <div className="mt-6 pt-4 border-t border-lantern-border">
              {(currentCard.srsData?.isLeech || (currentCard.srsData?.failedAttempts ?? 0) >= 3) && (
                <div className="mb-3 flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                  <span className="text-sm text-amber-700 dark:text-amber-400">You've struggled with this card. Want some help?</span>
                  <button
                    type="button"
                    onClick={() => {
                      const companion = useCompanionStore.getState();
                      companion.open();
                      companion.sendMessage(`I keep getting this flashcard wrong. Can you help me understand it and give me a mnemonic? Front: "${currentCard.front || currentCard.clozeText || ''}". Back: "${currentCard.back || ''}"`);
                    }}
                    className="ml-3 flex items-center gap-1 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-md transition-colors"
                  >
                    <SparklesIcon className="w-3.5 h-3.5" />
                    Ask Lantern
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button type="button" onClick={() => handleRatePerformance('again')} className="py-3 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg font-semibold hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors">Again</button>
                <button type="button" onClick={() => handleRatePerformance('hard')} className="py-3 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded-lg font-semibold hover:bg-orange-200 dark:hover:bg-orange-900/60 transition-colors">Hard</button>
                <button type="button" onClick={() => handleRatePerformance('good')} className="py-3 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg font-semibold hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors">Good</button>
                <button type="button" onClick={() => handleRatePerformance('easy')} className="py-3 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg font-semibold hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors">Easy</button>
              </div>
            </div>
          </article>
        ) : (
          <div
            className="w-full max-w-2xl min-h-[300px] bg-lantern-surface rounded-lantern-xl shadow-lg p-6 flex flex-col justify-between border border-lantern-border cursor-pointer"
            onClick={handleShowAnswer}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleShowAnswer(); } }}
            aria-label="Flashcard prompt, press to reveal answer"
          >
            <div
              key={`${currentCard.id}-front`}
              className="text-center flex-grow flex flex-col justify-center items-center animate-[fadeIn_0.25s_ease-out]"
            >
              {renderCardContent(currentCard, false)}
              <p className="mt-4 text-xs text-lantern-text-tertiary">Space or click to reveal · 1–4 to rate</p>
            </div>
            <div className="mt-6 pt-4 border-t border-lantern-border">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleShowAnswer(); }}
                className="w-full py-3 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lg text-lg font-semibold transition-colors"
              >
                Show Answer
              </button>
            </div>
          </div>
        )}
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