/**
 * The grid/list switch, and the sort beside it.
 *
 * Two icons rather than two words: the control sits on the same line as a
 * section caption inside a card, and on a 360dp screen `Grid`/`List` would take
 * a third of that line away from the heading. The icons are hidden from the
 * screen reader and each segment carries the WORD as its accessible name, so a
 * reader gets what a sighted reader gets from the shapes.
 *
 * The skin is `useSegmentSkin` — the same pair of colours the set room's own
 * segment row and the Notes view switch use — so this does not introduce a
 * third shape for "pick one of these". The sort is an `ActionSheet` rather than
 * a second segmented row because it has three options that are words, not
 * shapes, and because Android's native dialog silently drops past three.
 *
 * The hooks at the foot are where the phone differs from the web: AsyncStorage
 * cannot be read in a `useState` initialiser, so the surface's own default is
 * painted first and the remembered value lands a tick later. A student who taps
 * the toggle inside that tick keeps their tap — see `chosen` below.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { ActionSheet } from '../ui/ActionSheet';
import { T, useSegmentSkin } from '../ui';
import { useTheme } from '../../theme';
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

const VIEW_OPTIONS: ReadonlyArray<{ id: ViewMode; label: string; icon: AppIconName }> = [
  { id: 'grid', label: 'Grid view', icon: 'grid' },
  { id: 'list', label: 'List view', icon: 'list' },
];

export interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Names the control for a screen reader, e.g. `Recent materials`. */
  label: string;
}

export function ViewModeToggle({ value, onChange, label }: ViewModeToggleProps) {
  return (
    <View
      className="flex-row rounded-lg border border-lantern-border overflow-hidden"
      accessibilityLabel={`${label} layout`}
    >
      {VIEW_OPTIONS.map((option) => (
        <ViewModeSegment
          key={option.id}
          icon={option.icon}
          label={option.label}
          selected={value === option.id}
          onPress={() => onChange(option.id)}
        />
      ))}
    </View>
  );
}

function ViewModeSegment({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: AppIconName;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const skin = useSegmentSkin(selected);
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: skin.backgroundColor }}
      // 44dp is Material's target and the size every other segment in the app
      // draws; an icon-only control is not an excuse to shrink it.
      className="min-h-[44px] min-w-[44px] items-center justify-center px-3"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <AppIcon name={icon} size={16} color={skin.color} importantForAccessibility="no" />
    </Pressable>
  );
}

export interface MaterialSortButtonProps {
  value: MaterialSortId;
  onChange: (sort: MaterialSortId) => void;
  /** Names the control for a screen reader, e.g. `Lectures`. */
  label: string;
}

/**
 * `Newest first ⌄`.
 *
 * The trigger names the ACTIVE order rather than the field, because a control
 * that always reads `Date added` cannot tell you whether you are looking at the
 * newest or the oldest — which is the only thing the student wanted to know.
 */
export function MaterialSortButton({ value, onChange, label }: MaterialSortButtonProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="min-h-[44px] flex-row items-center gap-1 rounded-lg border border-lantern-border px-3"
        accessibilityRole="button"
        accessibilityLabel={`Sort ${label}. Currently ${materialSortLabel(value)}`}
      >
        <AppIcon
          name="swap-horizontal"
          size={16}
          color={colors.textSecondary}
          importantForAccessibility="no"
        />
        <T.Caption importantForAccessibility="no">{materialSortLabel(value)}</T.Caption>
        <AppIcon
          name="chevron-down"
          size={14}
          color={colors.textSecondary}
          importantForAccessibility="no"
        />
      </Pressable>
      <ActionSheet
        visible={open}
        title={`Sort ${label}`}
        onClose={() => setOpen(false)}
        items={MATERIAL_SORTS.map((option) => ({
          label: option.label,
          // The tick is the only mark of the current order in the sheet, so it
          // is also spoken — an icon alone would leave a reader guessing.
          icon: (value === option.id ? 'checkmark' : 'ellipse') as AppIconName,
          accessibilityLabel:
            value === option.id ? `${option.label}, selected` : option.label,
          onPress: () => {
            setOpen(false);
            onChange(option.id);
          },
        }))}
      />
    </>
  );
}

/* ------------------------------------------------------------- the wiring */

/**
 * The remembered view for one surface.
 *
 * The read is an effect because AsyncStorage is a promise, so the first paint
 * is always the surface's own default. `chosen` guards the only thing that can
 * go wrong with that: a student who taps the toggle before the read resolves
 * would otherwise have their tap undone a tick later by a stale stored value.
 */
export function useViewMode(
  surface: ViewSurface,
  fallback: ViewMode
): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(fallback);
  const chosen = useRef(false);
  useEffect(() => {
    let alive = true;
    void readViewMode(surface, fallback).then((stored) => {
      if (alive && !chosen.current) setMode(stored);
    });
    return () => {
      alive = false;
    };
    // `fallback` is a literal at every call site; re-reading on a surface
    // change is the only case that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);
  const choose = useCallback(
    (next: ViewMode) => {
      chosen.current = true;
      setMode(next);
      void writeViewMode(surface, next);
    },
    [surface]
  );
  return [mode, choose];
}

export function useMaterialSort(
  surface: ViewSurface,
  fallback: MaterialSortId
): [MaterialSortId, (sort: MaterialSortId) => void] {
  const [sort, setSort] = useState<MaterialSortId>(fallback);
  const chosen = useRef(false);
  useEffect(() => {
    let alive = true;
    void readMaterialSort(surface, fallback).then((stored) => {
      if (alive && !chosen.current) setSort(stored);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);
  const choose = useCallback(
    (next: MaterialSortId) => {
      chosen.current = true;
      setSort(next);
      void writeMaterialSort(surface, next);
    },
    [surface]
  );
  return [sort, choose];
}

export default ViewModeToggle;
