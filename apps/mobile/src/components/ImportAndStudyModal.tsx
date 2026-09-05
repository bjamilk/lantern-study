import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { FlashcardType, getNoteStudyContent } from '@lantern/shared';
import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import { formatMaxNoteUploadLabel } from '@lantern/shared/utils/noteUpload';
import { HANDWRITING_OCR_OFF_MESSAGE } from '@lantern/shared/utils/handwritingOcr';
import * as notesApi from '../services/notes';
import { fetchAiHealth } from '../services/api';
import { aiGenerateFlashcards } from '../services/ai';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import { useAuthStore } from '../stores/authStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useStudyGoalsStore } from '../stores/studyGoalsStore';
import { Button } from './ui';
import { SCREEN_KEYBOARD_BEHAVIOR } from './layout';
import { AppIcon } from './ui/AppIcon';

export interface ImportAndStudyResult {
  noteId: string;
  noteTitle: string;
  flashcardCount?: number;
  /** Name of the deck the generated cards were saved into. */
  deckName?: string;
  quizQuestionCount?: number;
}

interface ImportAndStudyModalProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: (result: ImportAndStudyResult) => void;
  onOpenNote: (noteId: string) => void;
  onTurnIntoStudyProduct?: (result: ImportAndStudyResult) => void;
}

type Step = 'input' | 'processing' | 'done';

export default function ImportAndStudyModal({
  visible,
  onClose,
  onComplete,
  onOpenNote,
  onTurnIntoStudyProduct,
}: ImportAndStudyModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [textContent, setTextContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAndStudyResult | null>(null);
  const [generateCards, setGenerateCards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);
  const [handwritingOcrOff, setHandwritingOcrOff] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void fetchAiHealth()
      .then((h) => setHandwritingOcrOff(h.handwritingOcr === 'off' || h.gemini === 'off'))
      .catch(() => setHandwritingOcrOff(false));
  }, [visible]);

  const reset = () => {
    setStep('input');
    setTextContent('');
    setError(null);
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const enrichNote = useCallback(
    async (note: {
      id: string;
      title: string;
      body?: string;
      sourceType?: string;
      summary?: string;
      attachments?: Array<{ extractedText?: string | null; metadata?: Record<string, unknown> | null }>;
    }) => {
      const studyText = getNoteStudyContent(note);
      let flashcardCount = 0;
      let quizQuestionCount = 0;
      let deckName: string | undefined;

      if (generateCards && studyText.length >= 50) {
        try {
          const { flashcards } = await aiGenerateFlashcards(studyText.slice(0, 8000), {
            count: normalizeFlashcardCount(),
          });
          // Persist into a deck the same way the note editor's flashcard path
          // does — generating without saving spends AI credits and reports a
          // count of cards that exist nowhere. The count below refers only to
          // cards that were actually saved.
          const userId = useAuthStore.getState().user?.id;
          if (flashcards?.length && userId) {
            const { createDeck, createFlashcard } = useFlashcardStore.getState();
            const deck = await createDeck(
              `From: ${note.title}`.slice(0, 80),
              `Generated from note: ${note.title}`,
              userId
            );
            deckName = deck.name;
            for (const card of flashcards) {
              await createFlashcard({
                deckId: deck.id,
                type: FlashcardType.BASIC,
                front: card.front,
                back: card.back,
                userId,
              });
              flashcardCount += 1;
            }
          }
        } catch {
          // non-fatal
        }
      }

      if (generateQuiz && studyText.length >= 50) {
        try {
          // Same daily-quiz store path as the note editor's Quiz button: the
          // session is kept (and shown on the dashboard) instead of being
          // generated server-side and dropped. Uses the store's real studyGoal.
          await useStudyGoalsStore
            .getState()
            .startDailyQuizFromContent(studyText.slice(0, 8000), note.id, note.title);
          quizQuestionCount =
            useStudyGoalsStore.getState().dailyQuiz?.questions.length ?? 0;
        } catch {
          // non-fatal
        }
      }

      const res: ImportAndStudyResult = {
        noteId: note.id,
        noteTitle: note.title,
        flashcardCount,
        deckName,
        quizQuestionCount,
      };
      setResult(res);
      setStep('done');
      onComplete?.(res);
    },
    [generateCards, generateQuiz, onComplete]
  );

  const processText = async () => {
    if (!textContent.trim()) return;
    setStep('processing');
    setError(null);
    try {
      const note = await notesApi.createNote({
        title: 'Imported Notes',
        body: textContent.trim(),
        sourceType: 'typed',
      });
      await enrichNote(note);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setStep('input');
    }
  };

  const importPhotos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (!assets.length) return;
    setStep('processing');
    setError(null);
    try {
      const uploaded = await notesApi.uploadNoteImagesViaApi(
        assets.map((asset, index) => ({
          uri: asset.uri,
          fileName: asset.fileName || `photo-${index + 1}.jpg`,
          mimeType: asset.mimeType,
          size: asset.fileSize ?? 0,
        })),
        undefined,
        defaultPhotoNoteTitle()
      );
      await enrichNote({
        ...uploaded.note,
        attachments: uploaded.attachments,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Photo import failed');
      setStep('input');
    }
  };

  const handlePickPhotosFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || !result.assets.length) return;
    await importPhotos(result.assets);
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false });
    if (result.canceled || !result.assets[0]) return;
    await importPhotos(result.assets);
  };

  const handlePickPhotos = () => {
    Alert.alert('Photograph pages', 'Choose a source', [
      { text: 'Photo library', onPress: () => void handlePickPhotosFromLibrary() },
      { text: 'Camera', onPress: () => void handleTakePhoto() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      {/* The keyboard lands exactly where a bottom-anchored sheet sits, and on
          Android 15+ (this app targets SDK 36) the window is not resized, so
          the input and its confirm button were covered with no scroll range.
          Making the KeyboardAvoidingView the overlay lifts the sheet, and its
          max-height then resolves against the keyboard-free box. */}
      <KeyboardAvoidingView
        behavior={SCREEN_KEYBOARD_BEHAVIOR}
        className="flex-1 bg-black/50 justify-center px-4"
      >
        <View className="bg-lantern-surface rounded-2xl overflow-hidden">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-lantern-border">
            <View className="flex-row items-center gap-2">
              <AppIcon name="sparkles" size={18} color="#8b5cf6" />
              <Text className="text-lg font-bold text-lantern-text">Import & Study</Text>
            </View>
            <Pressable onPress={handleClose} className="p-1">
              <AppIcon name="close" size={22} color="#94a3b8" />
            </Pressable>
          </View>

          <View className="p-4">
            {step === 'input' ? (
              <>
                <Text className="text-sm text-lantern-text-secondary mb-3">
                  Photograph handwritten pages, or paste lecture notes, to create study materials.
                </Text>
                <Text className="text-xs text-lantern-text-secondary mb-3">
                  {formatMaxNoteUploadLabel()}
                </Text>
                {handwritingOcrOff ? (
                  <Text className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 mb-3">
                    {HANDWRITING_OCR_OFF_MESSAGE}
                  </Text>
                ) : null}

                <Pressable
                  onPress={handlePickPhotos}
                  className="flex-row items-center gap-3 border-2 border-dashed border-lantern-border rounded-xl px-3 py-3 mb-3"
                >
                  <AppIcon name="camera" size={22} color="#6366f1" />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-lantern-text">Photograph pages</Text>
                    <Text className="text-xs text-lantern-text-secondary">
                      Camera or library — text is read off the photo
                    </Text>
                  </View>
                </Pressable>

                <TextInput
                  value={textContent}
                  onChangeText={setTextContent}
                  placeholder="Or paste lecture notes / text..."
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                  className="min-h-[100px] border border-lantern-border rounded-xl px-3 py-2 text-sm text-lantern-text bg-lantern-background mb-3"
                />

                <View className="flex-row gap-4 mb-3">
                  <View className="flex-row items-center gap-2">
                    <Switch value={generateCards} onValueChange={setGenerateCards} />
                    <Text className="text-sm text-lantern-text-secondary">Flashcards</Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Switch value={generateQuiz} onValueChange={setGenerateQuiz} />
                    <Text className="text-sm text-lantern-text-secondary">Quiz</Text>
                  </View>
                </View>

                {textContent.trim() ? (
                  <Button onPress={() => void processText()}>Import text</Button>
                ) : null}

                {error ? <Text className="text-sm text-red-500 mt-2">{error}</Text> : null}
              </>
            ) : null}

            {step === 'processing' ? (
              <View className="items-center py-8">
                <ActivityIndicator size="large" color="#6366f1" />
                <Text className="font-medium text-lantern-text mt-4">
                  Creating study materials...
                </Text>
              </View>
            ) : null}

            {step === 'done' && result ? (
              <View className="items-center py-4 gap-3">
                <AppIcon name="checkmark-circle" size={48} color="#22c55e" />
                <Text className="font-semibold text-lantern-text">{result.noteTitle} ready!</Text>
                <View className="flex-row flex-wrap justify-center gap-3">
                  {result.flashcardCount ? (
                    <Text className="text-sm text-lantern-text-secondary">
                      {result.flashcardCount} flashcards saved
                      {result.deckName ? ` to "${result.deckName}"` : ''}
                    </Text>
                  ) : null}
                  {result.quizQuestionCount ? (
                    <Text className="text-sm text-lantern-text-secondary">
                      {result.quizQuestionCount} quiz Qs on your dashboard
                    </Text>
                  ) : null}
                </View>
                <Button
                  fullWidth
                  onPress={() => {
                    onOpenNote(result.noteId);
                    handleClose();
                  }}
                >
                  Open note
                </Button>
                {onTurnIntoStudyProduct ? (
                  <Button
                    fullWidth
                    variant="secondary"
                    onPress={() => {
                      onTurnIntoStudyProduct(result);
                      handleClose();
                    }}
                  >
                    Turn this into a Study Product
                  </Button>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
