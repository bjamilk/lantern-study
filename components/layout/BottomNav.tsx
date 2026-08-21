import React, { useState } from 'react';
import { AppMode } from '../../types';
import { useLowDataModeToggle } from '../../hooks/useLowDataModeToggle';
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from '../ui';
import {
    HomeIcon,
    ChatBubbleLeftRightIcon,
    EllipsisHorizontalIcon,
    BellIcon,
    SparklesIcon,
    BookOpenIcon,
} from '@heroicons/react/24/outline';
import {
    HomeIcon as HomeIconSolid,
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
    onOpenWallet?: () => void;
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
    tipId?: string;
}

const BottomNav: React.FC<BottomNavProps> = ({ currentMode, onNavigate, unreadChatCount = 0, dueCardsCount = 0, unreadNotificationCount = 0, onOpenNotifications, onOpenWallet, onOpenSettings, onToggleTheme, theme, onLogout, onToggleCompanion, isCompanionOpen, isOnline = true, pendingSyncCount = 0, lowDataMode: lowDataProp }) => {
    const { lowDataMode: lowDataToggle, toggleLowDataMode } = useLowDataModeToggle();
    const lowDataMode = lowDataProp ?? lowDataToggle;
    const [isMoreOpen, setIsMoreOpen] = useState(false);

    const libraryModes = [
        AppMode.LIBRARY, AppMode.NOTES, AppMode.NOTE_EDITOR, AppMode.FLASHCARDS,
        AppMode.DECK_DETAIL,
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
            badge: dueCardsCount > 0 ? dueCardsCount : undefined,
            tipId: 'nav.library',
        },
        {
            label: 'Chat',
            modes: [AppMode.CHAT, AppMode.CREATE_GROUP],
            icon: ChatBubbleLeftRightIcon,
            activeIcon: ChatBubbleLeftRightIconSolid,
            targetMode: AppMode.CHAT,
            badge: unreadChatCount,
            tipId: 'nav.chat',
        },
    ];

    const moreModes = [
        AppMode.MARKETPLACE, AppMode.MARKETPLACE_LISTING_DETAIL, AppMode.MY_LISTINGS,
        AppMode.MARKETPLACE_INQUIRIES, AppMode.CREATE_MARKETPLACE_LISTING,
        AppMode.MARKETPLACE_FAVORITES,
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
        { label: 'Explore', icon: ShoppingBagIcon, mode: AppMode.MARKETPLACE, tipId: 'nav.marketplace' },
        ...(onToggleCompanion ? [{ label: isCompanionOpen ? 'Close Lantern AI' : 'Lantern AI', icon: SparklesIcon, action: onToggleCompanion, isCompanion: true, tipId: 'nav.companion' }] : []),
        ...(onOpenNotifications ? [{ label: 'Notifications', icon: BellAlertIcon, action: onOpenNotifications, badge: unreadNotificationCount }] : []),
        { label: 'Budget', icon: CreditCardIcon, mode: AppMode.BUDGET_TRACKER, tipId: 'nav.budget' },
        ...(onOpenWallet ? [{ label: 'Study wallet', icon: SparklesIcon, action: onOpenWallet }] : []),
        { label: 'Offline Mode', icon: CloudArrowDownIcon, mode: AppMode.OFFLINE_MODE, tipId: 'nav.offline' },
    ];

    const actionItems = [
        ...(onOpenSettings ? [{ label: 'Settings', icon: Cog6ToothIcon, action: onOpenSettings }] : []),
        ...(onToggleTheme ? [{ label: theme === 'light' ? 'Dark Mode' : 'Light Mode', icon: theme === 'light' ? MoonIcon : SunIcon, action: onToggleTheme }] : []),
        { label: lowDataMode ? 'Low-Data Mode: ON' : 'Low-Data Mode: OFF', icon: lowDataMode ? SignalSlashIcon : SignalIcon, action: toggleLowDataMode, isLowData: true },
        ...(onLogout ? [{ label: 'Logout', icon: ArrowLeftOnRectangleIcon, action: onLogout, isDestructive: true }] : []),
    ];

    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-lantern-surface/95 backdrop-blur-md border-t border-lantern-border shadow-[0_-8px_24px_rgba(15,23,42,0.06)] safe-area-bottom">
            <div className="flex items-center justify-around h-16">
                {tabs.map((tab) => {
                    const active = isActive(tab);
                    const Icon = active ? tab.activeIcon : tab.icon;
                    const badgeCount = tab.badge && tab.badge > 0 ? tab.badge : 0;
                    const badgeSuffix =
                        tab.label === 'Library'
                            ? 'due'
                            : tab.label === 'Chat'
                              ? 'unread'
                              : 'new';
                    const accessibleName = badgeCount > 0
                        ? `${tab.label}, ${badgeCount > 99 ? '99+' : badgeCount} ${badgeSuffix}`
                        : tab.label;
                    return (
                        <button
                            key={tab.label}
                            type="button"
                            aria-label={accessibleName}
                            aria-current={active ? 'page' : undefined}
                            data-tip-id={tab.tipId}
                            onClick={() => { onNavigate(tab.targetMode); setIsMoreOpen(false); }}
                            className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors ${
                                active ? 'text-lantern-primary' : 'text-lantern-text-secondary hover:text-lantern-text'
                            }`}
                        >
                            {active && (
                                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-lantern-primary" aria-hidden="true" />
                            )}
                            <div className="relative">
                                <Icon className="w-6 h-6" aria-hidden="true" />
                                {badgeCount > 0 ? (
                                    <span aria-hidden="true" className="absolute -top-1 -right-2 bg-lantern-error text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                                        {badgeCount > 99 ? '99+' : badgeCount}
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

                <Menu open={isMoreOpen} onOpenChange={setIsMoreOpen}>
                <div className="relative flex-1 h-full">
                    <MenuTrigger
                        aria-label={
                            unreadNotificationCount > 0
                                ? `More, ${unreadNotificationCount > 99 ? '99+' : unreadNotificationCount} unread notifications`
                                : 'More'
                        }
                        data-tip-id="nav.companion"
                        className={`flex flex-col items-center justify-center w-full h-full relative transition-colors ${
                            isMoreActive || isMoreOpen ? 'text-lantern-primary' : 'text-lantern-text-secondary hover:text-lantern-text'
                        }`}
                    >
                        <div className="relative">
                            {isMoreActive ? <EllipsisHorizontalIconSolid className="w-6 h-6" aria-hidden="true" /> : <EllipsisHorizontalIcon className="w-6 h-6" aria-hidden="true" />}
                            {unreadNotificationCount > 0 && (
                                <span aria-hidden="true" className="absolute -top-1 -right-2 bg-lantern-error text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                                    {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                                </span>
                            )}
                        </div>
                        <span className={`text-[10px] mt-0.5 font-medium ${isMoreActive ? 'font-semibold' : ''}`}>More</span>
                    </MenuTrigger>

                    <MenuContent placement="top" align="end" className="w-48 mb-2 mr-2 !rounded-xl overflow-hidden">
                            {moreItems.map(item => {
                                if ('action' in item) {
                                    return (
                                        <MenuItem
                                            key={item.label}
                                            onSelect={() => item.action()}
                                            data-tip-id={'tipId' in item ? (item as { tipId?: string }).tipId : undefined}
                                            aria-label={
                                                'badge' in item && (item as { badge?: number }).badge! > 0
                                                    ? `${item.label}, ${(item as { badge?: number }).badge! > 99 ? '99+' : (item as { badge?: number }).badge} unread`
                                                    : item.label
                                            }
                                            icon={
                                                <div className="relative" aria-hidden="true">
                                                    <item.icon className="w-5 h-5" />
                                                    {'badge' in item && (item as { badge?: number }).badge! > 0 && (
                                                        <span className="absolute -top-1.5 -right-2 bg-lantern-error text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                                                            {(item as { badge?: number }).badge! > 99 ? '99+' : (item as { badge?: number }).badge}
                                                        </span>
                                                    )}
                                                </div>
                                            }
                                            className={'isCompanion' in item && isCompanionOpen ? 'text-lantern-primary bg-lantern-primary-background font-medium' : ''}
                                        >
                                            {item.label}
                                        </MenuItem>
                                    );
                                }
                                return (
                                    <MenuItem
                                        key={item.label}
                                        onSelect={() => onNavigate(item.mode!)}
                                        data-tip-id={'tipId' in item ? item.tipId : undefined}
                                        icon={<item.icon className="w-5 h-5" />}
                                        className={currentMode === item.mode ? 'bg-lantern-primary-background text-lantern-primary font-medium' : ''}
                                    >
                                        {item.label}
                                    </MenuItem>
                                );
                            })}
                            {actionItems.length > 0 && (
                                <>
                                    <MenuSeparator />
                                    {actionItems.map(item => (
                                        <MenuItem
                                            key={item.label}
                                            onSelect={() => item.action()}
                                            icon={<item.icon className="w-5 h-5" />}
                                            destructive={'isDestructive' in item && item.isDestructive}
                                            className={
                                                'isLowData' in item && lowDataMode
                                                    ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                                                    : ''
                                            }
                                        >
                                            {item.label}
                                        </MenuItem>
                                    ))}
                                </>
                            )}
                    </MenuContent>
                </div>
                </Menu>
            </div>
        </nav>
    );
};

export default BottomNav;
