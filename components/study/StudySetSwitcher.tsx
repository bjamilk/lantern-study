import React, { useEffect, useMemo, useRef, useState } from 'react';
import { studySetLabel } from '@lantern/shared';
import type { StudySet } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { SetTile } from './SetRoomTile';

interface StudySetSwitcherProps {
  sets: readonly StudySet[];
  currentId: string;
  onSelect: (studySetId: string) => void;
  onViewAll: () => void;
  onCreate: () => void;
}

/**
 * "23m ago" / "Yesterday" / "3 Sep" — how recently a set was touched.
 *
 * The switcher's whole job is "which of these was I just in", and an absolute
 * `9/13/2026` on every row answers that with arithmetic. Relative inside a week,
 * a date beyond it, because "47d ago" is not a thing anyone reads.
 */
export function setRelativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'Not opened yet';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Not opened yet';
  const minutes = Math.floor((nowMs - at) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The set switcher, as a popover.
 *
 * WHAT THIS REPLACES. A bare native `<select>` in the room header, listing every
 * set by title with a `New study set…` option wedged on the end. Three things
 * were wrong with it and only one was cosmetic: it is the only unstyled control
 * on the page; it has no search, so a student with thirty sets scrolls a native
 * dropdown; and it carries no recency, so the list gives no clue which set was
 * the one you were just in. StudyFetch's is a pill that opens a searchable list
 * with a per-set relative time — this is that.
 *
 * The list is ordered by last-studied, newest first, which is the order the
 * question "take me back" is actually asked in.
 */
export const StudySetSwitcher: React.FC<StudySetSwitcherProps> = ({
  sets,
  currentId,
  onSelect,
  onViewAll,
  onCreate,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const current = sets.find((set) => set.id === currentId) ?? null;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...sets]
      .sort((a, b) => {
        const at = Date.parse(a.lastStudiedAt || a.updatedAt || '') || 0;
        const bt = Date.parse(b.lastStudiedAt || b.updatedAt || '') || 0;
        return bt - at;
      })
      .filter((set) => !needle || studySetLabel(set).toLowerCase().includes(needle));
  }, [sets, query]);

  useEffect(() => {
    if (!open) return;
    // Opening a search popover and having to click the field is the small
    // friction that makes people keep using the dropdown instead.
    searchRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setQuery('');
          setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Switch study set"
        className="inline-flex min-h-[44px] max-w-[16rem] items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface pl-1.5 pr-3 text-caption text-lantern-text hover:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
      >
        {current ? (
          <SetTile
            setId={current.id}
            title={studySetLabel(current)}
            coverPath={current.coverPath}
            size={28}
          />
        ) : null}
        <span className="truncate">{current ? studySetLabel(current) : 'Study sets'}</span>
        <AppIcon name="swap-horizontal" size={16} className="shrink-0 text-lantern-text-secondary" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Study sets"
          className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-lantern-border bg-lantern-surface p-2"
        >
          <label className="block px-1 pb-2">
            <span className="sr-only">Search study sets</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search study sets"
              className="w-full min-h-[40px] rounded-xl border border-lantern-border bg-lantern-background-secondary px-3 text-caption text-lantern-text placeholder:text-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
            />
          </label>
          <div className="max-h-72 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-caption text-lantern-text-secondary">
                No set matches “{query.trim()}”.
              </p>
            ) : (
              rows.map((set) => {
                const active = set.id === currentId;
                return (
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!active) onSelect(set.id);
                    }}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full min-h-[44px] items-center gap-2 rounded-xl px-2 text-left hover:bg-lantern-background-secondary ${
                      active ? 'bg-lantern-background-secondary' : ''
                    }`}
                  >
                    <SetTile setId={set.id} title={studySetLabel(set)} coverPath={set.coverPath} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption font-semibold text-lantern-text">
                        {studySetLabel(set)}
                      </span>
                      <span className="block text-caption text-lantern-text-secondary">
                        {setRelativeTime(set.lastStudiedAt || set.updatedAt)}
                      </span>
                    </span>
                    {active ? (
                      <AppIcon name="checkmark" size={16} className="shrink-0 text-lantern-text" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-lantern-border pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
              className="min-h-[44px] px-2 text-caption font-medium text-lantern-text hover:underline"
            >
              View all
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-caption font-medium text-lantern-text hover:underline"
            >
              <AppIcon name="add" size={16} />
              Create new
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default StudySetSwitcher;
