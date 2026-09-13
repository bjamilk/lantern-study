import React from 'react';
import { AppMode } from '../../types';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import {
    DESTINATION_LABELS,
    resolveActiveDestination,
    type DestinationId,
} from './destinations';

interface BottomNavProps {
    currentMode: AppMode;
    /** Pathname — the only way to know Profile is open; it has no AppMode. */
    currentPath: string;
    onNavigate: (mode: AppMode) => void;
    onNavigateToMe: () => void;
    onNavigateToCampus: () => void;
    unreadChatCount?: number;
    dueCardsCount?: number;
}

interface NavTab {
    id: DestinationId;
    icon: AppIconName;
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
 * now lives under the destination it belongs to (Campus, Profile) or with the two
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
            icon: 'home',
            onSelect: () => onNavigate(AppMode.DASHBOARD),
        },
        {
            id: 'study',
            icon: 'school',
            onSelect: () => onNavigate(AppMode.STUDY_HUB),
            badge: dueCardsCount,
            badgeSuffix: 'due',
            tipId: 'nav.library',
        },
        {
            id: 'chat',
            icon: 'chatbubbles',
            onSelect: () => onNavigate(AppMode.CHAT),
            badge: unreadChatCount,
            badgeSuffix: 'unread',
            tipId: 'nav.chat',
        },
        {
            id: 'campus',
            icon: 'business',
            onSelect: onNavigateToCampus,
            tipId: 'nav.marketplace',
        },
        {
            id: 'me',
            icon: 'person',
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
                                isActive ? '' : 'text-lantern-text-secondary hover:text-lantern-text'
                            }`}
                        >
                            {/* 2026-09-11: the lit tab is an INK pill with the
                                glyph and label reversed out of it — the phone
                                echo of the rail's grey pill and of the primary
                                button, so "selected" is one shape across the
                                product instead of three.

                                Still one outline glyph in every state (a solid
                                swap made the lit tab a different shape), still
                                labelled, still bolded, still `aria-current`: the
                                pill is the fourth signal, never the only one.

                                The pill wraps the glyph AND the label, so the
                                colour that reverses out of it is `--color-
                                surface`, which inverts with `--color-ink`. */}
                            <div
                                className={`relative flex flex-col items-center justify-center rounded-full px-3 py-1 ${
                                    isActive ? 'bg-lantern-ink text-lantern-surface' : ''
                                }`}
                            >
                                <AppIcon name={tab.icon} size={22} />
                                {badgeCount > 0 ? (
                                    <span
                                        aria-hidden="true"
                                        className="absolute -top-1 -right-2 bg-lantern-error-strong text-white text-label tracking-normal font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
                                    >
                                        {shown}
                                    </span>
                                ) : null}
                                <span
                                    className={`text-label tracking-normal mt-0.5 font-medium ${
                                        isActive ? 'font-semibold' : ''
                                    }`}
                                >
                                    {label}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};

export default BottomNav;
