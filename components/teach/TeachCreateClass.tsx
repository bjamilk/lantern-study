import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Course } from '@lantern/shared';
import { currentAcademicYear, teachClassPath } from '@lantern/shared/academic';
import { Button, Input, ScreenHeader } from '../ui';
import { CoursePicker } from '../academic/CoursePicker';
import { createClass } from '../../services/classes';

export const TeachCreateClass: React.FC = () => {
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!course) {
      setError('Pick a course first');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createClass({
        courseId: course.id,
        title: title.trim() || undefined,
        academicYear: currentAcademicYear(),
        semester: course.semester ?? null,
      });
      navigate(teachClassPath(created.id), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the class');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 md:p-8">
      <ScreenHeader title="New class" subtitle="Students will join with a 6-character code. You can show a QR in the hall." />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <CoursePicker value={course} onChange={setCourse} label="Course" />
        <label className="flex flex-col gap-1">
          <span className="text-caption text-lantern-text-secondary">Class name (optional)</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="BIO 201 — Harmattan tutorial"
          />
        </label>
        {error ? <p className="text-body text-lantern-error">{error}</p> : null}
        <Button type="submit" disabled={saving || !course}>
          {saving ? 'Creating…' : 'Create class'}
        </Button>
      </form>
    </div>
  );
};
