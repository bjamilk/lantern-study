import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { CourseTopic } from '../../types';
import { TOPIC_TITLE_MAX, useTopicSearch } from './useTopicSearch';

export interface TopicPickerProps {
  /** Course the topic must belong to. Without one there is nothing to pick. */
  courseId: string | null | undefined;
  /** Selected topic id (or the CourseTopic when the caller already has it). */
  value: string | CourseTopic | null | undefined;
  /** Fires with the full CourseTopic (or null when cleared). */
  onChange: (topic: CourseTopic | null) => void;
  label?: React.ReactNode;
  /** Hide the label row (caller renders its own). */
  hideLabel?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Tighter trigger for inline rows (note meta, modals). */
  compact?: boolean;
  /** Let the user clear the selection (default true). */
  clearable?: boolean;
  /** Extra hint under the control. */
  hint?: React.ReactNode;
}

/**
 * Single-select topic picker: the course's syllabus outline, with an inline
 * "Add ‘Gas exchange’" create row — the topic-side twin of CoursePicker.
 *
 * Two rules the server also enforces, mirrored here so the user never meets the
 * 400: a topic needs a course (disabled until one is picked), and a topic from
 * the *previous* course is dropped the moment the course changes.
 */
export const TopicPicker: React.FC<TopicPickerProps> = ({
  courseId,
  value,
  onChange,
  label = 'Topic',
  hideLabel = false,
  placeholder = 'No topic — tap to choose',
  id,
  className = '',
  disabled = false,
  compact = false,
  clearable = true,
  hint,
}) => {
  const autoId = useId();
  const controlId = id || `topic-picker-${autoId}`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedId = typeof value === 'string' ? value : value?.id ?? null;
  const effectiveCourseId = courseId || null;
  const noCourse = !effectiveCourseId;

  // Fetch while the list is open, and also whenever there is an id to resolve
  // into a title for the closed trigger.
  const { query, setQuery, topics, options, offer, loading, creating, error, unavailable, create } = useTopicSearch({
    courseId: effectiveCourseId,
    enabled: open || !!selectedId,
  });

  const selected: CourseTopic | null =
    typeof value === 'object' && value ? value : topics.find((topic) => topic.id === selectedId) ?? null;

  // A topic belongs to exactly one course, so one held over from the previous
  // course is a rejected save waiting to happen — drop it as the course changes
  // rather than letting the user watch the server refuse it.
  //
  // Unless the topic changed in the same breath: that is the caller swapping the
  // whole artefact under us (the note editor moving to another note), and the
  // incoming topic belongs to the incoming course. Clearing there would wipe a
  // perfectly good topic off a note the user only opened.
  const lastCourseId = useRef(effectiveCourseId);
  const lastSelectedId = useRef(selectedId);
  useEffect(() => {
    const courseChanged = lastCourseId.current !== effectiveCourseId;
    const topicChanged = lastSelectedId.current !== selectedId;
    lastCourseId.current = effectiveCourseId;
    lastSelectedId.current = selectedId;
    if (!courseChanged) return;
    setOpen(false);
    setQuery('');
    if (selectedId && !topicChanged) onChange(null);
  }, [effectiveCourseId, selectedId, onChange, setQuery]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const pick = (topic: CourseTopic | null) => {
    onChange(topic);
    setQuery('');
    setOpen(false);
  };

  const handleCreate = async () => {
    if (!offer) return;
    try {
      pick(await create(offer.title));
    } catch {
      /* error surfaced by the hook */
    }
  };

  const triggerPad = compact ? 'px-2.5 py-1.5 text-xs' : 'p-3 text-sm';
  const triggerLabel = noCourse ? 'Pick a course first' : selected ? selected.title : selectedId ? 'Topic selected' : placeholder;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {!hideLabel && label ? (
        <label htmlFor={controlId} className="block text-sm font-medium text-lantern-text mb-1">
          {label}
        </label>
      ) : null}
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          id={controlId}
          disabled={disabled || noCourse}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className={`flex-1 min-w-0 flex items-center justify-between gap-2 ${triggerPad} border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-left text-lantern-text disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lantern-primary`}
        >
          <span className={`truncate ${selected ? 'text-lantern-text' : 'text-lantern-text-secondary'}`}>
            {triggerLabel}
          </span>
          <ChevronDownIcon
            className={`w-4 h-4 shrink-0 text-lantern-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {clearable && selectedId && !disabled && !noCourse ? (
          <button
            type="button"
            onClick={() => pick(null)}
            aria-label="Clear topic"
            className={`shrink-0 ${compact ? 'px-2' : 'px-3'} rounded-lg border border-lantern-border text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary`}
          >
            <XMarkIcon className="w-4 h-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-lantern-text-tertiary">{hint}</p> : null}

      {open && !noCourse ? (
        <div
          className="absolute z-30 mt-1 w-full min-w-[16rem] border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary shadow-lg overflow-hidden"
          role="presentation"
        >
          <div className="relative border-b border-lantern-border">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or add a topic"
              maxLength={TOPIC_TITLE_MAX}
              className="w-full pl-9 pr-3 py-2.5 bg-transparent text-lantern-text text-sm focus:outline-none"
              aria-label="Search topics"
              autoFocus
            />
          </div>
          <ul role="listbox" aria-label="Topics" className="max-h-56 overflow-y-auto">
            {options.map((topic) => {
              const isSelected = topic.id === selectedId;
              return (
                <li key={topic.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => pick(topic)}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-lantern-border/40 last:border-b-0 ${
                      isSelected
                        ? 'bg-lantern-primary/10 text-lantern-text font-medium'
                        : 'text-lantern-text hover:bg-lantern-background'
                    }`}
                  >
                    <span className="block truncate">{topic.title}</span>
                  </button>
                </li>
              );
            })}
            {offer ? (
              <li className="border-t border-lantern-border bg-lantern-background/60 p-2">
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md text-lantern-primary hover:bg-lantern-primary/10 disabled:opacity-50"
                >
                  <PlusIcon className="w-4 h-4" aria-hidden />
                  {creating ? 'Adding…' : `Add ‘${offer.title}’`}
                </button>
              </li>
            ) : null}
          </ul>
          <p className="px-3 py-1.5 text-xs text-lantern-text-secondary border-t border-lantern-border">
            {error
              ? error
              : unavailable
                ? 'Topics aren’t set up for this course yet.'
                : loading
                  ? 'Loading topics…'
                  : options.length === 0
                    ? query.trim()
                      ? 'No matching topic — add it to the outline.'
                      : 'No topics yet. Type one to start this course’s outline.'
                    : `${options.length} topic${options.length === 1 ? '' : 's'}`}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default TopicPicker;
