import React from 'react';
import {
  AcademicCapIcon,
  PlayIcon,
  RectangleStackIcon,
  SparklesIcon,
  BoltIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { Deck, TestSessionData, StudySessionData } from '../types';
import { ScreenHeader, Card, Button, StatPill } from './ui';

interface StudyHubScreenProps {
  dueCardsCount: number;
  decks: Deck[];
  onStartDueReview: () => void;
  onOpenLibrary: () => void;
  onOpenAITools: () => void;
  onSelectDeck: (deck: Deck) => void;
  onStartLearn?: (deck: Deck) => void;
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
  recentTestCount?: number;
  onViewRecentTests?: () => void;
}

export const StudyHubScreen: React.FC<StudyHubScreenProps> = ({
  dueCardsCount,
  decks,
  onStartDueReview,
  onOpenLibrary,
  onOpenAITools,
  onSelectDeck,
  onStartLearn,
  activeTestSession,
  activeStudySession,
  onResumeSession,
  recentTestCount = 0,
  onViewRecentTests,
}) => {
  const hasPausedSession = Boolean(activeTestSession || activeStudySession);
  const topDecks = decks.slice(0, 4);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-lantern-background text-lantern-text">
      <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto w-full space-y-6">
        <ScreenHeader
          title="Study"
          subtitle="Review due cards, resume sessions, and jump back in"
        />

        {hasPausedSession && onResumeSession && (
          <Card padding="md" className="border-l-4 border-l-amber-500">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600">
                  <ClockIcon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-lantern-text">
                    {activeTestSession ? 'Test paused' : 'Study session paused'}
                  </p>
                  <p className="text-sm text-lantern-text-secondary">Pick up where you left off</p>
                </div>
              </div>
              <Button variant="accent" onClick={onResumeSession}>
                <PlayIcon className="w-4 h-4" />
                Resume
              </Button>
            </div>
          </Card>
        )}

        <Card padding="lg" className="border-l-4 border-l-lantern-primary bg-gradient-to-br from-lantern-primary/5 to-lantern-accent/5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-lantern-text">
                {dueCardsCount > 0 ? `${dueCardsCount} card${dueCardsCount !== 1 ? 's' : ''} due` : 'All caught up!'}
              </h2>
              <p className="text-sm text-lantern-text-secondary mt-1">
                {dueCardsCount > 0
                  ? 'Spaced repetition keeps knowledge fresh — review your due cards now.'
                  : 'Create or import material, then come back when cards are due.'}
              </p>
            </div>
            <Button
              size="lg"
              variant={dueCardsCount > 0 ? 'primary' : 'secondary'}
              onClick={dueCardsCount > 0 ? onStartDueReview : onOpenAITools}
              disabled={dueCardsCount === 0 && decks.length === 0}
            >
              <AcademicCapIcon className="w-5 h-5" />
              {dueCardsCount > 0 ? 'Review due cards' : 'Import & study'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-lantern-border">
            <StatPill label="Decks" value={decks.length} accent="primary" icon={<RectangleStackIcon className="w-4 h-4" />} />
            {recentTestCount > 0 && onViewRecentTests && (
              <button type="button" onClick={onViewRecentTests} className="text-sm text-lantern-primary font-medium hover:underline">
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
            <SparklesIcon className="w-6 h-6 text-lantern-primary mb-2" />
            <p className="font-semibold text-lantern-text">AI Tools</p>
            <p className="text-xs text-lantern-text-secondary mt-1">Import PDFs, paste notes, generate flashcards</p>
          </button>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="text-left p-4 rounded-xl border border-lantern-border bg-lantern-surface hover:border-lantern-primary transition-colors"
          >
            <RectangleStackIcon className="w-6 h-6 text-emerald-600 mb-2" />
            <p className="font-semibold text-lantern-text">Library</p>
            <p className="text-xs text-lantern-text-secondary mt-1">Browse notes and flashcard decks</p>
          </button>
        </div>

        {topDecks.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-lantern-text-secondary uppercase tracking-wide mb-3">Quick learn</h3>
            <div className="space-y-2">
              {topDecks.map((deck) => (
                <div
                  key={deck.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-lantern-border bg-lantern-surface"
                >
                  <button type="button" onClick={() => onSelectDeck(deck)} className="text-left min-w-0 flex-1">
                    <p className="font-medium text-lantern-text truncate">{deck.name}</p>
                    <p className="text-xs text-lantern-text-secondary truncate">{deck.description || 'Flashcard deck'}</p>
                  </button>
                  {onStartLearn && (
                    <Button size="sm" variant="secondary" onClick={() => onStartLearn(deck)}>
                      <BoltIcon className="w-4 h-4" />
                      Learn
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudyHubScreen;
