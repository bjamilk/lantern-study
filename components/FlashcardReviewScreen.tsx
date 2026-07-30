
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Flashcard, FlashcardComment, FlashcardSession, FlashcardType } from '../types';
import { ArrowUturnLeftIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { escapeHtml } from '../utils/helpers';
import { useAuthStore } from '../stores/authStore';
import { fetchFlashcardComments, addFlashcardComment } from '../services/supabase';
import { FLASHCARD_GRADE_LABELS } from '@lantern/shared';
import {
  FlashcardReviewAdvanceGuard,
  formatFreeformPointsForSvg,
  getBlurRegions,
  getFreeformPaths,
  resolveAutoAdvanceDelayMs,
} from '@lantern/shared/utils';
import { normalizeUserSettings } from '@lantern/shared/settings/userSettings';
import { useCompanionStore } from '../stores/companionStore';
import { trackFlashcardReviewCompleted, trackStudyModeCompleted } from '../services/productAnalytics';
import { useRegisterFeatureTip } from './featureTips/FeatureTip';
import { ResolvedStorageImg } from './ui/ResolvedStorageImg';

interface FlashcardReviewScreenProps {
  session: FlashcardSession;
  onUpdateSrs: (cardId: string, performanceRating: 'again' | 'hard' | 'good' | 'easy') => void;
  onEndSession: () => void;
}

const FlashcardReviewScreen: React.FC<FlashcardReviewScreenProps> = ({ session, onUpdateSrs, onEndSession }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnswerShown, setIsAnswerShown] = useState(false);
  const [ratingLocked, setRatingLocked] = useState(false);
  const [comments, setComments] = useState<FlashcardComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const currentUser = useAuthStore(state => state.currentUser);
  const advanceGuardRef = useRef(new FlashcardReviewAdvanceGuard());
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAdvanceGenerationRef = useRef<number | null>(null);
  const gradingRegionRef = useRef<HTMLDivElement | null>(null);

  const currentCard = session.cardQueue[currentIndex];
  const isSessionComplete = currentIndex >= session.cardQueue.length;
  const canGoBack = currentIndex > 0;
  // Browse forward only over cards already graded — never skip an unrated card.
  const canBrowseForward =
    currentIndex < session.cardQueue.length - 1 &&
    Boolean(currentCard && advanceGuardRef.current.hasRated(currentCard.id)) &&
    pendingAdvanceGenerationRef.current == null;
  const canFlushPendingAdvance = pendingAdvanceGenerationRef.current != null;
  const canGoForward = canBrowseForward || canFlushPendingAdvance;

  useRegisterFeatureTip('flashcards.grading', !isSessionComplete && session.cardQueue.length > 0);

  const clearAutoAdvanceTimer = useCallback(() => {
    if (autoAdvanceTimerRef.current != null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    advanceGuardRef.current.setActiveCard(currentCard?.id ?? null);
    clearAutoAdvanceTimer();
    pendingAdvanceGenerationRef.current = null;
    setRatingLocked(false);
    setIsAnswerShown(false);
  }, [currentIndex, currentCard?.id, clearAutoAdvanceTimer]);

  useEffect(() => () => clearAutoAdvanceTimer(), [clearAutoAdvanceTimer]);

  const completionTrackedRef = useRef(false);
  useEffect(() => {
    if (isSessionComplete && !completionTrackedRef.current) {
      completionTrackedRef.current = true;
      trackFlashcardReviewCompleted(
        session.cardQueue.filter((c) => advanceGuardRef.current.hasRated(c.id)).length
      );
      trackStudyModeCompleted('smart_review');
    }
  }, [isSessionComplete, session.cardQueue]);

  const applyAdvance = useCallback((generation: number) => {
    if (!advanceGuardRef.current.isAdvanceGenerationCurrent(generation)) return;
    pendingAdvanceGenerationRef.current = null;
    setCurrentIndex((prev) => prev + 1);
  }, []);

  const flushPendingAdvance = useCallback(() => {
    const generation = pendingAdvanceGenerationRef.current;
    if (generation == null) return false;
    clearAutoAdvanceTimer();
    applyAdvance(generation);
    return true;
  }, [clearAutoAdvanceTimer, applyAdvance]);

  const handleRatePerformance = useCallback((rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard || ratingLocked) return;
    const claim = advanceGuardRef.current.tryClaimAdvance(currentCard.id);
    if (!claim.ok || claim.generation == null) return;

    setRatingLocked(true);
    onUpdateSrs(currentCard.id, rating);

    const delayMs = resolveAutoAdvanceDelayMs(
      normalizeUserSettings(currentUser?.settings).study.autoAdvanceDelay
    );
    clearAutoAdvanceTimer();
    if (delayMs <= 0) {
      applyAdvance(claim.generation);
      return;
    }
    pendingAdvanceGenerationRef.current = claim.generation;
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      applyAdvance(claim.generation!);
    }, delayMs);
  }, [
    currentCard,
    ratingLocked,
    onUpdateSrs,
    currentUser?.settings,
    clearAutoAdvanceTimer,
    applyAdvance,
  ]);

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
        clearAutoAdvanceTimer();
        setCurrentIndex(prev => prev - 1);
        return;
      }

      // ArrowRight only revisits already-graded cards — never skips an unrated card.
      if (event.key === 'ArrowRight' && canGoForward) {
        event.preventDefault();
        if (flushPendingAdvance()) return;
        setCurrentIndex(prev => prev + 1);
        return;
      }

      // Space / Enter: show answer (never auto-grade via native button activation).
      if ((event.key === ' ' || event.key === 'Enter') && !isAnswerShown) {
        event.preventDefault();
        setIsAnswerShown(true);
        return;
      }

      // While the answer is visible, Space must not activate a focused grade button.
      if (isAnswerShown && (event.key === ' ' || event.key === 'Spacebar')) {
        event.preventDefault();
        return;
      }

      // Anki-style ratings when answer is shown
      if (isAnswerShown && currentCard) {
        if (event.repeat) return;

        const ratingMap: Record<string, 'again' | 'hard' | 'good' | 'easy'> = {
          '1': 'again',
          '2': 'hard',
          '3': 'good',
          '4': 'easy',
        };
        const rating = ratingMap[event.key];
        if (rating) {
          event.preventDefault();
          handleRatePerformance(rating);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canGoBack,
    canGoForward,
    isSessionComplete,
    isAnswerShown,
    currentCard,
    handleRatePerformance,
    flushPendingAdvance,
  ]);

  useEffect(() => {
    if (!currentCard?.id) return;

    let cancelled = false;
    fetchFlashcardComments(currentCard.id)
      .then((data) => {
        if (!cancelled) setComments(data);
      })
      .catch((err) => {
        if (!cancelled) console.warn('Failed to load flashcard comments', err);
      });

    return () => {
      cancelled = true;
    };
  }, [currentCard?.id]);

  useEffect(() => {
    if (!isAnswerShown) return;
    // Move focus to the grading region so Space/Enter cannot re-activate a leftover button.
    gradingRegionRef.current?.focus({ preventScroll: true });
  }, [isAnswerShown, currentCard?.id]);

  const handleShowAnswer = () => setIsAnswerShown(true);

  const handlePreviousCard = () => {
    if (!canGoBack) return;
    clearAutoAdvanceTimer();
    setCurrentIndex(prev => prev - 1);
  };

  const handleNextCard = () => {
    if (!canGoForward) return;
    if (flushPendingAdvance()) return;
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
            <ResolvedStorageImg src={card.imageUrl} alt="Flashcard" className="max-w-full max-h-64 rounded-lg object-contain" />
          )}
          <p className="text-lg md:text-xl text-lantern-text">{showAnswer ? card.back : card.front}</p>
        </div>
      );
    }

    if (card.type === FlashcardType.CLOZE) {
      // Simple regex to handle {{c1::cloze text}}
      const clozeRegex = /\{\{c1::(.*?)\}\}/g;
      const content = escapeHtml(card.clozeText || '');
      if (showAnswer) {
        const revealedText = content.replace(clozeRegex, '<strong class="text-lantern-primary">$1</strong>');
        return <div className="text-lg md:text-xl text-lantern-text" dangerouslySetInnerHTML={{ __html: revealedText }} />;
      } else {
        const hiddenText = content.replace(clozeRegex, '<span class="px-2 py-1 bg-lantern-border rounded text-lantern-text">[...]</span>');
        return <div className="text-lg md:text-xl text-lantern-text" dangerouslySetInnerHTML={{ __html: hiddenText }} />;
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

    return <p className="text-lg md:text-xl text-lantern-text">{card.front}</p>;
  };

  if (isSessionComplete) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-lantern-background">
        <h2 className="text-2xl font-bold text-green-500 dark:text-green-400">Session Complete!</h2>
        <p className="text-lantern-text-secondary mt-2">You've reviewed all due cards for this deck. Great work!</p>
        <button
          onClick={onEndSession}
          className="mt-6 px-6 py-3 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-md flex items-center font-semibold transition-colors"
        >
          <ArrowUturnLeftIcon className="w-5 h-5 mr-2" /> Back to Decks
        </button>
      </div>
    );
  }

  if (!currentCard) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-lantern-background">
        <h2 className="text-xl font-semibold text-lantern-text">Card unavailable</h2>
        <p className="text-lantern-text-secondary mt-2">
          This review step could not load. Continue to the next card or end the session.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              clearAutoAdvanceTimer();
              setCurrentIndex((prev) => prev + 1);
            }}
            className="px-5 py-2.5 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-md font-semibold transition-colors"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={onEndSession}
            className="px-5 py-2.5 border border-lantern-border text-lantern-text rounded-md font-semibold hover:bg-lantern-background-secondary transition-colors"
          >
            End session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-lantern-background">
      <div className="min-h-full flex flex-col p-4 md:p-6">
      <div className="flex-shrink-0 flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold text-rose-600 dark:text-rose-400">{session.deck.name}</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-lantern-text-secondary mr-2">{currentIndex + 1} / {session.cardQueue.length}</span>
          <button
            type="button"
            onClick={handlePreviousCard}
            disabled={!canGoBack}
            className="px-3 py-1 text-sm font-medium rounded-full border border-lantern-border text-lantern-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary transition-colors"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={handleNextCard}
            disabled={!canGoForward}
            title={canGoForward ? 'Next card' : 'Rate this card to continue'}
            className="px-3 py-1 text-sm font-medium rounded-full border border-lantern-border text-lantern-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary transition-colors"
          >
            Next
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-safe-center items-center py-2">
        {isAnswerShown ? (
          <article
            className="w-full max-w-2xl min-h-[300px] bg-lantern-surface rounded-lantern-xl shadow-lg p-6 flex flex-col border border-lantern-border"
            aria-label="Flashcard answer"
          >
            <div
              key={`${currentCard.id}-back`}
              className="text-center flex-1 min-h-0 overflow-y-auto overscroll-y-contain flex flex-col justify-safe-center items-center animate-[fadeIn_0.25s_ease-out] pr-1"
            >
              {renderCardContent(currentCard, true)}
            </div>
            <div
              ref={gradingRegionRef}
              tabIndex={-1}
              className="flex-shrink-0 mt-6 pt-4 border-t border-lantern-border outline-none"
            >
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
              <p className="mb-3 text-xs text-center text-lantern-text-tertiary">1–4 to rate</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-tip-id="flashcards.grading">
                {(['again', 'hard', 'good', 'easy'] as const).map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => handleRatePerformance(grade)}
                    disabled={ratingLocked || advanceGuardRef.current.hasRated(currentCard.id)}
                    className={`py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      grade === 'again'
                        ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                        : grade === 'hard'
                          ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/60'
                          : grade === 'good'
                            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
                            : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60'
                    }`}
                  >
                    <span className="block">{FLASHCARD_GRADE_LABELS[grade].label}</span>
                    <span className="block text-xs font-normal opacity-80">{FLASHCARD_GRADE_LABELS[grade].meaning}</span>
                  </button>
                ))}
              </div>
            </div>
          </article>
        ) : (
          <div
            className="w-full max-w-2xl min-h-[300px] bg-lantern-surface rounded-lantern-xl shadow-lg p-6 flex flex-col border border-lantern-border cursor-pointer"
            onClick={handleShowAnswer}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleShowAnswer(); } }}
            aria-label="Flashcard prompt, press to reveal answer"
          >
            <div
              key={`${currentCard.id}-front`}
              className="text-center flex-1 min-h-0 overflow-y-auto overscroll-y-contain flex flex-col justify-safe-center items-center animate-[fadeIn_0.25s_ease-out] pr-1"
            >
              {renderCardContent(currentCard, false)}
              <p className="mt-4 text-xs text-lantern-text-tertiary">Space or click to reveal</p>
            </div>
            <div className="flex-shrink-0 mt-6 pt-4 border-t border-lantern-border">
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
      <div className="flex-shrink-0 mt-6 bg-lantern-surface rounded-xl shadow-inner border border-lantern-border">
        <button
          type="button"
          onClick={() => setCommentsOpen((open) => !open)}
          className="flex w-full items-center justify-between p-4 text-left"
          aria-expanded={commentsOpen}
        >
          <h3 className="text-sm font-semibold text-lantern-text">Comments</h3>
          <span className="text-xs text-lantern-text-tertiary">
            {comments.length} comment{comments.length === 1 ? '' : 's'} {commentsOpen ? '▾' : '▸'}
          </span>
        </button>

        {commentsOpen && (
          <div className="px-4 pb-4 border-t border-lantern-border pt-3">
            {comments.length === 0 ? (
              <p className="text-sm text-lantern-text-secondary">No comments yet. Add one to start a discussion.</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-lantern-background p-3">
                    <p className="text-sm text-lantern-text">{c.comment}</p>
                    <div className="text-xs text-lantern-text-tertiary mt-1">{new Date((c as any).created_at || (c as any).createdAt).toLocaleString()}</div>
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
                className="flex-1 p-2 border border-lantern-border dark:border-lantern-border rounded-md bg-lantern-surface text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
              />
              <button
                onClick={handleSubmitComment}
                disabled={isSubmittingComment || !newComment.trim()}
                className="px-3 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border disabled:cursor-not-allowed text-white rounded-md text-sm font-semibold transition-colors"
              >
                {isSubmittingComment ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 text-center pb-4">
        <button onClick={onEndSession} className="text-sm text-lantern-text-secondary hover:text-lantern-text hover:underline transition-colors">End Session Early</button>
      </div>
      </div>
    </div>
  );
};

export default FlashcardReviewScreen;