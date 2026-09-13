import React from 'react';
import { ME_AREA_SECTIONS, type MeAreaSection } from '@lantern/shared';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export type { MeAreaSection };

export interface MeWorkspaceBarProps {
  active: MeAreaSection;
  onSelect: (section: MeAreaSection) => void;
  className?: string;
}

const ICONS: Record<MeAreaSection, AppIconName> = {
  profile: 'person',
  progress: 'trophy',
};

/**
 * Profile's two peer sections, as underline tabs — the same compact row Study
 * uses for Study | Library.
 */
export const MeWorkspaceBar: React.FC<MeWorkspaceBarProps> = ({
  active,
  onSelect,
  className = '',
}) => {
  return (
    <div
      role="tablist"
      aria-label="Profile sections"
      className={`grid border-b border-lantern-border ${className}`}
      style={{ gridTemplateColumns: `repeat(${ME_AREA_SECTIONS.length}, minmax(0, 1fr))` }}
    >
      {ME_AREA_SECTIONS.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={tab.label}
            onClick={() => onSelect(tab.id)}
            className={`relative flex min-h-[44px] items-center justify-center gap-1 px-1 py-2 text-caption font-medium transition-colors touch-manipulation ${
              selected
                ? 'text-lantern-primary'
                : 'text-lantern-text-secondary hover:text-lantern-text'
            }`}
          >
            <AppIcon name={ICONS[tab.id]} size={14} className="hidden sm:block" aria-hidden={true} />
            <span className="truncate">{tab.shortLabel}</span>
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

export default MeWorkspaceBar;
