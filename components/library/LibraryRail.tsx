import React, { useEffect, useMemo, useState } from 'react';
import {
  AcademicCapIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentCheckIcon,
  CloudArrowDownIcon,
  DocumentTextIcon,
  InboxIcon,
  RectangleStackIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import type { LibraryCourseCounts, LibraryCourseNode } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useAcademicStore } from '../../stores/academicStore';
import { UNFILED_COURSE_ID, buildLibraryTree, countsTotal } from '../../utils/libraryArchive';
import type { LibraryTab } from '../LibraryScreen';

export interface LibraryRailProps {
  /** Current course filter: uuid | 'null' (unfiled) | null (all). */
  selectedCourseId: string | null;
  onSelectCourse: (courseId: string | null) => void;
  /** Switch the Library tabs (Notes / Flashcards) — used by the per-course count badges. */
  onOpenTab: (tab: LibraryTab) => void;
  /** Opens recent tests; the web has no per-course test history yet, so this is unfiltered. */
  onOpenTests: () => void;
  /** Opens Offline Mode, which follows the Library course filter. */
  onOpenOffline: () => void;
  /** Tighter rows for the small-screen top panel. */
  compact?: boolean;
  className?: string;
}

type CountKey = keyof Pick<LibraryCourseCounts, 'notes' | 'decks' | 'tests' | 'bundles'>;

const COUNT_META: Array<{ key: CountKey; label: string; icon: React.ElementType }> = [
  { key: 'notes', label: 'Notes', icon: DocumentTextIcon },
  { key: 'decks', label: 'Flashcard decks', icon: RectangleStackIcon },
  { key: 'tests', label: 'Tests', icon: ClipboardDocumentCheckIcon },
  { key: 'bundles', label: 'Offline bundles', icon: CloudArrowDownIcon },
];

/**
 * The Library's archive spine (Phase 1 · B): "This semester" (active courses
 * with note/deck/test/bundle counts), "Past semesters" (archived enrolments,
 * collapsed) and "Unfiled". Selecting a row filters the Notes / Flashcards
 * tabs; the count badges jump straight to that artefact type.
 */
export const LibraryRail: React.FC<LibraryRailProps> = ({
  selectedCourseId,
  onSelectCourse,
  onOpenTab,
  onOpenTests,
  onOpenOffline,
  compact = false,
  className = '',
}) => {
  const overview = useLibraryStore((s) => s.overview);
  const loading = useLibraryStore((s) => s.overviewLoading);
  const error = useLibraryStore((s) => s.overviewError);
  const stale = useLibraryStore((s) => s.overviewStale);
  const loadOverview = useLibraryStore((s) => s.loadOverview);
  const rememberCourses = useAcademicStore((s) => s.rememberCourses);
  const [pastOpen, setPastOpen] = useState(false);

  // Fresh counts every time the Library opens; cached data paints immediately.
  useEffect(() => {
    void loadOverview({ force: true });
  }, [loadOverview]);
  useEffect(() => {
    if (stale) void loadOverview({ force: true });
  }, [stale, loadOverview]);

  const tree = useMemo(() => buildLibraryTree(overview), [overview]);

  // Let the chips / pickers label archived courses that are not active enrolments.
  useEffect(() => {
    const courses = [...tree.current, ...tree.past.flatMap((y) => y.courses)].map((n) => n.course);
    if (courses.length) rememberCourses(courses);
  }, [tree, rememberCourses]);

  // Auto-expand Past semesters when the selection lives there.
  useEffect(() => {
    if (selectedCourseId && tree.past.some((y) => y.courses.some((n) => n.course.id === selectedCourseId))) {
      setPastOpen(true);
    }
  }, [selectedCourseId, tree]);

  const openCount = (courseId: string | null, key: CountKey) => {
    onSelectCourse(courseId);
    if (key === 'notes') onOpenTab('notes');
    else if (key === 'decks') onOpenTab('flashcards');
    else if (key === 'tests') onOpenTests();
    else onOpenOffline();
  };

  const rowPad = compact ? 'px-2 py-1.5' : 'px-2.5 py-2';

  const renderCounts = (
    counts: Pick<LibraryCourseCounts, 'notes' | 'decks' | 'tests' | 'bundles'> & { purchasedPacks?: number },
    courseId: string | null,
    selected: boolean
  ) => (
    <div className="mt-1 flex flex-wrap items-center gap-1" aria-label="Item counts">
      {COUNT_META.map(({ key, label, icon: Icon }) => {
        const n = counts[key] || 0;
        const title =
          key === 'tests'
            ? `${n} ${label.toLowerCase()} — opens recent tests (all courses; a per-course test filter is not available yet)`
            : key === 'bundles' && counts.purchasedPacks
              ? `${n} ${label.toLowerCase()} (${counts.purchasedPacks} purchased) — opens Offline Mode for this course`
              : `${n} ${label.toLowerCase()}`;
        return (
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openCount(courseId, key);
            }}
            title={title}
            aria-label={title}
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors ${
              n > 0
                ? selected
                  ? 'bg-white/20 text-white hover:bg-white/30'
                  : 'bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border/60 hover:text-lantern-text'
                : selected
                  ? 'text-white/60'
                  : 'text-lantern-text-tertiary'
            }`}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {n}
            {key === 'bundles' && counts.purchasedPacks ? (
              <ShoppingBagIcon className="h-3 w-3 ml-0.5" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );

  const renderCourseRow = (node: LibraryCourseNode) => {
    const selected = selectedCourseId === node.course.id;
    const total = countsTotal(node.counts);
    return (
      <li key={`${node.enrolment.academicYear}-${node.course.id}`}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          onClick={() => onSelectCourse(selected ? null : node.course.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectCourse(selected ? null : node.course.id);
            }
          }}
          className={`w-full rounded-lg ${rowPad} text-left cursor-pointer transition-colors ${
            selected
              ? 'bg-lantern-primary text-white'
              : 'text-lantern-text hover:bg-lantern-background-secondary'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold shrink-0">{node.course.code}</span>
            {node.course.title && node.course.title !== node.course.code ? (
              <span
                className={`text-xs truncate ${selected ? 'text-white/80' : 'text-lantern-text-secondary'}`}
                title={node.course.title}
              >
                — {node.course.title}
              </span>
            ) : null}
            {total === 0 ? (
              <span className={`ml-auto text-[10px] shrink-0 ${selected ? 'text-white/70' : 'text-lantern-text-tertiary'}`}>
                empty
              </span>
            ) : null}
          </div>
          {renderCounts(node.counts, node.course.id, selected)}
        </div>
      </li>
    );
  };

  const allSelected = !selectedCourseId;
  const unfiledSelected = selectedCourseId === UNFILED_COURSE_ID;
  const hasAnything = tree.current.length > 0 || tree.past.length > 0;

  return (
    <nav aria-label="Browse library by course" className={`text-sm ${className}`}>
      <ul className="space-y-0.5">
        <li>
          {/* div[role=button] rather than <button>: the count badges inside are buttons themselves. */}
          <div
            role="button"
            tabIndex={0}
            aria-pressed={allSelected}
            onClick={() => onSelectCourse(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectCourse(null);
              }
            }}
            className={`w-full rounded-lg ${rowPad} text-left cursor-pointer transition-colors ${
              allSelected ? 'bg-lantern-primary text-white' : 'text-lantern-text hover:bg-lantern-background-secondary'
            }`}
          >
            <span className="flex items-center gap-2">
              <AcademicCapIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="font-semibold">All items</span>
            </span>
            {overview ? renderCounts(tree.totals, null, allSelected) : null}
          </div>
        </li>
      </ul>

      {loading && !overview ? (
        <div className="mt-3 space-y-2 px-1" aria-busy="true" aria-label="Loading courses">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 rounded-lg bg-lantern-background-secondary animate-pulse" />
          ))}
        </div>
      ) : null}

      {error && !overview ? (
        <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-200">
          <p>Couldn&apos;t load your courses.</p>
          <button
            type="button"
            onClick={() => void loadOverview({ force: true })}
            className="mt-1 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </div>
      ) : null}

      {overview ? (
        <>
          <section className="mt-3" aria-labelledby="library-rail-current">
            <h3
              id="library-rail-current"
              className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary"
            >
              This semester
            </h3>
            {tree.current.length > 0 ? (
              <ul className="space-y-0.5">{tree.current.map(renderCourseRow)}</ul>
            ) : (
              <p className="px-2 text-xs text-lantern-text-secondary">
                {hasAnything
                  ? 'No active courses this semester.'
                  : 'No courses yet — add them in Settings → Academic, or pick a course when you save a note or deck.'}
              </p>
            )}
          </section>

          {tree.past.length > 0 ? (
            <section className="mt-3" aria-labelledby="library-rail-past">
              <button
                type="button"
                id="library-rail-past"
                aria-expanded={pastOpen}
                onClick={() => setPastOpen((o) => !o)}
                className="w-full flex items-center gap-1 px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary hover:text-lantern-text"
              >
                {pastOpen ? (
                  <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden />
                )}
                <ArchiveBoxIcon className="h-3.5 w-3.5" aria-hidden />
                Past semesters
                <span className="ml-auto font-normal normal-case tracking-normal">
                  {tree.past.reduce((n, y) => n + y.courses.length, 0)}
                </span>
              </button>
              {pastOpen
                ? tree.past.map((year) => (
                    <div key={year.academicYear} className="mb-1.5">
                      <p className="px-2 py-0.5 text-[11px] text-lantern-text-secondary">{year.academicYear}</p>
                      <ul className="space-y-0.5">{year.courses.map(renderCourseRow)}</ul>
                    </div>
                  ))
                : null}
            </section>
          ) : null}

          <section className="mt-3" aria-labelledby="library-rail-unfiled">
            <h3 id="library-rail-unfiled" className="sr-only">
              Unfiled
            </h3>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={unfiledSelected}
              onClick={() => onSelectCourse(unfiledSelected ? null : UNFILED_COURSE_ID)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCourse(unfiledSelected ? null : UNFILED_COURSE_ID);
                }
              }}
              className={`w-full rounded-lg ${rowPad} text-left cursor-pointer transition-colors ${
                unfiledSelected ? 'bg-lantern-primary text-white' : 'text-lantern-text hover:bg-lantern-background-secondary'
              }`}
              title="Items not filed under any course"
            >
              <span className="flex items-center gap-2">
                <InboxIcon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="font-semibold">Unfiled</span>
              </span>
              {renderCounts(tree.unfiled, UNFILED_COURSE_ID, unfiledSelected)}
            </div>
          </section>
        </>
      ) : null}
    </nav>
  );
};

export default LibraryRail;
