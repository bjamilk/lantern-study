import React, { useEffect, useMemo, useState } from 'react';
import {
  AcademicCapIcon,
  AdjustmentsHorizontalIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  BuildingStorefrontIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentCheckIcon,
  CloudArrowDownIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  InboxIcon,
  RectangleStackIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { COURSE_TOPIC_COPY } from '@lantern/shared';
import type { LibraryCourseCounts, LibraryCourseNode } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useAcademicStore } from '../../stores/academicStore';
import {
  UNFILED_COURSE_ID,
  buildLibraryTree,
  countsTotal,
  courseTopicRows,
  type LibraryTopicRow,
} from '../../utils/libraryArchive';
import { ManageOutlineModal } from '../academic/ManageOutlineModal';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '../ui';
import type { LibraryTab } from '../LibraryScreen';

export interface LibraryRailProps {
  /** Current course filter: uuid | 'null' (unfiled) | null (all). */
  selectedCourseId: string | null;
  onSelectCourse: (courseId: string | null) => void;
  /** Current topic filter inside `selectedCourseId`: uuid | 'null' (no topic) | null (whole course). */
  selectedTopicId: string | null;
  /**
   * Selecting a topic sets both halves; `null` means the whole course again.
   * The title travels with the id so the chips can label the selection without
   * looking it back up in a tree that may no longer hold the row.
   */
  onSelectTopic: (courseId: string, topicId: string | null, topicLabel?: string | null) => void;
  /** Switch the Library tabs (Notes / Flashcards) — used by the per-course count badges. */
  onOpenTab: (tab: LibraryTab) => void;
  /** Opens the Dashboard's recent-tests list, which follows the Library course/topic filter. */
  onOpenTests: () => void;
  /** Opens Offline Mode, which follows the Library course filter. */
  onOpenOffline: () => void;
  /**
   * Draft a sellable study pack from one course's notes (Phase 2 · H). Takes
   * the course explicitly, so a row can offer it without first making that
   * course the Library's filter.
   */
  onCreateStudyPack?: (courseId: string, courseLabel?: string) => void;
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
 *
 * A course that carries a syllabus outline gets a third level (Phase 1 · A):
 * its topics, collapsed. Courses without one — everyone, until the
 * course_topics migration is applied — render exactly as they always have.
 */
export const LibraryRail: React.FC<LibraryRailProps> = ({
  selectedCourseId,
  onSelectCourse,
  selectedTopicId,
  onSelectTopic,
  onOpenTab,
  onOpenTests,
  onOpenOffline,
  onCreateStudyPack,
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
  // Topic levels are collapsed by default; keyed per row because one course can
  // appear under several academic years.
  const [openTopicRows, setOpenTopicRows] = useState<ReadonlySet<string>>(() => new Set<string>());
  // The course whose shared outline is being managed (rename/reorder/delete), if any.
  const [manageCourse, setManageCourse] = useState<{ id: string; label: string } | null>(null);

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

  // A topic selected elsewhere (a count badge, a restored filter) must be visible.
  useEffect(() => {
    if (!selectedCourseId || !selectedTopicId) return;
    const keys = [...tree.current, ...tree.past.flatMap((y) => y.courses)]
      .filter((n) => n.course.id === selectedCourseId)
      .map((n) => `${n.enrolment.academicYear}-${n.course.id}`);
    if (keys.length === 0) return;
    setOpenTopicRows((open) => (keys.every((k) => open.has(k)) ? open : new Set([...open, ...keys])));
  }, [selectedCourseId, selectedTopicId, tree]);

  const openArtefactTab = (key: CountKey) => {
    if (key === 'notes') onOpenTab('notes');
    else if (key === 'decks') onOpenTab('flashcards');
    else if (key === 'tests') onOpenTests();
    else onOpenOffline();
  };

  const openCount = (courseId: string | null, key: CountKey) => {
    onSelectCourse(courseId);
    openArtefactTab(key);
  };

  const openTopicCount = (courseId: string, row: LibraryTopicRow, key: CountKey) => {
    onSelectTopic(courseId, row.id, row.title);
    openArtefactTab(key);
  };

  const toggleTopics = (rowKey: string) => {
    setOpenTopicRows((open) => {
      const next = new Set(open);
      if (!next.delete(rowKey)) next.add(rowKey);
      return next;
    });
  };

  const rowPad = compact ? 'px-2 py-1.5' : 'px-2.5 py-2';

  /**
   * Enter/Space activation for a `div[role=button]` row.
   *
   * Every row nests real `<button>`s — the count badges, the topics chevron, the
   * manage-topics gear. A keydown on one of those bubbles up to the row, and
   * `preventDefault()` here cancels the BUTTON's own activation: before this
   * guard, Enter on the gear toggled the course filter and never opened the
   * modal, leaving keyboard and screen-reader users no route to rename, reorder
   * or delete. Only act when the row itself is the focused element.
   */
  const rowActivate = (activate: () => void) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    activate();
  };

  /**
   * Stands in for the four "0" badges an empty row used to carry: they cost the
   * row a whole second line, and their aria-labels were all a screen reader got,
   * so the marker has to say the same thing.
   */
  const renderEmptyMarker = (selected: boolean, extraClass = '') => (
    <span
      className={`text-[10px] shrink-0 ${selected ? 'text-white/70' : 'text-lantern-text-tertiary'} ${extraClass}`}
    >
      empty<span className="sr-only"> — no notes, decks, tests or offline packs</span>
    </span>
  );

  const renderCounts = (
    counts: Pick<LibraryCourseCounts, 'notes' | 'decks' | 'tests' | 'bundles'> & { purchasedPacks?: number },
    onOpen: (key: CountKey) => void,
    selected: boolean
  ) => {
    // `purchasedPacks` is a subset of `bundles`, so a zero bundles count can
    // never hide a purchased pack.
    const present = COUNT_META.filter(({ key }) => (counts[key] || 0) > 0);
    if (present.length === 0) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1" aria-label="Item counts">
        {present.map(({ key, label, icon: Icon }) => {
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
                onOpen(key);
              }}
              title={title}
              aria-label={title}
              className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors ${
                selected
                  ? 'bg-white/20 text-white hover:bg-white/30'
                  : 'bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border/60 hover:text-lantern-text'
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
  };

  const renderTopicRow = (courseId: string, row: LibraryTopicRow) => {
    const selected = selectedCourseId === courseId && selectedTopicId === row.id;
    const total = countsTotal(row.counts);
    // Re-clicking the selected topic goes back to the whole course, mirroring the course row.
    const toggle = () => onSelectTopic(courseId, selected ? null : row.id, row.title);
    return (
      <li key={row.id}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          onClick={toggle}
          onKeyDown={rowActivate(toggle)}
          title={row.untopiced ? 'Items in this course that are not under any topic' : row.title}
          className={`w-full rounded-lg ${rowPad} text-left cursor-pointer transition-colors ${
            selected ? 'bg-lantern-primary text-white' : 'text-lantern-text hover:bg-lantern-background-secondary'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-xs truncate ${
                row.untopiced && !selected ? 'italic text-lantern-text-secondary' : 'font-medium'
              }`}
            >
              {row.title}
            </span>
            {total === 0 ? renderEmptyMarker(selected, 'ml-auto') : null}
          </div>
          {renderCounts(row.counts, (key) => openTopicCount(courseId, row, key), selected)}
        </div>
      </li>
    );
  };

  const renderCourseRow = (node: LibraryCourseNode) => {
    const courseSelected = selectedCourseId === node.course.id;
    const total = countsTotal(node.counts);
    // Only topics something is FILED under reach the overview, so this is empty
    // both for a course with no outline and for a freshly seeded one.
    const topics = courseTopicRows(node);
    const courseLabel =
      node.course.title && node.course.title !== node.course.code
        ? `${node.course.code} — ${node.course.title}`
        : node.course.code;
    const rowKey = `${node.enrolment.academicYear}-${node.course.id}`;
    const topicsOpen = topics.length > 0 && openTopicRows.has(rowKey);
    // Academic years carry a slash, which has no business in a DOM id.
    const topicsId = `library-rail-topics-${rowKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    // With a topic selected, the course row is the way back to the whole course;
    // only a plain course selection toggles off to "all items".
    const select = () => {
      if (courseSelected && selectedTopicId) onSelectTopic(node.course.id, null);
      else onSelectCourse(courseSelected ? null : node.course.id);
    };
    return (
      <li key={rowKey}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={courseSelected && !selectedTopicId}
          onClick={select}
          onKeyDown={rowActivate(select)}
          className={`w-full rounded-lg ${rowPad} text-left cursor-pointer transition-colors ${
            courseSelected && !selectedTopicId
              ? 'bg-lantern-primary text-white'
              : 'text-lantern-text hover:bg-lantern-background-secondary'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {topics.length > 0 ? (
              <button
                type="button"
                aria-expanded={topicsOpen}
                aria-controls={topicsId}
                aria-label={`${topicsOpen ? 'Hide' : 'Show'} topics in ${node.course.code}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTopics(rowKey);
                }}
                className={`shrink-0 -ml-1 grid place-items-center min-w-[24px] min-h-[24px] rounded ${
                  courseSelected && !selectedTopicId ? 'hover:bg-white/20' : 'hover:bg-lantern-border/60'
                }`}
              >
                {topicsOpen ? (
                  <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            ) : null}
            <span className="text-sm font-semibold shrink-0">{node.course.code}</span>
            {node.course.title && node.course.title !== node.course.code ? (
              <span
                className={`text-xs truncate ${
                  courseSelected && !selectedTopicId ? 'text-white/80' : 'text-lantern-text-secondary'
                }`}
                title={node.course.title}
              >
                — {node.course.title}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1 shrink-0">
              {total === 0 ? renderEmptyMarker(courseSelected && !selectedTopicId) : null}
              {/* One overflow menu per course, in the same 24px the manage-topics
                  gear used to occupy — and on every course, not only ones with
                  topic rows: an outline whose topics hold nothing yet
                  contributes no rows here, and gating on them left a freshly
                  seeded outline with no way to be curated.
                  Its actions take the course explicitly, so a student can act on
                  BIO 201 without first making it the Library's filter. Mobile
                  puts the same actions in each row's overflow sheet. */}
              <Menu>
                <MenuTrigger
                  aria-label={`Actions for ${node.course.code}`}
                  title={`Actions for ${node.course.code}`}
                  className={`grid place-items-center min-w-[24px] min-h-[24px] rounded ${
                    courseSelected && !selectedTopicId
                      ? 'text-white/80 hover:bg-white/20'
                      : 'text-lantern-text-tertiary hover:text-lantern-text hover:bg-lantern-border/60'
                  }`}
                >
                  <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden />
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem
                    icon={<AdjustmentsHorizontalIcon className="h-5 w-5" aria-hidden />}
                    onSelect={() => setManageCourse({ id: node.course.id, label: courseLabel })}
                  >
                    {COURSE_TOPIC_COPY.manageTitle}
                  </MenuItem>
                  {onCreateStudyPack ? (
                    <MenuItem
                      icon={<BuildingStorefrontIcon className="h-5 w-5" aria-hidden />}
                      onSelect={() => onCreateStudyPack(node.course.id, courseLabel)}
                    >
                      Create a study pack
                    </MenuItem>
                  ) : null}
                </MenuContent>
              </Menu>
            </span>
          </div>
          {renderCounts(node.counts, (key) => openCount(node.course.id, key), courseSelected && !selectedTopicId)}
        </div>
        {topicsOpen ? (
          <ul
            id={topicsId}
            className="ml-3 mt-0.5 space-y-0.5 border-l border-lantern-border pl-1.5"
            aria-label={`Topics in ${node.course.code}`}
          >
            {topics.map((row) => renderTopicRow(node.course.id, row))}
          </ul>
        ) : null}
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
            onKeyDown={rowActivate(() => onSelectCourse(null))}
            className={`w-full rounded-lg ${rowPad} text-left cursor-pointer transition-colors ${
              allSelected ? 'bg-lantern-primary text-white' : 'text-lantern-text hover:bg-lantern-background-secondary'
            }`}
          >
            <span className="flex items-center gap-2">
              <AcademicCapIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="font-semibold">All items</span>
              {overview && countsTotal(tree.totals) === 0 ? renderEmptyMarker(allSelected, 'ml-auto') : null}
            </span>
            {overview ? renderCounts(tree.totals, (key) => openCount(null, key), allSelected) : null}
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
              onKeyDown={rowActivate(() => onSelectCourse(unfiledSelected ? null : UNFILED_COURSE_ID))}
              className={`w-full rounded-lg ${rowPad} text-left cursor-pointer transition-colors ${
                unfiledSelected ? 'bg-lantern-primary text-white' : 'text-lantern-text hover:bg-lantern-background-secondary'
              }`}
              title="Items not filed under any course"
            >
              <span className="flex items-center gap-2">
                <InboxIcon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="font-semibold">Unfiled</span>
                {countsTotal(tree.unfiled) === 0 ? renderEmptyMarker(unfiledSelected, 'ml-auto') : null}
              </span>
              {renderCounts(tree.unfiled, (key) => openCount(UNFILED_COURSE_ID, key), unfiledSelected)}
            </div>
          </section>
        </>
      ) : null}

      {manageCourse ? (
        <ManageOutlineModal
          isOpen
          onClose={() => setManageCourse(null)}
          courseId={manageCourse.id}
          courseLabel={manageCourse.label}
          // Counts on the tree include per-topic totals, so refresh after any
          // rename/reorder/delete or the outline the user just changed goes stale.
          onChanged={() => void loadOverview({ force: true })}
          // Deleting the topic the Library is filtered by would leave the filter
          // on a dead uuid: Notes, Flashcards and Tests would all read empty
          // under a chip still naming it. Widen back to the whole course.
          onTopicDeleted={(topicId) => {
            if (selectedCourseId !== manageCourse.id || selectedTopicId !== topicId) return;
            onSelectTopic(manageCourse.id, null);
          }}
        />
      ) : null}
    </nav>
  );
};

export default LibraryRail;
