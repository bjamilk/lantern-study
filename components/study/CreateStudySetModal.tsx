import React, { useEffect, useState } from 'react';
import { isValidStudySetTitle, normalizeStudySetTitle, STUDY_SET_TITLE_MAX } from '@lantern/shared';
import type { Course } from '../../types';
import { Button } from '../ui';
import { Input } from '../ui/Input';
import Modal from '../ui/Modal';
import { CoursePicker } from '../academic/CoursePicker';

interface CreateStudySetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; courseId?: string | null }) => Promise<void> | void;
}

export const CreateStudySetModal: React.FC<CreateStudySetModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState<Course | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setCourse(null);
    setSaving(false);
    setError(null);
  }, [isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = normalizeStudySetTitle(title);
    if (!isValidStudySetTitle(next)) {
      setError(`Name the set in ${STUDY_SET_TITLE_MAX} characters or fewer.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({ title: next, courseId: course?.id ?? null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that study set.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="create-study-set-title" maxWidthClass="max-w-md">
      <h2 id="create-study-set-title" className="text-heading font-bold text-lantern-text mb-1">
        New study set
      </h2>
      <p className="text-caption text-lantern-text-secondary mb-4">
        Name it first. Filing under a course is optional.
      </p>
      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        <Input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Midterm review"
          maxLength={STUDY_SET_TITLE_MAX}
          aria-label="Study set name"
        />
        <CoursePicker
          value={course}
          compact
          clearable
          label="Course (optional)"
          hint="Leave this empty to keep the set standalone."
          onChange={setCourse}
        />
        {error ? <p className="text-caption text-lantern-error">{error}</p> : null}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px]">
            Cancel
          </Button>
          <Button type="submit" disabled={!normalizeStudySetTitle(title) || saving} className="min-h-[44px]">
            {saving ? 'Creating…' : 'Create set'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateStudySetModal;
