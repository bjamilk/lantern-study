/**
 * Home screen: assembles the shared "home regions" spine out of data the app
 * already holds in stores — it fetches nothing of its own.
 *
 * Exports:
 *  - default `DashboardScreen` — the Home route body (scroll container + right rail).
 *  - `AcademicSetupBanner` (module-local) — legacy one-line profile nudge.
 * Touches:
 *  - stores: `uiStore` (openModal), `notesStore.notes`, `studyResumeStore`
 *    (`lastActivity`, `recentActivities`), `studySetStore` (`sets`, `lastOpenedId`),
 *    `companionStore.conversations`.
 *  - hooks: `useLoginStreak` (daily-bonus banner + local streak).
 *  - localStorage (via utils): academic-setup dismissal + onboarding-academic flags,
 *    keyed by `currentUser.id`.
 *  - shared: `homeRegions`, `primaryHomeAction`, `buildStudySetPath`, `computeStudyStreak`.
 *  - everything else is delegated to child cards (`HomeStudySets`, `RecentActivities`,
 *    `CourseReadinessCard`, `ClassWorkCard`, `AiJobsCard`, …) which own their own loads.
 * Gotchas:
 *  - Two "due" numbers exist: the store aggregate `dueCardsCount` and the plan total
 *    `reviewPlanTotalDue`. Everything the student SEES must come from `homeDueTotal`
 *    (plan-first), or the label and the session it opens disagree.
 *  - Colours are Tailwind `lantern-*` tokens resolved from `index.css` `:root`/`.dark`;
 *    the only literal palette here is the daily-bonus gradient (amber-on-white, same in
 *    both themes by design). Do not inline a token's value.
 *  - This component is the scroll container (`overflow-y-auto`) for Home. Children that
 *    clip (`overflow-hidden` cards) must carry `shrink-0` or the flex pass crushes them.
 */
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
import {
  buildStudySetPath,
  homeRegions,
  isCalendarNote,
  isLectureNote,
  notePreviewText,
  primaryHomeAction,
  studySetLabel,
  todayDateOnlyLocal,
  upcomingExamsFromNotes,
  type HomeRegionId,
  type StudyActivityDay,
} from '@lantern/shared';
import { useNotesStore } from '../stores/notesStore';
import { useStudyResumeStore } from '../stores/studyResumeStore';
import { useStudySetStore } from '../stores/studySetStore';
import { useCompanionStore } from '../stores/companionStore';
import { useLoginStreak } from '../hooks/useLoginStreak';
import { DashboardHero } from './dashboard/DashboardHero';
import { GettingStartedChecklist } from './dashboard/GettingStartedChecklist';
import { HomeQuickActions } from './dashboard/HomeQuickActions';
import { HomeStudySets } from './dashboard/HomeStudySets';
import { HomeRecentMaterials } from './dashboard/HomeRecentMaterials';
import { RecentActivities } from './dashboard/RecentActivities';
import { CourseReadinessCard } from './CourseReadinessCard';
import AiJobsCard from './jobs/AiJobsCard';
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
  /**
   * The total the "Study all N due" session will actually deal, from
   * `dueReviewPlan`. Home must label itself from this and not from the store's
   * `dueCardsCount` aggregate: the store counts cards due by date, the plan
   * also deals each deck's new-card allowance, and live the two disagreed
   * ("Study all 68 due" opened "1 / 78 across 8 decks"). Optional so a caller
   * with no plan yet still renders; when present it is authoritative.
   */
  reviewPlanTotalDue?: number | null;
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
  /** Route navigation for links that carry a path (resume href, set activities). */
  onNavigatePath?: (path: string) => void;
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
  onNavigatePath,
  dueCardsCount = 0,
  reviewPlanTotalDue,
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
  // --- Local state and derived tallies -------------------------------------
  const { streakData, showDailyBonus, bonusXP, dismissBonus } = useLoginStreak();
  const studyActivityStreak = useMemo(
    () => computeStudyStreak(studyActivityDays).current,
    [studyActivityDays]
  );
  const displayStreak = Math.max(serverStreak, studyActivityStreak);
  /**
   * One tally for the button, its sentence and its session. `null` only when
   * the caller passed no plan at all, in which case the store aggregate is the
   * best available number.
   */
  const homeReviewPlan = useMemo(
    () =>
      typeof reviewPlanTotalDue === 'number' && Number.isFinite(reviewPlanTotalDue)
        ? { totalDue: Math.max(0, Math.trunc(reviewPlanTotalDue)) }
        : null,
    [reviewPlanTotalDue]
  );
  const homeDueTotal = homeReviewPlan ? homeReviewPlan.totalDue : dueCardsCount;
  const totalTestsTakenOverall = rawTestResults.filter((result) => result?.session?.startTime).length;
  const dashboardScrollRef = useRef<HTMLDivElement>(null);

  // --- Store reads. All selectors, no loaders: Home renders whatever the
  // stores already hold and never triggers a fetch of its own.
  const notes = useNotesStore((s) => s.notes);
  const lastActivity = useStudyResumeStore((s) => s.lastActivity);
  const studySets = useStudySetStore((s) => s.sets);
  const lastOpenedSetId = useStudySetStore((s) => s.lastOpenedId);

  /**
   * A study set now carries its own `examDate`, so prefer it over parsing a
   * calendar note: the set knows its exam first-hand, and naming the set beats
   * the note title ("Plan — …") a student never wrote.
   */
  const upcomingExams = useMemo(() => {
    const today = todayDateOnlyLocal();
    const fromSets = studySets
      .flatMap((set) => {
        const examDate = (set.examDate || '').trim();
        if (!examDate || examDate < today) return [];
        return [{ examDate, title: studySetLabel(set), studySetId: set.id }];
      })
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
    return fromSets.length > 0 ? fromSets : upcomingExamsFromNotes(notes);
  }, [studySets, notes]);

  /**
   * HOME'S SPINE, from `homeRegions()` in `@lantern/shared/dashboard`. Web and
   * mobile render the same regions in the same order under the same headings;
   * only mobile's `Your progress` door differs, and web keeps Streak in the
   * right rail instead. The ids are read here so a heading cannot drift from
   * the one mobile prints.
   */
  const regions = useMemo(
    () =>
      new Map<HomeRegionId, { label?: string; sublabel?: string }>(
        homeRegions({
          platform: 'web',
          dueCount: homeDueTotal,
          hasExamDate: upcomingExams.length > 0,
        }).map((region) => [region.id, { label: region.label, sublabel: region.sublabel }])
      ),
    [homeDueTotal, upcomingExams.length]
  );

  const resumeRows = useStudyResumeStore((s) => s.recentActivities);
  /**
   * Companion threads are only in memory once the student has opened the
   * companion panel — the store fetches nothing on Home. Read whatever is
   * there and let an empty array contribute no rows; Home does not open a
   * request to fill a section.
   */
  const companionConversations = useCompanionStore((s) => s.conversations);

  /**
   * `Recent activities`, assembled from what Home already holds. Each kind has
   * exactly ONE source, so a row can never appear twice:
   *
   *   flashcards ← the resume feed's `cards` rows. There is no per-deck study
   *                timestamp in `Deck` at all, so this is the only honest one.
   *   tests      ← `testResults`, which carry the real attempt time and score.
   *   materials  ← the notes store's `updatedAt` (notes have no `lastOpenedAt`;
   *                this is the closest true thing, and it is what Recent
   *                materials already sorts on).
   *   companion  ← the companion store, when it has been loaded.
   *
   * Nothing here fetches.
   */
  const activityInput = useMemo(() => {
    const setTitleById = new Map(studySets.map((set) => [set.id, studySetLabel(set)]));

    const decks = resumeRows
      .filter((row) => row.kind === 'cards')
      .map((row) => ({
        id: row.href,
        title: row.title,
        setId: row.studySetId || null,
        setTitle: setTitleById.get(row.studySetId) ?? null,
        lastStudiedAt: row.at,
        // The resume href is more exact than the activity root: it can point
        // at the very deck session that was paused.
        targetRoute: row.href,
      }));

    const tests = rawTestResults
      .filter((result) => result?.session?.startTime)
      .map((result) => {
        const at = result.session.endTime ?? result.session.startTime;
        const setId = result.session.config?.studySetId ?? null;
        return {
          id: result.id,
          title:
            result.session.title ||
            result.session.config?.groupName ||
            'Test',
          setId,
          setTitle: setId ? setTitleById.get(setId) ?? null : null,
          lastAttemptAt: at instanceof Date ? at.toISOString() : String(at ?? ''),
          lastScore: typeof result.score === 'number' ? result.score : null,
        };
      });

    const materials = notes
      .filter((note) => !isCalendarNote(note))
      .map((note) => ({
        id: note.id,
        title: note.title || '',
        setId: note.studySetId || null,
        setTitle: note.studySetId ? setTitleById.get(note.studySetId) ?? null : null,
        lastOpenedAt: note.updatedAt || null,
        isLecture: isLectureNote(note),
      }));

    const conversations = companionConversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      lastMessageAt: conversation.updatedAt,
      lastMessagePreview: notePreviewText(conversation.preview),
    }));

    return { decks, tests, notes: materials, conversations };
  }, [resumeRows, rawTestResults, notes, studySets, companionConversations]);

  /**
   * The three quick-action doors go three places. Each opens the last set's
   * own activity; with no set yet there is nothing to open, so they fall back
   * to the Study hub rather than dead-ending.
   */
  const openLastSetActivity = useCallback(
    (activity: 'quiz' | 'lesson', extras: { createNew?: boolean } = {}) => {
      if (lastOpenedSetId && onNavigatePath) {
        onNavigatePath(buildStudySetPath({ studySetId: lastOpenedSetId, activity, ...extras }));
        return;
      }
      if (onNavigateToStudyHub) onNavigateToStudyHub();
      else if (activity === 'quiz') onNavigateToTests?.();
    },
    [lastOpenedSetId, onNavigatePath, onNavigateToStudyHub, onNavigateToTests]
  );

  /**
   * The "Open Study" door goes to the HUB.
   *
   * `onNavigateToStudyHub` is a misnomer inherited from the shell: App wires it
   * to `openStudyDestination()`, which resolves the last opened set and lands on
   * that set's room, only falling through to the hub when there is no set. That
   * is the right behaviour for the bottom-nav Study tab (resume where you were),
   * but wrong for a door labelled "Open Study" sitting in a grid of six — the
   * student asked for the shelf, not the last book. `/study` parses to
   * `AppMode.STUDY_HUB`, so the path navigator reaches the hub directly; the
   * shell callback stays as the fallback when no path navigator is wired.
   */
  const openStudyHub = useCallback(() => {
    if (onNavigatePath) {
      onNavigatePath('/study');
      return;
    }
    onNavigateToStudyHub?.();
  }, [onNavigatePath, onNavigateToStudyHub]);

  // Load-bearing classes on the scroll shell: `flex-1 min-h-0` lets it shrink
  // inside the app's flex column (without `min-h-0` the column refuses to
  // shrink and the page, not this pane, scrolls); `overscroll-y-none` stops the
  // scroll chaining that otherwise bounces the whole window on trackpads.
  // `dashboardScrollRef` is attached but currently unread — it is the handle any
  // future scroll-restore would use.
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

      {/* Two-column spine from `lg:` up, single column below. `minmax(0,1fr)`
          on the main column and `min-w-0` on its child are what let long titles
          truncate instead of forcing the grid wider than the viewport — the
          sidebar already eats most of the width, so the content column is
          narrow and its cards must wrap on CONTENT width, not on `sm:`/`md:`
          viewport breakpoints. `lg:items-start` is what lets the rail be
          sticky (a stretched grid item has nothing to stick within). */}
      <div className="px-4 md:px-8 py-8 w-full">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10 lg:items-start space-y-8 lg:space-y-0">
          <div className="space-y-8 min-w-0">
            <DashboardHero
              userName={getDashboardFirstName({
                firstName: currentUser.firstName,
                name: currentUser.name,
                username: currentUser.username,
              })}
              dueCardsCount={homeDueTotal}
              totalTestsTaken={totalTestsTakenOverall}
              onPrimaryAction={() => {
                const action = primaryHomeAction({
                  dueCardsCount,
                  reviewPlan: homeReviewPlan,
                  lastActivity,
                });
                if (action.kind === 'review' && onReviewDueCards) {
                  onReviewDueCards();
                  return;
                }
                if (action.kind === 'continue' && action.href && onNavigatePath) {
                  onNavigatePath(action.href);
                  return;
                }
                if (onOpenImportAndStudy) onOpenImportAndStudy();
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
              onNavigatePath={onNavigatePath}
            />

            <RecentActivities
              {...activityInput}
              dueTotal={homeDueTotal}
              onStudyAllDue={onReviewDueCards}
              onOpen={(activity) => {
                // The companion has no URL of its own — it is a docked panel —
                // so its rows open the panel rather than navigating to a route
                // that does not exist.
                if (activity.kind === 'companion') {
                  onToggleCompanion?.();
                  return;
                }
                onNavigatePath?.(activity.targetRoute);
              }}
            />

            <section>
              <h2 className="text-title font-semibold text-lantern-text mb-4">
                {regions.get('upcomingExam')?.label ?? 'Upcoming exam'}
              </h2>
              <div className="space-y-3">
                {upcomingExams[0] ? (
                  <Card padding="md" className="rounded-2xl">
                    <p className="text-body font-semibold text-lantern-text">Upcoming exam</p>
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
                  </Card>
                ) : (
                  // No exam date anywhere: the slot shows READINESS instead of
                  // an empty card that only says a date is missing. The
                  // readiness card is the mastery rollup per course, and it is
                  // day-one useful — a brand-new student sees each course's
                  // outline and a "Start here" pointer. The black pill under it
                  // is the one action the empty state actually wants.
                  <>
                    <CourseReadinessCard
                      onOpenDeck={onOpenDeckById}
                      onOpenNote={onOpenNoteById}
                      onOpenTests={onNavigateToTests}
                      onOpenAcademicSettings={onOpenAcademicSettings}
                    />
                    {onOpenAcademicSettings ? (
                      <button
                        type="button"
                        onClick={onOpenAcademicSettings}
                        className="inline-flex items-center gap-1.5 rounded-full bg-lantern-ink px-4 py-2 text-caption font-semibold text-lantern-surface hover:opacity-90 transition-opacity"
                      >
                        <AppIcon name="calendar" size={14} aria-hidden />
                        Add exam date
                      </button>
                    ) : null}
                  </>
                )}
                {onOpenCourseWorkspace && <WorkspaceJumpBack onOpen={onOpenCourseWorkspace} />}
                <ClassWorkCard />
                <div className="empty:hidden">
                  <AiJobsCard />
                </div>
              </div>
            </section>

            <HomeQuickActions
              onImport={onOpenImportAndStudy ?? onNavigateToAITools}
              onOpenTests={
                onNavigateToStudyHub || onNavigateToTests || onNavigatePath
                  ? () => openLastSetActivity('quiz', { createNew: true })
                  : undefined
              }
              onToggleCompanion={onToggleCompanion}
              onOpenTutor={
                onNavigateToStudyHub || onNavigatePath
                  ? () => openLastSetActivity('lesson')
                  : undefined
              }
              onRecordLecture={onRecordLecture}
              onOpenStudyHub={onNavigateToStudyHub || onNavigatePath ? openStudyHub : undefined}
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
              // FIXED (F9): both navigations used to fire. The handlers return
              // `void`, so `onNavigateToLibrary?.()` was always falsy and `||`
              // ran `onNavigateToFlashcards?.()` as well — the library route
              // was entered and then immediately replaced by flashcards. The
              // fallback is now chosen on whether the handler EXISTS, which is
              // what every sibling here (onCreateDeck, onTakeTest) already did.
              onOpenLibrary={() => {
                if (onNavigateToLibrary) onNavigateToLibrary();
                else onNavigateToFlashcards?.();
              }}
              onTryCompanion={() => onToggleCompanion?.()}
              onSubmitQuestion={() => onNavigateToChat?.()}
              onExploreMarketplace={() => onNavigateToMarketplace?.()}
              onTryOffline={() => onNavigateToOffline?.()}
            />

            {/* Region 7 of the shared spine. It used to sit in the right rail,
                which mobile has no equivalent of, so the two Homes ended on
                different things. The rail now carries only Streak. */}
            <section>
              <h2 className="text-title font-semibold text-lantern-text mb-4">
                {regions.get('joinClass')?.label ?? 'Join a class'}
              </h2>
              <JoinClassCard />
            </section>
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
          </aside>
        </div>
      </div>
    </div>
  );
}
