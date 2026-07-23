import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { findFirstUnreadMessageId, normalizeStorageUrl } from '@lantern/shared/utils';
import { useAuthStore } from '../../stores';
import { useGroupStore, type DirectMessage } from '../../stores/groupStore';
import { ChatComposer } from '../../components/chat/ChatComposer';
import { ChatThreadModal } from '../../components/chat/ChatThreadModal';
import { DmBubble } from '../../components/chat/DmBubble';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useChatReadReceipts } from '../../hooks/useChatReadReceipts';
import { fetchInquiryByThread } from '../../services/api';
import { useTheme } from '../../theme';

type ThreadInquiry = Awaited<ReturnType<typeof fetchInquiryByThread>>;

type NavigationProp = {
  goBack: () => void;
  canGoBack?: () => boolean;
  navigate: (screen: string) => void;
  getParent?: () =>
    | { navigate: (tab: string, params?: Record<string, unknown>) => void }
    | undefined;
};

interface Props {
  navigation: NavigationProp;
  route: { params: { threadId: string; recipientId: string; recipientName?: string } };
}

function NewMessagesDivider() {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-3 py-2">
      <View className="flex-1 h-px" style={{ backgroundColor: `${colors.primary}66` }} />
      <Text className="text-[11px] font-semibold" style={{ color: colors.primary }}>
        New messages
      </Text>
      <View className="flex-1 h-px" style={{ backgroundColor: `${colors.primary}66` }} />
    </View>
  );
}

function DmBubbleWrapper({
  message,
  isOwn,
  senderName,
  onReply,
  onScrollToMessage,
  onOpenThread,
}: {
  message: DirectMessage;
  isOwn: boolean;
  senderName?: string;
  onReply?: () => void;
  onScrollToMessage?: (messageId: string) => void;
  onOpenThread?: (rootId: string) => void;
}) {
  const timestamp =
    message.timestamp instanceof Date ? message.timestamp.toISOString() : String(message.timestamp);
  return (
    <DmBubble
      message={{
        text: message.text,
        timestamp,
        replyCount: message.replyCount,
        receiptStatus: message.receiptStatus,
        replyTo: message.replyTo
          ? {
              id: message.replyTo.id,
              senderName: message.replyTo.senderName,
              text: message.replyTo.text,
            }
          : null,
      }}
      isOwn={isOwn}
      senderName={isOwn ? undefined : senderName}
      onReply={onReply}
      onScrollToMessage={onScrollToMessage}
      onOpenThread={onOpenThread}
      threadRootId={message.threadRootId}
      messageId={message.id}
    />
  );
}

export function DirectMessageScreen({ navigation, route }: Props) {
  const { threadId, recipientId, recipientName } = route.params;
  const user = useAuthStore(s => s.user);
  const { directMessages, fetchDirectMessagesForThread, sendDirectMessageTo, markDMAsRead, fetchThread, applyPeerChatRead } =
    useGroupStore();
  const { colors } = useTheme();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inquiry, setInquiry] = useState<ThreadInquiry>(null);
  const [unreadAnchorAt, setUnreadAnchorAt] = useState<string | null | undefined>(undefined);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [replyTo, setReplyTo] = useState<{
    id: string;
    senderName?: string;
    text?: string;
  } | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<DirectMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const listRef = useRef<FlatList<DirectMessage>>(null);
  const isNearBottomRef = useRef(true);
  const initialAnchorDoneRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(0);

  const messages = directMessages[threadId] || [];
  const displayName = recipientName || 'Direct message';
  const { typingUserIds, broadcastTyping } = useTypingIndicator(threadId, user?.id);
  const otherIsTyping = typingUserIds.length > 0;

  const onPeerRead = useCallback(
    (payload: { userId: string; lastReadAt: string }) => {
      applyPeerChatRead({ chatId: threadId, ...payload });
    },
    [applyPeerChatRead, threadId]
  );
  useChatReadReceipts(threadId, user?.id, onPeerRead);

  const reloadThread = useCallback(async () => {
    if (!threadRootId) return;
    const msgs = (await fetchThread(threadRootId, { threadId })) as DirectMessage[];
    setThreadMessages(msgs);
  }, [fetchThread, threadId, threadRootId]);

  const handleOpenThread = useCallback(
    async (rootId: string) => {
      setThreadRootId(rootId);
      setThreadLoading(true);
      try {
        const msgs = (await fetchThread(rootId, { threadId })) as DirectMessage[];
        setThreadMessages(msgs);
      } catch {
        setThreadMessages([]);
        setThreadRootId(null);
      } finally {
        setThreadLoading(false);
      }
    },
    [fetchThread, threadId]
  );

  const loadThread = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    initialAnchorDoneRef.current = false;
    setUnreadAnchorAt(undefined);
    setFirstUnreadId(null);
    setNewMessagesBelow(0);
    try {
      const [, previousLastReadAt] = await Promise.all([
        fetchDirectMessagesForThread(user.id, recipientId, threadId),
        markDMAsRead(threadId, user.id),
      ]);
      setUnreadAnchorAt(previousLastReadAt ?? null);
    } finally {
      setLoading(false);
    }
  }, [user?.id, recipientId, threadId, fetchDirectMessagesForThread, markDMAsRead]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    let cancelled = false;
    fetchInquiryByThread(threadId)
      .then(data => {
        if (!cancelled) setInquiry(data);
      })
      .catch(() => {
        /* plain DM or endpoint unavailable — no banner */
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (unreadAnchorAt === undefined || messages.length === 0) return;
    if (unreadAnchorAt == null) {
      setFirstUnreadId(null);
      return;
    }
    const mapped = messages.map((m) => ({
      id: m.id,
      timestamp: m.timestamp,
      senderId: m.senderId,
    }));
    setFirstUnreadId(findFirstUnreadMessageId(mapped, unreadAnchorAt, user?.id));
  }, [messages, unreadAnchorAt, user?.id]);

  useEffect(() => {
    if (loading || messages.length === 0 || unreadAnchorAt === undefined) return;
    if (initialAnchorDoneRef.current) return;
    const timer = setTimeout(() => {
      initialAnchorDoneRef.current = true;
      lastMessageIdRef.current = messages[messages.length - 1]?.id ?? null;
      prevMessageCountRef.current = messages.length;
      if (firstUnreadId) {
        const index = messages.findIndex((m) => m.id === firstUnreadId);
        if (index >= 0) {
          listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.15 });
          isNearBottomRef.current = false;
          return;
        }
      }
      listRef.current?.scrollToEnd({ animated: false });
      isNearBottomRef.current = true;
    }, 80);
    return () => clearTimeout(timer);
  }, [loading, messages, firstUnreadId, unreadAnchorAt]);

  useEffect(() => {
    if (!initialAnchorDoneRef.current || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.id === lastMessageIdRef.current) {
      lastMessageIdRef.current = last?.id ?? null;
      prevMessageCountRef.current = messages.length;
      return;
    }
    const isOwn = last.senderId === user?.id;
    if (isOwn || isNearBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: true });
      setNewMessagesBelow(0);
      isNearBottomRef.current = true;
    } else {
      const added = Math.max(1, messages.length - prevMessageCountRef.current);
      setNewMessagesBelow((n) => n + added);
    }
    lastMessageIdRef.current = last.id;
    prevMessageCountRef.current = messages.length;
  }, [messages, user?.id]);

  const openListing = useCallback(() => {
    const listingId = inquiry?.listing?.id || inquiry?.listing_id;
    if (!listingId) return;
    navigation.getParent?.()?.navigate('MarketTab', {
      screen: 'ListingDetail',
      params: { listingId },
    });
  }, [inquiry, navigation]);

  const openOffers = useCallback(() => {
    navigation.getParent?.()?.navigate('MarketTab', { screen: 'Offers' });
  }, [navigation]);

  const handleSend = async (overrideText?: string) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || !user?.id || sending) return;
    setSending(true);
    if (!overrideText) setText('');
    const replyId = replyTo?.id;
    setReplyTo(null);
    isNearBottomRef.current = true;
    try {
      await sendDirectMessageTo(user.id, recipientId, trimmed, threadId, {
        replyToMessageId: replyId,
      });
      listRef.current?.scrollToEnd({ animated: true });
      setNewMessagesBelow(0);
    } finally {
      setSending(false);
    }
  };

  const handleBack = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('GroupsList');
    }
  }, [navigation]);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface">
        <Pressable
          onPress={handleBack}
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
        >
          <Ionicons name="arrow-back" size={22} color="#475569" />
        </Pressable>
        <View className="w-9 h-9 rounded-full bg-lantern-primary-background dark:bg-lantern-primary-dark/40 items-center justify-center">
          <Ionicons name="person" size={18} color="#6366f1" />
        </View>
        <Text className="flex-1 text-base font-semibold text-lantern-text" numberOfLines={1}>
          {displayName}
        </Text>
      </View>

      {inquiry?.listing ? (
        <Pressable
          onPress={openListing}
          className="flex-row items-center gap-3 px-3 py-2 border-b border-lantern-border bg-lantern-surface active:bg-lantern-background-secondary"
          accessibilityLabel={`View listing ${inquiry.listing.title}`}
        >
          {inquiry.listing.images?.[0] ? (
            <Image
              source={{ uri: normalizeStorageUrl(inquiry.listing.images[0]) }}
              className="w-10 h-10 rounded-lg bg-lantern-background-secondary"
              resizeMode="cover"
            />
          ) : (
            <View className="w-10 h-10 rounded-lg bg-lantern-background-secondary items-center justify-center">
              <Ionicons name="pricetag-outline" size={18} color="#6366f1" />
            </View>
          )}
          <View className="flex-1 min-w-0">
            <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
              {inquiry.listing.title}
            </Text>
            <View className="flex-row items-center gap-2 mt-0.5">
              <Text className="text-xs font-bold text-lantern-primary">
                {inquiry.listing.price ? `₦${Number(inquiry.listing.price).toLocaleString()}` : 'Free'}
              </Text>
              <View className="px-2 py-0.5 rounded-full bg-lantern-background-secondary">
                <Text className="text-[10px] font-semibold text-lantern-text-secondary capitalize">
                  {inquiry.status}
                </Text>
              </View>
            </View>
          </View>
          <Pressable
            onPress={openOffers}
            className="px-2.5 py-1.5 rounded-lg bg-lantern-primary-background active:opacity-80"
            accessibilityLabel="View offers"
          >
            <Text className="text-xs font-semibold text-lantern-primary">Offers</Text>
          </Pressable>
          <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {loading && messages.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        ) : (
          <View className="flex-1">
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={item => item.id}
              className="flex-1"
              contentContainerClassName="px-4 py-4 flex-grow"
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
                isNearBottomRef.current = distance < 120;
                if (isNearBottomRef.current) setNewMessagesBelow(0);
              }}
              scrollEventThrottle={100}
              onScrollToIndexFailed={() => {
                listRef.current?.scrollToEnd({ animated: false });
              }}
              ListEmptyComponent={
                <View className="flex-1 items-center justify-center py-16">
                  <Text className="text-sm text-lantern-text-secondary">
                    Start a conversation with {displayName}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View>
                  {firstUnreadId === item.id ? <NewMessagesDivider /> : null}
                  <DmBubbleWrapper
                    message={item}
                    isOwn={item.senderId === user?.id}
                    senderName={displayName}
                    onReply={() =>
                      setReplyTo({
                        id: item.id,
                        senderName: item.senderId === user?.id ? 'You' : displayName,
                        text: item.text,
                      })
                    }
                    onScrollToMessage={(messageId) => {
                      const index = messages.findIndex((m) => m.id === messageId);
                      if (index >= 0) {
                        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
                      }
                    }}
                    onOpenThread={handleOpenThread}
                  />
                </View>
              )}
            />
            {newMessagesBelow > 0 ? (
              <View className="absolute bottom-3 left-0 right-0 items-center" pointerEvents="box-none">
                <Pressable
                  onPress={() => {
                    listRef.current?.scrollToEnd({ animated: true });
                    setNewMessagesBelow(0);
                    isNearBottomRef.current = true;
                  }}
                  className="px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-xs font-semibold text-white">
                    ↓ {newMessagesBelow} new message{newMessagesBelow === 1 ? '' : 's'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}

        {otherIsTyping ? (
          <Text className="px-4 py-1 text-xs text-lantern-text-secondary">
            {displayName} is typing…
          </Text>
        ) : null}
        <ChatComposer
          value={text}
          onChangeText={value => {
            setText(value);
            broadcastTyping();
          }}
          onSend={() => void handleSend()}
          sending={sending}
          threadId={threadId}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          onSendAudioMarkdown={async (markdown) => {
            await handleSend(markdown);
          }}
        />
      </KeyboardAvoidingView>

      <ChatThreadModal
        visible={!!threadRootId}
        onClose={() => {
          setThreadRootId(null);
          setThreadMessages([]);
        }}
        rootId={threadRootId}
        loading={threadLoading}
        messages={threadMessages}
        onReload={reloadThread}
        onSend={async (text, replyToMessageId) => {
          if (!user?.id) return;
          await sendDirectMessageTo(user.id, recipientId, text, threadId, { replyToMessageId });
        }}
        currentUserId={user?.id}
        otherDisplayName={displayName}
        threadId={threadId}
      />
    </SafeAreaView>
  );
}

export default DirectMessageScreen;
