// ===========================================
// Lantern Study Mobile - AI Explain Answer Modal
// Shows AI explanation for why an answer is correct/incorrect
// ===========================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useAIHandlers } from '../hooks/useAIHandlers';
import AIUsageBadge from './AIUsageBadge';

interface AIExplainModalProps {
  visible: boolean;
  onClose: () => void;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  options?: string[];
  /** Pre-fetched explanation (skip API call if set) */
  cachedExplanation?: string;
}

export default function AIExplainModal({
  visible,
  onClose,
  question,
  userAnswer,
  correctAnswer,
  options,
  cachedExplanation,
}: AIExplainModalProps) {
  const { colors } = useTheme();
  const { handleAIExplainAnswer, isAILoading, aiError } = useAIHandlers();
  const [explanation, setExplanation] = useState<string | null>(cachedExplanation || null);

  useEffect(() => {
    if (visible && !explanation && question) {
      fetchExplanation();
    }
  }, [visible]);

  const fetchExplanation = async () => {
    const result = await handleAIExplainAnswer(question, userAnswer, correctAnswer, options);
    if (result) {
      setExplanation(result);
    }
  };

  const handleClose = () => {
    setExplanation(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.modalBackground }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerLeft}>
              <Ionicons name="bulb" size={20} color={colors.warning} />
              <Text style={[styles.headerTitle, { color: colors.text }]}>AI Explanation</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {/* Question */}
            <View style={[styles.sectionCard, { backgroundColor: colors.cardSecondary }]}>
              <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>QUESTION</Text>
              <Text style={[styles.sectionText, { color: colors.text }]}>{question}</Text>
            </View>

            {/* Answers */}
            <View style={styles.answersRow}>
              <View style={[styles.answerCard, { backgroundColor: colors.errorBackground }]}>
                <Text style={[styles.answerLabel, { color: colors.error }]}>Your Answer</Text>
                <Text style={[styles.answerText, { color: colors.text }]}>{userAnswer || '(none)'}</Text>
              </View>
              <View style={[styles.answerCard, { backgroundColor: colors.successBackground }]}>
                <Text style={[styles.answerLabel, { color: colors.success }]}>Correct Answer</Text>
                <Text style={[styles.answerText, { color: colors.text }]}>{correctAnswer}</Text>
              </View>
            </View>

            {/* Explanation */}
            <View style={[styles.explanationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {isAILoading ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                    AI is analyzing this question...
                  </Text>
                </View>
              ) : aiError ? (
                <View style={styles.errorState}>
                  <Ionicons name="alert-circle" size={24} color={colors.error} />
                  <Text style={[styles.errorText, { color: colors.error }]}>{aiError}</Text>
                  <TouchableOpacity
                    style={[styles.retryBtn, { backgroundColor: colors.primary }]}
                    onPress={fetchExplanation}
                  >
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : explanation ? (
                <>
                  <View style={styles.explanationHeader}>
                    <Ionicons name="sparkles" size={16} color={colors.primary} />
                    <Text style={[styles.explanationLabel, { color: colors.primary }]}>
                      AI Explanation
                    </Text>
                  </View>
                  <Text style={[styles.explanationText, { color: colors.text }]} selectable>
                    {explanation}
                  </Text>
                </>
              ) : null}
            </View>

            <AIUsageBadge variant="inline" />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    gap: 12,
  },
  sectionCard: {
    padding: 12,
    borderRadius: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionText: {
    fontSize: 15,
    lineHeight: 22,
  },
  answersRow: {
    flexDirection: 'row',
    gap: 8,
  },
  answerCard: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
  },
  answerLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  answerText: {
    fontSize: 14,
    lineHeight: 20,
  },
  explanationCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 100,
  },
  explanationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  explanationLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  explanationText: {
    fontSize: 15,
    lineHeight: 24,
  },
  loadingState: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  errorState: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
