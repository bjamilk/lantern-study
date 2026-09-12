/**
 * Past chats, as a list you can actually search and prune.
 *
 * The phone already swapped the message list for a list of threads, but with
 * no way to find one in a long history and no way to remove one: the header's
 * trash only ever deleted the thread currently open, so an old chat could be
 * read but never got rid of. Delete goes through the app's confirm dialog
 * rather than the web rail's two-tap arm — hover-to-reveal has no meaning on a
 * touch screen, and a destructive tap next to a "resume" tap needs a real gate.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { CompanionConversation } from '@lantern/shared';
import { appAlert } from '../ui/appDialog';
import { T, useFeatureAccent } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { filterConversations } from './companionScope';

interface Props {
  conversations: CompanionConversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  onSelect: (conversation: CompanionConversation) => void;
  onDelete: (conversationId: string) => void;
  onNewChat: () => void;
  onBack: () => void;
  formatRelativeTime: (iso: string) => string;
}

export function CompanionHistory({
  conversations,
  activeConversationId,
  isLoading,
  onSelect,
  onDelete,
  onNewChat,
  onBack,
  formatRelativeTime,
}: Props) {
  const { colors } = useTheme();
  const ai = useFeatureAccent('ai');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => filterConversations(conversations, query), [conversations, query]);

  const confirmDelete = (conversation: CompanionConversation) => {
    appAlert(
      'Delete this chat?',
      `"${conversation.title}" and its messages will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(conversation.id),
        },
      ]
    );
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      className="flex-1 px-3"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingVertical: 12, gap: 8, flexGrow: 1 }}
      ListHeaderComponent={
        <View className="mb-2">
          <View className="flex-row items-center justify-between px-1 mb-2">
            <T.Label tone="secondary" style={{ textTransform: 'uppercase' }}>
              Past chats
            </T.Label>
            <Pressable onPress={onNewChat} accessibilityRole="button" accessibilityLabel="New chat">
              <T.Label style={{ color: ai.ink }}>New chat</T.Label>
            </Pressable>
          </View>
          <View className="flex-row items-center rounded-xl border border-lantern-border px-3">
            <AppIcon name="search" size={16} color={colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search chats…"
              placeholderTextColor={colors.inputPlaceholder}
              accessibilityLabel="Search past chats"
              className="flex-1 h-11 ml-2 text-body text-lantern-text dark:text-white"
            />
            {query ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <AppIcon name="close" size={16} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        </View>
      }
      ListEmptyComponent={
        isLoading ? (
          <View className="py-8 items-center gap-2">
            <ActivityIndicator color={colors.primary} />
            <Text className="text-lantern-text-secondary text-center">Loading chats…</Text>
          </View>
        ) : (
          <Text className="text-lantern-text-secondary text-center py-8 px-4">
            {query.trim()
              ? 'No chats match that search.'
              : 'No past chats yet. Start a conversation and it will show up here.'}
          </Text>
        )
      }
      renderItem={({ item }) => {
        const isActive = item.id === activeConversationId;
        return (
          <View className="flex-row items-stretch gap-1">
            <Pressable
              onPress={() => onSelect(item)}
              accessibilityRole="button"
              accessibilityLabel={`Open chat: ${item.title}`}
              accessibilityState={{ selected: isActive }}
              className={`flex-1 rounded-xl px-3 py-3 border ${
                isActive
                  ? 'border-lantern-primary/30 bg-lantern-primary-background'
                  : 'border-transparent bg-lantern-background-secondary dark:bg-lantern-surface-secondary'
              }`}
            >
              <View className="flex-row items-start justify-between gap-2">
                <Text
                  className="flex-1 text-body font-medium text-lantern-text dark:text-white"
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <T.Label tone="secondary" style={{ flexShrink: 0 }}>
                  {formatRelativeTime(item.updatedAt)}
                </T.Label>
              </View>
              {item.noteTitle ? (
                <T.Label style={{ marginTop: 2, color: ai.ink }} numberOfLines={1}>
                  {item.noteTitle}
                </T.Label>
              ) : null}
              {item.preview ? (
                <T.Caption tone="secondary" style={{ marginTop: 2 }} numberOfLines={2}>
                  {item.preview}
                </T.Caption>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => confirmDelete(item)}
              accessibilityRole="button"
              accessibilityLabel={`Delete chat: ${item.title}`}
              className="w-11 items-center justify-center rounded-xl"
            >
              <AppIcon name="trash" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        );
      }}
      ListFooterComponent={
        <Pressable
          onPress={onBack}
          className="py-3"
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
        >
          <T.Caption tone="secondary" style={{ textAlign: 'center' }}>
            Back to chat
          </T.Caption>
        </Pressable>
      }
    />
  );
}

export default CompanionHistory;
