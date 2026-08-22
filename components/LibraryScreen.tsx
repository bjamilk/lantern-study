import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AcademicCapIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
  RectangleStackIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { FeatureHero, StatChip, Tabs, TabList, Tab, TabPanel } from './ui';
import { featureAccents } from '@lantern/shared/design';
import type { LibrarySearchResult } from '../types';
import { useLibraryStore } from '../stores/libraryStore';
import { useAcademicStore } from '../stores/academicStore';
import { UNFILED_COURSE_ID, isSearchableQuery } from '../utils/libraryArchive';
import { courseLabel } from '../utils/academicSetup';
import { LibraryRail } from './library/LibraryRail';
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
}) => {
  const courseFilterId = useLibraryStore((s) => s.courseFilterId);
  const setCourseFilter = useLibraryStore((s) => s.setCourseFilter);
  const setPendingOfflineBundleId = useLibraryStore((s) => s.setPendingOfflineBundleId);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  void knownCourses; // subscribe so the selected course label resolves once courses load

  const [query, setQuery] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  // Mount only one rail: the md+ aside or the small-screen panel (matches NotesScreen's approach).
  const [isMdUp, setIsMdUp] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsMdUp(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const selectedCourse = courseFilterId && courseFilterId !== UNFILED_COURSE_ID ? resolveCourse(courseFilterId) : null;
  const scopeLabel = useMemo(() => {
    if (!courseFilterId) return null;
    if (courseFilterId === UNFILED_COURSE_ID) return 'Unfiled';
    return selectedCourse ? selectedCourse.code : 'this course';
  }, [courseFilterId, selectedCourse]);

  const searching = isSearchableQuery(query) || query.trim().length > 0;
  const clearSearch = useCallback(() => setQuery(''), []);

  const handleSelectCourse = useCallback(
    (courseId: string | null) => {
      setCourseFilter(courseId);
      setRailOpen(false);
    },
    [setCourseFilter]
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
      onOpenTab={(next) => {
        clearSearch();
        onTabChange(next);
      }}
      onOpenTests={onOpenTests}
      onOpenOffline={onOpenOffline}
    />
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-lantern-background">
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as LibraryTab)}
        aria-label="Library sections"
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="shrink-0 px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 bg-lantern-background">
          <FeatureHero
            title="Library"
            subtitle="Your archive — notes, decks, tests and offline packs, filed by course"
            accentColor={featureAccents.library}
            icon={<RectangleStackIcon className="w-6 h-6 text-lantern-feature-library" />}
            className="mb-3"
          >
            <div className="flex flex-wrap gap-2">
              {noteCount != null ? (
                <StatChip label={`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`} variant="primary" />
              ) : null}
              {deckCount != null ? (
                <StatChip label={`${deckCount} ${deckCount === 1 ? 'deck' : 'decks'}`} variant="accent" />
              ) : null}
              {dueCardsCount > 0 ? (
                <StatChip label={`${dueCardsCount} due`} variant="neutral" className="bg-lantern-error/10 text-lantern-error" />
              ) : null}
            </div>
          </FeatureHero>

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <LibrarySearchBox
              value={query}
              onChange={setQuery}
              onClear={clearSearch}
              scopeLabel={scopeLabel}
              className="flex-1 min-w-0"
            />
            {!isMdUp ? (
              <button
                type="button"
                onClick={() => setRailOpen((o) => !o)}
                aria-expanded={railOpen}
                aria-controls="library-rail-panel"
                className="inline-flex items-center justify-between gap-2 rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-sm font-medium text-lantern-text"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <AcademicCapIcon className="h-4 w-4 shrink-0 text-lantern-primary" aria-hidden />
                  <span className="truncate">
                    {courseFilterId
                      ? courseFilterId === UNFILED_COURSE_ID
                        ? 'Unfiled'
                        : selectedCourse
                          ? courseLabel(selectedCourse)
                          : 'Course'
                      : 'Browse by course'}
                  </span>
                </span>
                {railOpen ? (
                  <ChevronUpIcon className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronDownIcon className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </button>
            ) : null}
          </div>

          {courseFilterId ? (
            <div className="mb-2 flex items-center gap-2 text-xs text-lantern-text-secondary">
              <span>
                Showing{' '}
                <span className="font-semibold text-lantern-text">
                  {courseFilterId === UNFILED_COURSE_ID
                    ? 'unfiled items'
                    : selectedCourse
                      ? courseLabel(selectedCourse)
                      : 'one course'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => handleSelectCourse(null)}
                className="inline-flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
              >
                <XMarkIcon className="h-3 w-3" aria-hidden /> Clear
              </button>
            </div>
          ) : null}

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
          {isMdUp ? (
            <aside className="shrink-0 w-52 lg:w-64 border-r border-lantern-border bg-lantern-surface overflow-y-auto p-2">
              {rail(false)}
            </aside>
          ) : null}

          <div className="flex-1 min-h-0 min-w-0 flex flex-col">
            {searching ? (
              <LibrarySearchResults
                query={query}
                courseId={courseFilterId}
                onOpenNote={onOpenNote}
                onOpenDeck={onOpenDeck}
                onOpenBundle={handleOpenBundle}
              />
            ) : (
              <>
                <TabPanel value="notes" className="flex-1 min-h-0 overflow-hidden flex flex-col">
                  {notesContent}
                </TabPanel>
                <TabPanel value="flashcards" className="flex-1 min-h-0 overflow-hidden flex flex-col">
                  {flashcardsContent}
                </TabPanel>
              </>
            )}
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default LibraryScreen;
