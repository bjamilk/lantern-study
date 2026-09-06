// ===========================================
// Lantern Study Mobile - AI Generate Questions Modal
// Lets users paste notes/topic and have AI generate questions
// ===========================================

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPOSER_KEYBOARD_BEHAVIOR } from './chat/composerKeyboardBehavior';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { getNoteStudyContent, hasEnoughNoteStudyContent } from '@lantern/shared/utils';
import { useTheme } from '../theme';
import { useAIHandlers } from '../hooks/useAIHandlers';
import AIUsageBadge from './AIUsageBadge';
import { AIDisclaimer } from './AIDisclaimer';
import { uploadNotePdfViaApi, uploadPresentationViaApi } from '../services/notes';
import type { AIGeneratedQuestion } from '../services/ai';
import { AppIcon } from './ui/AppIcon';

interface AIGenerateQuestionsModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called with generated questions for the parent to handle (e.g. post to group) */
  onQuestionsGenerated?: (questions: AIGeneratedQuestion[]) => void;
  /** Pre-fill subject context */
  subject?: string;
}

const DIFFICULTY_OPTIONS = ['easy', 'medium', 'hard'] as const;
const COUNT_OPTIONS = [3, 5, 8, 10] as const;

export default function AIGenerateQuestionsModal({
  visible,
  onClose,
  onQuestionsGenerated,
  subject,
}: AIGenerateQuestionsModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Definite px height, not maxHeight '92%': with maxHeight and auto height,
  // Yoga clamps AFTER measuring children, so the flex:1 ScrollView body
  // resolves to zero height on release builds — only the header rendered.
  // Same failure family as the offline Download Options footer (5fd746d).
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(windowHeight * 0.92);
  const { handleAIGenerateQuestions, isAILoading, aiError, setAiError } = useAIHandlers();

  const [notes, setNotes] = useState('');
  const [count, setCount] = useState<number>(5);
  const [difficulty, setDifficulty] = useState<string>('medium');
  const [generatedQuestions, setGeneratedQuestions] = useState<AIGeneratedQuestion[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handlePickAttachment = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const name = asset.name || 'upload.pdf';
      const isPdf = /\.pdf$/i.test(name) || asset.mimeType === 'application/pdf';

      setIsUploading(true);
      setAiError(null);
      const uploaded = isPdf
        ? await uploadNotePdfViaApi(asset.uri, name)
        : await uploadPresentationViaApi(asset.uri, name);

      const studyInput = {
        sourceType: uploaded.note.sourceType,
        body: uploaded.note.body,
        summary: uploaded.note.summary,
        attachments: [uploaded.attachment, ...(uploaded.note.attachments || [])],
      };
      if (!hasEnoughNoteStudyContent(studyInput)) {
        Alert.alert(
          'Not enough text',
          'Could not extract enough study text yet. Wait a moment and try again, or paste notes manually.'
        );
        return;
      }
      setNotes(getNoteStudyContent(studyInput).slice(0, 8000));
    } catch (err: unknown) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Could not upload attachment.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!notes.trim()) {
      Alert.alert('Missing Notes', 'Please paste some notes or upload a PDF/PowerPoint.');
      return;
    }
    if (notes.trim().length < 50) {
      Alert.alert('More notes needed', 'Paste at least 50 characters, or upload a PDF/slides file.');
      return;
    }

    setAiError(null);
    const questions = await handleAIGenerateQuestions(notes, {
      count,
      difficulty,
      subject,
    });

    if (questions.length > 0) {
      setGeneratedQuestions(questions);
    }
  };

  const handleUseQuestions = () => {
    if (onQuestionsGenerated) {
      onQuestionsGenerated(generatedQuestions);
    }
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setNotes('');
    setGeneratedQuestions([]);
    setAiError(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
        style={styles.overlay}
      >
        <View style={[styles.container, { backgroundColor: colors.modalBackground, height: sheetHeight }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <AppIcon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <AppIcon name="sparkles" size={20} color={colors.primaryText} />
              <Text style={[styles.headerTitle, { color: colors.text }]}>AI Generate Questions</Text>
            </View>
            <AIUsageBadge variant="badge" />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
            keyboardShouldPersistTaps="handled"
          >
            {generatedQuestions.length === 0 ? (
              <>
                {/* Notes Input */}
                <View style={styles.labelRow}>
                  <Text style={[styles.label, { color: colors.textSecondary, marginBottom: 0 }]}>
                    Paste notes or upload a file
                  </Text>
                  <TouchableOpacity
                    onPress={() => void handlePickAttachment()}
                    disabled={isAILoading || isUploading}
                    style={[styles.uploadChip, { borderColor: colors.border, backgroundColor: colors.inputBackground }]}
                  >
                    {isUploading ? (
                      <ActivityIndicator size="small" color={colors.primaryText} />
                    ) : (
                      <AppIcon name="document-attach" size={16} color={colors.primaryText} />
                    )}
                    <Text style={[styles.uploadChipText, { color: colors.primaryText }]}>
                      {isUploading ? 'Uploading…' : 'PDF / PPT'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <AIDisclaimer compact textColor={colors.textSecondary} linkColor={colors.primaryText} />
                <TextInput
                  style={[
                    styles.notesInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.inputText,
                    },
                  ]}
                  placeholder="e.g. Cell biology: mitosis and meiosis..."
                  placeholderTextColor={colors.inputPlaceholder}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={8000}
                />
                <Text style={[styles.charCount, { color: colors.textTertiary }]}>
                  {notes.length}/8000 · min 50 characters
                </Text>

                {/* Count Selection */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>Number of questions</Text>
                <View style={styles.optionRow}>
                  {COUNT_OPTIONS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: count === c ? colors.primaryFill : colors.inputBackground,
                          borderColor: count === c ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setCount(c)}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          { color: count === c ? '#fff' : colors.text },
                        ]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Difficulty Selection */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>Difficulty</Text>
                <View style={styles.optionRow}>
                  {DIFFICULTY_OPTIONS.map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: difficulty === d ? colors.primaryFill : colors.inputBackground,
                          borderColor: difficulty === d ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setDifficulty(d)}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          { color: difficulty === d ? '#fff' : colors.text },
                        ]}
                      >
                        {d.charAt(0).toUpperCase() + d.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Error */}
                {aiError && (
                  <View style={[styles.errorBox, { backgroundColor: colors.errorBackground }]}>
                    <AppIcon name="alert-circle" size={16} color={colors.error} />
                    <Text style={[styles.errorText, { color: colors.error }]}>{aiError}</Text>
                  </View>
                )}

                {/* Generate Button */}
                <TouchableOpacity
                  style={[
                    styles.generateBtn,
                    { backgroundColor: colors.primaryFill },
                    isAILoading && styles.generateBtnDisabled,
                  ]}
                  onPress={handleGenerate}
                  disabled={isAILoading}
                >
                  {isAILoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <AppIcon name="sparkles" size={20} color="#fff" />
                  )}
                  <Text style={styles.generateBtnText}>
                    {isAILoading ? 'Generating...' : 'Generate Questions'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Preview Generated Questions */}
                <Text style={[styles.previewTitle, { color: colors.text }]}>
                  {generatedQuestions.length} Questions Generated
                </Text>

                {generatedQuestions.map((q, idx) => (
                  <View
                    key={idx}
                    style={[styles.questionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={styles.questionHeader}>
                      <View style={[styles.qBadge, { backgroundColor: colors.primaryBackground }]}>
                        <Text style={[styles.qBadgeText, { color: colors.primaryText }]}>Q{idx + 1}</Text>
                      </View>
                      <View
                        style={[
                          styles.difficultyBadge,
                          {
                            backgroundColor:
                              q.difficulty === 'hard'
                                ? colors.errorBackground
                                : q.difficulty === 'medium'
                                ? colors.warningBackground
                                : colors.successBackground,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.difficultyText,
                            {
                              color:
                                q.difficulty === 'hard'
                                  ? colors.error
                                  : q.difficulty === 'medium'
                                  ? colors.warning
                                  : colors.success,
                            },
                          ]}
                        >
                          {q.difficulty}
                        </Text>
                      </View>
                    </View>

                    <Text style={[styles.questionStem, { color: colors.text }]}>{q.text}</Text>

                    {q.options && q.options.length > 0 && (
                      <View style={styles.optionsList}>
                        {q.options.map((opt, optIdx) => {
                          const letter = String.fromCharCode(65 + optIdx);
                          const isCorrect =
                            opt === q.correctAnswer ||
                            letter === q.correctAnswer ||
                            letter.toLowerCase() === q.correctAnswer?.toLowerCase();
                          return (
                            <View
                              key={optIdx}
                              style={[
                                styles.questionOption,
                                {
                                  backgroundColor: isCorrect
                                    ? colors.successBackground
                                    : colors.inputBackground,
                                  borderColor: isCorrect ? colors.success : colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.questionOptionText,
                                  { color: isCorrect ? colors.success : colors.text },
                                ]}
                              >
                                {letter}. {opt}
                              </Text>
                              {isCorrect && (
                                <AppIcon name="checkmark-circle" size={16} color={colors.success} />
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {q.explanation && (
                      <Text style={[styles.explanation, { color: colors.textSecondary }]}>
                        💡 {q.explanation}
                      </Text>
                    )}
                  </View>
                ))}

                {/* Action Buttons */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                    onPress={() => setGeneratedQuestions([])}
                  >
                    <AppIcon name="refresh" size={18} color={colors.text} />
                    <Text style={[styles.actionBtnText, { color: colors.text }]}>Regenerate</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: colors.primaryFill }]}
                    onPress={handleUseQuestions}
                  >
                    <AppIcon name="checkmark" size={18} color="#fff" />
                    <Text style={[styles.actionBtnText, { color: '#fff' }]}>Use Questions</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  uploadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  uploadChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    // Height set inline as a definite px value (92% of window) — see the
    // comment at the sheetHeight computation for why maxHeight breaks here.
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    marginTop: 16,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    minHeight: 120,
    lineHeight: 22,
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  optionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  optionChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  generateBtnDisabled: {
    opacity: 0.7,
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Preview
  previewTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  questionCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  qBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  qBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  difficultyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  difficultyText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  questionStem: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  optionsList: {
    gap: 6,
  },
  questionOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  questionOptionText: {
    fontSize: 14,
    flex: 1,
  },
  explanation: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionBtnPrimary: {
    borderWidth: 0,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
