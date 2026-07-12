import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { CompanionUserContext } from '@lantern/shared';
import { useCompanionStore } from '../stores/companionStore';
import { AIDisclaimer } from './AIDisclaimer';
import { useAuthStore } from '../stores/authStore';
import { useAppTheme } from '../theme';
import { Button } from './ui';

const QUICK_PROMPTS = [
  'What should I study today?',
  'Generate flashcards for my weak topics',
  'Quiz me on my weak topics',
  'Give me a study tip',
  'Explain spaced repetition',
];

interface Props {
  context?: CompanionUserContext;
}

export function AICompanionPanel({ context }: Props) {
  const theme = useAppTheme();
  const user = useAuthStore(s => s.user);
  const {
    isOpen,
    close,
    messages,
    isLoading,
    isLoadingHistory,
    historyLoaded,
    isStreaming,
    error,
    loadHistory,
    sendMessageStreaming,
    clearHistory,
    clearError,
    pendingMessage,
    setPendingMessage,
  } = useCompanionStore();

  const [input, setInput] = useState('');
  const hasLoaded = useRef(false);
  const listRef = useRef<FlatList>(null);

  const userName =
    user?.user_metadata?.name ||
    user?.user_metadata?.first_name ||
    user?.email?.split('@')[0] ||
    'Student';

  const enrichedContext: CompanionUserContext = useMemo(
    () => ({
      userName,
      ...context,
    }),
    [userName, context]
  );

  useEffect(() => {
    if (isOpen && !hasLoaded.current && user?.id) {
      hasLoaded.current = true;
      void loadHistory();
    }
  }, [isOpen, user?.id, loadHistory]);

  useEffect(() => {
    if (
      isOpen &&
      pendingMessage &&
      historyLoaded &&
      !isLoadingHistory &&
      !isLoading &&
      !isStreaming
    ) {
      const msg = pendingMessage;
      setPendingMessage(null);
      void sendMessageStreaming(msg, enrichedContext);
    }
  }, [
    isOpen,
    pendingMessage,
    historyLoaded,
    isLoadingHistory,
    isLoading,
    isStreaming,
    setPendingMessage,
    sendMessageStreaming,
    enrichedContext,
  ]);

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || isLoading || isStreaming) return;
      setInput('');
      await sendMessageStreaming(msg, enrichedContext);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [input, isLoading, isStreaming, sendMessageStreaming, enrichedContext]
  );

  const isBusy = isLoading || isStreaming || isLoadingHistory;

  if (!isOpen) {
    return null;
  }

  return (
    <Modal visible={isOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView
        className={`flex-1 ${theme === 'dark' ? 'bg-lantern-background' : 'bg-lantern-surface'}`}
        edges={['top', 'bottom']}
      >
        <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
          <Ionicons name="sparkles" size={22} color="#6366f1" />
          <Text className="flex-1 ml-2 text-lg font-bold text-lantern-text dark:text-white">Lantern AI</Text>
          <Pressable onPress={() => void clearHistory()} className="p-2 mr-1">
            <Ionicons name="trash-outline" size={20} color="#94a3b8" />
          </Pressable>
          <Pressable onPress={close} className="p-2">
            <Ionicons name="close" size={24} color="#94a3b8" />
          </Pressable>
        </View>
        <View className="px-4 pb-2">
          <AIDisclaimer compact textColor="#64748b" linkColor="#6366f1" />
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id || `${item.role}-${item.content.slice(0, 24)}`}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingVertical: 16, gap: 12 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            isLoadingHistory ? (
              <View className="py-8 items-center gap-2">
                <ActivityIndicator color="#6366f1" />
                <Text className="text-lantern-text-secondary text-center">
                  Loading conversation…
                </Text>
              </View>
            ) : (
            <View className="py-8">
              <Text className="text-lantern-text-secondary text-center mb-4">
                Ask anything about your study plan, flashcards, or tests.
              </Text>
              <View className="flex-row flex-wrap gap-2 justify-center">
                {QUICK_PROMPTS.map(p => (
                  <Pressable
                    key={p}
                    onPress={() => void handleSend(p)}
                    className="px-3 py-2 rounded-full bg-lantern-primary-background dark:bg-lantern-primary-background/50 border border-lantern-primary/30 dark:border-lantern-primary/30"
                  >
                    <Text className="text-xs text-lantern-primary">{p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            )
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View className={`max-w-[85%] ${isUser ? 'self-end' : 'self-start'}`}>
                <View
                  className={`px-4 py-3 rounded-2xl ${
                    isUser
                      ? 'bg-lantern-primary rounded-br-sm'
                      : 'bg-lantern-background-secondary rounded-bl-sm'
                  }`}
                >
                  <Text className={isUser ? 'text-white' : 'text-lantern-text'}>
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            isBusy ? (
              <View className="py-2 items-start">
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : null
          }
        />

        {error ? (
          <Pressable onPress={clearError} className="mx-4 mb-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <Text className="text-red-600 dark:text-red-300 text-sm">{error}</Text>
          </Pressable>
        ) : null}

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className="flex-row items-end gap-2 px-4 py-3 border-t border-lantern-border">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask Lantern AI..."
              placeholderTextColor="#94a3b8"
              multiline
              className="flex-1 max-h-24 bg-lantern-background-secondary rounded-2xl px-4 py-3 text-lantern-text dark:text-white"
            />
            <Button size="sm" disabled={!input.trim() || isBusy} onPress={() => void handleSend()}>
              Send
            </Button>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
