import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Flashcard } from '../stores/flashcardStore';
import { FlashcardType } from '@lantern/shared';
import { aiEnhanceFlashcard } from '../services/ai';
import { Button, Card } from './ui';

export interface FlashcardDraft {
  type: FlashcardType;
  front?: string;
  back?: string;
  clozeText?: string;
}

interface CreateFlashcardModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: FlashcardDraft) => Promise<void>;
  editingFlashcard?: Flashcard | null;
  /** Only supplied when editing — deleting a card that does not exist yet is meaningless. */
  onDelete?: () => void;
}

/** A cloze card is only answerable if it actually hides something. */
const CLOZE_PATTERN = /\{\{c\d+::[^}]+\}\}/;

export default function CreateFlashcardModal({
  visible,
  onClose,
  onSubmit,
  editingFlashcard,
  onDelete,
}: CreateFlashcardModalProps) {
  const [type, setType] = useState<FlashcardType>(FlashcardType.BASIC);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [clozeText, setClozeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setType((editingFlashcard?.type as FlashcardType) ?? FlashcardType.BASIC);
    setFront(editingFlashcard?.front ?? '');
    setBack(editingFlashcard?.back ?? '');
    setClozeText(editingFlashcard?.clozeText ?? '');
    setError(null);
  }, [visible, editingFlashcard]);

  const isCloze = type === FlashcardType.CLOZE;
  // Image occlusion cards review fine on mobile but the masks cannot be drawn
  // here, so the type is shown as locked rather than silently rewriting the
  // card as Basic and losing its image.
  const isOcclusion = type === FlashcardType.IMAGE_OCCLUSION;
  const canSave = isOcclusion
    ? false
    : isCloze
      ? CLOZE_PATTERN.test(clozeText)
      : Boolean(front.trim() && back.trim());

  const insertClozeDeletion = () => {
    // Numbering continues from what is already there, so repeated taps give
    // c1, c2, c3 rather than colliding.
    const used = [...clozeText.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]));
    const next = used.length > 0 ? Math.max(...used) + 1 : 1;
    setClozeText((prev) => `${prev}{{c${next}::answer}}`);
  };

  const handleEnhance = async () => {
    if (!front.trim() || !back.trim()) return;
    setEnhancing(true);
    setError(null);
    try {
      const result = await aiEnhanceFlashcard(front.trim(), back.trim());
      const enhanced = result?.enhanced;
      if (!enhanced) return;
      setFront(enhanced.front || front);
      setBack(
        (enhanced.back || back) +
          (enhanced.mnemonic ? `\n\n💡 ${enhanced.mnemonic}` : '') +
          (enhanced.example ? `\n📝 ${enhanced.example}` : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enhance this card.');
    } finally {
      setEnhancing(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(
        isCloze
          ? { type: FlashcardType.CLOZE, clozeText: clozeText.trim() }
          : { type: FlashcardType.BASIC, front: front.trim(), back: back.trim() }
      );
      setFront('');
      setBack('');
      setClozeText('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this card.');
    } finally {
      setSaving(false);
    }
  };

  const TypeTab = ({ value, label }: { value: FlashcardType; label: string }) => (
    <Pressable
      onPress={() => setType(value)}
      accessibilityRole="button"
      accessibilityState={{ selected: type === value }}
      className={`flex-1 py-2 rounded-xl items-center ${
        type === value ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          type === value ? 'text-white' : 'text-lantern-text-secondary'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 justify-center px-6" onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation?.()}>
          <Card className="border-0 shadow-lg">
            <Text className="text-lg font-bold text-lantern-text mb-3">
              {editingFlashcard ? 'Edit Flashcard' : 'New Flashcard'}
            </Text>

            {isOcclusion ? (
              <View className="mb-3 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
                <Text className="text-xs text-amber-800 dark:text-amber-200">
                  Image occlusion cards can be studied here, but their masks have to be drawn on the
                  web app.
                </Text>
              </View>
            ) : (
              <View className="flex-row gap-2 mb-4">
                <TypeTab value={FlashcardType.BASIC} label="Basic" />
                <TypeTab value={FlashcardType.CLOZE} label="Cloze" />
              </View>
            )}

            <ScrollView className="max-h-80" keyboardShouldPersistTaps="handled">
              {isCloze ? (
                <>
                  <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Text</Text>
                  <TextInput
                    value={clozeText}
                    onChangeText={setClozeText}
                    placeholder="The capital of France is {{c1::Paris}}"
                    placeholderTextColor="#94a3b8"
                    multiline
                    className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-surface mb-2 min-h-[96px]"
                  />
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="text-[11px] text-lantern-text-secondary flex-1 mr-2">
                      Wrap whatever should be hidden in {'{{c1::…}}'}.
                    </Text>
                    <Pressable
                      onPress={insertClozeDeletion}
                      accessibilityRole="button"
                      className="px-3 py-1.5 rounded-full bg-lantern-background-secondary active:opacity-80"
                    >
                      <Text className="text-xs font-semibold text-lantern-primary">
                        + Add deletion
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Front</Text>
                  <TextInput
                    value={front}
                    onChangeText={setFront}
                    placeholder="Question or term"
                    placeholderTextColor="#94a3b8"
                    multiline
                    editable={!isOcclusion}
                    className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-surface mb-3 min-h-[72px]"
                  />
                  <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Back</Text>
                  <TextInput
                    value={back}
                    onChangeText={setBack}
                    placeholder="Answer or definition"
                    placeholderTextColor="#94a3b8"
                    multiline
                    editable={!isOcclusion}
                    className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-surface mb-3 min-h-[72px]"
                  />
                  {!isOcclusion && front.trim() && back.trim() ? (
                    <Pressable
                      onPress={() => void handleEnhance()}
                      disabled={enhancing}
                      accessibilityRole="button"
                      accessibilityLabel="Enhance with AI"
                      className="flex-row items-center justify-center gap-2 mb-3 py-2 rounded-xl border border-lantern-border active:opacity-80"
                    >
                      {enhancing ? <ActivityIndicator size="small" /> : null}
                      <Text className="text-sm font-semibold text-lantern-primary">
                        {enhancing ? 'Enhancing…' : '✨ Enhance with AI'}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </ScrollView>

            {error ? <Text className="text-xs text-red-500 mb-2">{error}</Text> : null}

            <View className="flex-row gap-2">
              <Button variant="secondary" className="flex-1" onPress={onClose}>
                Cancel
              </Button>
              <Button className="flex-1" loading={saving} disabled={!canSave} onPress={handleSubmit}>
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
