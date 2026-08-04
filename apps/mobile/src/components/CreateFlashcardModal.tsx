import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import type { Flashcard } from '../stores/flashcardStore';
import { Button, Card } from './ui';

interface CreateFlashcardModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: { front: string; back: string }) => Promise<void>;
  editingFlashcard?: Flashcard | null;
  /** Only supplied when editing — deleting a card that does not exist yet is meaningless. */
  onDelete?: () => void;
}

export default function CreateFlashcardModal({
  visible,
  onClose,
  onSubmit,
  editingFlashcard,
  onDelete,
}: CreateFlashcardModalProps) {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setFront(editingFlashcard?.front ?? '');
      setBack(editingFlashcard?.back ?? '');
    }
  }, [visible, editingFlashcard]);

  const handleSubmit = async () => {
    if (!front.trim() || !back.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ front: front.trim(), back: back.trim() });
      setFront('');
      setBack('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 justify-center px-6" onPress={onClose}>
        <Pressable onPress={e => e.stopPropagation?.()}>
          <Card className="border-0 shadow-lg">
            <Text className="text-lg font-bold text-lantern-text mb-4">
              {editingFlashcard ? 'Edit Flashcard' : 'New Flashcard'}
            </Text>
            <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Front</Text>
            <TextInput
              value={front}
              onChangeText={setFront}
              placeholder="Question or term"
              placeholderTextColor="#94a3b8"
              multiline
              className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-surface mb-3 min-h-[72px]"
            />
            <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Back</Text>
            <TextInput
              value={back}
              onChangeText={setBack}
              placeholder="Answer or definition"
              placeholderTextColor="#94a3b8"
              multiline
              className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-surface mb-4 min-h-[72px]"
            />
            <View className="flex-row gap-2">
              <Button variant="secondary" className="flex-1" onPress={onClose}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={saving}
                disabled={!front.trim() || !back.trim()}
                onPress={handleSubmit}
              >
                {editingFlashcard ? 'Save' : 'Create'}
              </Button>
            </View>
            {editingFlashcard && onDelete ? (
              <Pressable
                onPress={onDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete card"
                className="mt-3 py-2 items-center active:opacity-70"
              >
                <Text className="text-sm font-semibold text-red-500">Delete card</Text>
              </Pressable>
            ) : null}
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
