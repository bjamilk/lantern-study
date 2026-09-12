import React, { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { AppIcon } from '../ui/AppIcon';
import { AppMode } from '../../types';
import { AppRouteParams } from '../../utils/appRoutes';
import Sidebar from '../Sidebar';
import BottomNav from './BottomNav';
import { ConnectionBadge } from '../ui/ConnectionBadge';
import { useUIStore } from '../../stores/uiStore';
import { useTestStore } from '../../stores/testStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useAuthStore } from '../../stores/authStore';
import { useNoteUploadStore, getActiveUploadJob, getVisibleUploadJobs } from '../../stores/noteUploadStore';
import {
  getSessionElapsedMs,
  useLectureRecordingStore,
} from '../../stores/lectureRecordingStore';
import {
  formatRecordingDuration,
  MIN_LECTURE_RECORD_MS,
} from '../../services/lectureRecording';
import { fetchAIUsage } from '../../services/ai';
import { resolveShellSideColumn } from './shellSideColumn';
import { useAiCredits } from './useAiCredits';

interface AppShellProps {
    children: React.ReactNode;
    sidebarProps: React.ComponentProps<typeof Sidebar>;
    dueCardsCount?: number;
    unreadChatCount?: number;
    onNavigate: (mode: AppMode, params?: AppRouteParams) => void;
    /** The two destinations that are not a plain AppMode jump. */
    onNavigateToMe: () => void;
    onNavigateToCampus: () => void;
    /** Open the note currently being recorded (Return from sticky banner). */
    onOpenLectureNote?: (noteId: string) => void;
}

const IMPORT_PROGRESS_WATCHDOG_MS = 5 * 60 * 1000;

/**
 * AppShell provides responsive layout:
 * - Desktop (md+): fixed sidebar on the left
 * - Mobile (<md): bottom navigation bar, sidebar hidden
 * - Paused session banner shown globally when navigating away from active test/study
 */
const AppShell: React.FC<AppShellProps> = ({
    children,
    sidebarProps,
    dueCardsCount = 0,
    unreadChatCount = 0,
    onNavigate,
    onNavigateToMe,
    onNavigateToCampus,
    onOpenLectureNote,
}) => {
    const location = useLocation();
    const { appMode, isSidebarExpanded, isChatsSectionExpanded, activeCommunity, lowDataMode, importProgress, clearImportProgress } = useUIStore();
    const uploadJobList = useNoteUploadStore((s) => s.jobs);
    const uploadJobs = useMemo(() => getVisibleUploadJobs(uploadJobList), [uploadJobList]);
    const activeUploadJob = useMemo(() => getActiveUploadJob(uploadJobList), [uploadJobList]);
    const dismissUploadJob = useNoteUploadStore((s) => s.dismissJob);
    const { activeTestSession, activeStudySession, activeGameSession } = useTestStore();
    const isCompanionOpen = useCompanionStore((s) => s.isOpen);
    const toggleCompanion = useCompanionStore((s) => s.toggle);
    const aiCredits = useAiCredits();
    const currentUser = useAuthStore(s => s.currentUser);
    const isAuthLoading = useAuthStore(s => s.isAuthLoading);
    const lectureStatus = useLectureRecordingStore((s) => s.status);
    const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
    const lectureNoteTitle = useLectureRecordingStore((s) => s.noteTitle);
    const lectureStartedAt = useLectureRecordingStore((s) => s.startedAt);
    const lecturePausedAt = useLectureRecordingStore((s) => s.pausedAt);
    const lecturePausedTotalMs = useLectureRecordingStore((s) => s.pausedTotalMs);
    const lectureTick = useLectureRecordingStore((s) => s.tick);
    const stopLecture = useLectureRecordingStore((s) => s.stopAndTranscribe);
    const pauseLecture = useLectureRecordingStore((s) => s.pauseRecording);
    const resumeLecture = useLectureRecordingStore((s) => s.resumeRecording);
    const discardLecture = useLectureRecordingStore((s) => s.discard);
    const cancelLectureTranscription = useLectureRecordingStore((s) => s.cancelTranscription);
    const lectureActive = lectureStatus !== 'idle' && Boolean(lectureNoteId);
    const lecturePaused = lectureStatus === 'recording' && Boolean(lecturePausedAt);
    const lectureSeconds =
      lectureStatus === 'recording'
        ? Math.floor(
            getSessionElapsedMs({
              startedAt: lectureStartedAt,
              pausedAt: lecturePausedAt,
              pausedTotalMs: lecturePausedTotalMs,
            }) / 1000
          )
        : 0;
    void lectureTick;
    // Always show when a lecture session is active so in-app navigation stays obvious.
    const lectureBannerVisible = lectureActive;

    useEffect(() => {
        if (!currentUser?.id || isAuthLoading) return;
        void fetchAIUsage(currentUser.id);
    }, [currentUser?.id, isAuthLoading]);

    useEffect(() => {
        if (!lectureActive) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [lectureActive]);

    // Flush active test/study draft on hide/unload so refresh keeps progress.
    useEffect(() => {
        const hasActiveRunner =
            (appMode === AppMode.TEST_ACTIVE && !!activeTestSession) ||
            (appMode === AppMode.STUDY_ACTIVE && !!activeStudySession);
        if (!hasActiveRunner) return;

        const flush = () => {
            void import('../../utils/sessionDraftSync').then(({ flushActiveSessionDraft }) => {
                let remaining: number | undefined;
                if (activeTestSession?.endTime) {
                    remaining = Math.max(
                        0,
                        Math.round((new Date(activeTestSession.endTime).getTime() - Date.now()) / 1000),
                    );
                }
                void flushActiveSessionDraft({
                    status: 'paused',
                    remainingTime: remaining,
                });
            });
        };

        const onVisibility = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            flush();
            event.preventDefault();
            event.returnValue = '';
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('beforeunload', onBeforeUnload);
        };
    }, [appMode, activeTestSession, activeStudySession]);

    useEffect(() => {
        if (!importProgress) return;
        const timer = window.setTimeout(() => {
            clearImportProgress();
        }, IMPORT_PROGRESS_WATCHDOG_MS);
        return () => window.clearTimeout(timer);
    }, [importProgress, clearImportProgress]);

    const pausedTest = activeTestSession && appMode !== AppMode.TEST_ACTIVE;
    const pausedStudy = activeStudySession && appMode !== AppMode.STUDY_ACTIVE;
    const pausedGame = !!(
        activeGameSession
        && !activeGameSession.isComplete
        && !activeGameSession.awaitingOpponent
        && appMode !== AppMode.GAME_ACTIVE
    );
    const isSessionPaused = pausedTest || pausedStudy || pausedGame;
    const sessionAppMode = pausedTest
        ? AppMode.TEST_ACTIVE
        : pausedStudy
            ? AppMode.STUDY_ACTIVE
            : AppMode.GAME_ACTIVE;
    const pausedSessionLabel = pausedTest ? 'Test' : pausedStudy ? 'Study' : 'Game';

    const finishedUploadJobs = uploadJobs.filter(
        (j) => j.status === 'complete' || j.status === 'failed'
    );
    const sideColumn = resolveShellSideColumn({ isChatsSectionExpanded, appMode, activeCommunity });
    const bottomNavHidden = [
        AppMode.TEST_ACTIVE, AppMode.STUDY_ACTIVE, AppMode.GAME_ACTIVE,
        AppMode.GAME_RESULTS, AppMode.TEST_REVIEW,
    ].includes(appMode) || isCompanionOpen;

  return (
    <div className="fixed inset-0 flex overflow-hidden overscroll-none bg-lantern-background text-lantern-text transition-colors">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-lantern-primary focus:px-4 focus:py-2 focus:text-white focus:outline-none"
      >
        Skip to main content
      </a>
            {/* Desktop sidebar - hidden on mobile */}
            <div className="hidden md:block">
                <Sidebar {...sidebarProps} />
            </div>

            {/* Main content area */}
            <main id="main-content" tabIndex={-1} className={`flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden transition-all duration-300 ease-in-out ${bottomNavHidden ? 'pb-0' : 'safe-area-pb'} md:pb-0 ${
                // Sidebar (what the aside shows) and this offset come from the
                // SAME resolveShellSideColumn call — they drifted once and the
                // content sat under the column. A column no longer forces the
                // sidebar down to its icon rail, so the offset is the sidebar's
                // real width (18rem or 5rem) plus the column's 20rem.
                sideColumn !== null
                  ? (isSidebarExpanded ? 'md:ml-[38rem]' : 'md:ml-[25rem]')
                  // Tracks the rail's own widths (components/Sidebar.tsx:
                  // `w-56` / `w-16`), which the 2026-09-11 pass narrowed from
                  // 288/80 px. The rail is `fixed`, so this margin is the only
                  // thing keeping the page out from under it.
                  : isSidebarExpanded ? 'md:ml-56' : 'md:ml-16'
            } ${isSessionPaused && !lectureBannerVisible ? 'pt-12' : ''}`}>
                {/* Paused session banner (mobile only).  Make it fixed so it never scrolls away and
                    add top padding to main content when shown so nothing is hidden underneath. */}
                {isSessionPaused && !lectureBannerVisible && (
                    <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 flex items-center justify-between">
                        <span className="text-sm font-medium">
                            {pausedSessionLabel} session paused
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => sidebarProps.onResumeSession(sessionAppMode)}
                                className="px-3 py-1 bg-lantern-surface/20 hover:bg-lantern-surface/30 rounded-lg text-sm font-semibold transition-colors"
                            >
                                Resume
                            </button>
                            <button
                                onClick={sidebarProps.onCancelSession}
                                className="px-3 py-1 bg-red-600/80 hover:bg-red-700 rounded-lg text-sm font-semibold transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
                {lectureBannerVisible && lectureNoteId && (
                    <div className="shrink-0 bg-red-600 text-white px-3 py-2 flex items-center justify-between gap-2">
                        <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => onOpenLectureNote?.(lectureNoteId)}
                        >
                            <span className="block text-caption font-semibold truncate">
                                {lectureStatus === 'recording'
                                  ? `${lecturePaused ? 'Paused' : 'Recording'} ${formatRecordingDuration(lectureSeconds)}`
                                  : lectureStatus === 'uploading'
                                    ? 'Uploading lecture…'
                                    : 'Transcribing lecture…'}
                            </span>
                            <span className="block text-label opacity-90 truncate">
                                {lectureNoteTitle || 'Untitled note'} · Tap to return
                            </span>
                            {/* Parity with the mobile pre-flight card's consent
                                line (apps/mobile/src/components/lecture/
                                lecturePreflight.ts). Same sentence, so the two
                                platforms make the same promise. */}
                            {lectureStatus === 'recording' && (
                                <span className="block text-label opacity-75 truncate">
                                    Recording is stored in your note; ask before recording other people.
                                </span>
                            )}
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {lectureStatus === 'recording' ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => (lecturePaused ? resumeLecture() : pauseLecture())}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs sm:text-sm font-semibold"
                                    >
                                        <AppIcon name={lecturePaused ? 'play' : 'pause'} size={16} />
                                        <span className="hidden sm:inline">{lecturePaused ? 'Resume' : 'Pause'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={lectureSeconds * 1000 < MIN_LECTURE_RECORD_MS}
                                        onClick={() => stopLecture()}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white/20 hover:bg-white/30 disabled:opacity-50 rounded-lg text-xs sm:text-sm font-semibold"
                                    >
                                        <AppIcon name="stop" size={16} />
                                        <span className="hidden sm:inline">
                                          {lectureSeconds < 2 ? `Wait ${2 - lectureSeconds}s` : 'Stop & transcribe'}
                                        </span>
                                        <span className="sm:hidden">{lectureSeconds < 2 ? `${2 - lectureSeconds}s` : 'Stop'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => discardLecture()}
                                        className="px-2.5 py-1 bg-black/20 hover:bg-black/30 rounded-lg text-xs sm:text-sm font-semibold"
                                    >
                                        Discard
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => cancelLectureTranscription()}
                                    className="px-2.5 py-1 bg-black/20 hover:bg-black/30 rounded-lg text-xs sm:text-sm font-semibold"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>
                )}
                {/* Connection status strip — single badge; compact on mobile */}
                <div className="shrink-0 px-3 py-1 md:px-4 md:py-2 border-b border-lantern-border bg-lantern-surface flex items-center justify-between gap-2 min-w-0 max-w-full overflow-x-hidden">
                    <ConnectionBadge
                        isOnline={sidebarProps.isOnline}
                        lowDataMode={lowDataMode}
                        pendingSyncCount={sidebarProps.pendingSyncCount}
                        compact
                        className="md:hidden"
                    />
                    <ConnectionBadge
                        isOnline={sidebarProps.isOnline}
                        lowDataMode={lowDataMode}
                        pendingSyncCount={sidebarProps.pendingSyncCount}
                        compact={false}
                        className="hidden md:inline-flex"
                    />
                    {/*
                      The two things that FOLLOW you. On desktop they are
                      labelled rows in the sidebar; at phone width the bar below
                      is the five destinations and nothing else, so they live
                      here — the same place mobile keeps them. This also retires
                      the standalone AI-usage badge: a count belongs on the thing
                      it counts, not floating beside it.
                    */}
                    <div className="md:hidden flex items-center gap-1 shrink-0">
                        {appMode !== AppMode.COURSE_WORKSPACE && appMode !== AppMode.STUDY_SET_WORKSPACE ? (
                        <button
                            type="button"
                            onClick={toggleCompanion}
                            data-tip-id="nav.companion"
                            aria-label={
                                aiCredits != null
                                    ? `Lantern AI, ${aiCredits} AI credits`
                                    : 'Lantern AI'
                            }
                            aria-pressed={isCompanionOpen}
                            className={`relative flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full transition-colors ${
                                isCompanionOpen
                                    ? 'text-lantern-primary bg-lantern-primary-background'
                                    : 'text-lantern-text-secondary hover:text-lantern-text'
                            }`}
                        >
                            <AppIcon name="sparkles" size={24} />
                            {aiCredits != null ? (
                                <span
                                    aria-hidden="true"
                                    className="absolute top-1 right-0.5 rounded-full bg-lantern-primary px-1 text-label tracking-normal font-bold leading-4 text-white"
                                >
                                    {aiCredits > 99 ? '99+' : aiCredits}
                                </span>
                            ) : null}
                        </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={sidebarProps.onOpenNotificationModal}
                            aria-label={
                                sidebarProps.unreadNotificationCount > 0
                                    ? `Notifications, ${sidebarProps.unreadNotificationCount > 99 ? '99+' : sidebarProps.unreadNotificationCount} unread`
                                    : 'Notifications'
                            }
                            className="relative flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full text-lantern-text-secondary hover:text-lantern-text transition-colors"
                        >
                            <AppIcon name="notifications" size={24} />
                            {sidebarProps.unreadNotificationCount > 0 ? (
                                <span
                                    aria-hidden="true"
                                    className="absolute top-1 right-0.5 rounded-full bg-lantern-error-strong px-1 text-label tracking-normal font-bold leading-4 text-white"
                                >
                                    {sidebarProps.unreadNotificationCount > 99 ? '99+' : sidebarProps.unreadNotificationCount}
                                </span>
                            ) : null}
                        </button>
                    </div>
                </div>
                {importProgress ? (
                    <div
                        className="shrink-0 px-3 py-2 md:px-4 border-b border-lantern-primary/20 bg-lantern-primary-background"
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-center gap-3 min-w-0 max-w-full">
                            <AppIcon name="refresh" size={20} className="text-lantern-primary shrink-0 animate-spin" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-lantern-text truncate">
                                    {importProgress.label}
                                </p>
                                {importProgress.fileName && (
                                    <p className="text-xs text-lantern-text-secondary truncate mt-0.5">
                                        {importProgress.fileName}
                                    </p>
                                )}
                                {importProgress.percent != null ? (
                                    <div className="mt-2 h-2 rounded-full overflow-hidden bg-lantern-primary/10">
                                        <div
                                            className="h-full bg-lantern-primary transition-all duration-300"
                                            style={{ width: `${importProgress.percent}%` }}
                                        />
                                    </div>
                                ) : (
                                    <div className="mt-2 h-2 rounded-full overflow-hidden bg-lantern-primary/10">
                                        <div className="h-full w-1/3 bg-lantern-primary rounded-full animate-upload-indeterminate" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : activeUploadJob ? (
                    <div
                        className="shrink-0 px-3 py-2 md:px-4 border-b border-lantern-primary/30 bg-lantern-primary-background dark:border-lantern-primary/30 dark:bg-lantern-primary-background"
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-center gap-3 min-w-0 max-w-full">
                            <AppIcon name="refresh" size={20} className="text-lantern-primary shrink-0 animate-spin" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-lantern-text truncate">
                                    {activeUploadJob.label}
                                </p>
                                <p className="text-xs text-lantern-text-secondary truncate mt-0.5">
                                    {activeUploadJob.fileName}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : null}
                {finishedUploadJobs.map((job) => (
                    <div
                        key={job.id}
                        className={`shrink-0 px-3 py-2 md:px-4 border-b flex items-center gap-3 min-w-0 ${
                            job.status === 'failed'
                                ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40'
                                : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                        }`}
                        role="status"
                        aria-live="polite"
                    >
                        {job.status === 'failed' ? (
                            <AppIcon name="alert-circle" size={20} className="text-red-500 shrink-0" />
                        ) : (
                            <AppIcon name="checkmark-circle" size={20} className="text-emerald-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-lantern-text truncate">
                                {job.status === 'failed' ? 'Upload failed' : 'Upload complete'}
                            </p>
                            <p className="text-xs text-lantern-text-secondary truncate mt-0.5">
                                {job.fileName}
                                {job.error ? ` — ${job.error}` : ''}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => dismissUploadJob(job.id)}
                            className="shrink-0 p-1 rounded-lg text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-surface/60 dark:text-lantern-text-tertiary dark:hover:text-lantern-text"
                            aria-label="Dismiss upload notification"
                        >
                            <AppIcon name="close" size={20} />
                        </button>
                    </div>
                ))}
                {children}

            </main>

            {/* Mobile bottom nav - hidden on desktop and while AI companion / immersive modes are open */}
            {!bottomNavHidden ? (
            <BottomNav
                currentMode={appMode}
                currentPath={location.pathname}
                onNavigate={onNavigate}
                onNavigateToMe={onNavigateToMe}
                onNavigateToCampus={onNavigateToCampus}
                dueCardsCount={dueCardsCount}
                unreadChatCount={unreadChatCount}
            />
            ) : null}
        </div>
    );
};

export default AppShell;
