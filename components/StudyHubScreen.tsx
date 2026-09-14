import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Deck, Flashcard, TestSessionData, StudySessionData, PausedSessionSummary } from '../types';
import {
  isCalendarNote,
  isLectureNote,
  materialsForStudySet,
  pickRecommendedTopic,
  studySetLabel,
  studySetPlanProgress,
  studySetProgressPercent,
  topicsFromReadingNotes,
  sortStudySets,
  STUDY_SET_SORTS,
  type StudySetSortId,
} from '@lantern/shared';
import { ScreenHeader, Card, Button, Skeleton, ConfirmDialog } from './ui';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/Menu';
import SavedSessionsList from './SavedSessionsList';
import { AppIcon } from './ui/AppIcon';
import { useAcademicStore } from '../stores/academicStore';
import { useNotesStore } from '../stores/notesStore';
import { useStudySetStore } from '../stores/studySetStore';
import { useToastStore } from '../stores/toastStore';
import CreateStudySetModal from './study/CreateStudySetModal';
import { StudySetSettingsModal } from './study/StudySetSettingsModal';
import { StudyWorkspaceBar } from './study/StudyWorkspaceBar';
import { StudySetCard } from './study/StudySetCard';
import type { StudySet } from '../types';

interface StudyHubScreenProps {
  dueCardsCount: number;
  decks: Deck[];
  flashcards?: Flashcard[];
  onStartDueReview: () => void;
  onOpenLibrary: () => void;
  onOpenAITools: () => void;
  onSelectDeck: (deck: Deck) => void;
  onStartLearn?: (deck: Deck) => void;
  onStartReview?: (deckId: string) => void;
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
  pausedSessions?: PausedSessionSummary[];
  onResumePausedSession?: (sessionId: string) => void;
  onAbandonPausedSession?: (sessionId: string) => void;
  recentTestCount?: number;
  onViewRecentTests?: () => void;
  onOpenFlashcards?: () => void;
  onOpenTests?: () => void;
  onRecordLecture?: () => void;
  noteCount?: number;
  onOpenCourse?: (courseId: string) => void;
  onOpenStudySet?: (studySetId: string) => void;
  onOpenImport?: () => void;
}

/** The dashed tile, first in the grid — the reference puts "new" before "old". */
const CreateSetTile: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex min-h-[11rem] flex-col items-start justify-center gap-2 rounded-2xl border border-dashed border-lantern-border p-4 text-left transition-colors hover:border-lantern-text-tertiary hover:bg-lantern-background-secondary"
  >
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] bg-lantern-background-secondary text-lantern-text">
      <AppIcon name="add" size={20} />
    </span>
    <span className="block text-body font-semibold text-lantern-text">Create study set</span>
    <span className="block text-caption text-lantern-text-secondary">
      Name a set, then add materials.
    </span>
  </button>
);

/**
 * What `/study` shows while the sets query is in flight.
 *
 * This is not decoration. Before it existed the screen branched on
 * `sets.length === 0`, which is TRUE for the whole first paint of a returning
 * student's session — so the tab that holds their four sets greeted them with
 * an empty state and no toolbar, and the real content appeared a frame later.
 * "You have nothing" is the worst possible lie to tell on first paint, so the
 * empty state is now reachable only from `loaded && sets.length === 0`.
 */
const StudyHubSkeleton: React.FC = () => (
  <div className="space-y-4" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading your study sets…</span>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Skeleton className="h-11 flex-1" />
      <Skeleton className="h-11 w-40" />
      <Skeleton className="h-11 w-36" />
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="space-y-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4"
        >
          <div className="flex items-start gap-3">
            <Skeleton variant="rectangular" className="h-10 w-10 rounded-[14px]" />
            <Skeleton variant="text" className="mt-1 w-1/2" />
          </div>
          <Skeleton variant="text" className="w-2/3" />
          <Skeleton variant="text" className="w-1/3" />
        </div>
      ))}
    </div>
  </div>
);

export const StudyHubScreen: React.FC<StudyHubScreenProps> = ({
  decks,
  activeTestSession,
  activeStudySession,
  onResumeSession,
  pausedSessions = [],
  onResumePausedSession,
  onAbandonPausedSession,
  onOpenStudySet,
  onOpenLibrary,
}) => {
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const notes = useNotesStore((s) => s.notes);
  const loadSets = useStudySetStore((s) => s.loadSets);
  const createSet = useStudySetStore((s) => s.createSet);
  const updateSet = useStudySetStore((s) => s.updateSet);
  const touchOpened = useStudySetStore((s) => s.touchOpened);
  const sets = useStudySetStore((s) => s.sets);
  const setsLoaded = useStudySetStore((s) => s.loaded);
  const setsLoadError = useStudySetStore((s) => s.loadError);
  const showToast = useToastStore((s) => s.showToast);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StudySetSortId>('lastAccessed');
  const [editing, setEditing] = useState<StudySet | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StudySet | null>(null);
  const lastOpenedId = useStudySetStore((s) => s.lastOpenedId);
  const removeSet = useStudySetStore((s) => s.removeSet);
  const folders = useStudySetStore((s) => s.folders);
  const loadFolders = useStudySetStore((s) => s.loadFolders);
  const createFolder = useStudySetStore((s) => s.createFolder);
  const [folderId, setFolderId] = useState<string | 'all'>('all');
  const [folderTitle, setFolderTitle] = useState('');
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadMyCourses();
    void loadSets().catch(() => undefined);
    void loadFolders().catch(() => undefined);
  }, [loadFolders, loadMyCourses, loadSets]);

  useEffect(() => {
    if (folderFormOpen) folderInputRef.current?.focus();
  }, [folderFormOpen]);

  const hasPausedSession = Boolean(activeTestSession || activeStudySession);
  const visibleSets = useMemo(() => {
    const filtered = sets.filter((set) => {
      const matchesQuery = studySetLabel(set).toLowerCase().includes(query.trim().toLowerCase());
      const matchesFolder = folderId === 'all' || set.folderId === folderId;
      return matchesQuery && matchesFolder;
    });
    return sortStudySets(filtered, sort, lastOpenedId);
  }, [folderId, lastOpenedId, query, sets, sort]);

  const sortLabel =
    STUDY_SET_SORTS.find((item) => item.id === sort)?.label ?? STUDY_SET_SORTS[0]?.label ?? 'Sort';

  // `loaded` is the only honest signal that "you have no sets" is true.
  // A failed list request used to leave `loaded` false, so this tab stayed
  // on the skeleton after a 429 or a dropped proxy — "stuck on refresh".
  const showEmptyState = setsLoaded && sets.length === 0;
  const showLoadError = Boolean(setsLoadError) && sets.length === 0 && !setsLoaded;
  const showSkeleton = !setsLoaded && sets.length === 0 && !setsLoadError;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-lantern-background text-lantern-text">
      <StudyWorkspaceBar
        active="study"
        onSelect={(section) => {
          if (section === 'library') onOpenLibrary();
        }}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 md:px-6 lg:px-8 py-6 w-full space-y-6">
        <ScreenHeader
          title="Which study set are you working on today?"
          subtitle="Search, sort, or start a new set. Every tool you open stays inside it."
        />

        {pausedSessions.length > 0 && onResumePausedSession && onAbandonPausedSession ? (
          <SavedSessionsList
            sessions={pausedSessions}
            onResume={onResumePausedSession}
            onDiscard={onAbandonPausedSession}
            compact
          />
        ) : hasPausedSession && onResumeSession ? (
          <Card padding="md">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-heading text-lantern-text">
                  {activeTestSession ? 'Test paused' : 'Study session paused'}
                </p>
                <p className="text-caption text-lantern-text-secondary">
                  Pick up where you left off.
                </p>
              </div>
              <Button variant="accent" onClick={onResumeSession}>
                <AppIcon name="play" size={16} />
                Resume
              </Button>
            </div>
          </Card>
        ) : null}

        {showSkeleton ? (
          <StudyHubSkeleton />
        ) : showLoadError ? (
          <div className="rounded-2xl border border-dashed border-lantern-border px-6 py-12 text-center">
            <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] bg-lantern-background-secondary text-lantern-text">
              <AppIcon name="refresh" size={24} />
            </span>
            <p className="text-heading text-lantern-text">Could not load your study sets</p>
            <p className="mt-1 text-body text-lantern-text-secondary">
              {/too many requests/i.test(setsLoadError ?? '')
                ? 'The app asked for them too quickly. Wait a moment and try again.'
                : 'Check your connection and try again.'}
            </p>
            <div className="mt-4 flex justify-center">
              <Button
                onClick={() => {
                  void loadSets({ force: true }).catch(() => undefined);
                }}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : showEmptyState ? (
          <div className="rounded-2xl border border-dashed border-lantern-border px-6 py-12 text-center">
            <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] bg-lantern-background-secondary text-lantern-text">
              <AppIcon name="add" size={24} />
            </span>
            <p className="text-heading text-lantern-text">Create study set</p>
            <p className="mt-1 text-body text-lantern-text-secondary">
              Name a set to organize your materials. You can file it under a course later.
            </p>
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setCreateOpen(true)}>Create study set</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Toolbar: search, a styled sort menu (the native select it replaces
                was the one unstyled control on the page), folders, and the CTA. */}
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search study sets</span>
                <AppIcon
                  name="search"
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search study sets…"
                  className="min-h-[44px] w-full rounded-full border border-lantern-border bg-lantern-surface pl-9 pr-3 text-body"
                />
              </label>

              <Menu>
                <MenuTrigger
                  aria-label={`Sort study sets. Current: ${sortLabel}`}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface px-4 text-caption text-lantern-text"
                >
                  <AppIcon name="swap-horizontal" size={16} />
                  {sortLabel}
                  <AppIcon name="chevron-down" size={14} />
                </MenuTrigger>
                <MenuContent align="start">
                  {STUDY_SET_SORTS.map((item) => (
                    <MenuItem
                      key={item.id}
                      onSelect={() => setSort(item.id)}
                      icon={
                        <AppIcon
                          name="checkmark"
                          size={16}
                          className={sort === item.id ? '' : 'opacity-0'}
                        />
                      }
                    >
                      {item.label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>

              <Button onClick={() => setCreateOpen(true)}>
                <AppIcon name="add" size={16} />
                Create study set
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFolderId('all')}
                aria-pressed={folderId === 'all'}
                className={`min-h-[36px] rounded-full border px-3 text-caption ${
                  folderId === 'all'
                    ? 'border-transparent bg-lantern-primary-fill text-white'
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                All
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setFolderId(folder.id)}
                  aria-pressed={folderId === folder.id}
                  className={`min-h-[36px] rounded-full border px-3 text-caption ${
                    folderId === folder.id
                      ? 'border-transparent bg-lantern-primary-fill text-white'
                      : 'border-lantern-border text-lantern-text-secondary'
                  }`}
                >
                  {folder.title}
                </button>
              ))}
              {/* A creation FORM does not belong in permanent chrome — it read as
                  an empty, unlabelled text box sitting among the filter chips. */}
              {folderFormOpen ? (
                <form
                  className="flex min-w-[14rem] items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = folderTitle.trim();
                    if (!title) return;
                    void createFolder(title)
                      .then(() => {
                        setFolderTitle('');
                        setFolderFormOpen(false);
                      })
                      .catch((error) => {
                        showToast(
                          error instanceof Error ? error.message : 'Could not create that folder.',
                          'error'
                        );
                      });
                  }}
                >
                  <input
                    ref={folderInputRef}
                    value={folderTitle}
                    onChange={(event) => setFolderTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setFolderTitle('');
                        setFolderFormOpen(false);
                      }
                    }}
                    aria-label="Folder name"
                    placeholder="Folder name"
                    className="min-h-[36px] flex-1 rounded-full border border-lantern-border bg-lantern-surface px-3 text-caption"
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    Add
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFolderTitle('');
                      setFolderFormOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setFolderFormOpen(true)}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-dashed border-lantern-border px-3 text-caption text-lantern-text-secondary hover:text-lantern-text"
                >
                  <AppIcon name="folder-add" size={14} />
                  Create folder
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <CreateSetTile onClick={() => setCreateOpen(true)} />
              {visibleSets.map((set) => {
                const setNotes = materialsForStudySet(notes, set.id).filter(
                  (note) => !isCalendarNote(note)
                );
                const setDecks = materialsForStudySet(decks, set.id);
                const lectures = setNotes.filter(isLectureNote).length;
                // The hub holds no server plan, so topics come from the set's own
                // reading notes — the same fallback the set room uses when a plan
                // has not been generated. No plan, no bar: an invented percentage
                // is worse than none.
                const topics =
                  setNotes.length > 0 ? topicsFromReadingNotes(set.id, setNotes).topics : [];
                const percent =
                  topics.length > 0
                    ? studySetProgressPercent(studySetPlanProgress(topics))
                    : null;
                return (
                  <StudySetCard
                    key={set.id}
                    studySet={set}
                    counts={{
                      materials: setNotes.length,
                      lectures,
                      decks: setDecks.length,
                    }}
                    progressPercent={percent}
                    currentTopic={pickRecommendedTopic(topics, set.mode || 'standard')}
                    folders={folders}
                    onOpen={() => {
                      touchOpened(set.id);
                      onOpenStudySet?.(set.id);
                    }}
                    onEdit={() => setEditing(set)}
                    onMoveToFolder={(nextFolderId) => {
                      void updateSet(set.id, { folderId: nextFolderId }).catch((error) => {
                        showToast(
                          error instanceof Error ? error.message : 'Could not move that set.',
                          'error'
                        );
                      });
                    }}
                    onDelete={() => setPendingDelete(set)}
                  />
                );
              })}
              {visibleSets.length === 0 ? (
                <p className="text-caption text-lantern-text-secondary sm:col-span-2 xl:col-span-3">
                  No study sets match that search.
                </p>
              ) : null}
            </div>
          </div>
        )}
        </div>
      </div>
      <CreateStudySetModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          const created = await createSet(input);
          showToast('Study set created.', 'success');
          onOpenStudySet?.(created.id);
        }}
      />
      <StudySetSettingsModal
        isOpen={Boolean(editing)}
        studySet={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setEditing(null)}
        onDeleted={() => setEditing(null)}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        danger
        title="Delete this study set?"
        message={
          pendingDelete
            ? `"${studySetLabel(pendingDelete)}" and its plan are removed. Materials filed in it stay in your library.`
            : ''
        }
        confirmLabel="Delete set"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          void removeSet(target.id).catch((error) => {
            showToast(
              error instanceof Error ? error.message : 'Could not delete that set.',
              'error'
            );
          });
        }}
      />
    </div>
  );
};

export default StudyHubScreen;
