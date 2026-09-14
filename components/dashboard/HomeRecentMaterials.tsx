import React, { useEffect } from 'react';
import {
  isCalendarNote,
  isLectureNote,
  notePreviewText,
  resumeKindPresentation,
} from '@lantern/shared';
import { Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { useNotesStore } from '../../stores/notesStore';
import { useStudyResumeStore } from '../../stores/studyResumeStore';
import { useStudySetStore } from '../../stores/studySetStore';

interface HomeRecentMaterialsProps {
  onOpenNote?: (noteId: string) => void;
  onOpenStudySet?: (studySetId: string) => void;
  /** Route navigation, so a recent activity reopens the activity itself. */
  onNavigatePath?: (path: string) => void;
}

export const HomeRecentMaterials: React.FC<HomeRecentMaterialsProps> = ({
  onOpenNote,
  onOpenStudySet,
  onNavigatePath,
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
            preview: notePreviewText(note.body),
            updatedAt: note.updatedAt || '',
          }));

  if (materials.length === 0) return null;

  return (
    <section>
      <h2 className="text-title font-semibold text-lantern-text mb-4">Recent materials</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {materials.map((item) => {
          const note = notes.find((row) => row.id === item.id);
          const lecture = item.kind === 'lecture' || (note ? isLectureNote(note) : false);
          // The LOCAL body first: the server's `preview` is a short field and
          // a stale one may still be a raw slice of a lesson note's JSON. The
          // full body types correctly ("Mastery plan · 6 steps"); the server
          // field is the fallback for a material this client has not loaded.
          const preview = notePreviewText(note?.body || item.preview);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (onOpenNote) onOpenNote(item.id);
                else if (item.studySetId) onOpenStudySet?.(item.studySetId);
              }}
              className="min-h-[11rem] rounded-2xl border border-lantern-border bg-lantern-surface text-left overflow-hidden hover:bg-lantern-background-secondary"
            >
              <div className={`h-24 px-3 py-3 ${lecture ? FEATURE_TINT_BG.recording : 'bg-lantern-background-secondary'}`}>
                {lecture ? (
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-lantern-surface ${FEATURE_INK_TEXT.recording}`}>
                    <AppIcon name="mic" size={20} />
                  </span>
                ) : (
                  <p className="text-caption text-lantern-text-secondary line-clamp-4">
                    {preview || 'Untitled note'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <AppIcon name={resumeKindPresentation(lecture ? 'lecture' : 'note').icon} size={16} />
                <span className="text-body font-semibold truncate">{item.title}</span>
              </div>
            </button>
          );
        })}
      </div>
      {resume.recentActivities.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {resume.recentActivities.slice(0, 3).map((activity) => {
            const quiz = activity.kind === 'quiz' || activity.kind === 'test';
            // One registry row per kind, so a recap wears headphones and a
            // lesson a mortarboard instead of every non-card falling to a page.
            const { icon, feature } = resumeKindPresentation(activity.kind);
            return (
              <Card key={activity.href} padding="none" className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    // The tile promises the activity, not the set it lives in.
                    if (activity.href && onNavigatePath) onNavigatePath(activity.href);
                    else onOpenStudySet?.(activity.studySetId);
                  }}
                  className="w-full text-left"
                >
                  <div className={`h-20 px-3 py-3 ${FEATURE_TINT_BG[feature]} ${FEATURE_INK_TEXT[feature]}`}>
                    {quiz ? (
                      <p className="text-caption line-clamp-3">{activity.title}</p>
                    ) : (
                      <AppIcon name={icon} size={22} />
                    )}
                  </div>
                  <div className="px-3 py-3">
                    <p className="text-caption uppercase text-lantern-text-secondary">{activity.kind}</p>
                    <p className="text-body font-semibold truncate">{activity.title}</p>
                  </div>
                </button>
              </Card>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

export default HomeRecentMaterials;
