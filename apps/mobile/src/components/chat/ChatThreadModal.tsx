import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChatComposer, type ReplyPreview } from './ChatComposer';
import { MessageBubble } from './MessageBubble';
import { DmBubble } from './DmBubble';
import type { DirectMessage, Message } from '../../stores/groupStore';
import { useTheme } from '../../theme';
import {
  canEditChatMessage,
  canRemoveChatMessage,
  shouldRenderRemovedMessage,
} from '@lantern/shared/utils';

type ThreadMessage = Message | DirectMessage;

function isGroupMessage(msg: ThreadMessage): msg is Message {
  return 'createdAt' in msg;
}

interface ChatThreadModalProps {
  visible: boolean;
  onClose: () => void;
  rootId: string | null;
  loading: boolean;
  messages: ThreadMessage[];
  onReload: () => Promise<void>;
  onSend: (text: string, replyToMessageId?: string) => Promise<void>;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onRemove?: (messageId: string) => Promise<void>;
  currentUserId?: string;
  /** Group thread rendering */
  isGroup?: boolean;
  memberCount?: number;
  userVotes?: Record<string, 'up' | 'down' | undefined>;
  onVote?: (messageId: string, vote: 'up' | 'down') => void;
  onFlag?: (messageId: string) => void;
  canFlag?: (message: Message) => boolean;
  userFlagged?: (message: Message) => boolean;
  /** DM thread rendering */
  otherDisplayName?: string;
  otherAvatarUrl?: string | null;
  groupId?: string;
  threadId?: string;
}

export function ChatThreadModal({
  visible,
  onClose,
  rootId,
  loading,
  messages,
  onReload,
  onSend,
  onEdit,
  onRemove,
  currentUserId,
  isGroup = false,
  memberCount = 0,
  userVotes,
  onVote,
  onFlag,
  canFlag,
  userFlagged,
  otherDisplayName,
  otherAvatarUrl,
  groupId,
  threadId,
}: ChatThreadModalProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [threadReplyTo, setThreadReplyTo] = useState<ReplyPreview | null>(null);
  const [editingMessage, setEditingMessage] = useState<ThreadMessage | null>(null);
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const visibleMessages = messages.filter((message) =>
    shouldRenderRemovedMessage(message, messages)
  );
  const rootMessage = messages.find(message => message.id === rootId) || messages[0];
  const isRootRemoved = !!rootMessage?.isRemoved || !!rootMessage?.removedAt;

  const resetReplyToRoot = useCallback(() => {
    if (!rootId) {
      setThreadReplyTo(null);
      return;
    }
    const root = messages.find(m => m.id === rootId) || messages[0];
    if (!root || root.isRemoved || root.removedAt) {
      setThreadReplyTo(null);
      return;
    }
    if (isGroupMessage(root)) {
      setThreadReplyTo({
        id: root.id,
        senderName: root.senderName,
        text: root.questionStem || root.text,
      });
    } else {
      setThreadReplyTo({
        id: root.id,
        senderName: root.senderId === currentUserId ? 'You' : otherDisplayName,
        text: root.text,
      });
    }
  }, [rootId, messages, currentUserId, otherDisplayName]);

  useEffect(() => {
    if (!visible) {
      setText('');
      setThreadReplyTo(null);
      setEditingMessage(null);
      return;
    }
    resetReplyToRoot();
  }, [visible, resetReplyToRoot]);

  const replyCount = Math.max(0, visibleMessages.length - 1);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      if (editingMessage && onEdit) {
        await onEdit(editingMessage.id, trimmed);
        setEditingMessage(null);
        setText('');
        await onReload();
        return;
      }

      setText('');
      const replyId = threadReplyTo?.id || rootId || undefined;
      await onSend(trimmed, replyId);
      await onReload();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      Alert.alert(
        editingMessage ? 'Edit failed' : 'Send failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
      if (!editingMessage) setText(trimmed);
    } finally {
      setSending(false);
    }
  };

  const beginReply = (message: ThreadMessage) => {
    setEditingMessage(null);
    if (isGroupMessage(message)) {
      setThreadReplyTo({
        id: message.id,
        senderName: message.senderName,
        text: message.questionStem || message.text,
      });
      return;
    }
    setThreadReplyTo({
      id: message.id,
      senderName: message.senderId === currentUserId ? 'You' : otherDisplayName,
      text: message.text,
    });
  };

  const beginEdit = (message: ThreadMessage) => {
    setThreadReplyTo(null);
    setEditingMessage(message);
    setText(message.text);
  };

  const confirmRemove = (message: ThreadMessage) => {
    if (!onRemove) return;
    Alert.alert(
      'Remove message?',
      'This removes the message for everyone. An audit record will be retained.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void onRemove(message.id)
              .then(async () => {
                if (editingMessage?.id === message.id) {
                  setEditingMessage(null);
                  setText('');
                }
                await onReload();
              })
              .catch((error) => {
                Alert.alert(
                  'Remove failed',
                  error instanceof Error ? error.message : 'Please try again.'
                );
              });
          },
        },
      ]
    );
  };

  const showMessageActions = (message: ThreadMessage) => {
    const canEdit =
      !!onEdit && canEditChatMessage(message, currentUserId);
    const canRemove =
      !!onRemove && canRemoveChatMessage(message, currentUserId);
    if (!canEdit && !canRemove) {
      beginReply(message);
      return;
    }

    Alert.alert('Message options', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reply', onPress: () => beginReply(message) },
      {
        text: canEdit ? 'Edit or remove' : 'Remove',
        onPress: () =>
          Alert.alert('Manage message', undefined, [
            { text: 'Cancel', style: 'cancel' },
            ...(canEdit ? [{ text: 'Edit', onPress: () => beginEdit(message) }] : []),
            ...(canRemove
              ? [{
                  text: 'Remove',
                  style: 'destructive' as const,
                  onPress: () => confirmRemove(message),
                }]
              : []),
          ]),
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
        <View
          className="flex-row items-center justify-between px-3 py-2 border-b border-lantern-border bg-lantern-surface"
        >
          <View className="flex-1 min-w-0">
            <Text className="text-base font-semibold text-lantern-text">Thread</Text>
            <Text className="text-[11px] text-lantern-text-secondary">
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            className="p-2 rounded-lg active:bg-lantern-background-secondary"
            accessibilityLabel="Close thread"
          >
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {loading && messages.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={visibleMessages}
              keyExtractor={item => item.id}
              className="flex-1"
              contentContainerClassName="px-4 py-4 flex-grow"
              onContentSizeChange={() => {
                if (visibleMessages.length > 0) {
                  listRef.current?.scrollToEnd({ animated: false });
                }
              }}
              renderItem={({ item, index }) => {
                const isOwn = item.senderId === currentUserId;
                if (isGroup && isGroupMessage(item)) {
                  const previous = index > 0 && isGroupMessage(visibleMessages[index - 1])
                    ? (visibleMessages[index - 1] as Message)
                    : undefined;
                  const isGroupedWithPrevious =
                    !!previous &&
                    previous.senderId === item.senderId &&
                    new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() <
                      5 * 60 * 1000;

                  return (
                    <MessageBubble
                      message={item}
                      isOwn={isOwn}
                      userVote={userVotes?.[item.id]}
                      memberCount={memberCount}
                      isGroupedWithPrevious={isGroupedWithPrevious}
                      onVote={
                        item.type === 'question' && onVote
                          ? vote => onVote(item.id, vote)
                          : undefined
                      }
                      flagCount={item.flaggedAsSimilarUserIds?.length ?? 0}
                      userFlagged={userFlagged?.(item) ?? false}
                      onFlag={onFlag ? () => onFlag(item.id) : undefined}
                      canFlag={canFlag?.(item) ?? false}
                      onReply={showMessageActions}
                      onSwipeReply={beginReply}
                    />
                  );
                }

                const dm = item as DirectMessage;
                const timestamp =
                  dm.timestamp instanceof Date
                    ? dm.timestamp.toISOString()
                    : String(dm.timestamp);
                return (
                  <DmBubble
                    message={{
                      text: dm.text,
                      timestamp,
                      editedAt: dm.editedAt,
                      removedAt: dm.removedAt,
                      isRemoved: dm.isRemoved,
                      replyTo: dm.replyTo
                        ? {
                            id: dm.replyTo.id,
                            senderName: dm.replyTo.senderName,
                            text: dm.replyTo.text,
                            isRemoved: dm.replyTo.isRemoved,
                          }
                        : null,
                      replyCount: dm.replyCount,
                      receiptStatus: dm.receiptStatus,
                    }}
                    isOwn={isOwn}
                    senderName={isOwn ? undefined : otherDisplayName}
                    senderAvatar={isOwn ? undefined : otherAvatarUrl}
                    onReply={() => showMessageActions(dm)}
                    onSwipeReply={() => beginReply(dm)}
                  />
                );
              }}
            />
          )}

          {!isRootRemoved ? (
            <ChatComposer
              value={text}
              onChangeText={setText}
              onSend={() => void handleSend()}
              sending={sending}
              replyTo={threadReplyTo}
              onClearReply={resetReplyToRoot}
              editingMessage={
                editingMessage ? { id: editingMessage.id, text: editingMessage.text } : null
              }
              onCancelEdit={() => {
                setEditingMessage(null);
                setText('');
                resetReplyToRoot();
              }}
              groupId={groupId}
              threadId={threadId}
              onSendAudioMarkdown={async markdown => {
                setSending(true);
                try {
                  const replyId = threadReplyTo?.id || rootId || undefined;
                  await onSend(markdown, replyId);
                  await onReload();
                } finally {
                  setSending(false);
                }
              }}
            />
          ) : (
            <View className="px-4 py-3 border-t border-lantern-border bg-lantern-surface">
              <Text className="text-xs text-center text-lantern-text-secondary">
                This thread is closed because its original message was removed.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
