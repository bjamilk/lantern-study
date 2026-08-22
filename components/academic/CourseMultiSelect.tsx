import React, { useId, useMemo, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { Course } from '../../types';
import { courseLabel } from '../../utils/academicSetup';
import { useCourseSearch } from './useCourseSearch';

export interface CourseMultiSelectProps {
  value: Course[];
  onChange: (courses: Course[]) => void;
  institutionId?: string | null;
  label?: React.ReactNode;
  id?: string;
  className?: string;
  max?: number;
  /** Show my active courses ahead of search results (off when editing the enrolment list itself). */
  includeMyCourses?: boolean;
  hint?: React.ReactNode;
}

/**
 * Typeahead multi-select with chips — used by the profile setup step and the
 * Academic settings "My courses" add row. Same "Add ‘CODE’" create path as the
 * single-select picker.
 */
export const CourseMultiSelect: React.FC<CourseMultiSelectProps> = ({
  value,
  onChange,
  institutionId,
  label = 'Courses',
  id,
  className = '',
  max = 40,
  includeMyCourses = false,
  hint,
}) => {
  const autoId = useId();
  const controlId = id || `course-multi-${autoId}`;
  const [focused, setFocused] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const selectedIds = useMemo(() => value.map((c) => c.id), [value]);
  const { query, setQuery, options, offer, searching, creating, error, create } = useCourseSearch({
    institutionId,
    excludeIds: selectedIds,
    includeMyCourses,
    enabled: true,
  });

  const atMax = value.length >= max;
  const showList = focused || query.trim().length > 0;

  const add = (course: Course) => {
    if (atMax || selectedIds.includes(course.id)) return;
    onChange([...value, course]);
    setQuery('');
    setNewTitle('');
  };

  const remove = (courseId: string) => onChange(value.filter((c) => c.id !== courseId));

  const handleCreate = async () => {
    if (!offer) return;
    try {
      add(await create(offer.code, newTitle));
    } catch {
      /* error surfaced by the hook */
    }
  };

  return (
    <div className={className}>
      {label ? (
        <label htmlFor={controlId} className="block text-sm font-medium text-lantern-text mb-1">
          {label}
        </label>
      ) : null}
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 mb-2" aria-label="Selected courses">
          {value.map((course) => (
            <li
              key={course.id}
              className="inline-flex items-center gap-1 max-w-full rounded-full bg-lantern-primary/10 text-lantern-text px-2.5 py-1 text-xs font-medium"
              title={courseLabel(course)}
            >
              <span className="truncate">{course.code}</span>
              <button
                type="button"
                onClick={() => remove(course.id)}
                aria-label={`Remove ${course.code}`}
                className="rounded-full p-0.5 hover:bg-lantern-primary/20"
              >
                <XMarkIcon className="w-3.5 h-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary overflow-hidden">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary pointer-events-none" />
          <input
            id={controlId}
            type="search"
            value={query}
            disabled={atMax}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={atMax ? `Maximum ${max} courses` : 'Search by code or title (e.g. BIO 201)'}
            className="w-full pl-9 pr-3 py-2.5 bg-transparent text-lantern-text text-sm focus:outline-none disabled:opacity-60"
            aria-label="Search courses"
            autoComplete="off"
          />
        </div>
        {showList ? (
          <div className="border-t border-lantern-border">
            <ul role="listbox" aria-label="Course results" className="max-h-48 overflow-y-auto">
              {options.map((course) => (
                <li key={course.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(course)}
                    className="w-full text-left px-3 py-2 text-sm border-b border-lantern-border/40 last:border-b-0 text-lantern-text hover:bg-lantern-background"
                  >
                    <span className="block font-medium">{course.code}</span>
                    {course.title && course.title !== course.code ? (
                      <span className="block text-xs text-lantern-text-secondary truncate">{course.title}</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {offer ? (
                <li className="border-t border-lantern-border bg-lantern-background/60 p-2 space-y-2">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onFocus={() => setFocused(true)}
                    placeholder={`Title for ${offer.code} (optional)`}
                    className="w-full px-2.5 py-1.5 text-xs border border-lantern-border rounded-md bg-lantern-surface text-lantern-text"
                    aria-label={`Title for ${offer.code}`}
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
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
      {hint ? <p className="mt-1 text-xs text-lantern-text-tertiary">{hint}</p> : null}
    </div>
  );
};

export default CourseMultiSelect;
