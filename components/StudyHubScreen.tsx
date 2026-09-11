import React, { useEffect } from 'react';
import { Deck, Flashcard, TestSessionData, StudySessionData, PausedSessionSummary } from '../types';
import { getStudyAllDueLabel, getStudyCtaLabel, FLASHCARD_MODE_LABELS, isCardDue, courseWorkspaceLabel } from '@lantern/shared';
import { ScreenHeader, Card, Button, StatPill, FeatureDisc, DoorTile } from './ui';
import SavedSessionsList from './SavedSessionsList';
import { AppIcon } from './ui/AppIcon';
import { useAcademicStore } from '../stores/academicStore';

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
  onOpenCourse?: (courseId: string) => void;
  onOpenImport?: () => void;
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
  onOpenCourse,
  onOpenImport,
}) => {
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const myCourses = useAcademicStore((s) => s.myCourses);
  useEffect(() => {
    void loadMyCourses();
  }, [loadMyCourses]);
  const activeCourses = myCourses.filter((row) => row.status === 'active');
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
          subtitle="Open a course, or import material"
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
                <FeatureDisc feature="budget" icon={<AppIcon name="time" size={20} />} />
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
                <AppIcon name="play" size={16} />
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
              <AppIcon name="school" size={20} />
              {dueCardsCount > 0 ? getStudyAllDueLabel(dueCardsCount) : 'Import & study'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-lantern-border">
            <StatPill label="Decks" value={decks.length} accent="primary" icon={<AppIcon name="albums" size={16} />} />
            {recentTestCount > 0 && onViewRecentTests && (
              <button type="button" onClick={onViewRecentTests} className="text-body text-lantern-primary-text font-medium hover:underline">
                {recentTestCount} recent test{recentTestCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </Card>

        {/* Course workspaces — the room, not five equal doors. Import stays a door. */}
        <div className="space-y-3">
          {activeCourses.length > 0 && onOpenCourse ? (
            <Card padding="md">
              <h2 className="text-label uppercase text-lantern-text-secondary mb-3">Your courses</h2>
              <div className="space-y-1">
                {activeCourses.map((row) => (
                  <button
                    key={row.course.id}
                    type="button"
                    onClick={() => onOpenCourse(row.course.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-lantern-background-secondary text-left"
                  >
                    <FeatureDisc feature="notes" icon={<AppIcon name="library" size={20} />} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold text-lantern-text truncate">
                        {courseWorkspaceLabel(row.course)}
                      </span>
                      <span className="block text-caption text-lantern-text-secondary">
                        Notes, cards, tests and lectures
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          ) : (
            <Card padding="md">
              <p className="text-body text-lantern-text-secondary">
                Add courses in Academic settings, then open them here as a workspace.
              </p>
            </Card>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DoorTile
              feature="notes"
              icon={<AppIcon name="cloud-upload" size={24} />}
              illustration="import-tray"
              title="Import & study"
              promise="PDF, slides or pasted notes — one step"
              onClick={onOpenImport ?? onOpenAITools}
            />
          </div>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="text-caption text-lantern-text-secondary hover:underline"
          >
            All materials
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
                  <button type="button" onClick={() => onSelectDeck(deck)} className="text-left min-w-0 flex-1 flex items-center gap-3">
                    <FeatureDisc feature="flashcards" icon={<AppIcon name="albums" size={20} />} />
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
                        <AppIcon name="school" size={16} />
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
                      <AppIcon name="school" size={16} />
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
