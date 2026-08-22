import React, { useEffect, useState } from 'react';
import type { Course } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CoursePicker } from './CoursePicker';
import { useAcademicStore } from '../../stores/academicStore';
import { courseLabel } from '../../utils/academicSetup';

export interface MoveToCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Course the item is currently filed under (null/undefined = unfiled). */
  currentCourseId?: string | null;
  title?: string;
  description?: React.ReactNode;
  /** Fires with the chosen course id, or null to unfile. Resolves when the move has been persisted. */
  onSubmit: (courseId: string | null) => void | Promise<void>;
  /** Stack above other dialogs (e.g. a deck's Manage menu). */
  zIndexClass?: string;
}

/**
 * "Move to course…" dialog shared by note rows, deck cards and the deck
 * detail menu (Phase 1 · B): CoursePicker + an explicit "Unfile" path so an
 * item can also be taken out of its course.
 */
export const MoveToCourseModal: React.FC<MoveToCourseModalProps> = ({
  isOpen,
  onClose,
  currentCourseId,
  title = 'Move to course',
  description,
  onSubmit,
  zIndexClass,
}) => {
  const [course, setCourse] = useState<Course | string | null>(currentCourseId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const loaded = useAcademicStore((s) => s.loaded);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);

  useEffect(() => {
    if (!isOpen) return;
    setCourse(currentCourseId ?? null);
    setBusy(false);
    setError(null);
    if (!loaded) void loadMyCourses();
  }, [isOpen, currentCourseId, loaded, loadMyCourses]);

  const selectedId = typeof course === 'string' ? course : course?.id ?? null;
  const unchanged = (selectedId || null) === (currentCourseId || null);
  const current = currentCourseId ? resolveCourse(currentCourseId) : null;

  const submit = async (courseId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(courseId);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not move. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!busy) onClose();
      }}
      ariaLabelledBy="move-to-course-title"
      maxWidthClass="max-w-sm"
      zIndexClass={zIndexClass}
    >
      <h2 id="move-to-course-title" className="text-lg font-bold text-lantern-text mb-1">
        {title}
      </h2>
      <p className="text-sm text-lantern-text-secondary mb-4">
        {description ||
          (current
            ? `Currently filed under ${courseLabel(current)}.`
            : 'Not filed under a course yet. Pick one from your courses or the catalogue.')}
      </p>
      <CoursePicker value={course} onChange={(c) => setCourse(c)} label="Course" placeholder="Choose a course" />
      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {currentCourseId ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void submit(null)}
            className="min-h-[44px] mr-auto"
          >
            Remove from course
          </Button>
        ) : null}
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose} className="min-h-[44px]">
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || unchanged || !selectedId}
          onClick={() => void submit(selectedId)}
          className="min-h-[44px]"
        >
          {busy ? 'Moving…' : 'Move'}
        </Button>
      </div>
    </Modal>
  );
};

export default MoveToCourseModal;
