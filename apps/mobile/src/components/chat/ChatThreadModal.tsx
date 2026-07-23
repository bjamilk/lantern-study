import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  currentUserId,
  isGroup = false,
  memberCount = 0,
  userVotes,
  onVote,
  onFlag,
  canFlag,
  userFlagged,
  otherDisplayName,
  groupId,
  threadId,
}: ChatThreadModalProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [threadReplyTo, setThreadReplyTo] = useState<ReplyPreview | null>(null);
  const listRef = useRef<FlatList<ThreadMessage>>(null);

  const resetReplyToRoot = useCallback(() => {
    if (!rootId) {
      setThreadReplyTo(null);
      return;
    }
    const root = messages.find(m => m.id === rootId) || messages[0];
    if (!root) {
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
      return;
    }
    resetReplyToRoot();
  }, [visible, resetReplyToRoot]);

  const replyCount = Math.max(0, messages.length - 1);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    const replyId = threadReplyTo?.id || rootId || undefined;
    try {
      await onSend(trimmed, replyId);
      await onReload();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } finally {
      setSending(false);
    }
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
              data={messages}
              keyExtractor={item => item.id}
              className="flex-1"
              contentContainerClassName="px-4 py-4 flex-grow"
              onContentSizeChange={() => {
                if (messages.length > 0) {
                  listRef.current?.scrollToEnd({ animated: false });
                }
              }}
              renderItem={({ item, index }) => {
                const isOwn = item.senderId === currentUserId;
                if (isGroup && isGroupMessage(item)) {
                  const previous = index > 0 && isGroupMessage(messages[index - 1])
                    ? (messages[index - 1] as Message)
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
                      onReply={m =>
                        setThreadReplyTo({
                          id: m.id,
                          senderName: m.senderName,
                          text: m.questionStem || m.text,
                        })
                      }
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
                      replyTo: dm.replyTo
                        ? {
                            id: dm.replyTo.id,
                            senderName: dm.replyTo.senderName,
                            text: dm.replyTo.text,
                          }
                        : null,
                      replyCount: dm.replyCount,
                      receiptStatus: dm.receiptStatus,
                    }}
                    isOwn={isOwn}
                    senderName={isOwn ? undefined : otherDisplayName}
                    onReply={() =>
                      setThreadReplyTo({
                        id: dm.id,
                        senderName: isOwn ? 'You' : otherDisplayName,
                        text: dm.text,
                      })
                    }
                  />
                );
              }}
            />
          )}

          <ChatComposer
            value={text}
            onChangeText={setText}
            onSend={() => void handleSend()}
            sending={sending}
            replyTo={threadReplyTo}
            onClearReply={resetReplyToRoot}
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
