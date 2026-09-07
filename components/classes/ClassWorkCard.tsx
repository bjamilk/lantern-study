import React, { useEffect, useState } from 'react';
import type { ClassAssignment, Course } from '@lantern/shared';
import { Card, Button } from '../ui';
import { completeClassAssignment, fetchMyClassWork } from '../../services/classes';

/**
 * Assigned practice from lecturers — student dashboard.
 */
export const ClassWorkCard: React.FC = () => {
  const [items, setItems] = useState<(ClassAssignment & { classTitle?: string; course?: Course })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchMyClassWork()
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  const open = items.filter((row) => row.progress?.status !== 'completed');
  if (error || open.length === 0) return null;

  return (
    <Card padding="md" className="flex flex-col gap-3">
      <p className="text-body font-semibold text-lantern-text">Assigned by your lecturer</p>
      <ul className="flex flex-col gap-2">
        {open.slice(0, 5).map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-body text-lantern-text truncate">{row.title}</p>
              <p className="text-caption text-lantern-text-secondary">
                {row.classTitle || row.course?.code}
                {row.dueAt ? ` · due ${new Date(row.dueAt).toLocaleDateString()}` : ''}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                await completeClassAssignment(row.classId, row.id);
                load();
              }}
            >
              Mark done
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
};
