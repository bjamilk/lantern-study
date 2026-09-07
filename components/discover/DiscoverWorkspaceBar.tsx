import React from 'react';
import { isDiscoverSectionEnabled } from '@lantern/shared/marketplace';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

/**
 * Discover's section tabs (Phase 3 · L, decision D12).
 *
 * D12 resolved: "Explore" in the sidebar becomes DISCOVER. The marketplace
 * used to be one tab inside it; since 2026-09-02 (founder ask, matching the
 * mobile hub) that slot is Rooms — temporary 24-hour study rooms — and the
 * marketplace is reached from its own sidebar entry. 'marketplace' stays in
 * the type because MarketplaceScreen still renders this bar with it active.
 *
 * Underline tabs (not filled pills) keep the chrome to one compact row so the
 * list itself is the screen.
 */
export type DiscoverSection = 'communities' | 'groups' | 'people' | 'rooms' | 'marketplace';

export interface DiscoverWorkspaceBarProps {
  active: DiscoverSection;
  onSelect: (section: DiscoverSection) => void;
  className?: string;
}

const TABS: Array<{
  id: DiscoverSection;
  label: string;
  shortLabel: string;
  icon: AppIconName;
}> = [
  { id: 'communities', label: 'Communities', shortLabel: 'Community', icon: 'people' },
  { id: 'groups', label: 'Groups', shortLabel: 'Groups', icon: 'chatbubbles' },
  { id: 'people', label: 'People', shortLabel: 'People', icon: 'people' },
  { id: 'rooms', label: 'Rooms', shortLabel: 'Room', icon: 'time' },
];

export const DiscoverWorkspaceBar: React.FC<DiscoverWorkspaceBarProps> = ({
  active,
  onSelect,
  className = '',
}) => {
  // Sections are flag-gated (DISCOVER_SECTION_ENABLED); one surviving tab is
  // decoration, not a choice, so the bar disappears entirely.
  const visible = TABS.filter((tab) => isDiscoverSectionEnabled(tab.id));
  if (visible.length < 2) return null;

  return (
  <div
    role="tablist"
    aria-label="Discover sections"
    className={`grid border-b border-lantern-border ${className}`}
    style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
  >
    {visible.map(({ id, label, shortLabel, icon }) => {
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
          <AppIcon name={icon} size={14} className="hidden sm:block" aria-hidden={true} />
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
};

export default DiscoverWorkspaceBar;
