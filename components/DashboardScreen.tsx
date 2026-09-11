import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Group,
  User,
  TestResult,
  TestSessionData,
  StudySessionData,
  PausedSessionSummary,
} from '../types';
import SavedSessionsList from './SavedSessionsList';
import { useUIStore } from '../stores/uiStore';
import { Card } from './ui';
import { computeStudyStreak, getDashboardFirstName } from '@lantern/shared/utils';
import { upcomingExamsFromNotes, type StudyActivityDay } from '@lantern/shared';
import { useNotesStore } from '../stores/notesStore';
import { useLoginStreak } from '../hooks/useLoginStreak';
import { DashboardHero } from './dashboard/DashboardHero';
import { GettingStartedChecklist } from './dashboard/GettingStartedChecklist';
import { HomeQuickActions } from './dashboard/HomeQuickActions';
import { HomeStudySets } from './dashboard/HomeStudySets';
import { HomeRecentMaterials } from './dashboard/HomeRecentMaterials';
import AiJobsCard from './jobs/AiJobsCard';
import Modal from './ui/Modal';
import {
  readAcademicSetupDismissed,
  markAcademicSetupDismissed,
} from '../utils/academicSetup';
import {
  readOnboardingAcademicDone,
  shouldShowAcademicFallbackBanner,
} from '../utils/onboardingAcademic';
import { JoinClassCard } from './classes/JoinClassCard';
import { WorkspaceJumpBack } from './study/WorkspaceJumpBack';
import { ClassWorkCard } from './classes/ClassWorkCard';
import { AppIcon } from './ui/AppIcon';

/**
 * LEGACY FALLBACK ONLY — one-line "Finish setting up your profile" nudge
 * for accounts created before onboarding asked for the institution.
 */
const AcademicSetupBanner: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const openModal = useUIStore((s) => s.openModal);
  const [dismissed, setDismissed] = useState<boolean>(() =>
    readAcademicSetupDismissed(currentUser.id)
  );
  const answeredOnboardingStep = useMemo(
    () => readOnboardingAcademicDone(currentUser.id),
    [currentUser.id]
  );
  if (!shouldShowAcademicFallbackBanner({ user: currentUser, dismissed, answeredOnboardingStep }))
    return null;
  const dismiss = () => {
    setDismissed(true);
    markAcademicSetupDismissed(currentUser.id);
  };
  return (
    <div
      role="status"
      className="bg-lantern-primary-background border-b border-lantern-border px-4 py-2 flex items-center justify-between gap-3 text-body"
    >
      <p className="min-w-0 truncate text-lantern-text">
        <AppIcon name="school" size={16} className="inline-block mr-1.5 -mt-0.5 text-lantern-primary-text" aria-hidden />
        Finish setting up your profile — add your university and courses.
      </p>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => openModal('usernameRequired')}
          className="px-2.5 py-1 rounded-md text-caption font-semibold text-white bg-lantern-primary-fill hover:bg-lantern-primary-dark"
        >
          Set up
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="p-1.5 rounded-full text-lantern-text-secondary hover:bg-lantern-background-secondary"
          aria-label="Dismiss profile setup reminder"
        >
          <AppIcon name="close" size={16} />
        </button>
      </div>
    </div>
  );
};

interface DashboardScreenProps {
  testResults: TestResult[];
  groups: Group[];
  currentUser: User;
  theme: 'light' | 'dark';
  onNavigateToChat?: () => void;
  onNavigateToFlashcards?: () => void;
  onOpenCreateDeck?: () => void;
  onNavigateToMarketplace?: () => void;
  onNavigateToCreateGroup?: () => void;
  onNavigateToBudget?: () => void;
  onNavigateToStudyHub?: () => void;
  onNavigateToLibrary?: () => void;
  onNavigateToOffline?: () => void;
  onToggleCompanion?: () => void;
  deckCount?: number;
  hasBudgetSet?: boolean;
  hasOpenedLibrary?: boolean;
  hasTriedCompanion?: boolean;
  hasSubmittedQuestion?: boolean;
  hasExploredMarketplace?: boolean;
  hasTriedOffline?: boolean;
  dueCardsCount?: number;
  onOpenQuickTest?: (groupId: string) => void;
  onNavigateToNotes?: () => void;
  onOpenImportAndStudy?: () => void;
  onNavigateToAITools?: () => void;
  onReviewDueCards?: () => void;
  onNavigateToTests?: () => void;
  onOpenCourseWorkspace?: (courseId: string) => void;
  onOpenStudySet?: (studySetId: string) => void;
  onOpenDeckById?: (deckId: string) => void;
  onOpenNoteById?: (noteId: string) => void;
  onOpenAcademicSettings?: () => void;
  onRecordLecture?: () => void;
  serverStreak?: number;
  studyActivityDays?: StudyActivityDay[];
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
  pausedSessions?: PausedSessionSummary[];
  onResumePausedSession?: (sessionId: string) => void;
  onAbandonPausedSession?: (sessionId: string) => void;
}

export default function DashboardScreen({
  testResults: rawTestResults,
  groups,
  currentUser,
  onNavigateToChat,
  onNavigateToFlashcards,
  onOpenCreateDeck,
  onNavigateToMarketplace,
  onNavigateToCreateGroup,
  onNavigateToBudget,
  onNavigateToStudyHub,
  onNavigateToLibrary,
  onNavigateToOffline,
  onToggleCompanion,
  deckCount = 0,
  hasBudgetSet = false,
  hasOpenedLibrary = false,
  hasTriedCompanion = false,
  hasSubmittedQuestion = false,
  hasExploredMarketplace = false,
  hasTriedOffline = false,
  onOpenImportAndStudy,
  onNavigateToAITools,
  onReviewDueCards,
  onNavigateToTests,
  onOpenCourseWorkspace,
  onOpenStudySet,
  onOpenDeckById,
  onOpenNoteById,
  onOpenAcademicSettings,
  onRecordLecture,
  dueCardsCount = 0,
  onOpenQuickTest,
  serverStreak = 0,
  studyActivityDays = [],
  activeTestSession,
  activeStudySession,
  onResumeSession,
  pausedSessions = [],
  onResumePausedSession,
  onAbandonPausedSession,
}: DashboardScreenProps) {
  const [quickActionPicker, setQuickActionPicker] = useState<'test' | 'study' | null>(null);
  const availableGroups = useMemo(() => groups.filter((g) => !g.isArchived), [groups]);
  const { streakData, showDailyBonus, bonusXP, dismissBonus } = useLoginStreak();
  const studyActivityStreak = useMemo(
    () => computeStudyStreak(studyActivityDays).current,
    [studyActivityDays]
  );
  const displayStreak = Math.max(serverStreak, studyActivityStreak);
  const totalTestsTakenOverall = rawTestResults.filter((result) => result?.session?.startTime).length;
  const dashboardScrollRef = useRef<HTMLDivElement>(null);

  const handleQuickActionGroupSelect = useCallback((groupId: string) => {
    if (quickActionPicker === 'test') onOpenQuickTest?.(groupId);
    setQuickActionPicker(null);
  }, [quickActionPicker, onOpenQuickTest]);
  const notes = useNotesStore((s) => s.notes);
  const upcomingExams = useMemo(() => upcomingExamsFromNotes(notes), [notes]);

  return (
    <div
      ref={dashboardScrollRef}
      className="flex-1 min-h-0 flex flex-col bg-transparent text-lantern-text overflow-y-auto overscroll-y-none"
    >
      {showDailyBonus && (
        <div className="bg-gradient-to-r from-lantern-accent to-amber-500 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-lantern-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>🔥</span>
            <div>
              <p className="font-bold text-body leading-tight tracking-tight">
                Day {streakData.streak} streak! +{bonusXP} XP bonus claimed!
              </p>
              <p className="text-orange-50/90 text-caption">
                {streakData.streak >= 7
                  ? `${streakData.streak} days in a row — incredible! Keep it up!`
                  : streakData.streak >= 3
                    ? `${streakData.streak} days strong! Reach 7 days for a bigger reward.`
                    : 'Come back tomorrow to grow your streak!'}
              </p>
            </div>
          </div>
          <button
            onClick={dismissBonus}
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-white/20 transition-colors"
            aria-label="Dismiss bonus notification"
          >
            <AppIcon name="close" size={16} className="text-white" />
          </button>
        </div>
      )}

      <AcademicSetupBanner currentUser={currentUser} />

      <div className="px-4 md:px-8 py-8 w-full">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10 lg:items-start space-y-8 lg:space-y-0">
          <div className="space-y-8 min-w-0">
            <DashboardHero
              userName={getDashboardFirstName({
                firstName: currentUser.firstName,
                name: currentUser.name,
                username: currentUser.username,
              })}
              dueCardsCount={dueCardsCount}
              totalTestsTaken={totalTestsTakenOverall}
              onPrimaryAction={() => {
                if (dueCardsCount > 0 && onReviewDueCards) onReviewDueCards();
                else if (onOpenImportAndStudy) onOpenImportAndStudy();
                else if (onNavigateToAITools) onNavigateToAITools();
              }}
              activeTestSession={activeTestSession}
              activeStudySession={activeStudySession}
              onResumeSession={onResumeSession}
            />

            {pausedSessions.length > 0 && onResumePausedSession && onAbandonPausedSession ? (
              <SavedSessionsList
                sessions={pausedSessions}
                onResume={onResumePausedSession}
                onDiscard={onAbandonPausedSession}
                compact
              />
            ) : null}

            <HomeStudySets
              onOpenStudySet={onOpenStudySet}
              onOpenStudyHub={onNavigateToStudyHub}
            />

            <HomeRecentMaterials
              onOpenNote={onOpenNoteById}
              onOpenStudySet={onOpenStudySet}
            />

            <section>
              <h2 className="text-title font-semibold text-lantern-text mb-4">Upcoming</h2>
              <div className="space-y-3">
                {onOpenCourseWorkspace && <WorkspaceJumpBack onOpen={onOpenCourseWorkspace} />}
                <ClassWorkCard />
                <div className="empty:hidden">
                  <AiJobsCard />
                </div>
                <Card padding="md" className="rounded-2xl">
                  <p className="text-body font-semibold text-lantern-text">Upcoming exam</p>
                  {upcomingExams[0] ? (
                    <button
                      type="button"
                      onClick={() =>
                        upcomingExams[0].studySetId
                          ? onOpenStudySet?.(upcomingExams[0].studySetId)
                          : onNavigateToStudyHub?.()
                      }
                      className="mt-1 w-full text-left"
                    >
                      <p className="text-caption text-lantern-text-secondary">
                        {upcomingExams[0].title} · {upcomingExams[0].examDate}
                      </p>
                    </button>
                  ) : (
                    <p className="text-caption text-lantern-text-secondary mt-1">
                      Add an exam date on a study set calendar when you have one.
                    </p>
                  )}
                </Card>
              </div>
            </section>

            <HomeQuickActions
              onImport={onOpenImportAndStudy ?? onNavigateToAITools}
              onOpenTests={onNavigateToStudyHub ?? onNavigateToTests}
              onToggleCompanion={onToggleCompanion}
              onOpenTutor={onNavigateToStudyHub}
              onRecordLecture={onRecordLecture}
              onOpenStudyHub={onNavigateToStudyHub}
            />

            <GettingStartedChecklist
              hasDecks={deckCount > 0}
              hasTests={rawTestResults.length > 0}
              hasGroups={groups.length > 0}
              hasBudget={hasBudgetSet}
              hasOpenedLibrary={hasOpenedLibrary}
              hasTriedCompanion={hasTriedCompanion}
              hasSubmittedQuestion={hasSubmittedQuestion}
              hasExploredMarketplace={hasExploredMarketplace}
              hasTriedOffline={hasTriedOffline}
              onCreateDeck={() => {
                if (onOpenCreateDeck) onOpenCreateDeck();
                else onNavigateToFlashcards?.();
              }}
              onTakeTest={() => {
                if (onNavigateToStudyHub) onNavigateToStudyHub();
                else if (groups[0]?.id && onOpenQuickTest) onOpenQuickTest(groups[0].id);
              }}
              onJoinGroup={() => {
                if (onNavigateToCreateGroup) onNavigateToCreateGroup();
                else onNavigateToChat?.();
              }}
              onSetBudget={() => onNavigateToBudget?.()}
              onOpenLibrary={() => onNavigateToLibrary?.() || onNavigateToFlashcards?.()}
              onTryCompanion={() => onToggleCompanion?.()}
              onSubmitQuestion={() => onNavigateToChat?.()}
              onExploreMarketplace={() => onNavigateToMarketplace?.()}
              onTryOffline={() => onNavigateToOffline?.()}
            />
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <Card padding="md" className="rounded-2xl">
              <p className="text-caption text-lantern-text-secondary">Streak</p>
              <p className="mt-1 text-title font-semibold text-lantern-text tabular-nums">
                {displayStreak} day{displayStreak === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-caption text-lantern-text-secondary">
                Keep a day going to protect it.
              </p>
            </Card>
            <JoinClassCard />
          </aside>
        </div>
      </div>

      {quickActionPicker && (
        <Modal
          isOpen={Boolean(quickActionPicker)}
          onClose={() => setQuickActionPicker(null)}
          ariaLabelledBy="quick-action-group-picker-title"
          maxWidthClass="max-w-md"
          alignClass="items-end sm:items-center justify-center"
          backdropClassName="backdrop-blur-sm"
          panelClassName="!p-0 overflow-hidden border border-lantern-border bg-lantern-surface rounded-lantern-xl"
        >
          <div className="w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-lantern-border">
              <div className="flex items-center gap-2">
                <AppIcon name="flash" size={20} filled className="text-yellow-500" />
                <h2 id="quick-action-group-picker-title" className="text-body font-semibold text-lantern-text">
                  Select a group for Quick Test
                </h2>
              </div>
              <button
                onClick={() => setQuickActionPicker(null)}
                className="p-1.5 rounded-lantern hover:bg-lantern-background-secondary transition-colors"
                aria-label="Close"
              >
                <AppIcon name="close" size={20} className="text-lantern-text-secondary" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-lantern-border">
              {availableGroups.length === 0 ? (
                <p className="text-center text-body text-lantern-text-tertiary py-8">
                  No groups available. Join or create a group first.
                </p>
              ) : (
                availableGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => handleQuickActionGroupSelect(group.id)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-lantern-background-secondary transition-colors"
                  >
                    {group.avatarUrl ? (
                      <img
                        src={group.avatarUrl}
                        alt={group.name}
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-lantern-primary-background flex items-center justify-center flex-shrink-0">
                        <AppIcon name="people" size={20} filled className="text-lantern-primary-text" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold text-lantern-text truncate">{group.name}</p>
                    </div>
                    <AppIcon name="flash" size={16} filled className="text-yellow-400 flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
