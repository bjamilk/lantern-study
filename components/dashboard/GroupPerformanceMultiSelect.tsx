import React, { useEffect, useId, useRef, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';

export interface GroupPerformanceOption {
  id: string;
  name: string;
  level: number;
}

interface GroupPerformanceMultiSelectProps {
  options: GroupPerformanceOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function GroupPerformanceMultiSelect({
  options,
  selectedIds,
  onChange,
  disabled = false,
}: GroupPerformanceMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedCount = selectedIds.length;
  const selectedNames = options
    .filter((opt) => selectedIds.includes(opt.id))
    .map((opt) => opt.name);
  const buttonLabel =
    selectedCount === 0
      ? 'Select groups'
      : selectedCount === 1
        ? selectedNames[0]
        : `${selectedCount} groups selected`;

  const allSelected = options.length > 0 && selectedCount === options.length;

  const toggleId = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((value) => value !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-[12rem] max-w-full sm:min-w-[16rem]">
      <button
        type="button"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-body rounded-lantern border border-lantern-border bg-lantern-surface text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate text-left">{buttonLabel}</span>
        <AppIcon name="chevron-down" size={16} className={`flex-shrink-0 text-lantern-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 w-full min-w-[16rem] max-h-72 overflow-y-auto rounded-lantern border border-lantern-border bg-lantern-surface shadow-lantern"
        >
          <div className="sticky top-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface">
            <button
              type="button"
              className="text-caption font-semibold text-lantern-primary-text hover:underline"
              onClick={() => onChange(options.map((opt) => opt.id))}
              disabled={allSelected}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-caption font-semibold text-lantern-text-secondary hover:underline"
              onClick={() => onChange([])}
              disabled={selectedCount === 0}
            >
              Clear
            </button>
          </div>
          <ul className="py-1">
            {options.map((opt) => {
              const checked = selectedIds.includes(opt.id);
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggleId(opt.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-body text-left hover:bg-lantern-background-secondary"
                    style={{ paddingLeft: `${0.75 + opt.level * 0.85}rem` }}
                  >
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        checked
                          ? 'bg-lantern-primary-fill border-lantern-primary text-white'
                          : 'border-lantern-border bg-lantern-surface'
                      }`}
                    >
                      {checked ? <AppIcon name="checkmark" size={12} /> : null}
                    </span>
                    <span className="truncate text-lantern-text">
                      {opt.level > 0 ? (
                        <span className="text-lantern-text-tertiary mr-1">└</span>
                      ) : null}
                      {opt.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default GroupPerformanceMultiSelect;
