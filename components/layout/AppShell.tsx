import React, { useEffect, useMemo, useRef, useState } from 'react';
import { XMarkIcon, ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { AppMode } from '../../types';
import { AppRouteParams } from '../../utils/appRoutes';
import Sidebar from '../Sidebar';
import BottomNav from './BottomNav';
import AIUsageBadge from '../AIUsageBadge';
import { ConnectionBadge } from '../ui/ConnectionBadge';
import { useUIStore } from '../../stores/uiStore';
import { useTestStore } from '../../stores/testStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useAuthStore } from '../../stores/authStore';
import { useNoteUploadStore, getActiveUploadJob, getVisibleUploadJobs } from '../../stores/noteUploadStore';
import { fetchAIUsage } from '../../services/ai';

interface AppShellProps {
    children: React.ReactNode;
    sidebarProps: React.ComponentProps<typeof Sidebar>;
    dueCardsCount?: number;
    unreadChatCount?: number;
    onNavigate: (mode: AppMode, params?: AppRouteParams) => void;
    /** Hide floating AI badge on mobile (e.g. active chat composer) */
    hideMobileAiUsageBadge?: boolean;
}

const IMPORT_PROGRESS_WATCHDOG_MS = 5 * 60 * 1000;

/**
 * AppShell provides responsive layout:
 * - Desktop (md+): fixed sidebar on the left
 * - Mobile (<md): bottom navigation bar, sidebar hidden
 * - Paused session banner shown globally when navigating away from active test/study
 */
const AppShell: React.FC<AppShellProps> = ({ children, sidebarProps, dueCardsCount = 0, unreadChatCount = 0, onNavigate, hideMobileAiUsageBadge = false }) => {
    const { appMode, isSidebarExpanded, lowDataMode, importProgress, clearImportProgress } = useUIStore();
    const uploadJobList = useNoteUploadStore((s) => s.jobs);
    const uploadJobs = useMemo(() => getVisibleUploadJobs(uploadJobList), [uploadJobList]);
    const activeUploadJob = useMemo(() => getActiveUploadJob(uploadJobList), [uploadJobList]);
    const dismissUploadJob = useNoteUploadStore((s) => s.dismissJob);
    const { activeTestSession, activeStudySession, activeGameSession } = useTestStore();
    const { isOpen: isCompanionOpen, toggle: toggleCompanion } = useCompanionStore();
    const currentUser = useAuthStore(s => s.currentUser);
    const isAuthLoading = useAuthStore(s => s.isAuthLoading);

    useEffect(() => {
        if (!currentUser?.id || isAuthLoading) return;
        void fetchAIUsage(currentUser.id);
    }, [currentUser?.id, isAuthLoading]);

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
    const bottomNavHidden = [
        AppMode.TEST_ACTIVE, AppMode.STUDY_ACTIVE, AppMode.GAME_ACTIVE,
        AppMode.GAME_RESULTS, AppMode.TEST_REVIEW,
    ].includes(appMode);

    return (
        <div className="flex h-screen overflow-hidden bg-lantern-background text-lantern-text transition-colors">
            {/* Desktop sidebar - hidden on mobile */}
            <div className="hidden md:block">
                <Sidebar {...sidebarProps} />
            </div>

            {/* Main content area */}
            <main className={`flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden transition-all duration-300 ease-in-out ${bottomNavHidden ? 'pb-0' : 'pb-16'} md:pb-0 ${isSidebarExpanded ? 'md:ml-72' : 'md:ml-20'} ${isSessionPaused ? 'pt-12' : ''}`}>
                {/* Paused session banner (mobile only).  Make it fixed so it never scrolls away and
                    add top padding to main content when shown so nothing is hidden underneath. */}
                {isSessionPaused && (
                    <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 flex items-center justify-between">
                        <span className="text-sm font-medium">
                            {pausedSessionLabel} session paused
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => sidebarProps.onResumeSession(sessionAppMode)}
                                className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition-colors"
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
                </div>
                {importProgress ? (
                    <div
                        className="shrink-0 px-3 py-2 md:px-4 border-b border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40"
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-center gap-3 min-w-0 max-w-full">
                            <ArrowPathIcon className="w-5 h-5 text-indigo-500 shrink-0 animate-spin" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {importProgress.label}
                                </p>
                                {importProgress.fileName && (
                                    <p className="text-xs text-gray-600 dark:text-gray-400 truncate mt-0.5">
                                        {importProgress.fileName}
                                    </p>
                                )}
                                {importProgress.percent != null ? (
                                    <div className="mt-2 h-2 rounded-full overflow-hidden bg-indigo-100 dark:bg-gray-700">
                                        <div
                                            className="h-full bg-indigo-500 transition-all duration-300"
                                            style={{ width: `${importProgress.percent}%` }}
                                        />
                                    </div>
                                ) : (
                                    <div className="mt-2 h-2 rounded-full overflow-hidden bg-indigo-100 dark:bg-gray-700">
                                        <div className="h-full w-1/3 bg-indigo-500 rounded-full animate-upload-indeterminate" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : activeUploadJob ? (
                    <div
                        className="shrink-0 px-3 py-2 md:px-4 border-b border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40"
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-center gap-3 min-w-0 max-w-full">
                            <ArrowPathIcon className="w-5 h-5 text-indigo-500 shrink-0 animate-spin" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {activeUploadJob.label}
                                </p>
                                <p className="text-xs text-gray-600 dark:text-gray-400 truncate mt-0.5">
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
                            <ExclamationCircleIcon className="w-5 h-5 text-red-500 shrink-0" />
                        ) : (
                            <CheckCircleIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {job.status === 'failed' ? 'Upload failed' : 'Upload complete'}
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 truncate mt-0.5">
                                {job.fileName}
                                {job.error ? ` — ${job.error}` : ''}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => dismissUploadJob(job.id)}
                            className="shrink-0 p-1 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-white/60 dark:text-gray-400 dark:hover:text-gray-100"
                            aria-label="Dismiss upload notification"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    </div>
                ))}
                {children}

                {/* mobile-only AI usage indicator — hidden during chat (composer + send) */}
                {!hideMobileAiUsageBadge && (
                <div className="md:hidden fixed top-1/2 -translate-y-1/2 right-3 z-30 max-w-[9rem] pointer-events-none">
                    <div className="pointer-events-auto scale-90 origin-center">
                        <AIUsageBadge compact className="px-2 py-1 shadow-md" />
                    </div>
                </div>
                )}
            </main>

            {/* Mobile bottom nav - hidden on desktop */}
            <BottomNav
                currentMode={appMode}
                onNavigate={onNavigate}
                dueCardsCount={dueCardsCount}
                unreadChatCount={unreadChatCount}
                unreadNotificationCount={sidebarProps.unreadNotificationCount}
                onOpenNotifications={sidebarProps.onOpenNotificationModal}
                onOpenSettings={sidebarProps.onOpenSettingsModal}
                onToggleTheme={sidebarProps.onToggleTheme}
                theme={sidebarProps.theme}
                onLogout={sidebarProps.onLogout}
                onToggleCompanion={toggleCompanion}
                isCompanionOpen={isCompanionOpen}
                isOnline={sidebarProps.isOnline}
                pendingSyncCount={sidebarProps.pendingSyncCount}
                lowDataMode={lowDataMode}
            />
        </div>
    );
};

export default AppShell;
