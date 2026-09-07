import React, { useEffect, useState } from 'react';
import type { ClassMaterial, Course } from '@lantern/shared';
import { Card } from '../ui';
import { fetchOfficialClassMaterials } from '../../services/classes';

interface ClassOfficialMaterialsProps {
  courseId?: string | null;
}

/** Library callout: published lecturer materials for the selected course. */
export const ClassOfficialMaterials: React.FC<ClassOfficialMaterialsProps> = ({ courseId }) => {
  const [items, setItems] = useState<(ClassMaterial & { classTitle?: string; course?: Course })[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetchOfficialClassMaterials(courseId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [courseId]);

  if (items.length === 0) return null;

  return (
    <Card padding="md" className="mb-3">
      <p className="text-caption font-semibold uppercase tracking-wide text-lantern-text-secondary">
        From your lecturer
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {items.slice(0, 8).map((item) => {
          const open = openId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <p className="text-body font-medium text-lantern-text">{item.title}</p>
                <p className="text-caption text-lantern-text-secondary">
                  {item.classTitle || item.course?.code} · {item.kind}
                </p>
              </button>
              {open && item.body ? (
                <p className="mt-2 whitespace-pre-wrap text-caption text-lantern-text-secondary">
                  {item.body}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
