import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClassSection } from '@lantern/shared';
import { classSubjectLine, teachClassPath, teachNewClassPath } from '@lantern/shared/academic';
import { AcademicCapIcon } from '@heroicons/react/24/outline';
import { Button, Card, EmptyState, ScreenHeader } from '../ui';
import { fetchMyClasses } from '../../services/classes';
import { TeachAffiliationForm } from './TeachAffiliationForm';
import { useAuthStore } from '../../stores/authStore';

export const TeachHome: React.FC = () => {
  const navigate = useNavigate();
  const institutionId = useAuthStore((s) => s.currentUser?.institutionId ?? null);
  const [classes, setClasses] = useState<ClassSection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMyClasses('instructor')
      .then((rows) => {
        if (!cancelled) setClasses(rows);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Could not load classes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openClasses = classes.filter((cls) => !cls.archivedAt);
  const archivedClasses = classes.filter((cls) => Boolean(cls.archivedAt));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-8">
      <ScreenHeader
        title="Your classes"
        subtitle="Invite students with a code. No Canvas or Google Classroom required."
        actions={
          <Button type="button" onClick={() => navigate(teachNewClassPath())}>
            New class
          </Button>
        }
      />
      {!institutionId ? <TeachAffiliationForm /> : null}
      {error ? <p className="text-body text-lantern-error">{error}</p> : null}
      {loading ? <p className="text-body text-lantern-text-secondary">Loading classes…</p> : null}
      {!loading && openClasses.length === 0 && archivedClasses.length === 0 ? (
        <EmptyState
          icon={<AcademicCapIcon className="h-8 w-8" />}
          title="No classes yet"
          description="Create a class for a whole subject or just one topic, show the QR in the hall, and students join on Lantern the same day. Archive it when the session ends so the next cohort gets a fresh roster."
          actionLabel="Create a class"
          onAction={() => navigate(teachNewClassPath())}
        />
      ) : null}
      <ClassList classes={openClasses} onOpen={(id) => navigate(teachClassPath(id))} />
      {archivedClasses.length > 0 ? (
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-lantern-text-secondary">
            Archived
          </p>
          <p className="text-caption text-lantern-text-secondary">
            Closed for new students. Their lecturer notes stay in Library.
          </p>
          <ClassList classes={archivedClasses} onOpen={(id) => navigate(teachClassPath(id))} archived />
        </div>
      ) : null}
    </div>
  );
};

const ClassList: React.FC<{
  classes: ClassSection[];
  onOpen: (id: string) => void;
  archived?: boolean;
}> = ({ classes, onOpen, archived }) => (
  <ul className="flex flex-col gap-3">
    {classes.map((cls) => (
      <li key={cls.id}>
        <button type="button" className="w-full text-left" onClick={() => onOpen(cls.id)}>
          <Card padding="md" className="hover:border-lantern-primary/40 transition-colors">
            <p className="text-caption text-lantern-text-secondary">
              {classSubjectLine(cls.course, cls.topic)} · {cls.academicYear}
              {archived ? ' · Archived' : ''}
            </p>
            <p className="text-title font-semibold text-lantern-text">{cls.title}</p>
            <p className="text-caption text-lantern-text-secondary mt-1">
              {cls.memberCount} member{cls.memberCount === 1 ? '' : 's'}
              {!archived && cls.joinCode ? ` · code ${cls.joinCode}` : ''}
            </p>
          </Card>
        </button>
      </li>
    ))}
  </ul>
);
