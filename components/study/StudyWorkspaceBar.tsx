import React from 'react';
import { STUDY_AREA_SECTIONS, type StudyAreaSection } from '@lantern/shared';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export type { StudyAreaSection };

export interface StudyWorkspaceBarProps {
  active: StudyAreaSection;
  onSelect: (section: StudyAreaSection) => void;
  className?: string;
}

const ICONS: Record<StudyAreaSection, AppIconName> = {
  study: 'school',
  library: 'library',
};

/**
 * Study's two peer sections, as underline tabs — the same compact row Campus
 * uses for Discover. Study is the set picker; Library is the archive.
 */
export const StudyWorkspaceBar: React.FC<StudyWorkspaceBarProps> = ({
  active,
  onSelect,
  className = '',
}) => {
  return (
    <div
      role="tablist"
      aria-label="Study sections"
      className={`grid border-b border-lantern-border ${className}`}
      style={{ gridTemplateColumns: `repeat(${STUDY_AREA_SECTIONS.length}, minmax(0, 1fr))` }}
    >
      {STUDY_AREA_SECTIONS.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={tab.label}
            data-tip-id={tab.id === 'library' ? 'nav.library' : undefined}
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

export default StudyWorkspaceBar;
