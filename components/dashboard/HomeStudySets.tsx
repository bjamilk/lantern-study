import React, { useEffect, useState } from 'react';
import {
  courseWorkspaceLabel,
  isCalendarNote,
  isLectureNote,
  formatStudySetCardCounts,
  materialsForStudySet,
  studySetLabel,
  STUDY_SET_TILE,
} from '@lantern/shared';
import { Button, Card, FeatureDisc } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useAcademicStore } from '../../stores/academicStore';
import { useNotesStore } from '../../stores/notesStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';
import CreateStudySetModal from '../study/CreateStudySetModal';
import { SetCoverSquare } from '../study/SetRoomTile';

interface HomeStudySetsProps {
  onOpenStudySet?: (studySetId: string) => void;
  onOpenStudyHub?: () => void;
}

export const HomeStudySets: React.FC<HomeStudySetsProps> = ({
  onOpenStudySet,
  onOpenStudyHub,
}) => {
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const notes = useNotesStore((s) => s.notes);
  const decks = useFlashcardStore((s) => s.decks);
  const loadSets = useStudySetStore((s) => s.loadSets);
  const createSet = useStudySetStore((s) => s.createSet);
  const sets = useStudySetStore((s) => s.sets);
  const showToast = useToastStore((s) => s.showToast);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void loadMyCourses();
    void loadSets().catch(() => undefined);
  }, [loadMyCourses, loadSets]);

  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-title font-semibold text-lantern-text">Your study sets</h2>
          <p className="text-caption text-lantern-text-secondary mt-1">
            Continue from a set, or start a new one.
          </p>
        </div>
        {onOpenStudySet ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            New study set
          </Button>
        ) : null}
      </div>

      {sets.length === 0 ? (
        <Card padding="lg" className="rounded-2xl">
          <div className="flex items-start gap-4">
            <FeatureDisc
                  feature={STUDY_SET_TILE.feature}
                  icon={<AppIcon name={STUDY_SET_TILE.icon} size={20} />}
                />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-lantern-text">Level up your library</p>
              <p className="text-caption text-lantern-text-secondary mt-1">
                Name a set to keep notes and decks together. You can file it under a course later.
              </p>
              {onOpenStudySet ? (
                <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                  Create a study set
                </Button>
              ) : onOpenStudyHub ? (
                <Button size="sm" className="mt-3" onClick={onOpenStudyHub}>
                  Open Study
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sets.slice(0, 4).map((set) => {
            const filedCourse = set.courseId ? resolveCourse(set.courseId) : null;
            const setNotes = materialsForStudySet(notes, set.id).filter((note) => !isCalendarNote(note));
            const setDecks = materialsForStudySet(decks, set.id);
            const lectures = setNotes.filter(isLectureNote).length;
            const current = setNotes[0]?.title;
            return (
              <button
                key={set.id}
                type="button"
                onClick={() => onOpenStudySet?.(set.id)}
                className="rounded-2xl border border-lantern-border bg-lantern-surface p-5 text-left hover:bg-lantern-background-secondary/70 transition-colors"
              >
                {/* Home draws the set with the SAME square the hub card and
                    the room header draw it with, so a set a student gave a
                    picture is recognisable on the first screen they see. */}
                <SetCoverSquare
                  coverPath={set.coverPath}
                  fallback={
                    <FeatureDisc
                      feature={STUDY_SET_TILE.feature}
                      icon={<AppIcon name={STUDY_SET_TILE.icon} size={20} />}
                    />
                  }
                />
                <p className="mt-4 text-body font-semibold text-lantern-text truncate">
                  {studySetLabel(set)}
                </p>
                <p className="mt-1 text-caption text-lantern-text-secondary">
                  {formatStudySetCardCounts({
                    notes: setNotes.length,
                    decks: setDecks.length,
                    lectures,
                  })}
                </p>
                <p className="mt-1 text-caption text-lantern-text-tertiary">
                  {set.lastStudiedAt
                    ? `Last studied ${new Date(set.lastStudiedAt).toLocaleDateString()}`
                    : filedCourse
                      ? courseWorkspaceLabel(filedCourse)
                      : 'Not studied yet'}
                  {current ? ` · ${current}` : ''}
                </p>
              </button>
            );
          })}
          {onOpenStudySet ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-2xl border border-dashed border-lantern-border p-5 text-left hover:bg-lantern-background-secondary/70"
            >
              <span className="text-body font-semibold">Create another set</span>
              <span className="block text-caption text-lantern-text-secondary mt-1">
                Level up your library
              </span>
            </button>
          ) : null}
        </div>
      )}

      {sets.length > 4 && onOpenStudyHub ? (
        <button
          type="button"
          onClick={onOpenStudyHub}
          className="mt-3 text-caption font-medium text-lantern-primary-text hover:underline"
        >
          View all study sets
        </button>
      ) : null}

      {onOpenStudySet ? (
        <CreateStudySetModal
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            try {
              const created = await createSet(input);
              setCreateOpen(false);
              onOpenStudySet(created.id);
            } catch (error) {
              showToast(error instanceof Error ? error.message : 'Could not create the study set.', 'error');
            }
          }}
        />
      ) : null}
    </section>
  );
};

export default HomeStudySets;
