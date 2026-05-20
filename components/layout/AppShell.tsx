import React from 'react';
import { AppMode } from '../../types';
import Sidebar from '../Sidebar';
import BottomNav from './BottomNav';
import AIUsageBadge from '../AIUsageBadge';
import { useUIStore } from '../../stores/uiStore';
import { useTestStore } from '../../stores/testStore';

interface AppShellProps {
    children: React.ReactNode;
    sidebarProps: React.ComponentProps<typeof Sidebar>;
    dueCardsCount?: number;
    unreadChatCount?: number;
}

/**
 * AppShell provides responsive layout:
 * - Desktop (md+): fixed sidebar on the left
 * - Mobile (<md): bottom navigation bar, sidebar hidden
 * - Paused session banner shown globally when navigating away from active test/study
 */
const AppShell: React.FC<AppShellProps> = ({ children, sidebarProps, dueCardsCount = 0, unreadChatCount = 0 }) => {
    const { appMode, setAppMode, isSidebarExpanded } = useUIStore();
    const { activeTestSession, activeStudySession } = useTestStore();

    const activeSession = activeTestSession || activeStudySession;
    const sessionAppMode = activeTestSession ? AppMode.TEST_ACTIVE : AppMode.STUDY_ACTIVE;
    const isSessionPaused = activeSession && appMode !== sessionAppMode;

    return (
        <div className="flex h-screen bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 transition-colors">
            {/* Desktop sidebar - hidden on mobile */}
            <div className="hidden md:block">
                <Sidebar {...sidebarProps} />
            </div>

            {/* Main content area */}
            <main className={`flex-1 flex flex-col min-h-0 transition-all duration-300 ease-in-out pb-16 md:pb-0 ${isSidebarExpanded ? 'md:ml-64' : 'md:ml-20'} ${isSessionPaused ? 'pt-12' : ''}`}>
                {/* Paused session banner (mobile only).  Make it fixed so it never scrolls away and
                    add top padding to main content when shown so nothing is hidden underneath. */}
                {isSessionPaused && (
                    <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 flex items-center justify-between">
                        <span className="text-sm font-medium">
                            {activeTestSession ? 'Test' : 'Study'} session paused
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
                {children}

                {/* mobile-only AI usage indicator floating above bottom nav */}
                <div className="md:hidden fixed bottom-20 right-4 z-50">
                    <AIUsageBadge compact className="px-2 py-1 shadow-lg" />
                </div>
            </main>

            {/* Mobile bottom nav - hidden on desktop */}
            <BottomNav
                currentMode={appMode}
                onNavigate={setAppMode}
                dueCardsCount={dueCardsCount}
                unreadChatCount={unreadChatCount}
                unreadNotificationCount={sidebarProps.unreadNotificationCount}
                onOpenNotifications={sidebarProps.onOpenNotificationModal}
                onOpenSettings={sidebarProps.onOpenSettingsModal}
                onToggleTheme={sidebarProps.onToggleTheme}
                theme={sidebarProps.theme}
                onLogout={sidebarProps.onLogout}
            />
        </div>
    );
};

export default AppShell;
