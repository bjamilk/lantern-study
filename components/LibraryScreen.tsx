import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AcademicCapIcon,
  ArrowLeftIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  RectangleStackIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Tabs, TabList, Tab, TabPanel } from './ui';
import { featureAccents } from '@lantern/shared/design';
import { COURSE_TOPIC_COPY } from '@lantern/shared';
import type { LibrarySearchResult } from '../types';
import { useLibraryStore } from '../stores/libraryStore';
import { useAcademicStore } from '../stores/academicStore';
import { useUIStore } from '../stores/uiStore';
import { useIsMdUp } from '../hooks/useMediaQuery';
import {
  LIBRARY_SEARCH_MIN_CHARS,
  UNFILED_COURSE_ID,
  buildLibraryTree,
  findTreeTopic,
  isSearchableQuery,
} from '../utils/libraryArchive';
import { courseLabel } from '../utils/academicSetup';
import { CourseFilterShownAboveProvider } from './academic/CourseChips';
import { LibraryRail } from './library/LibraryRail';
import { LibraryPanelSearchProvider } from './library/libraryPanelSearch';
import { LibrarySearchBox, LibrarySearchResults } from './library/LibrarySearch';

export type LibraryTab = 'notes' | 'flashcards';

interface LibraryScreenProps {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  notesContent: React.ReactNode;
  flashcardsContent: React.ReactNode;
  dueCardsCount?: number;
  noteCount?: number;
  deckCount?: number;
  /** Search deep links (Phase 1 · B). */
  onOpenNote: (noteId: string) => void;
  onOpenDeck: (deckId: string) => void;
  /** Opens Offline Mode; it follows the Library's course filter (store). */
  onOpenOffline: () => void;
  /** Opens recent tests — the web has no per-course test history yet, so this is unfiltered. */
  onOpenTests: () => void;
  /**
   * Generate a sellable study pack from a course's notes (Phase 2 · H). Offered
   * on every course row in the rail, not only the filtered one — see
   * `LibraryRail`.
   */
  onCreateStudyPackFromCourse?: (courseId: string, courseLabel?: string) => void;
}

const tabs: { id: LibraryTab; label: string; icon: React.ElementType }[] = [
  { id: 'notes', label: 'Notes', icon: DocumentTextIcon },
  { id: 'flashcards', label: 'Flashcards', icon: RectangleStackIcon },
];

/**
 * "My Lantern Library": the archive spine (course rail / top panel), a
 * cross-artefact search box and the Notes / Flashcards tabs, which follow the
 * selected course via the library store.
 */
export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  tab,
  onTabChange,
  notesContent,
  flashcardsContent,
  dueCardsCount = 0,
  noteCount,
  deckCount,
  onOpenNote,
  onOpenDeck,
  onOpenOffline,
  onOpenTests,
  onCreateStudyPackFromCourse,
}) => {
  const courseFilterId = useLibraryStore((s) => s.courseFilterId);
  const setCourseFilter = useLibraryStore((s) => s.setCourseFilter);
  const topicFilterId = useLibraryStore((s) => s.topicFilterId);
  const topicFilterLabel = useLibraryStore((s) => s.topicFilterLabel);
  const setTopicFilter = useLibraryStore((s) => s.setTopicFilter);
  const overview = useLibraryStore((s) => s.overview);
  const setPendingOfflineBundleId = useLibraryStore((s) => s.setPendingOfflineBundleId);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  void knownCourses; // subscribe so the selected course label resolves once courses load
  const academicLoaded = useAcademicStore((s) => s.loaded);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  // The scope row is now the only place the active course is named, and its
  // label comes from `resolveCourse`. Load here rather than inheriting the
  // fetch from whichever panel happens to be mounted: the rail can be
  // collapsed and only one tab renders at a time, so neither is guaranteed.
  useEffect(() => {
    if (courseFilterId && courseFilterId !== UNFILED_COURSE_ID && !academicLoaded) void loadMyCourses();
  }, [courseFilterId, academicLoaded, loadMyCourses]);

  const [query, setQuery] = useState('');
  // Persisted (uiStore) so the rail does not collapse on every navigation.
  const railOpen = useUIStore((s) => s.isLibraryRailOpen);
  const setRailOpen = useUIStore((s) => s.setLibraryRailOpen);
  const toggleRail = useUIStore((s) => s.toggleLibraryRail);
  // Mount only one rail: the md+ aside or the small-screen panel (matches NotesScreen's approach).
  const isMdUp = useIsMdUp();
  // Persisted in the same store as the rest of the Library's chrome, so the
  // screen has one persistence mechanism rather than a store plus a stray key.
  const railCollapsed = useUIStore((s) => s.isLibraryRailCollapsed);
  const toggleRailCollapsed = useUIStore((s) => s.toggleLibraryRailCollapsed);

  const selectedCourse = courseFilterId && courseFilterId !== UNFILED_COURSE_ID ? resolveCourse(courseFilterId) : null;
  // The store carries the title picked in the rail; the tree is only a fallback
  // for a filter restored without one. Never *only* the tree: a row can leave it
  // (the "No topic" row disappears once its last item is filed, another device
  // renames a topic) while the filter is still narrowing the results, and a
  // label that vanishes takes the "Whole course" button with it.
  const selectedTopic = useMemo(() => {
    if (!topicFilterId) return null;
    const fromTree = findTreeTopic(buildLibraryTree(overview), courseFilterId, topicFilterId);
    return fromTree || { title: topicFilterLabel || COURSE_TOPIC_COPY.filterLabel };
  }, [overview, courseFilterId, topicFilterId, topicFilterLabel]);
  const scopeLabel = useMemo(() => {
    if (!courseFilterId) return null;
    if (courseFilterId === UNFILED_COURSE_ID) return 'Unfiled';
    const course = selectedCourse ? selectedCourse.code : 'this course';
    return selectedTopic ? `${course} · ${selectedTopic.title}` : course;
  }, [courseFilterId, selectedCourse, selectedTopic]);
  // The box narrows the open tab's list, so its placeholder has to say which
  // list — "Search your library" promised an archive-wide search that typing
  // no longer performs.
  const searchFilterLabel = `${tab === 'notes' ? 'notes' : 'flashcards'}${scopeLabel ? ` in ${scopeLabel}` : ''}`;

  // Same totals the rail's "All items" row carries; here they cost no height,
  // so they survive the rail being collapsed. No due count: the Flashcards tab
  // badge two rows below already carries it and is visible at the same time —
  // mobile dropped the duplicate from its collapsed tree summary for exactly
  // this reason, and the two clients have to agree.
  const countsLabel = useMemo(() => {
    const parts: string[] = [];
    if (noteCount != null) parts.push(`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`);
    if (deckCount != null) parts.push(`${deckCount} ${deckCount === 1 ? 'deck' : 'decks'}`);
    return parts.join(' · ');
  }, [noteCount, deckCount]);

  const trimmedQuery = query.trim();
  const canSearchEverything = isSearchableQuery(query);
  /**
   * Whether the cross-library search has replaced the open panel.
   *
   * Typing no longer does this on its own. `GET /library/search` needs the
   * network and two characters, and it knows nothing about the panel's folder,
   * Mine/Shared or Active/Archived selection — so while those controls sat on
   * screen looking applied, the results ignored them. Typing now filters the
   * panel in place (see `LibraryPanelSearchProvider`), which is instant, works
   * offline and honours everything on screen; this is the deliberate step out
   * to decks, cards and offline bundles.
   */
  const [searchEverything, setSearchEverything] = useState(false);
  useEffect(() => {
    if (!canSearchEverything) setSearchEverything(false);
  }, [canSearchEverything]);
  const clearSearch = useCallback(() => setQuery(''), []);

  const handleSelectCourse = useCallback(
    (courseId: string | null) => {
      setCourseFilter(courseId);
      setRailOpen(false);
    },
    [setCourseFilter, setRailOpen]
  );

  const handleSelectTopic = useCallback(
    (courseId: string, topicId: string | null, topicLabel?: string | null) => {
      setTopicFilter(courseId, topicId, topicLabel);
      setRailOpen(false);
    },
    [setTopicFilter, setRailOpen]
  );

  const handleOpenBundle = useCallback(
    (bundle: LibrarySearchResult) => {
      setPendingOfflineBundleId(bundle.id);
      onOpenOffline();
    },
    [setPendingOfflineBundleId, onOpenOffline]
  );

  const rail = (compact: boolean) => (
    <LibraryRail
      compact={compact}
      selectedCourseId={courseFilterId}
      onSelectCourse={handleSelectCourse}
      selectedTopicId={topicFilterId}
      onSelectTopic={handleSelectTopic}
      onOpenTab={(next) => {
        clearSearch();
        onTabChange(next);
      }}
      onOpenTests={onOpenTests}
      onOpenOffline={onOpenOffline}
      onCreateStudyPack={onCreateStudyPackFromCourse}
    />
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-lantern-background">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          // A tab is also the way back out of the cross-library results: the
          // TabList stays visible there, so clicking one has to land on that
          // tab's list rather than leaving the search in place.
          setSearchEverything(false);
          onTabChange(value as LibraryTab);
        }}
        aria-label="Library sections"
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-2 sm:pt-3 bg-lantern-background">
          {/* One line where a hero used to be. The Library is reached from the
              nav, so it does not need to introduce itself on every visit, and
              its totals are the rail's — repeated here only because they fit
              beside the title for free. */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h1 className="flex shrink-0 items-center gap-2 text-base font-semibold text-lantern-text">
              <RectangleStackIcon className="h-5 w-5 text-lantern-feature-library" aria-hidden />
              Library
            </h1>
            {/* From md, where the rail — and the badges carrying these totals — can be collapsed. */}
            {countsLabel ? (
              <span className="hidden md:inline truncate text-xs text-lantern-text-secondary">{countsLabel}</span>
            ) : null}
            <LibrarySearchBox
              value={query}
              onChange={setQuery}
              onClear={clearSearch}
              filterLabel={searchFilterLabel}
              className="flex-1 min-w-[10rem]"
            />
            {!isMdUp ? (
              <button
                type="button"
                onClick={toggleRail}
                aria-expanded={railOpen}
                aria-controls="library-rail-panel"
                className="inline-flex items-center justify-between gap-2 rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-sm font-medium text-lantern-text"
              >
                {/* A disclosure, not a second read-out of the filter: whatever is
                    selected, the scope row below says so and can clear it. */}
                <span className="inline-flex items-center gap-2 min-w-0">
                  <AcademicCapIcon className="h-4 w-4 shrink-0 text-lantern-primary" aria-hidden />
                  <span className="truncate">Browse by course</span>
                </span>
                {railOpen ? (
                  <ChevronUpIcon className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronDownIcon className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </button>
            ) : null}
          </div>

          <TabList data-tip-id="library.tabs">
            {tabs.map(({ id, label, icon: Icon }, index) => (
              <Tab
                key={id}
                value={id}
                index={index}
                icon={<Icon className="w-4 h-4" />}
                style={tab === id ? { borderTopWidth: 3, borderTopColor: featureAccents.library } : undefined}
                badge={
                  id === 'flashcards' && dueCardsCount > 0 ? (
                    <span className="bg-lantern-error text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {dueCardsCount > 99 ? '99+' : dueCardsCount}
                    </span>
                  ) : undefined
                }
              >
                {label}
              </Tab>
            ))}
          </TabList>

          {/* The one place the active filter is named inside the panels: the
              chips that used to repeat it on each tab are gone, so this row
              has to stay directly above the list it is narrowing. It carries
              the search's scope controls too, so a query costs no row of its
              own whenever a course is selected. */}
          {courseFilterId || trimmedQuery ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-lantern-text-secondary">
              {courseFilterId ? (
                <>
                  <span>
                    Showing{' '}
                    <span className="font-semibold text-lantern-text">
                      {courseFilterId === UNFILED_COURSE_ID
                        ? 'unfiled items'
                        : selectedCourse
                          ? courseLabel(selectedCourse)
                          : 'one course'}
                    </span>
                    {selectedTopic ? (
                      <>
                        {' · '}
                        <span className="font-semibold text-lantern-text">{selectedTopic.title}</span>
                      </>
                    ) : null}
                  </span>
                  {selectedTopic && courseFilterId !== UNFILED_COURSE_ID ? (
                    <button
                      type="button"
                      onClick={() => handleSelectTopic(courseFilterId, null)}
                      className="inline-flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
                      title={COURSE_TOPIC_COPY.filterClearHint}
                    >
                      Whole course
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleSelectCourse(null)}
                    className="inline-flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
                  >
                    <XMarkIcon className="h-3 w-3" aria-hidden /> Clear
                  </button>
                </>
              ) : null}
              {trimmedQuery ? (
                searchEverything ? (
                  <button
                    type="button"
                    onClick={() => setSearchEverything(false)}
                    className="inline-flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
                  >
                    <ArrowLeftIcon className="h-3 w-3" aria-hidden /> Back to {tab === 'notes' ? 'notes' : 'flashcards'}
                  </button>
                ) : canSearchEverything ? (
                  <button
                    type="button"
                    onClick={() => setSearchEverything(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-lantern-primary/30 bg-lantern-primary/5 px-2 py-0.5 font-medium text-lantern-primary hover:bg-lantern-primary/10"
                    title="Search decks, cards and offline bundles as well — this drops the folder and Archived filters"
                  >
                    <MagnifyingGlassIcon className="h-3 w-3" aria-hidden /> Search everything
                  </button>
                ) : (
                  // One character filters the list below just fine; only the
                  // server search has a minimum, so say so instead of
                  // emptying the screen the way the old behaviour did.
                  <span>Type {LIBRARY_SEARCH_MIN_CHARS} characters to search decks, cards and bundles too.</span>
                )
              ) : null}
            </div>
          ) : null}
        </div>

        {!isMdUp && railOpen ? (
          <div
            id="library-rail-panel"
            className="shrink-0 max-h-[50vh] overflow-y-auto border-b border-lantern-border bg-lantern-surface px-2 py-2"
          >
            {rail(true)}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex flex-row">
          {/* Collapsing narrows the rail to a strip rather than removing it:
              at 1024px it was taking a quarter of the width from deck cards,
              but a rail that vanishes takes the way back with it. */}
          {isMdUp ? (
            <aside
              id="library-rail-aside"
              aria-label="Courses"
              className={`shrink-0 border-r border-lantern-border bg-lantern-surface ${
                railCollapsed ? 'w-11 overflow-hidden py-2 flex flex-col items-center gap-2' : 'w-52 lg:w-64 overflow-y-auto p-2'
              }`}
            >
              {railCollapsed ? (
                <>
                  <button
                    type="button"
                    onClick={toggleRailCollapsed}
                    aria-expanded={false}
                    aria-controls="library-rail-aside"
                    aria-label="Show courses"
                    title="Show courses"
                    className="flex w-full min-h-[44px] items-center justify-center rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                  >
                    <ChevronDoubleRightIcon className="h-4 w-4" aria-hidden />
                  </button>
                  <AcademicCapIcon className="h-5 w-5 text-lantern-text-tertiary" aria-hidden />
                </>
              ) : (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2 pl-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
                      Courses
                    </span>
                    <button
                      type="button"
                      onClick={toggleRailCollapsed}
                      aria-expanded
                      aria-controls="library-rail-aside"
                      aria-label="Hide courses"
                      title="Hide courses"
                      className="rounded-lg p-1.5 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
                    >
                      <ChevronDoubleLeftIcon className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {rail(false)}
                </>
              )}
            </aside>
          ) : null}

          <div className="flex-1 min-h-0 min-w-0 flex flex-col">
            {searchEverything ? (
              <LibrarySearchResults
                query={query}
                courseId={courseFilterId}
                topicId={topicFilterId}
                onOpenNote={onOpenNote}
                onOpenDeck={onOpenDeck}
                onOpenBundle={handleOpenBundle}
              />
            ) : (
              // Both panels ship their own course chips for when they are the
              // whole screen. Here the rail picks the filter and the scope row
              // above names it, so the chips stand down — and the search box
              // above filters the panel's own list rather than replacing it.
              <CourseFilterShownAboveProvider>
                <LibraryPanelSearchProvider query={query}>
                  <TabPanel value="notes" className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {notesContent}
                  </TabPanel>
                  <TabPanel value="flashcards" className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {flashcardsContent}
                  </TabPanel>
                </LibraryPanelSearchProvider>
              </CourseFilterShownAboveProvider>
            )}
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default LibraryScreen;
