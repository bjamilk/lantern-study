import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClassSection } from '@lantern/shared';
import { teachClassPath, teachNewClassPath } from '@lantern/shared/academic';
import { AcademicCapIcon } from '@heroicons/react/24/outline';
import { Button, Card, EmptyState, ScreenHeader } from '../ui';
import { fetchMyClasses } from '../../services/classes';

export const TeachHome: React.FC = () => {
  const navigate = useNavigate();
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
      {error ? <p className="text-body text-lantern-error">{error}</p> : null}
      {loading ? <p className="text-body text-lantern-text-secondary">Loading classes…</p> : null}
      {!loading && classes.length === 0 ? (
        <EmptyState
          icon={<AcademicCapIcon className="h-8 w-8" />}
          title="No classes yet"
          description="Create a class, show the QR in the lecture hall, and students join on Lantern the same day."
          actionLabel="Create a class"
          onAction={() => navigate(teachNewClassPath())}
        />
      ) : null}
      <ul className="flex flex-col gap-3">
        {classes.map((cls) => (
          <li key={cls.id}>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => navigate(teachClassPath(cls.id))}
            >
              <Card padding="md" className="hover:border-lantern-primary/40 transition-colors">
                <p className="text-caption text-lantern-text-secondary">
                  {cls.course.code} · {cls.academicYear}
                </p>
                <p className="text-title font-semibold text-lantern-text">{cls.title}</p>
                <p className="text-caption text-lantern-text-secondary mt-1">
                  {cls.memberCount} member{cls.memberCount === 1 ? '' : 's'}
                  {cls.joinCode ? ` · code ${cls.joinCode}` : ''}
                </p>
              </Card>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
