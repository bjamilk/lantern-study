import React, { useMemo, useRef, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';
import { LibrarySearchBox } from '../library/LibrarySearch';
import { StudySetArtifactLibrary, type ArtifactCard } from './StudySetArtifactLibrary';
import { ViewModeToggle, useViewMode } from './ViewModeToggle';

/**
 * Practice — one hub over the quiz and test libraries.
 *
 * WHY. Measured on 2026-09-17 (docs/studyfetch-mysets-2026-09-17/
 * 02-style-and-subpages.md, §Practice): the reference has ONE Practice page
 * with All / Tests / Quiz tabs and a single Create menu. Lantern had two
 * unconnected destinations — `/quiz` and `/test` — with no way to see both,
 * and the rail's "Practice & activities" header was a label with nothing
 * behind it. A student who had made three quizzes and one test had to
 * remember which door each was behind.
 *
 * WHAT DID NOT MOVE: the stores. The tab bodies are the same
 * `StudySetArtifactLibrary` the two libraries already were, fed by the same
 * `quizRows` / `testRows` the room already derives. This is a frame around
 * them, not a migration.
 *
 * DEEP LINKS. `/study/sets/:id/quiz` and `/…/test` still mean exactly what they
 * meant and open the hub on that tab; `/…/practice` is the All tab. The tab is
 * read from the URL, so Back moves between tabs and a tab can be shared.
 *
 * Touches: `CourseWorkspace` (owns the rows and the navigation),
 * `studySetRoutes` (the `practice` path activity).
 *
 * Gotchas:
 *  - The tabs are a real `role="tablist"` with arrow-key movement and roving
 *    tabindex. They are also LINKS in effect — each one navigates — so they
 *    must not be `aria-pressed` toggles.
 *  - There is NO folder card here, and no "Create folder" — although the
 *    reference has both. Nothing in Lantern files a quiz or a test into a
 *    folder: there is no `folderId` on a test row anywhere, and the only
 *    "folders" in reach are `useStudySetStore.folders`, which come from
 *    `/users/me/study-sets/folders` and group SETS. The old quiz library
 *    passed those through, so a set folder was drawn beside the quizzes
 *    reading "<name> · Folder" and clicking it LEFT the room for the set
 *    picker. A founder read that as a quiz folder on the 2026-09-17 pass,
 *    which is exactly the misreading it invites, so the hub does not draw it.
 *    A real Practice folder needs a column on the tests table first.
 */

export type PracticeTab = 'all' | 'tests' | 'quiz';

export const PRACTICE_TABS: readonly { id: PracticeTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tests', label: 'Tests' },
  { id: 'quiz', label: 'Quiz' },
];

/**
 * Which tab a set-room path activity opens the hub on.
 *
 * ONE function, because the answer is consumed twice — by the hub's body and
 * by the focus bar's label — and two copies of a rule this small drift within
 * a release, which is how the bar ends up saying "Quiz" over a list of tests.
 */
export function practiceTabForActivity(activity?: string | null): PracticeTab {
  if (activity === 'practice') return 'all';
  if (activity === 'test') return 'tests';
  return 'quiz';
}

/**
 * What the focus bar says over each tab.
 *
 * The All tab is "Practice", not "All": the bar answers "which tool am I in",
 * and "All" answers nothing on its own. The other two take their tab's word.
 */
export function practiceTabLabel(tab: PracticeTab): string {
  if (tab === 'all') return 'Practice';
  if (tab === 'tests') return 'Tests';
  return 'Quiz';
}

/** What the Create menu offers, in the reference's order. */
export type PracticeCreateKind = 'quiz' | 'test' | 'cards';

const CREATE_ITEMS: readonly { id: PracticeCreateKind; label: string }[] = [
  { id: 'quiz', label: 'Quiz' },
  { id: 'test', label: 'Test' },
  { id: 'cards', label: 'Flashcards' },
];

interface PracticeHubProps {
  setLabel: string;
  tab: PracticeTab;
  onTabChange: (tab: PracticeTab) => void;
  quizzes: readonly ArtifactCard[];
  tests: readonly ArtifactCard[];
  onOpen: (tab: Exclude<PracticeTab, 'all'>, id: string) => void;
  onCreate: (kind: PracticeCreateKind) => void;
  renderItemMenu?: (item: ArtifactCard) => React.ReactNode;
}

export const PracticeHub: React.FC<PracticeHubProps> = ({
  setLabel,
  tab,
  onTabChange,
  quizzes,
  tests,
  onOpen,
  onCreate,
  renderItemMenu,
}) => {
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useViewMode('practiceHub', 'grid');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const match = (rows: readonly ArtifactCard[]) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...rows];
    return rows.filter((row) => row.title.toLowerCase().includes(needle));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `match` is a plain
  // closure over `query`, which is already a dependency.
  const shownQuizzes = useMemo(() => match(quizzes), [quizzes, query]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- as above.
  const shownTests = useMemo(() => match(tests), [tests, query]);

  const body = useMemo(() => {
    if (tab === 'quiz') return shownQuizzes;
    if (tab === 'tests') return shownTests;
    return [...shownTests, ...shownQuizzes];
  }, [tab, shownQuizzes, shownTests]);

  /** Which library an item in the All tab belongs to. */
  const libraryOf = (item: ArtifactCard): Exclude<PracticeTab, 'all'> =>
    shownTests.some((row) => row.id === item.id) ? 'tests' : 'quiz';

  const moveTab = (delta: number) => {
    const at = PRACTICE_TABS.findIndex((row) => row.id === tab);
    const next = PRACTICE_TABS[(at + delta + PRACTICE_TABS.length) % PRACTICE_TABS.length];
    if (!next) return;
    onTabChange(next.id);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-title text-lantern-text">Practice</h2>
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((was) => !was)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-lantern-text px-3 py-2 text-body font-semibold text-lantern-surface hover:opacity-90"
          >
            Create
            <AppIcon name="chevron-down" size={16} aria-hidden="true" />
          </button>
          {createOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-lantern-border bg-lantern-surface shadow-lantern-md"
            >
              {CREATE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateOpen(false);
                    onCreate(item.id);
                  }}
                  className="flex min-h-[44px] w-full items-center px-3 py-2 text-left text-body hover:bg-lantern-background-secondary"
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Practice"
        className="flex items-center gap-1 border-b border-lantern-border"
      >
        {PRACTICE_TABS.map((row, position) => {
          const on = row.id === tab;
          return (
            <button
              key={row.id}
              ref={(node) => {
                tabRefs.current[position] = node;
              }}
              type="button"
              role="tab"
              id={`practice-tab-${row.id}`}
              aria-selected={on}
              aria-controls="practice-tabpanel"
              tabIndex={on ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  moveTab(1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  moveTab(-1);
                }
              }}
              onClick={() => onTabChange(row.id)}
              className={`min-h-[44px] border-b-2 px-3 text-body font-medium transition-colors ${
                on
                  ? 'border-lantern-text text-lantern-text'
                  : 'border-transparent text-lantern-text-secondary hover:text-lantern-text'
              }`}
            >
              {row.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-caption font-medium text-lantern-text-secondary">
          <AppIcon name="library" size={14} aria-hidden="true" />
          {setLabel}
        </span>
        <ViewModeToggle value={view} onChange={setView} label="Practice" />
        <div className="min-w-[12rem] flex-1">
          <LibrarySearchBox
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            filterLabel="quizzes and tests in this set"
          />
        </div>
      </div>

      <div
        id="practice-tabpanel"
        role="tabpanel"
        aria-labelledby={`practice-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {view === 'grid' ? (
          <StudySetArtifactLibrary
            title={PRACTICE_TABS.find((row) => row.id === tab)?.label ?? 'All'}
            empty="Make a quiz or a test from the materials in this set."
            items={body}
            onOpen={(id) => {
              const item = body.find((row) => row.id === id);
              onOpen(item ? libraryOf(item) : 'quiz', id);
            }}
            onCreate={tab === 'tests' ? () => onCreate('test') : () => onCreate('quiz')}
            createLabel={tab === 'tests' ? 'New test' : 'New quiz'}
            {...(renderItemMenu ? { renderItemMenu } : {})}
          />
        ) : body.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">
            Make a quiz or a test from the materials in this set.
          </p>
        ) : (
          <ul className="divide-y divide-lantern-border overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface">
            {body.map((item) => (
              <li key={item.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onOpen(libraryOf(item), item.id)}
                  className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-lantern-background-secondary"
                >
                  <AppIcon
                    name={item.icon}
                    size={16}
                    aria-hidden="true"
                    className={FEATURE_INK_TEXT[item.feature]}
                  />
                  <span className="min-w-0 flex-1 truncate text-body">{item.title}</span>
                  {item.meta ? (
                    <span className="shrink-0 text-caption text-lantern-text-tertiary">
                      {item.meta}
                    </span>
                  ) : null}
                </button>
                {renderItemMenu ? (
                  <div className="shrink-0 pr-2">{renderItemMenu(item)}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default PracticeHub;
