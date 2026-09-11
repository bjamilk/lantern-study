import React, { useEffect, useMemo, useState } from 'react';
import { courseWorkspaceLabel } from '@lantern/shared';
import { useAcademicStore } from '../../stores/academicStore';
import { Card, FeatureDisc } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { readWorkspaceRecents } from '../../utils/workspaceRecents';

interface WorkspaceJumpBackProps {
  onOpen: (courseId: string) => void;
}

export const WorkspaceJumpBack: React.FC<WorkspaceJumpBackProps> = ({ onOpen }) => {
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const myCourses = useAcademicStore((s) => s.myCourses);
  const [openedAt, setOpenedAt] = useState(0);

  useEffect(() => {
    void loadMyCourses();
    setOpenedAt(Date.now());
  }, [loadMyCourses]);

  const recents = useMemo(() => readWorkspaceRecents().slice(0, 4), [openedAt, myCourses.length]);

  if (recents.length === 0) return null;

  return (
    <Card padding="md">
      <h2 className="text-label uppercase text-lantern-text-secondary mb-3">Jump back in</h2>
      <div className="space-y-1">
        {recents.map((row) => {
          const course = resolveCourse(row.courseId);
          const label = course
            ? courseWorkspaceLabel(course)
            : 'Course';
          return (
            <button
              key={row.courseId}
              type="button"
              onClick={() => onOpen(row.courseId)}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-lantern-background-secondary text-left"
            >
              <FeatureDisc feature="notes" icon={<AppIcon name="library" size={16} />} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-lantern-text truncate">{label}</span>
                <span className="block text-caption text-lantern-text-secondary">Open workspace</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
};

export default WorkspaceJumpBack;
