import React, { useEffect, useState } from 'react';
import type { Course, CourseTopic } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CoursePicker } from './CoursePicker';
import { TopicPicker } from './TopicPicker';
import { useAcademicStore } from '../../stores/academicStore';
import { courseLabel } from '../../utils/academicSetup';

export interface MoveToCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Course the item is currently filed under (null/undefined = unfiled). */
  currentCourseId?: string | null;
  /** Topic within `currentCourseId` (null/undefined = filed under no topic). */
  currentTopicId?: string | null;
  title?: string;
  description?: React.ReactNode;
  /**
   * Fires with the chosen course id (null to unfile) and the topic within it.
   * `topicId` is a second argument rather than part of an object so callers
   * that only file by course keep working unchanged. Resolves when the move has
   * been persisted.
   */
  onSubmit: (courseId: string | null, topicId: string | null) => void | Promise<void>;
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
  currentTopicId,
  title = 'Move to course',
  description,
  onSubmit,
  zIndexClass,
}) => {
  const [course, setCourse] = useState<Course | string | null>(currentCourseId ?? null);
  const [topic, setTopic] = useState<CourseTopic | string | null>(currentTopicId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const loaded = useAcademicStore((s) => s.loaded);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);

  useEffect(() => {
    if (!isOpen) return;
    setCourse(currentCourseId ?? null);
    setTopic(currentTopicId ?? null);
    setBusy(false);
    setError(null);
    if (!loaded) void loadMyCourses();
  }, [isOpen, currentCourseId, currentTopicId, loaded, loadMyCourses]);

  const selectedId = typeof course === 'string' ? course : course?.id ?? null;
  const selectedTopicId = typeof topic === 'string' ? topic : topic?.id ?? null;
  const unchanged =
    (selectedId || null) === (currentCourseId || null) &&
    (selectedTopicId || null) === (currentTopicId || null);
  const current = currentCourseId ? resolveCourse(currentCourseId) : null;

  const submit = async (courseId: string | null, topicId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(courseId, topicId);
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
      <CoursePicker
        value={course}
        onChange={(c) => {
          setCourse(c);
          setTopic(null);
        }}
        label="Course"
        placeholder="Choose a course"
      />
      <TopicPicker
        className="mt-3"
        courseId={selectedId}
        value={topic}
        onChange={(t) => setTopic(t)}
        label={<>Topic <span className="text-lantern-text-tertiary font-normal">(optional)</span></>}
        placeholder="Where it sits in the syllabus"
      />
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
            onClick={() => void submit(null, null)}
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
          onClick={() => void submit(selectedId, selectedId ? selectedTopicId : null)}
          className="min-h-[44px]"
        >
          {busy ? 'Moving…' : 'Move'}
        </Button>
      </div>
    </Modal>
  );
};

export default MoveToCourseModal;
