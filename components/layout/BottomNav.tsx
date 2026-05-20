import React, { useState, useRef, useEffect } from 'react';
import { AppMode } from '../../types';
import {
    HomeIcon,
    AcademicCapIcon,
    ChatBubbleLeftRightIcon,
    ShoppingBagIcon,
    EllipsisHorizontalIcon,
    BellIcon,
} from '@heroicons/react/24/outline';
import {
    HomeIcon as HomeIconSolid,
    AcademicCapIcon as AcademicCapIconSolid,
    ChatBubbleLeftRightIcon as ChatBubbleLeftRightIconSolid,
    ShoppingBagIcon as ShoppingBagIconSolid,
    EllipsisHorizontalIcon as EllipsisHorizontalIconSolid,
    CreditCardIcon,
    CloudArrowDownIcon,
    Cog6ToothIcon,
    SunIcon,
    MoonIcon,
    ArrowLeftOnRectangleIcon,
    BellAlertIcon,
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
}

interface NavTab {
    label: string;
    modes: AppMode[];
    icon: React.ElementType;
    activeIcon: React.ElementType;
    targetMode: AppMode;
    badge?: number;
}

const BottomNav: React.FC<BottomNavProps> = ({ currentMode, onNavigate, unreadChatCount = 0, dueCardsCount = 0, unreadNotificationCount = 0, onOpenNotifications, onOpenSettings, onToggleTheme, theme, onLogout }) => {
    const [isMoreOpen, setIsMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);

    // Close "More" popover when clicking outside
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

    const tabs: NavTab[] = [
        {
            label: 'Home',
            modes: [AppMode.DASHBOARD],
            icon: HomeIcon,
            activeIcon: HomeIconSolid,
            targetMode: AppMode.DASHBOARD,
        },
        {
            label: 'Study',
            modes: [AppMode.FLASHCARDS, AppMode.DECK_DETAIL, AppMode.FLASHCARD_REVIEW, AppMode.FLASHCARD_CRAM, AppMode.OFFLINE_MODE],
            icon: AcademicCapIcon,
            activeIcon: AcademicCapIconSolid,
            targetMode: AppMode.FLASHCARDS,
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
        {
            label: 'Market',
            modes: [AppMode.MARKETPLACE, AppMode.MARKETPLACE_LISTING_DETAIL, AppMode.MY_LISTINGS, AppMode.MARKETPLACE_INQUIRIES, AppMode.CREATE_MARKETPLACE_LISTING],
            icon: ShoppingBagIcon,
            activeIcon: ShoppingBagIconSolid,
            targetMode: AppMode.MARKETPLACE,
        },
    ];

    const moreModes = [AppMode.BUDGET_TRACKER, AppMode.OFFLINE_MODE];
    const isMoreActive = moreModes.includes(currentMode);

    const isActive = (tab: NavTab) => tab.modes.includes(currentMode);

    // Hide bottom nav during active sessions
    const hiddenModes = [
        AppMode.TEST_ACTIVE, AppMode.STUDY_ACTIVE, AppMode.GAME_ACTIVE,
        AppMode.GAME_RESULTS, AppMode.TEST_REVIEW,
    ];
    if (hiddenModes.includes(currentMode)) return null;

    const moreItems = [
        ...(onOpenNotifications ? [{ label: 'Notifications', icon: BellAlertIcon, action: onOpenNotifications, badge: unreadNotificationCount }] : []),
        { label: 'Budget Tracker', icon: CreditCardIcon, mode: AppMode.BUDGET_TRACKER },
        { label: 'Offline Mode', icon: CloudArrowDownIcon, mode: AppMode.OFFLINE_MODE },
    ];

    const actionItems = [
        ...(onOpenSettings ? [{ label: 'Settings', icon: Cog6ToothIcon, action: onOpenSettings }] : []),
        ...(onToggleTheme ? [{ label: theme === 'light' ? 'Dark Mode' : 'Light Mode', icon: theme === 'light' ? MoonIcon : SunIcon, action: onToggleTheme }] : []),
        ...(onLogout ? [{ label: 'Logout', icon: ArrowLeftOnRectangleIcon, action: onLogout, isDestructive: true }] : []),
    ];

    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 safe-area-bottom">
            <div className="flex items-center justify-around h-16">
                {tabs.map((tab) => {
                    const active = isActive(tab);
                    const Icon = active ? tab.activeIcon : tab.icon;
                    return (
                        <button
                            key={tab.label}
                            onClick={() => { onNavigate(tab.targetMode); setIsMoreOpen(false); }}
                            className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors ${
                                active
                                    ? 'text-indigo-600 dark:text-indigo-400'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
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
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-b" />
                            )}
                        </button>
                    );
                })}

                {/* "More" tab with popover */}
                <div ref={moreRef} className="relative flex-1 h-full">
                    <button
                        onClick={() => setIsMoreOpen(prev => !prev)}
                        className={`flex flex-col items-center justify-center w-full h-full relative transition-colors ${
                            isMoreActive || isMoreOpen
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
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
                        <span className={`text-[10px] mt-0.5 font-medium ${isMoreActive ? 'font-semibold' : ''}`}>
                            More
                        </span>
                        {isMoreActive && (
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-b" />
                        )}
                    </button>

                    {/* Popover */}
                    {isMoreOpen && (
                        <div className="absolute bottom-full right-0 mb-2 mr-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                            {moreItems.map(item => {
                                if ('action' in item) {
                                    return (
                                        <button
                                            key={item.label}
                                            onClick={() => { item.action(); setIsMoreOpen(false); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                                        >
                                            <div className="relative">
                                                <item.icon className="w-5 h-5" />
                                                {'badge' in item && (item as any).badge > 0 && (
                                                    <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                                                        {(item as any).badge > 99 ? '99+' : (item as any).badge}
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
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium'
                                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                    }`}
                                >
                                    <item.icon className="w-5 h-5" />
                                    {item.label}
                                </button>
                                );
                            })}
                            {actionItems.length > 0 && (
                                <>
                                    <div className="border-t border-slate-200 dark:border-slate-700" />
                                    {actionItems.map(item => (
                                        <button
                                            key={item.label}
                                            onClick={() => { item.action(); setIsMoreOpen(false); }}
                                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                                                'isDestructive' in item && item.isDestructive
                                                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                                                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
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
