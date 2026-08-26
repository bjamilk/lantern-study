import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useAcademicStore } from '../../stores/academicStore';
import { activeUserCourses } from '../../utils/academicSetup';
import { UNFILED_COURSE_ID } from '../../utils/libraryArchive';

/**
 * Marks a subtree whose ancestor already names the active course/topic filter
 * *and* can clear it. Inside one, `CourseChips` and `TopicFilterChip` render
 * nothing.
 *
 * The Library is the only such ancestor: its scope row ("Showing PHARM 212 ·
 * Enzymes", Whole course, Clear) sits directly above the tab panels, and its
 * rail is where the filter is chosen. A second copy of that state inside each
 * panel costs a row of vertical space on both tabs and says nothing the row
 * above does not. Everywhere else — the standalone Notes and Flashcards
 * screens — the chips are the only filter surface and are untouched.
 *
 * This is a context rather than a prop because the two chip callers each render
 * in both places; the ancestor that owns an indicator is the one that knows.
 */
const CourseFilterShownAbove = createContext(false);

export const CourseFilterShownAboveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CourseFilterShownAbove.Provider value={true}>{children}</CourseFilterShownAbove.Provider>
);

/** True when an ancestor already shows — and can clear — the course/topic filter. */
export const useCourseFilterShownAbove = (): boolean => useContext(CourseFilterShownAbove);

interface CourseChipsProps {
  /** Selected course id; null = All; the literal `'null'` = Unfiled. */
  value: string | null;
  onChange: (courseId: string | null) => void;
  className?: string;
  /** Screen-reader label for the chip group. */
  ariaLabel?: string;
  /** Add an "Unfiled" chip (value `'null'`, the API literal for items with no course). */
  showUnfiled?: boolean;
}

/**
 * "All · BIO 201 · CHM 101 …" filter row over a list screen. Renders nothing
 * when the user has no active courses (and nothing is selected) so empty
 * profiles keep the old layout. A selection made elsewhere — the Library rail
 * picking an archived course or Unfiled — still gets a chip so the filter is
 * visible and clearable here.
 */
export const CourseChips: React.FC<CourseChipsProps> = ({
  value,
  onChange,
  className = '',
  ariaLabel = 'Filter by course',
  showUnfiled = false,
}) => {
  const shownAbove = useCourseFilterShownAbove();
  const myCourses = useAcademicStore((s) => s.myCourses);
  const loaded = useAcademicStore((s) => s.loaded);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  const active = useMemo(() => activeUserCourses(myCourses), [myCourses]);

  useEffect(() => {
    if (!loaded) void loadMyCourses();
  }, [loaded, loadMyCourses]);

  const isUnfiled = value === UNFILED_COURSE_ID;
  const selectedInActive = Boolean(value) && active.some((uc) => uc.course.id === value);
  // knownCourses is subscribed so an archived/catalogue course label resolves once it loads.
  void knownCourses;
  const extraSelected = value && !isUnfiled && !selectedInActive ? resolveCourse(value) : null;

  // A selected course that no longer exists anywhere (removed, not merely
  // archived) falls back to All. Archived enrolments and Unfiled stay selected.
  useEffect(() => {
    if (!value || isUnfiled || !loaded || selectedInActive) return;
    if (!resolveCourse(value)) onChange(null);
  }, [value, isUnfiled, loaded, selectedInActive, resolveCourse, onChange, knownCourses]);

  // Rendering nothing, not unmounting: the effect above is the safety net that
  // drops a filter pointing at a deleted course, and it has to keep running.
  if (shownAbove) return null;

  if (active.length === 0 && !isUnfiled && !extraSelected) return null;

  const chipClass = (selected: boolean) =>
    `shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
      selected
        ? 'bg-lantern-primary text-white border-lantern-primary'
        : 'bg-lantern-surface text-lantern-text-secondary border-lantern-border hover:bg-lantern-background-secondary'
    }`;

  return (
    <div className={`-mx-1 px-1 overflow-x-auto scrollbar-none ${className}`} role="group" aria-label={ariaLabel}>
      <div className="flex gap-1.5 pb-1 w-max max-w-none items-center">
        <button type="button" aria-pressed={!value} onClick={() => onChange(null)} className={chipClass(!value)}>
          All
        </button>
        {showUnfiled || isUnfiled ? (
          <button
            type="button"
            aria-pressed={isUnfiled}
            onClick={() => onChange(isUnfiled ? null : UNFILED_COURSE_ID)}
            title="Items not filed under any course"
            className={chipClass(isUnfiled)}
          >
            Unfiled
          </button>
        ) : null}
        {active.map((uc) => (
          <button
            key={uc.course.id}
            type="button"
            aria-pressed={value === uc.course.id}
            onClick={() => onChange(value === uc.course.id ? null : uc.course.id)}
            title={uc.course.title}
            className={chipClass(value === uc.course.id)}
          >
            {uc.course.code}
          </button>
        ))}
        {extraSelected ? (
          <button
            type="button"
            aria-pressed
            onClick={() => onChange(null)}
            title={`${extraSelected.title || extraSelected.code} (past semester) — tap to clear`}
            className={chipClass(true)}
          >
            {extraSelected.code}
            <span className="ml-1 opacity-80">· past</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default CourseChips;
