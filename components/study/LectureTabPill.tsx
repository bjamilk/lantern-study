import React, { useRef } from 'react';
import type { LectureTabPillId, LectureTabPillItem } from '@lantern/shared';

/**
 * The lecture's floating tab pill: My Notes · Enhanced Notes · Material ·
 * Audio Files · 🎙 Record.
 *
 * It floats at the BOTTOM of the editor column rather than sitting above the
 * pane, which is the single change that makes this screen read as a document
 * with tools under it instead of a dashboard with a document in it. The editor
 * scrolls behind it, so the pane keeps its whole height and the row is always
 * one press away wherever the student has scrolled to.
 *
 * ACCESSIBILITY, which the reference has none of: this is a real `tablist` with
 * roving focus (← → Home End), every tab is 44px tall inside the 40px visual
 * pill (the box is taller than the paint, exactly as `SetRoomFocusBar` does it),
 * a disabled tab carries its reason as a `title` rather than silently doing
 * nothing, and the labels come from `lectureTabPillLabels` so the Record tab and
 * the Enhanced tab cannot disagree with the drawer about what is happening.
 */

export interface LectureTabPillProps {
  items: LectureTabPillItem[];
  value: LectureTabPillId;
  onChange: (id: LectureTabPillId) => void;
  /** The `aria-controls` target of the four panel tabs. */
  panelId?: string;
}

export const LectureTabPill: React.FC<LectureTabPillProps> = ({
  items,
  value,
  onChange,
  panelId,
}) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const count = items.length;
    for (let step = 1; step <= count; step += 1) {
      const next = (from + delta * step + count * count) % count;
      const row = items[next];
      if (!row || row.disabled) continue;
      refs.current[next]?.focus();
      onChange(row.id);
      return;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(index, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(index, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(-1, 1);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(items.length, -1);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Lecture"
      aria-orientation="horizontal"
      className="pointer-events-auto inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-lantern-border bg-lantern-surface px-1 shadow-lantern-md"
    >
      {items.map((row, index) => {
        const selected = row.id === value;
        return (
          <button
            key={row.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`lecture-tab-${row.id}`}
            aria-selected={selected}
            aria-controls={row.id === 'record' ? undefined : panelId}
            aria-disabled={row.disabled || undefined}
            disabled={row.disabled}
            tabIndex={selected ? 0 : -1}
            title={row.hint}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onChange(row.id)}
            className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full px-3 text-body font-medium transition-colors disabled:opacity-50 ${
              row.emphasis === 'ink'
                ? 'bg-lantern-primary-fill text-white hover:bg-lantern-primary-light'
                : selected
                  ? 'border border-lantern-ink bg-lantern-surface text-lantern-text'
                  : 'text-lantern-text-secondary hover:text-lantern-text'
            }`}
          >
            {row.label}
          </button>
        );
      })}
    </div>
  );
};

export default LectureTabPill;
