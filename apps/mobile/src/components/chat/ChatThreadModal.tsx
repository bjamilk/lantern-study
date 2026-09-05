import { COMPOSER_KEYBOARD_BEHAVIOR } from './composerKeyboardBehavior';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ErrorState, InlineErrorBanner, LoadingState } from '../ui';
import { useAiTutorSend } from '../../hooks/useAiTutorSend';
import { useChatImageAttach } from '../../hooks/useChatImageAttach';
import { CHAT_LIST_WINDOWING } from './chatListWindowing';
import { ChatComposer, type MentionCandidate, type ReplyPreview } from './ChatComposer';
import { MessageBubble } from './MessageBubble';
import { DmBubble } from './DmBubble';
import type { DirectMessage, GroupMember, Message } from '../../stores/groupStore';
import { useTheme } from '../../theme';
import { ChatWallpaperLayer, useChatWallpaper } from './ChatWallpaper';
import {
  canEditChatMessage,
  canRemoveChatMessage,
  parseAiQuery,
  shouldRenderRemovedMessage,
} from '@lantern/shared/utils';
import { AppIcon } from '../ui/AppIcon';

type ThreadMessage = Message | DirectMessage;

function isGroupMessage(msg: ThreadMessage): msg is Message {
  return 'createdAt' in msg;
}

interface ChatThreadModalProps {
  visible: boolean;
  onClose: () => void;
  rootId: string | null;
  loading: boolean;
  /** Set when the thread failed to load. The modal stays open and offers Retry. */
  loadError?: string | null;
  messages: ThreadMessage[];
  onReload: () => Promise<void>;
  onSend: (text: string, replyToMessageId?: string) => Promise<void>;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onRemove?: (messageId: string) => Promise<void>;
  currentUserId?: string;
  /** Group thread rendering */
  isGroup?: boolean;
  memberCount?: number;
  /** Group roster for author/mention/avatar resolution in MessageBubble. */
  members?: GroupMember[];
  userVotes?: Record<string, 'up' | 'down' | undefined>;
  onVote?: (messageId: string, vote: 'up' | 'down') => void;
  onFlag?: (messageId: string) => void;
  canFlag?: (message: Message) => boolean;
  userFlagged?: (message: Message) => boolean;
  /** @mention autocomplete for the thread composer — same roster as the parent chat. */
  mentionCandidates?: MentionCandidate[];
  /** DM thread rendering */
  otherDisplayName?: string;
  otherAvatarUrl?: string | null;
  groupId?: string;
  threadId?: string;
  /**
   * Same conversation, same background. Dropping to a flat colour inside the
   * thread reads as a rendering bug, and the uri is identical to the parent's
   * so RN's image cache dedupes the decode — this costs a draw, not a decode.
   */
  wallpaperScopeKey?: string | null;
}

export function ChatThreadModal({
  visible,
  onClose,
  rootId,
  loading,
  loadError,
  messages,
  onReload,
  onSend,
  onEdit,
  onRemove,
  currentUserId,
  isGroup = false,
  memberCount = 0,
  members,
  mentionCandidates,
  userVotes,
  onVote,
  onFlag,
  canFlag,
  userFlagged,
  otherDisplayName,
  otherAvatarUrl,
  groupId,
  threadId,
  wallpaperScopeKey,
}: ChatThreadModalProps) {
  const { colors } = useTheme();
  const wallpaper = useChatWallpaper(wallpaperScopeKey ?? null);
  const { width: windowWidth } = useWindowDimensions();
  // On tablets / landscape, present the thread as a centered sheet with a
  // dimmed backdrop instead of an edge-to-edge full-screen slide.
  const isWide = windowWidth >= 768;
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

  // Posts arbitrary text into this thread, threaded onto the current reply
  // target. Shared by the image attachment and the AI tutor.
  const postToThread = useCallback(
    async (markdown: string) => {
      await onSend(markdown, threadReplyTo?.id || rootId || undefined);
      await onReload();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [onSend, onReload, threadReplyTo?.id, rootId]
  );

  const attachImage = useChatImageAttach({
    chatId: groupId || threadId,
    onSendMarkdown: postToThread,
  });

  const { trySend: tryAiTutorSend, aiThinking } = useAiTutorSend({
    onPostAnswer: postToThread,
  });

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || aiThinking) return;

    // Same trigger as the parent chat. Without this, "@AI …" typed in a thread
    // posted verbatim as a plain message.
    if (!editingMessage && parseAiQuery(trimmed)) {
      setText('');
      const result = await tryAiTutorSend(trimmed);
      if (result === 'failed') setText(trimmed);
      return;
    }

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

  // A native Modal is its own window, so the app-root SafeAreaProvider never
  // measures it — without this the insets read 0 and the thread header renders
  // under the status bar and notch.
  const inner = (
      <SafeAreaProvider>
        <SafeAreaView
          accessibilityViewIsModal
          accessibilityLabel="Message thread"
          className="flex-1 bg-lantern-background"
          edges={['top', 'bottom']}
        >
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
            <AppIcon name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={COMPOSER_KEYBOARD_BEHAVIOR}
        >
          {loading && messages.length === 0 ? (
            <LoadingState label="Loading thread" />
          ) : loadError && messages.length === 0 ? (
            /* The modal used to close itself on failure, so the thread simply
               vanished behind an alert with nothing to retry. */
            <ErrorState message={loadError} onRetry={() => void onReload()} />
          ) : (
            <View className="flex-1 relative" style={{ backgroundColor: colors.chatBackground }}>
            <ChatWallpaperLayer
              uri={wallpaper.uri}
              scrimColor={wallpaper.scrimColor}
              onError={wallpaper.onImageError}
            />
            <FlatList
              ref={listRef}
              data={visibleMessages}
              keyExtractor={item => item.id}
              {...CHAT_LIST_WINDOWING}
              ListHeaderComponent={
                loadError ? (
                  <InlineErrorBanner
                    title="Couldn't refresh this thread"
                    onRetry={() => void onReload()}
                  />
                ) : null
              }
              className="flex-1"
              style={{ backgroundColor: wallpaper.listBackgroundColor }}
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
                      members={members}
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
                      wallpaperPillStyle={wallpaper.pillStyle}
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
                    wallpaperPillStyle={wallpaper.pillStyle}
                  />
                );
              }}
            />
            </View>
          )}

          {aiThinking ? (
            <Text
              accessibilityLiveRegion="polite"
              className="px-4 py-1 text-xs text-lantern-primary"
            >
              🤖 AI Tutor is thinking…
            </Text>
          ) : null}

          {!isRootRemoved ? (
            <ChatComposer
              value={text}
              onChangeText={setText}
              onSend={() => void handleSend()}
              sending={sending || aiThinking}
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
              mentionCandidates={mentionCandidates}
              onAttachImage={attachImage}
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
      </SafeAreaProvider>
  );

  return (
    <Modal
      visible={visible}
      transparent={isWide}
      animationType={isWide ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      {isWide ? (
        <View style={styles.wideBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close thread"
          />
          <View style={[styles.wideSheet, { width: Math.min(windowWidth - 48, 560) }]}>
            {inner}
          </View>
        </View>
      ) : (
        inner
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  wideBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  wideSheet: {
    height: '90%',
    borderRadius: 16,
    overflow: 'hidden',
  },
});
