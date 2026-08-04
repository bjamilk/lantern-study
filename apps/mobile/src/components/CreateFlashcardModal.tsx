import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Flashcard } from '../stores/flashcardStore';
import { FlashcardType, type OcclusionData } from '@lantern/shared';
import { aiEnhanceFlashcard } from '../services/ai';
import {
  pickFlashcardImage,
  uploadPickedFlashcardImage,
  type PickedFlashcardImage,
} from '../services/flashcardImageUpload';
import { OcclusionEditor, countShapes, type OcclusionMode } from './OcclusionEditor';
import { Button, Card } from './ui';

export interface FlashcardDraft {
  type: FlashcardType;
  front?: string;
  back?: string;
  clozeText?: string;
  imageUrl?: string;
  occlusionData?: OcclusionData;
}

interface CreateFlashcardModalProps {
  visible: boolean;
  onClose: () => void;
  /** Needed to upload the picture against the right account and deck. */
  userId?: string;
  deckId?: string;
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
  userId,
  deckId,
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
  // The picked file is kept separately from the stored URL: the local URI is
  // what the editor draws on straight away, while the uploaded URL is what the
  // card persists. Uploading on save rather than on pick means a cancelled card
  // leaves nothing behind in storage.
  const [picked, setPicked] = useState<PickedFlashcardImage | null>(null);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [occlusion, setOcclusion] = useState<OcclusionData | null>(null);
  const [occlusionMode, setOcclusionMode] = useState<OcclusionMode>('rectangles');
  const [uploading, setUploading] = useState(false);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setType((editingFlashcard?.type as FlashcardType) ?? FlashcardType.BASIC);
    setFront(editingFlashcard?.front ?? '');
    setBack(editingFlashcard?.back ?? '');
    setClozeText(editingFlashcard?.clozeText ?? '');
    setImageUrl(editingFlashcard?.imageUrl ?? undefined);
    setOcclusion((editingFlashcard?.occlusionData as OcclusionData) ?? null);
    setOcclusionMode((editingFlashcard?.occlusionData?.type as OcclusionMode) ?? 'rectangles');
    setPicked(null);
    setError(null);
  }, [visible, editingFlashcard]);

  const isCloze = type === FlashcardType.CLOZE;
  const isOcclusion = type === FlashcardType.IMAGE_OCCLUSION;
  const previewUri = picked?.localUri ?? imageUrl;
  /**
   * What still stands between this card and being saveable, in words.
   *
   * The button used to be disabled until every condition was met without ever
   * saying which one was missing — so typing ordinary cloze text, or leaving the
   * occlusion prompt blank, left a dead Create button and no way to find out
   * why. The requirement is now stated, and the button stays live so the
   * message can be shown on the attempt.
   */
  const missingRequirement: string | null = isOcclusion
    ? !previewUri
      ? 'Choose an image first.'
      : countShapes(occlusion) === 0
        ? 'Drag across the image to hide at least one region.'
        : !front.trim()
          ? 'Add a prompt so you know what to recall.'
          : null
    : isCloze
      ? !clozeText.trim()
        ? 'Add the text for this card.'
        : !CLOZE_PATTERN.test(clozeText)
          ? 'Mark what to hide, like {{c1::answer}} — use “+ Add deletion”.'
          : null
      : !front.trim()
        ? 'Add the front of the card.'
        : !back.trim()
          ? 'Add the back of the card.'
          : null;

  const canSave = !uploading && !saving;

  const insertClozeDeletion = () => {
    // Numbering continues from what is already there, so repeated taps give
    // c1, c2, c3 rather than colliding.
    const used = [...clozeText.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]));
    const next = used.length > 0 ? Math.max(...used) + 1 : 1;
    setClozeText((prev) => `${prev}{{c${next}::answer}}`);
  };

  const handlePickImage = async () => {
    setError(null);
    try {
      const image = await pickFlashcardImage();
      if (!image) return;
      setPicked(image);
      // A new picture invalidates masks drawn over the old one.
      if (isOcclusion) setOcclusion(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the photo library.');
    }
  };

  const handleRemoveImage = () => {
    setPicked(null);
    setImageUrl(undefined);
    setOcclusion(null);
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
    if (missingRequirement) {
      setError(missingRequirement);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Upload only now, so abandoning the dialog never leaves an orphan file.
      let storedUrl = imageUrl;
      if (picked) {
        if (!userId) throw new Error('Sign in again to attach an image.');
        setUploading(true);
        try {
          storedUrl = await uploadPickedFlashcardImage(picked, userId, deckId);
        } finally {
          setUploading(false);
        }
      }

      if (isOcclusion) {
        await onSubmit({
          type: FlashcardType.IMAGE_OCCLUSION,
          front: front.trim(),
          imageUrl: storedUrl,
          occlusionData: occlusion ?? undefined,
        });
      } else if (isCloze) {
        await onSubmit({ type: FlashcardType.CLOZE, clozeText: clozeText.trim() });
      } else {
        await onSubmit({
          type: FlashcardType.BASIC,
          front: front.trim(),
          back: back.trim(),
          imageUrl: storedUrl,
        });
      }

      setFront('');
      setBack('');
      setClozeText('');
      setPicked(null);
      setImageUrl(undefined);
      setOcclusion(null);
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

            <View className="flex-row gap-2 mb-4">
              <TypeTab value={FlashcardType.BASIC} label="Basic" />
              <TypeTab value={FlashcardType.CLOZE} label="Cloze" />
              <TypeTab value={FlashcardType.IMAGE_OCCLUSION} label="Image" />
            </View>

            <ScrollView
              className="max-h-80"
              keyboardShouldPersistTaps="handled"
              scrollEnabled={!drawing}
            >
              {isOcclusion ? (
                <>
                  {previewUri ? (
                    <>
                      <OcclusionEditor
                        imageUri={previewUri}
                        value={occlusion}
                        onChange={setOcclusion}
                        mode={occlusionMode}
                        onModeChange={setOcclusionMode}
                        onDrawingChange={setDrawing}
                      />
                      <View className="flex-row gap-2 mt-3">
                        <Button size="sm" variant="secondary" onPress={() => void handlePickImage()}>
                          Replace image
                        </Button>
                        <Button size="sm" variant="ghost" onPress={handleRemoveImage}>
                          Remove
                        </Button>
                      </View>
                      <Text className="text-xs font-medium text-lantern-text-secondary mt-3 mb-1">
                        Prompt
                      </Text>
                      <TextInput
                        value={front}
                        onChangeText={setFront}
                        placeholder="What is hidden here?"
                        placeholderTextColor="#94a3b8"
                        className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-surface mb-2"
                      />
                    </>
                  ) : (
                    <Pressable
                      onPress={() => void handlePickImage()}
                      accessibilityRole="button"
                      className="items-center justify-center py-10 rounded-2xl border-2 border-dashed border-lantern-border active:opacity-80"
                    >
                      <Text className="text-base font-semibold text-lantern-primary">
                        Choose an image
                      </Text>
                      <Text className="text-xs text-lantern-text-secondary mt-1 px-6 text-center">
                        Then drag across it to hide the parts you want to recall.
                      </Text>
                    </Pressable>
                  )}
                </>
              ) : isCloze ? (
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
                  {previewUri ? (
                    <View className="mb-3">
                      <Image
                        source={{ uri: previewUri }}
                        style={{ width: '100%', height: 160, borderRadius: 12 }}
                        resizeMode="contain"
                      />
                      <View className="flex-row gap-2 mt-2">
                        <Button size="sm" variant="secondary" onPress={() => void handlePickImage()}>
                          Replace
                        </Button>
                        <Button size="sm" variant="ghost" onPress={handleRemoveImage}>
                          Remove image
                        </Button>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => void handlePickImage()}
                      accessibilityRole="button"
                      accessibilityLabel="Attach an image"
                      className="flex-row items-center justify-center gap-2 mb-3 py-2 rounded-xl border border-lantern-border active:opacity-80"
                    >
                      <Text className="text-sm font-semibold text-lantern-primary">
                        🖼  Attach image
                      </Text>
                    </Pressable>
                  )}
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

            {error ? (
              <Text className="text-xs text-red-500 mb-2">{error}</Text>
            ) : missingRequirement ? (
              <Text className="text-xs text-lantern-text-secondary mb-2">{missingRequirement}</Text>
            ) : null}

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
