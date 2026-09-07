import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ClassMaterial, Course } from '@lantern/shared/types';
import { Card } from '../ui';
import { fetchOfficialClassMaterials } from '../../services/api';

interface ClassOfficialMaterialsProps {
  courseId?: string | null;
}

export function ClassOfficialMaterials({ courseId }: ClassOfficialMaterialsProps) {
  const [items, setItems] = useState<(ClassMaterial & { classTitle?: string; course?: Course })[]>(
    []
  );
  const [openId, setOpenId] = useState<string | null>(null);

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
          </View>
        );
      })}
    </Card>
  );
}
