import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as notesApi from '../services/notes';
import { aiGenerateFlashcards } from '../services/ai';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import { Button } from './ui';

export interface ImportAndStudyResult {
  noteId: string;
  noteTitle: string;
  flashcardCount?: number;
  quizQuestionCount?: number;
}

interface ImportAndStudyModalProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: (result: ImportAndStudyResult) => void;
  onOpenNote: (noteId: string) => void;
}

type Step = 'input' | 'processing' | 'done';

export default function ImportAndStudyModal({
  visible,
  onClose,
  onComplete,
  onOpenNote,
}: ImportAndStudyModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [textContent, setTextContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAndStudyResult | null>(null);
  const [generateCards, setGenerateCards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);

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
    async (note: { id: string; title: string; body?: string }) => {
      const body = note.body || '';
      let flashcardCount = 0;
      let quizQuestionCount = 0;

      if (generateCards && body.length >= 50) {
        try {
          const { flashcards } = await aiGenerateFlashcards(body.slice(0, 8000), {
            count: normalizeFlashcardCount(),
          });
          flashcardCount = flashcards?.length ?? 0;
        } catch {
          // non-fatal
        }
      }

      if (generateQuiz && body.length >= 50) {
        try {
          const { questions } = await notesApi.generateDailyQuizFromContent(body.slice(0, 8000), 'retention', 5);
          quizQuestionCount = questions?.length ?? 0;
        } catch {
          // non-fatal
        }
      }

      const res: ImportAndStudyResult = {
        noteId: note.id,
        noteTitle: note.title,
        flashcardCount,
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View className="flex-1 bg-black/50 justify-center px-4">
        <View className="bg-lantern-surface rounded-2xl overflow-hidden">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-lantern-border">
            <View className="flex-row items-center gap-2">
              <Ionicons name="sparkles" size={18} color="#8b5cf6" />
              <Text className="text-lg font-bold text-lantern-text">Import & Study</Text>
            </View>
            <Pressable onPress={handleClose} className="p-1">
              <Ionicons name="close" size={22} color="#94a3b8" />
            </Pressable>
          </View>

          <View className="p-4">
            {step === 'input' ? (
              <>
                <Text className="text-sm text-lantern-text-secondary mb-3">
                  Paste lecture notes to create study materials.
                </Text>

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
                <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
                <Text className="font-semibold text-lantern-text">{result.noteTitle} ready!</Text>
                <View className="flex-row gap-3">
                  {result.flashcardCount ? (
                    <Text className="text-sm text-lantern-text-secondary">{result.flashcardCount} flashcards</Text>
                  ) : null}
                  {result.quizQuestionCount ? (
                    <Text className="text-sm text-lantern-text-secondary">{result.quizQuestionCount} quiz Qs</Text>
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
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
