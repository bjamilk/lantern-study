import React, { useEffect, useState } from 'react';
import type { ClassMaterial, Course } from '@lantern/shared';
import { Button, Card } from '../ui';
import { copyClassMaterialToNotes, fetchOfficialClassMaterials } from '../../services/classes';

interface ClassOfficialMaterialsProps {
  courseId?: string | null;
  onOpenNote?: (noteId: string) => void;
  /** Skip the Library card chrome when this sits inside the course materials list. */
  embedded?: boolean;
}

/** Published lecturer materials for a course — Library and the course room. */
export const ClassOfficialMaterials: React.FC<ClassOfficialMaterialsProps> = ({
  courseId,
  onOpenNote,
  embedded = false,
}) => {
  const [items, setItems] = useState<(ClassMaterial & { classTitle?: string; course?: Course })[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOfficialClassMaterials(courseId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [courseId]);

  if (items.length === 0) return null;

  const body = (
    <>
      <p className="text-caption font-semibold uppercase tracking-wide text-lantern-text-secondary">
        From your lecturer
      </p>
      <p className="mt-1 text-caption text-lantern-text-secondary">
        {embedded
          ? 'Read-only class notes. Copy one into this course to edit it.'
          : 'These notes stay available after the class is archived. They are read-only — copy one into your notes to edit or share your own version.'}
      </p>
      {error ? <p className="mt-2 text-caption text-lantern-error">{error}</p> : null}
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
              {open ? (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={copyingId === item.id}
                    onClick={async (event) => {
                      event.stopPropagation();
                      setError(null);
                      setCopyingId(item.id);
                      try {
                        const copied = await copyClassMaterialToNotes(item.classId, item.id);
                        setCopiedId(item.id);
                        onOpenNote?.(copied.noteId);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Could not copy this lecture');
                      } finally {
                        setCopyingId(null);
                      }
                    }}
                  >
                    {copiedId === item.id ? 'Copied to my notes' : 'Copy to my notes'}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );

  if (embedded) {
    return <div className="mb-4">{body}</div>;
  }

  return (
    <Card padding="md" className="mb-3">
      {body}
    </Card>
  );
};
