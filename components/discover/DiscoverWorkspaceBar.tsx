import React from 'react';
import {
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  UsersIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';

/**
 * Discover's tab bar (Phase 3 · L, decision D12).
 *
 * D12 resolved: "Explore" in the sidebar becomes DISCOVER, with the marketplace
 * as one tab inside it rather than a sibling destination. This bar is rendered
 * by both DiscoverScreen and MarketplaceScreen so the marketplace visibly sits
 * INSIDE Discover instead of merely linking back to it.
 *
 * Every chip carries a real accessible name — the Phase 2 production E2E found
 * the marketplace workspace chips exposing none.
 */
export type DiscoverSection = 'communities' | 'groups' | 'people' | 'marketplace';

export interface DiscoverWorkspaceBarProps {
  active: DiscoverSection;
  onSelect: (section: DiscoverSection) => void;
  className?: string;
}

const TABS: Array<{
  id: DiscoverSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'communities', label: 'Communities', icon: UserGroupIcon },
  { id: 'groups', label: 'Groups', icon: ChatBubbleLeftRightIcon },
  { id: 'people', label: 'People', icon: UsersIcon },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBagIcon },
];

const chip = (active: boolean) =>
  `inline-flex items-center gap-1.5 shrink-0 h-9 min-h-[44px] sm:h-8 sm:min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors touch-manipulation ${
    active
      ? 'bg-lantern-primary text-white shadow-sm'
      : 'bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border/50 hover:text-lantern-text'
  }`;

export const DiscoverWorkspaceBar: React.FC<DiscoverWorkspaceBarProps> = ({
  active,
  onSelect,
  className = '',
}) => (
  <nav
    aria-label="Discover sections"
    className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar ${className}`}
  >
    {TABS.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        type="button"
        onClick={() => onSelect(id)}
        className={chip(active === id)}
        aria-current={active === id ? 'page' : undefined}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
        <span>{label}</span>
      </button>
    ))}
  </nav>
);

export default DiscoverWorkspaceBar;
