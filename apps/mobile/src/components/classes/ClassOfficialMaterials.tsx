import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ClassMaterial, Course } from '@lantern/shared/types';
import { Card } from '../ui';
import { copyClassMaterialToNotes, fetchOfficialClassMaterials } from '../../services/api';

interface ClassOfficialMaterialsProps {
  courseId?: string | null;
  onOpenNote?: (noteId: string) => void;
  embedded?: boolean;
}

export function ClassOfficialMaterials({ courseId, onOpenNote, embedded = false }: ClassOfficialMaterialsProps) {
  const [items, setItems] = useState<(ClassMaterial & { classTitle?: string; course?: Course })[]>(
    []
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOfficialClassMaterials(courseId)
      .then((rows) => setItems(rows || []))
      .catch(() => setItems([]));
  }, [courseId]);

  if (items.length === 0) return null;

  return (
    <Card className="mb-3">
      <Text className="text-caption font-semibold uppercase tracking-wide text-lantern-text-secondary">
        From your lecturer
      </Text>
      <Text className="mt-1 text-caption text-lantern-text-secondary">
        {embedded
          ? 'Read-only class notes. Copy one into this course to edit it.'
          : 'These notes stay available after the class is archived. They are read-only — copy one into your notes to edit or share your own version.'}
      </Text>
      {error ? <Text className="mt-2 text-caption text-lantern-error">{error}</Text> : null}
      {items.slice(0, 8).map((item) => {
        const open = openId === item.id;
        return (
          <View key={item.id} className="mt-2">
            <Pressable onPress={() => setOpenId(open ? null : item.id)} accessibilityRole="button">
              <Text className="text-body font-medium text-lantern-text">{item.title}</Text>
              <Text className="text-caption text-lantern-text-secondary">
                {item.classTitle || item.course?.code} · {item.kind}
              </Text>
            </Pressable>
            {open && item.body ? (
              <Text className="mt-1 text-caption text-lantern-text-secondary">{item.body}</Text>
            ) : null}
            {open ? (
              <Pressable
                className="mt-2 self-start rounded-lg bg-lantern-background-secondary px-3 py-2"
                disabled={copyingId === item.id}
                onPress={async () => {
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
                accessibilityRole="button"
                accessibilityLabel="Copy lecturer notes into my notes"
              >
                <Text className="text-caption font-semibold text-lantern-text">
                  {copiedId === item.id ? 'Copied to my notes' : 'Copy to my notes'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
