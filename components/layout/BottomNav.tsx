import React from 'react';
import { AppMode } from '../../types';
import {
    HomeIcon,
    ChatBubbleLeftRightIcon,
    AcademicCapIcon,
    BuildingLibraryIcon,
    UserCircleIcon,
} from '@heroicons/react/24/outline';
import {
    HomeIcon as HomeIconSolid,
    ChatBubbleLeftRightIcon as ChatBubbleLeftRightIconSolid,
    AcademicCapIcon as AcademicCapIconSolid,
    BuildingLibraryIcon as BuildingLibraryIconSolid,
    UserCircleIcon as UserCircleIconSolid,
} from '@heroicons/react/24/solid';
import {
    DESTINATION_LABELS,
    resolveActiveDestination,
    type DestinationId,
} from './destinations';

interface BottomNavProps {
    currentMode: AppMode;
    /** Pathname — the only way to know Me is open; it has no AppMode. */
    currentPath: string;
    onNavigate: (mode: AppMode) => void;
    onNavigateToMe: () => void;
    onNavigateToCampus: () => void;
    unreadChatCount?: number;
    dueCardsCount?: number;
}

interface NavTab {
    id: DestinationId;
    icon: React.ElementType;
    activeIcon: React.ElementType;
    onSelect: () => void;
    badge?: number;
    badgeSuffix?: string;
    tipId?: string;
}

/**
 * The five destinations, as a phone bar.
 *
 * It used to be three tabs plus a "More" menu, and More held six unrelated
 * things: a marketplace, notifications, Budget, Offline Mode, the AI companion,
 * the theme switch and logout. A menu called More is where navigation goes to
 * hide — nothing in it has a name you can look for. Every one of those items
 * now lives under the destination it belongs to (Campus, Me) or with the two
 * things that follow you, in the sidebar's own group.
 *
 * The labels, the order and the meanings are identical to mobile's bottom tabs.
 */
const BottomNav: React.FC<BottomNavProps> = ({
    currentMode,
    currentPath,
    onNavigate,
    onNavigateToMe,
    onNavigateToCampus,
    unreadChatCount = 0,
    dueCardsCount = 0,
}) => {
    const active = resolveActiveDestination(currentMode, currentPath);

    const tabs: NavTab[] = [
        {
            id: 'home',
            icon: HomeIcon,
            activeIcon: HomeIconSolid,
            onSelect: () => onNavigate(AppMode.DASHBOARD),
        },
        {
            id: 'study',
            icon: AcademicCapIcon,
            activeIcon: AcademicCapIconSolid,
            onSelect: () => onNavigate(AppMode.STUDY_HUB),
            badge: dueCardsCount,
            badgeSuffix: 'due',
            tipId: 'nav.library',
        },
        {
            id: 'chat',
            icon: ChatBubbleLeftRightIcon,
            activeIcon: ChatBubbleLeftRightIconSolid,
            onSelect: () => onNavigate(AppMode.CHAT),
            badge: unreadChatCount,
            badgeSuffix: 'unread',
            tipId: 'nav.chat',
        },
        {
            id: 'campus',
            icon: BuildingLibraryIcon,
            activeIcon: BuildingLibraryIconSolid,
            onSelect: onNavigateToCampus,
            tipId: 'nav.marketplace',
        },
        {
            id: 'me',
            icon: UserCircleIcon,
            activeIcon: UserCircleIconSolid,
            onSelect: onNavigateToMe,
        },
    ];

    return (
        <nav
            aria-label="Primary"
            className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-lantern-surface/95 backdrop-blur-md border-t border-lantern-border shadow-[0_-8px_24px_rgba(15,23,42,0.06)] safe-area-bottom"
        >
            <div className="flex items-stretch justify-around h-16">
                {tabs.map((tab) => {
                    const label = DESTINATION_LABELS[tab.id];
                    const isActive = active === tab.id;
                    const Icon = isActive ? tab.activeIcon : tab.icon;
                    const badgeCount = tab.badge && tab.badge > 0 ? tab.badge : 0;
                    const shown = badgeCount > 99 ? '99+' : String(badgeCount);
                    const accessibleName = badgeCount > 0
                        ? `${label}, ${shown} ${tab.badgeSuffix ?? 'new'}`
                        : label;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            aria-label={accessibleName}
                            aria-current={isActive ? 'page' : undefined}
                            data-tip-id={tab.tipId}
                            onClick={tab.onSelect}
                            className={`flex flex-col items-center justify-center flex-1 min-h-[44px] relative transition-colors ${
                                isActive ? 'text-lantern-primary' : 'text-lantern-text-secondary hover:text-lantern-text'
                            }`}
                        >
                            {/* The lit tab is named as well as coloured, and carries
                                the bar above it — never colour alone. */}
                            {isActive && (
                                <span
                                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-lantern-primary"
                                    aria-hidden="true"
                                />
                            )}
                            <div className="relative">
                                <Icon className="w-6 h-6" aria-hidden="true" />
                                {badgeCount > 0 ? (
                                    <span
                                        aria-hidden="true"
                                        className="absolute -top-1 -right-2 bg-lantern-error text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
                                    >
                                        {shown}
                                    </span>
                                ) : null}
                            </div>
                            <span className={`text-[10px] mt-0.5 font-medium ${isActive ? 'font-semibold' : ''}`}>
                                {label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};

export default BottomNav;
