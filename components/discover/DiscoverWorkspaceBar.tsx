import React from 'react';
import {
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  UsersIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';

/**
 * Discover's section tabs (Phase 3 · L, decision D12).
 *
 * D12 resolved: "Explore" in the sidebar becomes DISCOVER, with the marketplace
 * as one tab inside it rather than a sibling destination. This bar is rendered
 * by both DiscoverScreen and MarketplaceScreen so the marketplace visibly sits
 * INSIDE Discover instead of merely linking back to it.
 *
 * Underline tabs (not filled pills) keep the chrome to one compact row so the
 * list itself is the screen.
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
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'communities', label: 'Communities', shortLabel: 'Campus', icon: UserGroupIcon },
  { id: 'groups', label: 'Groups', shortLabel: 'Groups', icon: ChatBubbleLeftRightIcon },
  { id: 'people', label: 'People', shortLabel: 'People', icon: UsersIcon },
  { id: 'marketplace', label: 'Marketplace', shortLabel: 'Market', icon: ShoppingBagIcon },
];

export const DiscoverWorkspaceBar: React.FC<DiscoverWorkspaceBarProps> = ({
  active,
  onSelect,
  className = '',
}) => (
  <div
    role="tablist"
    aria-label="Discover sections"
    className={`grid grid-cols-4 border-b border-lantern-border ${className}`}
  >
    {TABS.map(({ id, label, shortLabel, icon: Icon }) => {
      const selected = active === id;
      return (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={selected}
          aria-label={label}
          onClick={() => onSelect(id)}
          className={`relative flex min-h-[40px] items-center justify-center gap-1 px-1 py-2 text-[12px] font-medium transition-colors touch-manipulation sm:min-h-[36px] sm:text-[13px] ${
            selected
              ? 'text-lantern-primary'
              : 'text-lantern-text-secondary hover:text-lantern-text'
          }`}
        >
          <Icon className="hidden h-3.5 w-3.5 sm:block" aria-hidden="true" />
          <span className="truncate sm:hidden">{shortLabel}</span>
          <span className="hidden truncate sm:inline">{label}</span>
          {selected ? (
            <span
              className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-lantern-primary"
              aria-hidden="true"
            />
          ) : null}
        </button>
      );
    })}
  </div>
);

export default DiscoverWorkspaceBar;
