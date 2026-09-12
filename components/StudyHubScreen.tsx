import React, { useEffect, useMemo, useState } from 'react';
import { Deck, Flashcard, TestSessionData, StudySessionData, PausedSessionSummary } from '../types';
import {
  isCalendarNote,
  isLectureNote,
  formatStudySetCardCounts,
  materialsForStudySet,
  studySetLabel,
  courseWorkspaceLabel,
  sortStudySets,
  STUDY_SET_SORTS,
  type StudySetSortId,
  STUDY_SET_TILE,
} from '@lantern/shared';
import { ScreenHeader, Card, Button, FeatureDisc } from './ui';
import SavedSessionsList from './SavedSessionsList';
import { AppIcon } from './ui/AppIcon';
import { useAcademicStore } from '../stores/academicStore';
import { useNotesStore } from '../stores/notesStore';
import { useStudySetStore } from '../stores/studySetStore';
import { useToastStore } from '../stores/toastStore';
import CreateStudySetModal from './study/CreateStudySetModal';
import { StudySetSettingsModal } from './study/StudySetSettingsModal';
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

export const StudyHubScreen: React.FC<StudyHubScreenProps> = ({
  decks,
  activeTestSession,
  activeStudySession,
  onResumeSession,
  pausedSessions = [],
  onResumePausedSession,
  onAbandonPausedSession,
  onOpenStudySet,
}) => {
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const notes = useNotesStore((s) => s.notes);
  const loadSets = useStudySetStore((s) => s.loadSets);
  const createSet = useStudySetStore((s) => s.createSet);
  const touchOpened = useStudySetStore((s) => s.touchOpened);
  const sets = useStudySetStore((s) => s.sets);
  const showToast = useToastStore((s) => s.showToast);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StudySetSortId>('lastAccessed');
  const [editing, setEditing] = useState<StudySet | null>(null);
  const lastOpenedId = useStudySetStore((s) => s.lastOpenedId);
  const removeSet = useStudySetStore((s) => s.removeSet);
  const folders = useStudySetStore((s) => s.folders);
  const loadFolders = useStudySetStore((s) => s.loadFolders);
  const createFolder = useStudySetStore((s) => s.createFolder);
  const [folderId, setFolderId] = useState<string | 'all'>('all');
  const [folderTitle, setFolderTitle] = useState('');

  useEffect(() => {
    void loadMyCourses();
    void loadSets().catch(() => undefined);
    void loadFolders().catch(() => undefined);
  }, [loadFolders, loadMyCourses, loadSets]);

  const hasPausedSession = Boolean(activeTestSession || activeStudySession);
  const visibleSets = useMemo(() => {
    const filtered = sets.filter((set) => {
      const matchesQuery = studySetLabel(set).toLowerCase().includes(query.trim().toLowerCase());
      const matchesFolder = folderId === 'all' || set.folderId === folderId;
      return matchesQuery && matchesFolder;
    });
    return sortStudySets(filtered, sort, lastOpenedId);
  }, [folderId, lastOpenedId, query, sets, sort]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-lantern-background text-lantern-text">
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

        <Card padding="lg">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-heading text-lantern-text">Your study sets</h2>
              <p className="text-caption text-lantern-text-secondary mt-1">
                Last accessed, recently created, or A–Z.
              </p>
            </div>
            {onOpenStudySet ? (
              <Button onClick={() => setCreateOpen(true)}>Create study set</Button>
            ) : null}
          </div>
          {sets.length > 0 || folders.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => setFolderId('all')}
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
                  className={`min-h-[36px] rounded-full border px-3 text-caption ${
                    folderId === folder.id
                      ? 'border-transparent bg-lantern-primary-fill text-white'
                      : 'border-lantern-border text-lantern-text-secondary'
                  }`}
                >
                  {folder.title}
                </button>
              ))}
              <form
                className="flex min-w-[12rem] flex-1 gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const title = folderTitle.trim();
                  if (!title) return;
                  void createFolder(title)
                    .then(() => setFolderTitle(''))
                    .catch((error) => {
                      showToast(error instanceof Error ? error.message : 'Could not create that folder.', 'error');
                    });
                }}
              >
                <input
                  value={folderTitle}
                  onChange={(event) => setFolderTitle(event.target.value)}
                  placeholder="Create folder"
                  className="min-h-[44px] flex-1 rounded-xl border border-lantern-border bg-lantern-surface px-3 text-body"
                />
                <Button type="submit" size="sm" variant="secondary">
                  Add
                </Button>
              </form>
            </div>
          ) : null}
          {sets.length > 0 ? (
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search study sets"
                className="flex-1 min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 text-body"
              />
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as StudySetSortId)}
                className="min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 text-caption"
              >
                {STUDY_SET_SORTS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {sets.length === 0 ? (
            <button
              type="button"
              onClick={() => onOpenStudySet && setCreateOpen(true)}
              className="w-full min-h-[10rem] rounded-2xl border border-dashed border-lantern-border px-6 py-8 text-center hover:bg-lantern-background-secondary"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-lantern-background-secondary text-lantern-text mb-3">
                <AppIcon name="add" size={24} />
              </span>
              <span className="block text-heading text-lantern-text">Create study set</span>
              <span className="block text-body text-lantern-text-secondary mt-1">
                Name a set to organize your materials. You can file it under a course later.
              </span>
            </button>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleSets.map((set) => {
                const filedCourse = set.courseId ? resolveCourse(set.courseId) : null;
                const setNotes = materialsForStudySet(notes, set.id).filter((note) => !isCalendarNote(note));
                const setDecks = materialsForStudySet(decks, set.id);
                const lectures = setNotes.filter(isLectureNote).length;
                return (
                  <div
                    key={set.id}
                    className="flex items-start gap-3 p-4 rounded-2xl border border-lantern-border bg-lantern-surface"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        touchOpened(set.id);
                        onOpenStudySet?.(set.id);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <FeatureDisc
                  feature={STUDY_SET_TILE.feature}
                  icon={<AppIcon name={STUDY_SET_TILE.icon} size={20} />}
                />
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-semibold text-lantern-text truncate">
                          {studySetLabel(set)}
                        </span>
                        <span className="block text-caption text-lantern-text-secondary mt-1">
                          {formatStudySetCardCounts({
                            notes: setNotes.length,
                            decks: setDecks.length,
                            lectures,
                          })}
                        </span>
                        <span className="block text-caption text-lantern-text-tertiary mt-1">
                          {set.lastStudiedAt
                            ? `Last studied ${new Date(set.lastStudiedAt).toLocaleDateString()}`
                            : filedCourse
                              ? courseWorkspaceLabel(filedCourse)
                              : 'Not studied yet'}
                          {setNotes[0]?.title ? ` · ${setNotes[0].title}` : ''}
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(set)}
                        className="text-caption text-lantern-primary-text hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void removeSet(set.id).catch((error) => {
                            showToast(error instanceof Error ? error.message : 'Could not delete that set.', 'error');
                          });
                        }}
                        className="text-caption text-lantern-error hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="min-h-[8rem] rounded-2xl border border-dashed border-lantern-border p-4 text-left hover:bg-lantern-background-secondary"
              >
                <span className="text-body font-semibold">Create study set</span>
                <span className="block text-caption text-lantern-text-secondary mt-1">
                  Name a set, then add materials.
                </span>
              </button>
            </div>
          )}
        </Card>
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
    </div>
  );
};

export default StudyHubScreen;
