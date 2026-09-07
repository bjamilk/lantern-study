import React from 'react';
import {
  AcademicCapIcon,
  ArrowDownOnSquareIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  MicrophoneIcon,
  PlayIcon,
  RectangleStackIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { Deck, Flashcard, TestSessionData, StudySessionData, PausedSessionSummary } from '../types';
import { getStudyAllDueLabel, getStudyCtaLabel, FLASHCARD_MODE_LABELS, isCardDue } from '@lantern/shared';
import { ScreenHeader, Card, Button, StatPill, FeatureDisc, DoorTile } from './ui';
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
  /** Wave 1 doors. Each tile renders only when its route is actually wired. */
  onOpenFlashcards?: () => void;
  onOpenTests?: () => void;
  /** Opens a fresh note with the lecture recorder — the web's only recording path. */
  onRecordLecture?: () => void;
  noteCount?: number;
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
  onOpenFlashcards,
  onOpenTests,
  onRecordLecture,
  noteCount,
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
                <FeatureDisc feature="budget" icon={<ClockIcon className="w-5 h-5" />} />
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

        {/* ─── The doors (§5.7 Study hub). Five tiles, one hue each, no more. ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <DoorTile
            feature="notes"
            icon={<Squares2X2Icon className="w-6 h-6" />}
            illustration="notes-stack"
            title="Library"
            promise="Turn slides into cards"
            count={
              noteCount !== undefined
                ? `${noteCount + decks.length} item${noteCount + decks.length === 1 ? '' : 's'}`
                : undefined
            }
            onClick={onOpenLibrary}
          />
          <DoorTile
            feature="flashcards"
            icon={<RectangleStackIcon className="w-6 h-6" />}
            illustration="cards-fan"
            title="Flashcards"
            promise="Spaced repetition that remembers for you"
            count={dueCardsCount > 0 ? `${dueCardsCount} due` : undefined}
            onClick={onOpenFlashcards ?? onOpenLibrary}
          />
          {onOpenTests && (
            <DoorTile
              feature="tests"
              icon={<ClipboardDocumentCheckIcon className="w-6 h-6" />}
              illustration="test-sheet"
              title="Tests"
              promise="Sit a practice test, see what to fix"
              count={recentTestCount > 0 ? `${recentTestCount} saved` : undefined}
              onClick={onOpenTests}
            />
          )}
          {onRecordLecture && (
            <DoorTile
              feature="recording"
              icon={<MicrophoneIcon className="w-6 h-6" />}
              illustration="mic-wave"
              title="Record"
              promise="Record a lecture, get a note back"
              onClick={onRecordLecture}
            />
          )}
          <DoorTile
            feature="notes"
            icon={<ArrowDownOnSquareIcon className="w-6 h-6" />}
            illustration="import-tray"
            title="Import & study"
            promise="PDF, slides or pasted notes — one step"
            onClick={onOpenAITools}
          />
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
                  <button type="button" onClick={() => onSelectDeck(deck)} className="text-left min-w-0 flex-1 flex items-center gap-3">
                    <FeatureDisc feature="flashcards" icon={<RectangleStackIcon className="w-5 h-5" />} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold text-lantern-text truncate">{deck.name}</span>
                      <span className="block text-caption text-lantern-text-secondary truncate">
                        {deck.description || 'Flashcard deck'}
                      </span>
                    </span>
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
