import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { ClassAssignment, Course } from '@lantern/shared/types';
import { Button, Card } from '../ui';
import { completeClassAssignment, fetchMyClassWork } from '../../services/api';

export function ClassWorkCard() {
  const [items, setItems] = useState<(ClassAssignment & { classTitle?: string; course?: Course })[]>(
    []
  );

  const load = useCallback(() => {
    fetchMyClassWork()
      .then((rows) => setItems(rows || []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = items.filter((row) => row.progress?.status !== 'completed');
  if (open.length === 0) return null;

  return (
    <Card className="mb-3">
      <Text className="text-body font-semibold text-lantern-text mb-2">Assigned by your lecturer</Text>
      {open.slice(0, 5).map((row) => (
        <View key={row.id} className="flex-row items-center gap-2 py-2 border-t border-lantern-border">
          <View className="flex-1 min-w-0">
            <Text className="text-body text-lantern-text" numberOfLines={1}>
              {row.title}
            </Text>
            <Text className="text-caption text-lantern-text-secondary">
              {row.classTitle || row.course?.code}
              {row.dueAt ? ` · due ${new Date(row.dueAt).toLocaleDateString()}` : ''}
            </Text>
          </View>
          <Button
            size="sm"
            onPress={async () => {
              await completeClassAssignment(row.classId, row.id);
              load();
            }}
          >
            Mark done
          </Button>
        </View>
      ))}
    </Card>
  );
}
