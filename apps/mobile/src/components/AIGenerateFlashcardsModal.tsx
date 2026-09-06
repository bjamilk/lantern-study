// ===========================================
// Lantern Study Mobile - AI Generate Flashcards Modal
// Generate flashcards from pasted notes using AI
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
import { useTheme } from '../theme';
import { useAIHandlers } from '../hooks/useAIHandlers';
import AIUsageBadge from './AIUsageBadge';
import { AIDisclaimer } from './AIDisclaimer';
import type { AIGeneratedFlashcard } from '../services/ai';
import { AppIcon } from './ui/AppIcon';

interface AIGenerateFlashcardsModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called with generated flashcards for parent to create */
  onFlashcardsGenerated: (flashcards: AIGeneratedFlashcard[]) => void;
}

const COUNT_OPTIONS = [3, 5, 8, 10] as const;
const STYLE_OPTIONS = ['concise', 'detailed'] as const;

export default function AIGenerateFlashcardsModal({
  visible,
  onClose,
  onFlashcardsGenerated,
}: AIGenerateFlashcardsModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Definite px height, not maxHeight '92%': the maxHeight+flex:1-scroll combo
  // collapses the body to zero height on Android release builds (same failure
  // family as the offline Download Options footer, 5fd746d).
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(windowHeight * 0.92);
  const { handleAIGenerateFlashcards, isAILoading, aiError, setAiError } = useAIHandlers();

  const [notes, setNotes] = useState('');
  const [count, setCount] = useState<number>(5);
  const [style, setStyle] = useState<'concise' | 'detailed'>('concise');
  const [generated, setGenerated] = useState<AIGeneratedFlashcard[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleGenerate = async () => {
    if (!notes.trim()) {
      Alert.alert('Missing Notes', 'Please paste some notes to generate flashcards from.');
      return;
    }
    setAiError(null);
    const cards = await handleAIGenerateFlashcards(notes, { count, style });
    if (cards.length > 0) {
      setGenerated(cards);
    }
  };

  const handleUse = () => {
    onFlashcardsGenerated(generated);
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setNotes('');
    setGenerated([]);
    setAiError(null);
    setExpandedIdx(null);
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
              <Text style={[styles.headerTitle, { color: colors.text }]}>AI Generate Flashcards</Text>
            </View>
            <AIUsageBadge variant="badge" />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
            keyboardShouldPersistTaps="handled"
          >
            {generated.length === 0 ? (
              <>
                {/* Notes Input */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Paste your notes or lecture content
                </Text>
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
                  placeholder="Paste lecture notes, textbook content, etc..."
                  placeholderTextColor={colors.inputPlaceholder}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={3000}
                />
                <Text style={[styles.charCount, { color: colors.textTertiary }]}>
                  {notes.length}/3000
                </Text>

                {/* Count */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>Number of cards</Text>
                <View style={styles.optionRow}>
                  {COUNT_OPTIONS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: count === c ? colors.primaryFill : colors.inputBackground,
                          borderColor: count === c ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setCount(c)}
                    >
                      <Text style={{ color: count === c ? '#fff' : colors.text, fontWeight: '500', fontSize: 14 }}>
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Style */}
                <Text style={[styles.label, { color: colors.textSecondary }]}>Style</Text>
                <View style={styles.optionRow}>
                  {STYLE_OPTIONS.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: style === s ? colors.primaryFill : colors.inputBackground,
                          borderColor: style === s ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setStyle(s)}
                    >
                      <Text style={{ color: style === s ? '#fff' : colors.text, fontWeight: '500', fontSize: 14 }}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
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

                {/* Generate */}
                <TouchableOpacity
                  style={[styles.generateBtn, { backgroundColor: colors.primaryFill }, isAILoading && { opacity: 0.7 }]}
                  onPress={handleGenerate}
                  disabled={isAILoading}
                >
                  {isAILoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <AppIcon name="sparkles" size={20} color="#fff" />
                  )}
                  <Text style={styles.generateBtnText}>
                    {isAILoading ? 'Generating...' : 'Generate Flashcards'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Preview */}
                <Text style={[styles.previewTitle, { color: colors.text }]}>
                  {generated.length} Flashcards Generated
                </Text>

                {generated.map((card, idx) => {
                  const isExpanded = expandedIdx === idx;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.cardPreview, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => setExpandedIdx(isExpanded ? null : idx)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.cardPreviewHeader}>
                        <View style={[styles.cardBadge, { backgroundColor: colors.primaryBackground }]}>
                          <Text style={[styles.cardBadgeText, { color: colors.primaryText }]}>#{idx + 1}</Text>
                        </View>
                        <AppIcon
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={colors.textTertiary}
                        />
                      </View>

                      <Text style={[styles.cardFront, { color: colors.text }]} numberOfLines={isExpanded ? undefined : 2}>
                        {card.front}
                      </Text>

                      {isExpanded && (
                        <View style={[styles.cardBackContainer, { backgroundColor: colors.cardSecondary }]}>
                          <Text style={[styles.cardBackLabel, { color: colors.textTertiary }]}>ANSWER</Text>
                          <Text style={[styles.cardBack, { color: colors.text }]}>{card.back}</Text>
                          {card.mnemonic && (
                            <Text style={[styles.cardMnemonic, { color: colors.primaryText }]}>
                              💡 {card.mnemonic}
                            </Text>
                          )}
                          {card.example && (
                            <Text style={[styles.cardExample, { color: colors.textSecondary }]}>
                              📝 {card.example}
                            </Text>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Actions */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                    onPress={() => setGenerated([])}
                  >
                    <AppIcon name="refresh" size={18} color={colors.text} />
                    <Text style={[styles.actionBtnText, { color: colors.text }]}>Regenerate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.primaryFill, borderColor: colors.primary }]}
                    onPress={handleUse}
                  >
                    <AppIcon name="add-circle" size={18} color="#fff" />
                    <Text style={[styles.actionBtnText, { color: '#fff' }]}>Add to Deck</Text>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  // Height set inline as a definite px value — see sheetHeight comment.
  container: { borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  closeBtn: { padding: 4 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 8, marginTop: 16 },
  notesInput: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, minHeight: 120, lineHeight: 22 },
  charCount: { fontSize: 11, textAlign: 'right', marginTop: 4 },
  optionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, marginTop: 16 },
  errorText: { fontSize: 13, flex: 1 },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 24 },
  generateBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  previewTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  cardPreview: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardPreviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  cardBadgeText: { fontSize: 12, fontWeight: '700' },
  cardFront: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  cardBackContainer: { marginTop: 10, padding: 10, borderRadius: 8 },
  cardBackLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  cardBack: { fontSize: 14, lineHeight: 20 },
  cardMnemonic: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  cardExample: { fontSize: 13, marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
});
