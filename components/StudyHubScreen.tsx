import React from 'react';
import {
  AcademicCapIcon,
  PlayIcon,
  RectangleStackIcon,
  SparklesIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { Deck, Flashcard, TestSessionData, StudySessionData, PausedSessionSummary } from '../types';
import { getStudyAllDueLabel, getStudyCtaLabel, FLASHCARD_MODE_LABELS, isCardDue } from '@lantern/shared';
import { ScreenHeader, Card, Button, StatPill } from './ui';
import SavedSessionsList from './SavedSessionsList';

interface StudyHubScreenProps {
  dueCardsCount: number;
  decks: Deck[];
  flashcards?: Flashcard[];
  onStartDueReview: () => void;
  onOpenLibrary: () => void;
  onOpenAITools: () => void;
  onSelectDeck: (deck: Deck) => void;
  onStartLearn?: (deck: Deck) => void;
  /** Launches the real SRS review for a deck. When absent, rows fall back to the Learn quiz with honest labels. */
  onStartReview?: (deckId: string) => void;
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
  pausedSessions?: PausedSessionSummary[];
  onResumePausedSession?: (sessionId: string) => void;
  onAbandonPausedSession?: (sessionId: string) => void;
  recentTestCount?: number;
  onViewRecentTests?: () => void;
}

export const StudyHubScreen: React.FC<StudyHubScreenProps> = ({
  dueCardsCount,
  decks,
  flashcards = [],
  onStartDueReview,
  onOpenLibrary,
  onOpenAITools,
  onSelectDeck,
  onStartLearn,
  onStartReview,
  activeTestSession,
  activeStudySession,
  onResumeSession,
  pausedSessions = [],
  onResumePausedSession,
  onAbandonPausedSession,
  recentTestCount = 0,
  onViewRecentTests,
}) => {
  const hasPausedSession = Boolean(activeTestSession || activeStudySession);
  const topDecks = decks.slice(0, 4);
  const quizLabel = FLASHCARD_MODE_LABELS.quiz.label;
  // Only advertise "Smart review" when the rows can actually launch the SRS review.
  // Without onStartReview, rows launch the non-SRS Learn quiz, so header/button must say so.
  const deckSectionLabel = onStartReview ? FLASHCARD_MODE_LABELS.smart_review.label : quizLabel;

  const getDeckDueCount = (deckId: string) =>
    flashcards.filter((fc) => fc.deckId === deckId && isCardDue(fc.srsData)).length;

  const getDeckTotalCount = (deckId: string) =>
    flashcards.filter((fc) => fc.deckId === deckId).length;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-lantern-background text-lantern-text">
      <div className="px-4 md:px-6 lg:px-8 py-6 w-full space-y-6">
        <ScreenHeader
          title="Study"
          subtitle="Review due cards, resume sessions, and jump back in"
        />

        {pausedSessions.length > 0 && onResumePausedSession && onAbandonPausedSession ? (
          <SavedSessionsList
            sessions={pausedSessions}
            onResume={onResumePausedSession}
            onDiscard={onAbandonPausedSession}
            compact
          />
        ) : hasPausedSession && onResumeSession ? (
          <Card padding="md">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600">
                  <ClockIcon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-heading text-lantern-text">
                    {activeTestSession ? 'Test paused' : 'Study session paused'}
                  </p>
                  <p className="text-caption text-lantern-text-secondary">
                    Pick up where you left off — progress is saved to your account when online
                  </p>
                </div>
              </div>
              <Button variant="accent" onClick={onResumeSession}>
                <PlayIcon className="w-4 h-4" />
                Resume
              </Button>
            </div>
          </Card>
        ) : null}

        <Card padding="lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-heading text-lantern-text">
                {dueCardsCount > 0 ? `${dueCardsCount} card${dueCardsCount !== 1 ? 's' : ''} ready to review` : 'All caught up!'}
              </h2>
              <p className="text-caption text-lantern-text-secondary mt-1">
                {dueCardsCount > 0
                  ? 'Spaced repetition keeps knowledge fresh — review when cards are ready.'
                  : 'Create or import material, then come back when cards are ready.'}
              </p>
            </div>
            <Button
              size="lg"
              variant={dueCardsCount > 0 ? 'primary' : 'secondary'}
              onClick={dueCardsCount > 0 ? onStartDueReview : onOpenAITools}
              disabled={dueCardsCount === 0 && decks.length === 0}
            >
              <AcademicCapIcon className="w-5 h-5" />
              {dueCardsCount > 0 ? getStudyAllDueLabel(dueCardsCount) : 'Import & study'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-lantern-border">
            <StatPill label="Decks" value={decks.length} accent="primary" icon={<RectangleStackIcon className="w-4 h-4" />} />
            {recentTestCount > 0 && onViewRecentTests && (
              <button type="button" onClick={onViewRecentTests} className="text-body text-lantern-primary-text font-medium hover:underline">
                {recentTestCount} recent test{recentTestCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onOpenAITools}
            className="text-left p-4 rounded-xl border border-lantern-border bg-lantern-surface hover:border-lantern-primary transition-colors"
          >
            <SparklesIcon className="w-6 h-6 text-lantern-primary-text mb-2" />
            <p className="text-heading text-lantern-text">AI Tools</p>
            <p className="text-caption text-lantern-text-secondary mt-1">Import PDFs, paste notes, generate flashcards</p>
          </button>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="text-left p-4 rounded-xl border border-lantern-border bg-lantern-surface hover:border-lantern-primary transition-colors"
          >
            <RectangleStackIcon className="w-6 h-6 text-emerald-600 mb-2" />
            <p className="text-heading text-lantern-text">Library</p>
            <p className="text-caption text-lantern-text-secondary mt-1">Browse notes and flashcard decks</p>
          </button>
        </div>

        {topDecks.length > 0 && (
          <div>
            <h3 className="text-label text-lantern-text-secondary uppercase mb-3">{deckSectionLabel}</h3>
            <div className="space-y-2">
              {topDecks.map((deck) => {
                const dueCount = getDeckDueCount(deck.id);
                const totalCount = getDeckTotalCount(deck.id);
                const canStartSrsReview = Boolean(onStartReview) && dueCount > 0;
                return (
                <div
                  key={deck.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-lantern-border bg-lantern-surface"
                >
                  <button type="button" onClick={() => onSelectDeck(deck)} className="text-left min-w-0 flex-1">
                    <p className="text-body font-semibold text-lantern-text truncate">{deck.name}</p>
                    <p className="text-caption text-lantern-text-secondary truncate">{deck.description || 'Flashcard deck'}</p>
                  </button>
                  {canStartSrsReview ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button size="sm" variant="accent" onClick={() => onStartReview!(deck.id)}>
                        <AcademicCapIcon className="w-4 h-4" />
                        {getStudyCtaLabel(dueCount, totalCount)}
                      </Button>
                      {onStartLearn && (
                        <Button size="sm" variant="secondary" onClick={() => onStartLearn(deck)}>
                          {quizLabel}
                        </Button>
                      )}
                    </div>
                  ) : onStartLearn ? (
                    <Button size="sm" variant="secondary" onClick={() => onStartLearn(deck)}>
                      <AcademicCapIcon className="w-4 h-4" />
                      {quizLabel}
                    </Button>
                  ) : null}
                </div>
              );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudyHubScreen;
