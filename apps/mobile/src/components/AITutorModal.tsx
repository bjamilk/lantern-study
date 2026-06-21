// ===========================================
// Lantern Study Mobile - AI Tutor Modal
// Ask the AI tutor any study question
// ===========================================

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useAIHandlers } from '../hooks/useAIHandlers';
import AIUsageBadge from './AIUsageBadge';
import { AIDisclaimer } from './AIDisclaimer';

interface AITutorModalProps {
  visible: boolean;
  onClose: () => void;
  /** Optional context like current group subject */
  subject?: string;
  recentTopics?: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export default function AITutorModal({
  visible,
  onClose,
  subject,
  recentTopics,
}: AITutorModalProps) {
  const { colors } = useTheme();
  const { handleAIAskTutor, isAILoading, aiError, setAiError } = useAIHandlers();
  const scrollRef = useRef<ScrollView>(null);

  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const handleAsk = useCallback(async () => {
    if (!question.trim() || isAILoading) return;

    const q = question.trim();
    setQuestion('');
    setChatHistory((prev) => [...prev, { role: 'user', text: q }]);

    const answer = await handleAIAskTutor(q, { subject, recentTopics });

    if (answer) {
      setChatHistory((prev) => [...prev, { role: 'assistant', text: answer }]);
    } else if (aiError) {
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', text: `Sorry, I couldn't answer that. ${aiError}` },
      ]);
    }

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [question, isAILoading, handleAIAskTutor, subject, recentTopics, aiError]);

  const handleClose = () => {
    setChatHistory([]);
    setQuestion('');
    setAiError(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={[styles.container, { backgroundColor: colors.modalBackground }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Ionicons name="school" size={20} color={colors.primary} />
              <Text style={[styles.headerTitle, { color: colors.text }]}>AI Tutor</Text>
            </View>
            <AIUsageBadge variant="badge" />
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <AIDisclaimer compact textColor={colors.textSecondary} linkColor={colors.primary} />
          </View>

          {/* Chat History */}
          <ScrollView
            ref={scrollRef}
            style={styles.chatArea}
            contentContainerStyle={styles.chatContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {chatHistory.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="school-outline" size={48} color={colors.textTertiary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  Ask me anything!
                </Text>
                <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                  I can explain concepts, solve problems, and help you study.
                  {subject ? `\nCurrently studying: ${subject}` : ''}
                </Text>
              </View>
            )}

            {chatHistory.map((msg, idx) => (
              <View
                key={idx}
                style={[
                  styles.chatBubble,
                  msg.role === 'user'
                    ? [styles.userBubble, { backgroundColor: colors.primary }]
                    : [styles.assistantBubble, { backgroundColor: colors.card, borderColor: colors.border }],
                ]}
              >
                {msg.role === 'assistant' && (
                  <View style={styles.botIcon}>
                    <Ionicons name="sparkles" size={14} color={colors.primary} />
                  </View>
                )}
                <Text
                  style={[
                    styles.chatText,
                    { color: msg.role === 'user' ? '#fff' : colors.text },
                  ]}
                  selectable
                >
                  {msg.text}
                </Text>
              </View>
            ))}

            {isAILoading && (
              <View style={[styles.chatBubble, styles.assistantBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.typingText, { color: colors.textSecondary }]}>
                  Thinking...
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Input */}
          <View style={[styles.inputRow, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.inputText,
                },
              ]}
              placeholder="Ask a study question..."
              placeholderTextColor={colors.inputPlaceholder}
              value={question}
              onChangeText={setQuestion}
              multiline
              maxLength={1000}
              onSubmitEditing={handleAsk}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[
                styles.sendBtn,
                {
                  backgroundColor: question.trim() && !isAILoading ? colors.primary : colors.inputBackground,
                },
              ]}
              onPress={handleAsk}
              disabled={!question.trim() || isAILoading}
            >
              <Ionicons
                name="send"
                size={18}
                color={question.trim() && !isAILoading ? '#fff' : colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    height: '90%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  chatBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  botIcon: {
    marginTop: 2,
  },
  chatText: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  typingText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 80,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
