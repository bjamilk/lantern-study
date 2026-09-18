import React from 'react';
import type { StudySetUnit } from '@lantern/shared';
import { ChipRowScroller } from './ChipRowScroller';

interface UnitChipRowProps {
  units: readonly StudySetUnit[];
  activeUnitId: string | null | undefined;
  onSelect: (unitId: string) => void;
}

/**
 * Where in the syllabus the student is standing, as the measured 180×46 cards.
 *
 * WHY THIS IS A CARD AND NOT A PILL. Lantern drew these as 144×40 outlined
 * pills, which is the same object as a filter chip — and a student reads a row
 * of filter chips as "narrow this list", not as "these are the units of your
 * course, and you are in the second one". StudyFetch draws them as small white
 * cards with a hairline and a soft shadow, two lines' worth of height, with
 * the number set apart from the name (measured 2026-09-17: 180×46, 12px gap,
 * r16, index 14/600 over the name). The number is the whole point: it is the
 * only thing on the page that says a set has an ORDER.
 *
 * Overflow is `ChipRowScroller`, which already draws the reference's
 * "show more units" chevrons at both ends and hides the native scrollbar.
 *
 * `aria-pressed` rather than `aria-current`: this is a toggle over a set of
 * mutually exclusive choices that changes what the panel below shows, which is
 * a pressed state, not a navigation position.
 */
export const UnitChipRow: React.FC<UnitChipRowProps> = ({ units, activeUnitId, onSelect }) => {
  if (units.length === 0) return null;

  return (
    <ChipRowScroller aria-label="Study plan units" className="mb-3">
      {units.map((unit, index) => {
        const active = unit.id === activeUnitId;
        return (
          <button
            key={unit.id}
            type="button"
            onClick={() => onSelect(unit.id)}
            aria-pressed={active}
            title={unit.title}
            // 180×46 with the hairline and the soft shadow, as measured. The
            // active card is marked with the ink border rather than a fill, so
            // the row stays one material and the selection is a weight change.
            className={`flex h-[46px] w-[180px] shrink-0 items-center gap-2 rounded-2xl border bg-lantern-surface px-3 text-left shadow-lantern transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40 ${
              active
                ? 'border-lantern-text text-lantern-text'
                : 'border-lantern-border text-lantern-text-secondary hover:border-lantern-text-tertiary'
            }`}
          >
            <span
              className={`shrink-0 tabular-nums text-body font-semibold ${
                active ? 'text-lantern-text' : 'text-lantern-text-tertiary'
              }`}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0 flex-1 truncate text-body font-medium">{unit.title}</span>
          </button>
        );
      })}
    </ChipRowScroller>
  );
};

export default UnitChipRow;
