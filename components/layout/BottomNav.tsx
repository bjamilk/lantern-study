import React, { useState, useRef, useEffect } from 'react';
import { AppMode } from '../../types';
import { useLowDataModeToggle } from '../../hooks/useLowDataModeToggle';
import {
    HomeIcon,
    AcademicCapIcon,
    ChatBubbleLeftRightIcon,
    EllipsisHorizontalIcon,
    BellIcon,
    SparklesIcon,
    BookOpenIcon,
} from '@heroicons/react/24/outline';
import {
    HomeIcon as HomeIconSolid,
    AcademicCapIcon as AcademicCapIconSolid,
    ChatBubbleLeftRightIcon as ChatBubbleLeftRightIconSolid,
    EllipsisHorizontalIcon as EllipsisHorizontalIconSolid,
    BookOpenIcon as BookOpenIconSolid,
    CreditCardIcon,
    CloudArrowDownIcon,
    Cog6ToothIcon,
    SunIcon,
    MoonIcon,
    ArrowLeftOnRectangleIcon,
    BellAlertIcon,
    SignalIcon,
    SignalSlashIcon,
    ShoppingBagIcon,
} from '@heroicons/react/24/solid';

interface BottomNavProps {
    currentMode: AppMode;
    onNavigate: (mode: AppMode) => void;
    unreadChatCount?: number;
    dueCardsCount?: number;
    unreadNotificationCount?: number;
    onOpenNotifications?: () => void;
    onOpenSettings?: () => void;
    onToggleTheme?: () => void;
    theme?: 'light' | 'dark';
    onLogout?: () => void;
    onToggleCompanion?: () => void;
    isCompanionOpen?: boolean;
    isOnline?: boolean;
    pendingSyncCount?: number;
    lowDataMode?: boolean;
}

interface NavTab {
    label: string;
    modes: AppMode[];
    icon: React.ElementType;
    activeIcon: React.ElementType;
    targetMode: AppMode;
    badge?: number;
}

const BottomNav: React.FC<BottomNavProps> = ({ currentMode, onNavigate, unreadChatCount = 0, dueCardsCount = 0, unreadNotificationCount = 0, onOpenNotifications, onOpenSettings, onToggleTheme, theme, onLogout, onToggleCompanion, isCompanionOpen, isOnline = true, pendingSyncCount = 0, lowDataMode: lowDataProp }) => {
    const { lowDataMode: lowDataToggle, toggleLowDataMode } = useLowDataModeToggle();
    const lowDataMode = lowDataProp ?? lowDataToggle;
    const [isMoreOpen, setIsMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
                setIsMoreOpen(false);
            }
        };
        if (isMoreOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isMoreOpen]);

    const libraryModes = [
        AppMode.LIBRARY, AppMode.NOTES, AppMode.NOTE_EDITOR, AppMode.FLASHCARDS,
        AppMode.DECK_DETAIL,
    ];
    const studyModes = [
        AppMode.STUDY_HUB, AppMode.FLASHCARD_REVIEW, AppMode.FLASHCARD_CRAM,
        AppMode.FLASHCARD_MATCH, AppMode.FLASHCARD_LEARN, AppMode.AI_TOOLS,
    ];

    const tabs: NavTab[] = [
        {
            label: 'Home',
            modes: [AppMode.DASHBOARD],
            icon: HomeIcon,
            activeIcon: HomeIconSolid,
            targetMode: AppMode.DASHBOARD,
        },
        {
            label: 'Library',
            modes: libraryModes,
            icon: BookOpenIcon,
            activeIcon: BookOpenIconSolid,
            targetMode: AppMode.LIBRARY,
        },
        {
            label: 'Study',
            modes: studyModes,
            icon: AcademicCapIcon,
            activeIcon: AcademicCapIconSolid,
            targetMode: AppMode.STUDY_HUB,
            badge: dueCardsCount,
        },
        {
            label: 'Chat',
            modes: [AppMode.CHAT, AppMode.CREATE_GROUP],
            icon: ChatBubbleLeftRightIcon,
            activeIcon: ChatBubbleLeftRightIconSolid,
            targetMode: AppMode.CHAT,
            badge: unreadChatCount,
        },
    ];

    const moreModes = [
        AppMode.MARKETPLACE, AppMode.MARKETPLACE_LISTING_DETAIL, AppMode.MY_LISTINGS,
        AppMode.MARKETPLACE_INQUIRIES, AppMode.CREATE_MARKETPLACE_LISTING,
        AppMode.BUDGET_TRACKER, AppMode.OFFLINE_MODE,
    ];
    const isMoreActive = moreModes.includes(currentMode);

    const isActive = (tab: NavTab) => tab.modes.includes(currentMode);

    const hiddenModes = [
        AppMode.TEST_ACTIVE, AppMode.STUDY_ACTIVE, AppMode.GAME_ACTIVE,
        AppMode.GAME_RESULTS, AppMode.TEST_REVIEW,
    ];
    if (hiddenModes.includes(currentMode)) return null;

    const moreItems = [
        { label: 'Explore', icon: ShoppingBagIcon, mode: AppMode.MARKETPLACE },
        ...(onToggleCompanion ? [{ label: isCompanionOpen ? 'Close Lantern AI' : 'Lantern AI', icon: SparklesIcon, action: onToggleCompanion, isCompanion: true }] : []),
        ...(onOpenNotifications ? [{ label: 'Notifications', icon: BellAlertIcon, action: onOpenNotifications, badge: unreadNotificationCount }] : []),
        { label: 'Budget Tracker', icon: CreditCardIcon, mode: AppMode.BUDGET_TRACKER },
        { label: 'Offline Mode', icon: CloudArrowDownIcon, mode: AppMode.OFFLINE_MODE },
    ];

    const actionItems = [
        ...(onOpenSettings ? [{ label: 'Settings', icon: Cog6ToothIcon, action: onOpenSettings }] : []),
        ...(onToggleTheme ? [{ label: theme === 'light' ? 'Dark Mode' : 'Light Mode', icon: theme === 'light' ? MoonIcon : SunIcon, action: onToggleTheme }] : []),
        { label: lowDataMode ? 'Low-Data Mode: ON' : 'Low-Data Mode: OFF', icon: lowDataMode ? SignalSlashIcon : SignalIcon, action: toggleLowDataMode, isLowData: true },
        ...(onLogout ? [{ label: 'Logout', icon: ArrowLeftOnRectangleIcon, action: onLogout, isDestructive: true }] : []),
    ];

    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-lantern-surface border-t border-lantern-border safe-area-bottom">
            <div className="flex items-center justify-around h-16">
                {tabs.map((tab) => {
                    const active = isActive(tab);
                    const Icon = active ? tab.activeIcon : tab.icon;
                    return (
                        <button
                            key={tab.label}
                            type="button"
                            aria-label={tab.label}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => { onNavigate(tab.targetMode); setIsMoreOpen(false); }}
                            className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors ${
                                active ? 'text-lantern-primary' : 'text-lantern-text-secondary hover:text-lantern-text'
                            }`}
                        >
                            <div className="relative">
                                <Icon className="w-6 h-6" />
                                {tab.badge && tab.badge > 0 ? (
                                    <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                                        {tab.badge > 99 ? '99+' : tab.badge}
                                    </span>
                                ) : null}
                            </div>
                            <span className={`text-[10px] mt-0.5 font-medium ${active ? 'font-semibold' : ''}`}>
                                {tab.label}
                            </span>
                            {active && (
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-lantern-primary rounded-b" />
                            )}
                        </button>
                    );
                })}

                <div ref={moreRef} className="relative flex-1 h-full">
                    <button
                        type="button"
                        aria-label="More"
                        aria-expanded={isMoreOpen}
                        aria-haspopup="menu"
                        aria-current={isMoreActive ? 'page' : undefined}
                        onClick={() => setIsMoreOpen(prev => !prev)}
                        className={`flex flex-col items-center justify-center w-full h-full relative transition-colors ${
                            isMoreActive || isMoreOpen ? 'text-lantern-primary' : 'text-lantern-text-secondary hover:text-lantern-text'
                        }`}
                    >
                        <div className="relative">
                            {isMoreActive ? <EllipsisHorizontalIconSolid className="w-6 h-6" /> : <EllipsisHorizontalIcon className="w-6 h-6" />}
                            {unreadNotificationCount > 0 && (
                                <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                                    {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                                </span>
                            )}
                        </div>
                        <span className={`text-[10px] mt-0.5 font-medium ${isMoreActive ? 'font-semibold' : ''}`}>More</span>
                    </button>

                    {isMoreOpen && (
                        <div className="absolute bottom-full right-0 mb-2 mr-2 w-48 bg-lantern-surface rounded-xl shadow-xl border border-lantern-border overflow-hidden">
                            {moreItems.map(item => {
                                if ('action' in item) {
                                    return (
                                        <button
                                            key={item.label}
                                            onClick={() => { item.action(); setIsMoreOpen(false); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-lantern-text hover:bg-lantern-background-secondary transition-colors"
                                        >
                                            <div className="relative">
                                                <item.icon className="w-5 h-5" />
                                                {'badge' in item && (item as { badge?: number }).badge! > 0 && (
                                                    <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                                                        {(item as { badge?: number }).badge! > 99 ? '99+' : (item as { badge?: number }).badge}
                                                    </span>
                                                )}
                                            </div>
                                            {item.label}
                                        </button>
                                    );
                                }
                                return (
                                    <button
                                        key={item.label}
                                        onClick={() => { onNavigate(item.mode!); setIsMoreOpen(false); }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                                            currentMode === item.mode
                                                ? 'bg-lantern-primary-background text-lantern-primary font-medium'
                                                : 'text-lantern-text hover:bg-lantern-background-secondary'
                                        }`}
                                    >
                                        <item.icon className="w-5 h-5" />
                                        {item.label}
                                    </button>
                                );
                            })}
                            {actionItems.length > 0 && (
                                <>
                                    <div className="border-t border-lantern-border" />
                                    {actionItems.map(item => (
                                        <button
                                            key={item.label}
                                            onClick={() => { item.action(); if (!('isLowData' in item)) setIsMoreOpen(false); }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                                                'isDestructive' in item && item.isDestructive
                                                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                                                    : 'isCompanion' in item
                                                    ? `text-lantern-primary hover:bg-lantern-primary-background font-medium${isCompanionOpen ? ' bg-lantern-primary-background' : ''}`
                                                    : 'isLowData' in item && lowDataMode
                                                    ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                                                    : 'text-lantern-text hover:bg-lantern-background-secondary'
                                            }`}
                                        >
                                            <item.icon className="w-5 h-5" />
                                            {item.label}
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default BottomNav;
