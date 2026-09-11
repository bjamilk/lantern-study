import React, { useEffect } from 'react';
import { isCalendarNote, isLectureNote } from '@lantern/shared';
import { Card, FeatureDisc } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useNotesStore } from '../../stores/notesStore';
import { useStudyResumeStore } from '../../stores/studyResumeStore';
import { useStudySetStore } from '../../stores/studySetStore';

interface HomeRecentMaterialsProps {
  onOpenNote?: (noteId: string) => void;
  onOpenStudySet?: (studySetId: string) => void;
}

export const HomeRecentMaterials: React.FC<HomeRecentMaterialsProps> = ({
  onOpenNote,
  onOpenStudySet,
}) => {
  const notes = useNotesStore((s) => s.notes);
  const resume = useStudyResumeStore();
  const lastOpenedId = useStudySetStore((s) => s.lastOpenedId);

  useEffect(() => {
    void resume.loadResume();
  }, [resume.loadResume]);

  const materials =
    resume.recentMaterials.length > 0
      ? resume.recentMaterials
      : notes
          .filter((note) => !isCalendarNote(note) && note.studySetId)
          .slice(0, 8)
          .map((note) => ({
            id: note.id,
            title: note.title || 'Untitled note',
            studySetId: note.studySetId || lastOpenedId || '',
            kind: (isLectureNote(note) ? 'lecture' : 'note') as 'note' | 'lecture',
            href: note.id,
            updatedAt: note.updatedAt || '',
          }));

  if (materials.length === 0) return null;

  return (
    <section>
      <h2 className="text-title font-semibold text-lantern-text mb-4">Recent materials</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {materials.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (onOpenNote) onOpenNote(item.id);
              else if (item.studySetId) onOpenStudySet?.(item.studySetId);
            }}
            className="min-w-[14rem] max-w-[16rem] rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left hover:bg-lantern-background-secondary"
          >
            <FeatureDisc
              feature={item.kind === 'lecture' ? 'recording' : 'notes'}
              icon={<AppIcon name={item.kind === 'lecture' ? 'mic' : 'document-text'} size={18} />}
            />
            <p className="mt-3 text-body font-semibold truncate">{item.title}</p>
            <p className="text-caption text-lantern-text-secondary capitalize">{item.kind}</p>
          </button>
        ))}
      </div>
      {resume.recentActivities.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {resume.recentActivities.slice(0, 3).map((activity) => (
            <Card
              key={activity.href}
              padding="md"
              className={
                activity.kind === 'cards'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30'
                  : activity.kind === 'recap'
                    ? 'bg-violet-50 dark:bg-violet-950/30'
                    : 'bg-sky-50 dark:bg-sky-950/30'
              }
            >
              <button
                type="button"
                onClick={() => onOpenStudySet?.(activity.studySetId)}
                className="w-full text-left"
              >
                <p className="text-caption uppercase text-lantern-text-secondary">{activity.kind}</p>
                <p className="text-body font-semibold truncate">{activity.title}</p>
              </button>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default HomeRecentMaterials;
