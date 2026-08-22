import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { Course } from '../../types';
import { useAcademicStore } from '../../stores/academicStore';
import { useAuthStore } from '../../stores/authStore';
import { courseLabel } from '../../utils/academicSetup';
import { useCourseSearch } from './useCourseSearch';

export interface CoursePickerProps {
  /** Selected course id (or the Course object when the caller already has it). */
  value: string | Course | null | undefined;
  /** Fires with the full Course (or null when cleared). */
  onChange: (course: Course | null) => void;
  /** Scope catalogue search; defaults to the signed-in user's institution. */
  institutionId?: string | null;
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
 * Single-select course picker: my active courses first, then catalogue search,
 * with an inline "Add ‘BIO 201’" create row. Resolves a bare id to a label via
 * the academic store (enrolments + courses seen this session).
 */
export const CoursePicker: React.FC<CoursePickerProps> = ({
  value,
  onChange,
  institutionId,
  label = 'Course',
  hideLabel = false,
  placeholder = 'No course — tap to choose',
  id,
  className = '',
  disabled = false,
  compact = false,
  clearable = true,
  hint,
}) => {
  const autoId = useId();
  const controlId = id || `course-picker-${autoId}`;
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const userInstitutionId = useAuthStore((s) => s.currentUser?.institutionId ?? null);
  const effectiveInstitutionId = institutionId === undefined ? userInstitutionId : institutionId;
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  const myCourses = useAcademicStore((s) => s.myCourses);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const rememberCourses = useAcademicStore((s) => s.rememberCourses);

  const selectedId = typeof value === 'string' ? value : value?.id ?? null;
  // knownCourses/myCourses are subscribed so the label updates once they load.
  void knownCourses;
  void myCourses;
  const selected: Course | null = typeof value === 'object' && value ? value : resolveCourse(selectedId);

  useEffect(() => {
    if (typeof value === 'object' && value) rememberCourses([value]);
  }, [value, rememberCourses]);

  const { query, setQuery, options, offer, searching, creating, error, create } = useCourseSearch({
    institutionId: effectiveInstitutionId,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const onDocDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const pick = (course: Course | null) => {
    onChange(course);
    setQuery('');
    setNewTitle('');
    setOpen(false);
  };

  const handleCreate = async () => {
    if (!offer) return;
    try {
      const course = await create(offer.code, newTitle);
      pick(course);
    } catch {
      /* error surfaced by the hook */
    }
  };

  const triggerPad = compact ? 'px-2.5 py-1.5 text-xs' : 'p-3 text-sm';

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
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className={`flex-1 min-w-0 flex items-center justify-between gap-2 ${triggerPad} border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-left text-lantern-text disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lantern-primary`}
        >
          <span className={`truncate ${selected ? 'text-lantern-text' : 'text-lantern-text-secondary'}`}>
            {selected ? courseLabel(selected) : selectedId ? 'Course selected' : placeholder}
          </span>
          <ChevronDownIcon
            className={`w-4 h-4 shrink-0 text-lantern-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {clearable && selectedId && !disabled ? (
          <button
            type="button"
            onClick={() => pick(null)}
            aria-label="Clear course"
            className={`shrink-0 ${compact ? 'px-2' : 'px-3'} rounded-lg border border-lantern-border text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary`}
          >
            <XMarkIcon className="w-4 h-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-lantern-text-tertiary">{hint}</p> : null}

      {open ? (
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
              placeholder="Search by code or title (e.g. BIO 201)"
              className="w-full pl-9 pr-3 py-2.5 bg-transparent text-lantern-text text-sm focus:outline-none"
              aria-label="Search courses"
              autoFocus
            />
          </div>
          <ul role="listbox" aria-label="Courses" className="max-h-56 overflow-y-auto">
            {options.map((course) => {
              const isSelected = course.id === selectedId;
              return (
                <li key={course.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => pick(course)}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-lantern-border/40 last:border-b-0 ${
                      isSelected
                        ? 'bg-lantern-primary/10 text-lantern-text font-medium'
                        : 'text-lantern-text hover:bg-lantern-background'
                    }`}
                  >
                    <span className="block font-medium">{course.code}</span>
                    {course.title && course.title !== course.code ? (
                      <span className="block text-xs text-lantern-text-secondary truncate">{course.title}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {offer ? (
              <li className="border-t border-lantern-border bg-lantern-background/60 p-2 space-y-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={`Title for ${offer.code} (optional)`}
                  className="w-full px-2.5 py-1.5 text-xs border border-lantern-border rounded-md bg-lantern-surface text-lantern-text"
                  aria-label={`Title for ${offer.code}`}
                />
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md text-lantern-primary hover:bg-lantern-primary/10 disabled:opacity-50"
                >
                  <PlusIcon className="w-4 h-4" aria-hidden />
                  {creating ? 'Adding…' : `Add ‘${offer.code}’`}
                </button>
              </li>
            ) : null}
          </ul>
          <p className="px-3 py-1.5 text-xs text-lantern-text-secondary border-t border-lantern-border">
            {error
              ? error
              : searching
                ? 'Searching…'
                : options.length === 0
                  ? query.trim()
                    ? 'No matches. Type a course code like "BIO 201" to add it.'
                    : 'Type to search the course catalogue.'
                  : `${options.length} course${options.length === 1 ? '' : 's'}`}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default CoursePicker;
