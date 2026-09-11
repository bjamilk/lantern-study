import React, { useEffect, useState } from 'react';
import { Deck, Flashcard, TestSessionData, StudySessionData, PausedSessionSummary } from '../types';
import {
  isCalendarNote,
  materialsForStudySet,
  studySetLabel,
  formatCourseMaterialCounts,
  courseWorkspaceLabel,
} from '@lantern/shared';
import { ScreenHeader, Card, Button, FeatureDisc } from './ui';
import SavedSessionsList from './SavedSessionsList';
import { AppIcon } from './ui/AppIcon';
import { useAcademicStore } from '../stores/academicStore';
import { useNotesStore } from '../stores/notesStore';
import { useStudySetStore } from '../stores/studySetStore';
import { useToastStore } from '../stores/toastStore';
import CreateStudySetModal from './study/CreateStudySetModal';

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

  useEffect(() => {
    void loadMyCourses();
    void loadSets().catch(() => undefined);
  }, [loadMyCourses, loadSets]);

  const hasPausedSession = Boolean(activeTestSession || activeStudySession);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-lantern-background text-lantern-text">
      <div className="px-4 md:px-6 lg:px-8 py-6 w-full space-y-6">
        <ScreenHeader
          title="Study"
          subtitle="A study set houses every activity you start — notes, quizzes, cards, lectures and games."
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
                Open a set to study, or name a new one.
              </p>
            </div>
            {onOpenStudySet ? (
              <Button onClick={() => setCreateOpen(true)}>New study set</Button>
            ) : null}
          </div>
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
              {sets.map((set) => {
                const filedCourse = set.courseId ? resolveCourse(set.courseId) : null;
                return (
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => {
                      touchOpened(set.id);
                      onOpenStudySet?.(set.id);
                    }}
                    className="flex items-start gap-3 p-4 rounded-2xl border border-lantern-border bg-lantern-surface text-left hover:bg-lantern-background-secondary"
                  >
                    <FeatureDisc feature="notes" icon={<AppIcon name="albums" size={20} />} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold text-lantern-text truncate">
                        {studySetLabel(set)}
                      </span>
                      <span className="block text-caption text-lantern-text-secondary mt-1">
                        {filedCourse ? courseWorkspaceLabel(filedCourse) : 'Standalone'}
                        {' · '}
                        {formatCourseMaterialCounts({
                          notes: materialsForStudySet(notes, set.id).filter(
                            (note) => !isCalendarNote(note)
                          ).length,
                          decks: materialsForStudySet(decks, set.id).length,
                        })}
                      </span>
                    </span>
                  </button>
                );
              })}
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
    </div>
  );
};

export default StudyHubScreen;
