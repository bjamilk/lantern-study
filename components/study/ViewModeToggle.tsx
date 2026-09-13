import React, { useCallback, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import { Menu, MenuContent, MenuItem } from '../ui';
import { MenuTrigger } from '../ui/Menu';
import {
  MATERIAL_SORTS,
  materialSortLabel,
  readMaterialSort,
  readViewMode,
  writeMaterialSort,
  writeViewMode,
  type MaterialSortId,
  type ViewMode,
  type ViewSurface,
} from './viewMode';

/**
 * The grid/list switch, and the sort beside it.
 *
 * Two icons rather than two words: the control sits on the same line as a
 * section heading, where `Grid`/`List` would compete with it for reading. The
 * icons carry `sr-only` names and `aria-selected`, so a screen reader gets the
 * words a sighted reader gets from the shapes.
 *
 * This is a `tablist` and not two toggle buttons because the two options are
 * exclusive and one is always on — which is what `aria-selected` on a tab says
 * and what `aria-pressed` on a pair of toggles does not. The skin is the pill
 * row `NotesScreen` already uses for its view switch, so the set room does not
 * introduce a third shape for "pick one of these".
 */

const VIEW_OPTIONS: ReadonlyArray<{ id: ViewMode; label: string; icon: 'grid' | 'list' }> = [
  { id: 'grid', label: 'Grid view', icon: 'grid' },
  { id: 'list', label: 'List view', icon: 'list' },
];

export interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Names the control for a screen reader, e.g. `Recent materials`. */
  label: string;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({ value, onChange, label }) => (
  <div
    role="tablist"
    aria-label={`${label} layout`}
    className="inline-flex rounded-full border border-lantern-border bg-lantern-surface p-0.5"
  >
    {VIEW_OPTIONS.map((option) => {
      const selected = value === option.id;
      return (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={selected}
          onClick={() => onChange(option.id)}
          className={`inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full px-3 transition-colors ${
            selected
              ? 'bg-lantern-ink text-lantern-surface'
              : 'text-lantern-text-secondary hover:text-lantern-text'
          }`}
        >
          <AppIcon name={option.icon} size={16} aria-hidden />
          <span className="sr-only">{option.label}</span>
        </button>
      );
    })}
  </div>
);

export interface MaterialSortMenuProps {
  value: MaterialSortId;
  onChange: (sort: MaterialSortId) => void;
  /** Names the control for a screen reader, e.g. `Lectures`. */
  label: string;
}

/**
 * `Date added ⌄`.
 *
 * The trigger names the ACTIVE order rather than the field, because a control
 * that always reads `Date added` cannot tell you whether you are looking at the
 * newest or the oldest — which is the only thing the student wanted to know.
 * The tick column marks the current row, the same shape the study-set sort menu
 * on Home uses.
 */
export const MaterialSortMenu: React.FC<MaterialSortMenuProps> = ({ value, onChange, label }) => (
  <Menu>
    <MenuTrigger
      aria-label={`Sort ${label}. Current: ${materialSortLabel(value)}`}
      className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface px-3 text-caption text-lantern-text"
    >
      <AppIcon name="swap-horizontal" size={16} aria-hidden />
      {materialSortLabel(value)}
      <AppIcon name="chevron-down" size={14} aria-hidden />
    </MenuTrigger>
    <MenuContent align="end">
      {MATERIAL_SORTS.map((option) => (
        <MenuItem
          key={option.id}
          onSelect={() => onChange(option.id)}
          icon={
            <AppIcon
              name="checkmark"
              size={16}
              aria-hidden
              className={value === option.id ? '' : 'opacity-0'}
            />
          }
        >
          {option.label}
        </MenuItem>
      ))}
    </MenuContent>
  </Menu>
);

/* ------------------------------------------------------------- the wiring */

/**
 * The remembered view for one surface.
 *
 * Read in the `useState` initialiser, not an effect: reading it after the first
 * paint would draw the grid and then swap it for the list, which is a flash of
 * the wrong layout on every single load for anyone who chose the non-default.
 */
export function useViewMode(
  surface: ViewSurface,
  fallback: ViewMode
): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => readViewMode(surface, fallback));
  const choose = useCallback(
    (next: ViewMode) => {
      setMode(next);
      writeViewMode(surface, next);
    },
    [surface]
  );
  return [mode, choose];
}

export function useMaterialSort(
  surface: ViewSurface,
  fallback: MaterialSortId
): [MaterialSortId, (sort: MaterialSortId) => void] {
  const [sort, setSort] = useState<MaterialSortId>(() => readMaterialSort(surface, fallback));
  const choose = useCallback(
    (next: MaterialSortId) => {
      setSort(next);
      writeMaterialSort(surface, next);
    },
    [surface]
  );
  return [sort, choose];
}

export default ViewModeToggle;
