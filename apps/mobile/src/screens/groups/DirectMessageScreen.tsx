import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
  TextInput,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { ForwardMessageSheet } from '../../components/chat/ForwardMessageSheet';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import { MessageActionBar } from '../../components/chat/MessageActionBar';
import { useToastStore } from '../../stores/toastStore';
import { Ionicons } from '@expo/vector-icons';
import {
  canEditChatMessage,
  canRemoveChatMessage,
  findFirstUnreadMessageId,
  normalizeStorageUrl,
  resolveAvatarSrc,
  shouldRenderRemovedMessage,
  isChatAudioMessage,
  isChatImageMessage,
} from '@lantern/shared/utils';
import { useAuthStore } from '../../stores';
import { useGroupStore, type DirectMessage } from '../../stores/groupStore';
import {
  EmptyState,
  ErrorState,
  InlineErrorBanner,
  LoadingState,
  ActionSheet,
  type ActionSheetItem,
} from '../../components/ui';
import { useChatImageAttach } from '../../hooks/useChatImageAttach';
import { CHAT_LIST_WINDOWING } from '../../components/chat/chatListWindowing';
import { ChatComposer } from '../../components/chat/ChatComposer';
import { ChatThreadModal } from '../../components/chat/ChatThreadModal';
import { DmBubble } from '../../components/chat/DmBubble';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { DmOffersPanel } from '../../components/chat/DmOffersPanel';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useChatReadReceipts } from '../../hooks/useChatReadReceipts';
import {
  acceptDmMessageRequest,
  declineDmMessageRequest,
  blockUser,
  fetchInquiryByThread,
  fetchOrderForInquiry,
  updateMarketplaceOrder,
  resumeMarketplaceOrderCheckout,
  getDmBlockStatus,
  getDmMuteStatus,
  muteDmThread,
  unmuteDmThread,
  unblockUser,
} from '../../services/api';
import {
  CHAT_MUTE_DURATIONS,
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared';
import { useTheme } from '../../theme';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';

type ThreadInquiry = Awaited<ReturnType<typeof fetchInquiryByThread>>;

type NavigationProp = {
  goBack: () => void;
  canGoBack?: () => boolean;
  getState?: () => { index?: number } | undefined;
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

interface DmMessageRowProps {
  message: DirectMessage;
  isOwn: boolean;
  senderName?: string;
  senderAvatar?: string | null;
  showUnreadDivider: boolean;
  onReplyToMessage: (message: DirectMessage) => void;
  onSwipeReplyToMessage: (message: DirectMessage) => void;
  onScrollToMessage: (messageId: string) => void;
  onOpenThread: (rootId: string) => void;
  onRetryMessage: (message: DirectMessage) => void;
  /** Device-local star indicator. */
  starred: boolean;
}

/**
 * DM equivalent of the group screen's MessageRow. `DmBubble` takes a projection
 * of the message rather than the message itself, so that object has to be
 * memoized here — a fresh literal per render would defeat the bubble's memo
 * outright. Same for the per-message closures.
 */
const DmMessageRow = React.memo(function DmMessageRow({
  message,
  isOwn,
  senderName,
  senderAvatar,
  showUnreadDivider,
  onReplyToMessage,
  onSwipeReplyToMessage,
  onScrollToMessage,
  onOpenThread,
  onRetryMessage,
  starred,
}: DmMessageRowProps) {
  const bubbleMessage = useMemo(() => {
    const timestamp =
      message.timestamp instanceof Date
        ? message.timestamp.toISOString()
        : String(message.timestamp);
    return {
      text: message.text,
      timestamp,
      editedAt: message.editedAt,
      removedAt: message.removedAt,
      isRemoved: message.isRemoved,
      replyCount: message.replyCount,
      receiptStatus: message.receiptStatus,
      deliveryState: message.deliveryState,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            senderName: message.replyTo.senderName,
            text: message.replyTo.text,
            isRemoved: message.replyTo.isRemoved,
          }
        : null,
    };
  }, [message]);

  const handleReply = useCallback(
    () => onReplyToMessage(message),
    [message, onReplyToMessage]
  );
  const handleSwipeReply = useCallback(
    () => onSwipeReplyToMessage(message),
    [message, onSwipeReplyToMessage]
  );
  const handleRetry = useCallback(() => onRetryMessage(message), [message, onRetryMessage]);

  return (
    <View>
      {showUnreadDivider ? <NewMessagesDivider /> : null}
      <DmBubble
        message={bubbleMessage}
        isOwn={isOwn}
        senderName={isOwn ? undefined : senderName}
        senderAvatar={isOwn ? undefined : senderAvatar}
        onReply={handleReply}
        onSwipeReply={handleSwipeReply}
        onRetry={handleRetry}
        onScrollToMessage={onScrollToMessage}
        onOpenThread={onOpenThread}
        threadRootId={message.threadRootId}
        messageId={message.id}
        starred={starred}
      />
    </View>
  );
});

export function DirectMessageScreen({ navigation, route }: Props) {
  const { threadId, recipientId, recipientName } = route.params;
  const user = useAuthStore(s => s.user);
  const {
    directMessages,
    dmThreads,
    fetchDirectMessagesForThread,
    sendDirectMessageTo,
    retryFailedDirectMessage,
    editDirectMessage,
    removeDirectMessage,
    markDMAsRead,
    fetchThread,
    fetchDmThreads,
    applyPeerChatRead,
    setActiveDmThreadId,
    archiveDmThread,
    unarchiveDmThread,
    deleteDmThread,
  } =
    useGroupStore();
  const { colors } = useTheme();

  // Past a tablet breakpoint, cap the conversation to a centered column so
  // landscape/tablet reads as a column instead of full-bleed edge-to-edge.
  const { width: windowWidth } = useWindowDimensions();
  const isWideScreen = windowWidth >= 768;
  const columnStyle: ViewStyle | undefined = isWideScreen
    ? { width: '100%', maxWidth: 680, alignSelf: 'center' }
    : undefined;

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dmRequestBusy, setDmRequestBusy] = useState(false);
  const [dmBlocked, setDmBlocked] = useState(false);
  const [iBlockedThem, setIBlockedThem] = useState(false);
  const [dmBlockBusy, setDmBlockBusy] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatMutedUntil, setChatMutedUntil] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);
  const [chatActionBusy, setChatActionBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'offers'>('chat');
  const [editingMessage, setEditingMessage] = useState<DirectMessage | null>(null);
  const [inquiry, setInquiry] = useState<ThreadInquiry>(null);
  // Order lifecycle in the DM (pay / mark-ready / confirm-received) — mirrors web's
  // order bar so a mobile deal no longer falls out of the chat at acceptance.
  const [order, setOrder] = useState<Awaited<ReturnType<typeof fetchOrderForInquiry>> | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
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
  const [threadError, setThreadError] = useState<string | null>(null);
  const listRef = useRef<FlatList<DirectMessage>>(null);
  const isNearBottomRef = useRef(true);
  const initialAnchorDoneRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(0);

  const rawMessages = directMessages[threadId] || [];
  const messages = useMemo(
    () => rawMessages.filter((message) => shouldRenderRemovedMessage(message, rawMessages)),
    [rawMessages]
  );
  // Read by handlers that must not take `messages` as a dependency.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const thread = dmThreads.find((t) => t.id === threadId);
  const peerAvatarUrl =
    (recipientId && thread?.participants?.[recipientId]?.avatarUrl) ||
    Object.entries(thread?.participants || {}).find(([id]) => id !== user?.id)?.[1]?.avatarUrl;
  const displayName =
    recipientName ||
    (recipientId && thread?.participants?.[recipientId]?.name) ||
    'Direct message';
  const { typingUserIds, broadcastTyping } = useTypingIndicator(threadId, user?.id);
  const otherIsTyping = typingUserIds.length > 0;

  const onPeerRead = useCallback(
    (payload: { userId: string; lastReadAt: string }) => {
      applyPeerChatRead({ chatId: threadId, ...payload });
    },
    [applyPeerChatRead, threadId]
  );
  useChatReadReceipts(threadId, user?.id, onPeerRead);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !recipientId) {
      setDmBlocked(false);
      setIBlockedThem(false);
      return;
    }
    void getDmBlockStatus(user.id, recipientId)
      .then((status) => {
        if (cancelled) return;
        setDmBlocked(!!status.blocked);
        setIBlockedThem(!!status.iBlockedThem);
      })
      .catch(() => {
        if (cancelled) return;
        setDmBlocked(false);
        setIBlockedThem(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, recipientId, threadId]);

  const handleToggleDmBlock = useCallback(() => {
    if (!user?.id || !recipientId || dmBlockBusy) return;
    const run = async () => {
      setDmBlockBusy(true);
      try {
        if (iBlockedThem) {
          await unblockUser(user.id, recipientId);
          setIBlockedThem(false);
          const status = await getDmBlockStatus(user.id, recipientId);
          setDmBlocked(!!status.blocked);
        } else {
          await blockUser(user.id, recipientId);
          setIBlockedThem(true);
          setDmBlocked(true);
        }
      } catch (err) {
        Alert.alert(
          iBlockedThem ? 'Could not unblock' : 'Could not block',
          err instanceof Error ? err.message : 'Please try again.'
        );
      } finally {
        setDmBlockBusy(false);
      }
    };

    if (iBlockedThem) {
      void run();
      return;
    }

    Alert.alert(
      'Block user',
      `Block ${displayName}? They won’t be able to message you, and you won’t be able to message them until you unblock.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: () => void run() },
      ]
    );
  }, [user?.id, recipientId, dmBlockBusy, iBlockedThem, displayName]);

  useEffect(() => {
    let cancelled = false;
    void getDmMuteStatus(threadId)
      .then((status) => {
        if (cancelled) return;
        setChatMuted(!!status?.muted);
        setChatMutedUntil(status?.mutedUntil ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setChatMuted(false);
        setChatMutedUntil(null);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const applyMute = useCallback(
    async (duration: ChatMuteDurationId) => {
      if (muteBusy) return;
      setMuteBusy(true);
      try {
        const status = await muteDmThread(threadId, duration);
        if (!status?.muted) {
          Alert.alert('Mute failed', 'Could not mute notifications for this chat.');
          return;
        }
        setChatMuted(true);
        setChatMutedUntil(status.mutedUntil);
      } catch {
        Alert.alert('Mute failed', 'Could not mute notifications for this chat.');
      } finally {
        setMuteBusy(false);
      }
    },
    [threadId, muteBusy]
  );

  const clearMute = useCallback(async () => {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      const status = await unmuteDmThread(threadId);
      if (!status || status.muted) {
        Alert.alert('Unmute failed', 'Could not unmute notifications for this chat.');
        return;
      }
      setChatMuted(false);
      setChatMutedUntil(null);
    } catch {
      Alert.alert('Unmute failed', 'Could not unmute notifications for this chat.');
    } finally {
      setMuteBusy(false);
    }
  }, [threadId, muteBusy]);

  const muteUntilLabel = formatMuteUntilLabel(chatMutedUntil);

  const handleToggleArchive = useCallback(async () => {
    if (!user?.id || chatActionBusy) return;
    setChatActionBusy(true);
    try {
      if (thread?.isArchived) {
        await unarchiveDmThread(threadId, user.id);
      } else {
        await archiveDmThread(threadId, user.id);
        navigation.goBack();
      }
    } catch (error) {
      Alert.alert(
        'Could not update chat',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setChatActionBusy(false);
    }
  }, [
    user?.id,
    chatActionBusy,
    thread?.isArchived,
    threadId,
    archiveDmThread,
    unarchiveDmThread,
    navigation,
  ]);

  const handleDeleteChat = useCallback(() => {
    if (!user?.id || chatActionBusy) return;
    Alert.alert(
      'Delete conversation?',
      'This removes the conversation and its history from your chats. The other person keeps their copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setChatActionBusy(true);
            void deleteDmThread(threadId, user.id)
              .then(() => navigation.goBack())
              .catch((error: unknown) => {
                Alert.alert(
                  'Delete failed',
                  error instanceof Error ? error.message : 'Please try again.'
                );
              })
              .finally(() => setChatActionBusy(false));
          },
        },
      ]
    );
  }, [user?.id, chatActionBusy, threadId, deleteDmThread, navigation]);

  // One ActionSheet for both platforms: Android's Alert caps at three buttons
  // and silently dropped Block/Delete here; the sheet lists them all and gains
  // "Report user" (Phase 1 · E). Actions that open an Alert are deferred so the
  // sheet's Modal is gone first — iOS will not stack an Alert under a Modal.
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [dmMessageTarget, setDmMessageTarget] = useState<DirectMessage | null>(null);
  const [dmMessageOverflowOpen, setDmMessageOverflowOpen] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [pinnedMessage, setPinnedMessage] = useState<{ id: string; text: string } | null>(null);
  const [forwardMessage, setForwardMessage] = useState<DirectMessage | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  const [showReportUser, setShowReportUser] = useState(false);
  const openChatMenu = useCallback(() => setChatMenuOpen(true), []);
  const afterSheet = (fn: () => void) => setTimeout(fn, Platform.OS === 'ios' ? 320 : 0);
  const chatMenuItems: ActionSheetItem[] = [
    {
      label: 'Search messages',
      icon: 'search-outline',
      onPress: () => afterSheet(() => setChatSearchOpen(true)),
    },
    {
      label: chatMuted ? 'Unmute notifications' : 'Mute',
      icon: chatMuted ? 'notifications-outline' : 'notifications-off-outline',
      onPress: () =>
        afterSheet(() => {
          if (chatMuted) {
            void clearMute();
            return;
          }
          setMuteSheetOpen(true);
        }),
    },
    {
      label: thread?.isArchived ? 'Unarchive conversation' : 'Archive conversation',
      icon: 'archive-outline',
      onPress: () => void handleToggleArchive(),
    },
    {
      label: 'Report user',
      icon: 'flag-outline',
      hint: 'Harassment, spam, scams or inappropriate messages',
      onPress: () => afterSheet(() => setShowReportUser(true)),
    },
    {
      label: iBlockedThem ? 'Unblock user' : 'Block user',
      icon: 'ban-outline',
      destructive: !iBlockedThem,
      onPress: () => afterSheet(handleToggleDmBlock),
    },
    {
      label: 'Delete conversation',
      icon: 'trash-outline',
      destructive: true,
      onPress: () => afterSheet(handleDeleteChat),
    },
  ];

  const reloadThread = useCallback(async () => {
    if (!threadRootId) return;
    try {
      const msgs = (await fetchThread(threadRootId, { threadId })) as DirectMessage[];
      setThreadMessages(msgs);
      setThreadError(null);
    } catch (error) {
      // Also the Retry path of the thread's ErrorState — it must resolve, not
      // reject, or a failed retry becomes an unhandled rejection.
      setThreadError(
        error instanceof Error ? error.message : 'Could not load this thread.'
      );
    }
  }, [fetchThread, threadId, threadRootId]);

  const handleOpenThread = useCallback(
    async (rootId: string) => {
      setThreadRootId(rootId);
      setThreadLoading(true);
      setThreadError(null);
      try {
        const msgs = (await fetchThread(rootId, { threadId })) as DirectMessage[];
        setThreadMessages(msgs);
      } catch (error) {
        // Was: close the modal, so the thread vanished silently with no way to
        // retry. Keep it open and surface the failure in place.
        setThreadError(
          error instanceof Error ? error.message : 'Could not load this thread.'
        );
      } finally {
        setThreadLoading(false);
      }
    },
    [fetchThread, threadId]
  );

  const loadThread = useCallback(async () => {
    if (!user?.id) return;
    // Keep showing last-known messages while refreshing (avoid empty flash).
    const hasCached = (useGroupStore.getState().directMessages[threadId] || []).length > 0;
    if (!hasCached) setLoading(true);
    initialAnchorDoneRef.current = false;
    setUnreadAnchorAt(undefined);
    setFirstUnreadId(null);
    setNewMessagesBelow(0);
    try {
      const [fetched, previousLastReadAt] = await Promise.all([
        fetchDirectMessagesForThread(user.id, recipientId, threadId),
        markDMAsRead(threadId, user.id),
      ]);
      setUnreadAnchorAt(previousLastReadAt ?? null);
      // The store reports failure by return value, not by throwing — several
      // callers fire it un-awaited. Without this check the catch below is dead
      // code and an offline thread renders as "Start a conversation with X".
      setLoadError(fetched ? null : 'Could not load this conversation.');
    } catch (error) {
      // Was a bare try/finally: a failed fetch left an empty list, so a 500
      // rendered as "Start a conversation with X" with no way to retry.
      setLoadError(
        error instanceof Error ? error.message : 'Could not load this conversation.'
      );
    } finally {
      setLoading(false);
    }
  }, [user?.id, recipientId, threadId, fetchDirectMessagesForThread, markDMAsRead]);

  useEffect(() => {
    setActiveDmThreadId(threadId);
    loadThread();
    return () => {
      if (useGroupStore.getState().activeDmThreadId === threadId) {
        setActiveDmThreadId(null);
      }
    };
  }, [loadThread, threadId, setActiveDmThreadId]);

  // Foreground resync for the open thread (missed realtime while backgrounded).
  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next !== 'active' || !user?.id) return;
      void fetchDirectMessagesForThread(user.id, recipientId, threadId);
      void fetchDmThreads(user.id);
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [user?.id, recipientId, threadId, fetchDirectMessagesForThread, fetchDmThreads]);

  useEffect(() => {
    let cancelled = false;
    setOrder(null);
    fetchInquiryByThread(threadId)
      .then(async data => {
        if (cancelled) return;
        setInquiry(data);
        if (data?.id) {
          try {
            const o = await fetchOrderForInquiry(data.id);
            if (!cancelled) setOrder(o ?? null);
          } catch {
            /* no order yet */
          }
        }
      })
      .catch(() => {
        /* plain DM or endpoint unavailable — no banner */
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const reloadOrder = useCallback(async () => {
    if (!inquiry?.id) return;
    try {
      const o = await fetchOrderForInquiry(inquiry.id);
      setOrder(o ?? null);
    } catch {
      /* ignore */
    }
  }, [inquiry?.id]);

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
      // Mirrors GroupChatScreen: without this a screen-reader user gets no
      // signal that messages arrived below the viewport.
      void AccessibilityInfo.announceForAccessibility(
        `${added} new message${added === 1 ? '' : 's'}`
      );
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
    try {
      if (editingMessage) {
        await editDirectMessage(threadId, editingMessage.id, trimmed);
        setEditingMessage(null);
        setText('');
        if (threadRootId) await reloadThread();
        return;
      }

      if (!overrideText) setText('');
      const replyId = replyTo?.id;
      setReplyTo(null);
      isNearBottomRef.current = true;
      await sendDirectMessageTo(user.id, recipientId, trimmed, threadId, {
        replyToMessageId: replyId,
      });
      listRef.current?.scrollToEnd({ animated: true });
      setNewMessagesBelow(0);
    } catch (error) {
      if (!overrideText && !editingMessage) setText(trimmed);
      Alert.alert(
        editingMessage ? 'Edit failed' : 'Send failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSending(false);
    }
  };

  // `handleSend` is re-created every render; going through a ref keeps the
  // attach handler's identity stable for the composer.
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  const sendImageMarkdown = useCallback(async (markdown: string) => {
    await handleSendRef.current(markdown);
  }, []);

  const attachImage = useChatImageAttach({
    chatId: threadId,
    onSendMarkdown: sendImageMarkdown,
    enabled: !!user?.id,
  });

  const beginReply = useCallback((message: DirectMessage) => {
    setEditingMessage(null);
    setReplyTo({
      id: message.id,
      senderName: message.senderId === user?.id ? 'You' : displayName,
      text: message.text,
    });
  }, [displayName, user?.id]);

  const beginEdit = useCallback((message: DirectMessage) => {
    setReplyTo(null);
    setEditingMessage(message);
    setText(message.text);
  }, []);

  const confirmRemoveMessage = useCallback((message: DirectMessage) => {
    Alert.alert(
      'Remove message?',
      'This removes the message for everyone. An audit record will be retained.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeDirectMessage(threadId, message.id)
              .then(async () => {
                if (editingMessage?.id === message.id) {
                  setEditingMessage(null);
                  setText('');
                }
                if (threadRootId) await reloadThread();
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
  }, [editingMessage?.id, reloadThread, removeDirectMessage, threadId, threadRootId]);

  // Long-press opens one sheet with every message action (the nested Alerts
  // it replaces could never show Reply, Forward, Star and Pin together).
  const showMessageActions = useCallback((message: DirectMessage) => {
    setDmMessageTarget(message);
  }, []);

  useEffect(() => {
    if (!dmMessageTarget) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setDmMessageTarget(null);
      return true;
    });
    return () => sub.remove();
  }, [dmMessageTarget]);

  // Stars and the pinned message are device-local (no backend fields yet).
  useEffect(() => {
    if (!user?.id || !threadId) return;
    let cancelled = false;
    void AsyncStorage.getItem(`lantern_starred_msgs:${user.id}:dm:${threadId}`).then((raw) => {
      if (cancelled || !raw) return;
      try {
        setStarredIds(new Set(JSON.parse(raw) as string[]));
      } catch {
        /* corrupt cache: start clean */
      }
    });
    void AsyncStorage.getItem(`lantern_pinned_msg:${user.id}:dm:${threadId}`).then((raw) => {
      if (cancelled || !raw) return;
      try {
        setPinnedMessage(JSON.parse(raw) as { id: string; text: string });
      } catch {
        /* corrupt cache: start clean */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, threadId]);

  const toggleStarMessage = useCallback(
    (message: DirectMessage) => {
      if (!user?.id) return;
      const next = new Set(starredIds);
      const starring = !next.has(message.id);
      if (starring) next.add(message.id);
      else next.delete(message.id);
      setStarredIds(next);
      void AsyncStorage.setItem(
        `lantern_starred_msgs:${user.id}:dm:${threadId}`,
        JSON.stringify([...next])
      );
      useToastStore
        .getState()
        .showToast(starring ? 'Message starred' : 'Star removed', 'success');
    },
    [threadId, user?.id, starredIds]
  );

  const togglePinMessage = useCallback(
    (message: DirectMessage) => {
      if (!user?.id) return;
      const unpinning = pinnedMessage?.id === message.id;
      const next = unpinning ? null : { id: message.id, text: (message.text || '').trim() };
      setPinnedMessage(next);
      const key = `lantern_pinned_msg:${user.id}:dm:${threadId}`;
      if (next) void AsyncStorage.setItem(key, JSON.stringify(next));
      else void AsyncStorage.removeItem(key);
      useToastStore
        .getState()
        .showToast(unpinning ? 'Unpinned' : 'Pinned in this chat', 'success');
    },
    [threadId, user?.id, pinnedMessage]
  );

  const dmMessageItems: ActionSheetItem[] = useMemo(() => {
    const message = dmMessageTarget;
    if (!message) return [];
    const canEdit = canEditChatMessage(message, user?.id);
    const canRemove = canRemoveChatMessage(message, user?.id);
    const bodyText = (message.text || '').trim();
    const plainText =
      !!bodyText && !isChatAudioMessage(message.text) && !isChatImageMessage(message.text);
    const starred = starredIds.has(message.id);
    const pinned = pinnedMessage?.id === message.id;
    const items: ActionSheetItem[] = [];
    void bodyText;
    void plainText;
    void starred;
    void pinned;
    if (canEdit) {
      items.push({
        label: 'Edit',
        icon: 'create-outline',
        onPress: () => beginEdit(message),
      });
    }
    if (canRemove) {
      items.push({
        label: 'Remove',
        icon: 'trash-outline',
        destructive: true,
        onPress: () => afterSheet(() => confirmRemoveMessage(message)),
      });
    }
    return items;
  }, [
    dmMessageTarget,
    user?.id,
    starredIds,
    pinnedMessage,
    beginReply,
    beginEdit,
    confirmRemoveMessage,
    toggleStarMessage,
    togglePinMessage,
  ]);

  // Reads the list through a ref so its identity survives every new message —
  // otherwise every row re-renders whenever the thread grows.
  const chatSearchMatches = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!chatSearchOpen || q.length < 2) return [] as string[];
    return messages
      .filter((m) => (m.text || '').toLowerCase().includes(q))
      .map((m) => m.id);
  }, [chatSearchOpen, chatSearchQuery, messages]);

  const handleScrollToMessage = useCallback((messageId: string) => {
    const index = messagesRef.current.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
    }
  }, []);

  const jumpToChatMatch = useCallback(
    (nextIndex: number) => {
      if (chatSearchMatches.length === 0) return;
      const wrapped = (nextIndex + chatSearchMatches.length) % chatSearchMatches.length;
      setChatSearchIndex(wrapped);
      handleScrollToMessage(chatSearchMatches[wrapped]);
    },
    [chatSearchMatches, handleScrollToMessage]
  );

  const closeChatSearch = useCallback(() => {
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchIndex(0);
  }, []);

  const handleRetryMessage = useCallback(
    (message: DirectMessage) => {
      if (!user?.id) return;
      void retryFailedDirectMessage(threadId, message.id, user.id).catch(() => undefined);
    },
    [retryFailedDirectMessage, threadId, user?.id]
  );

  // DmMessageRow is memoized, so the list has to be told when the values the
  // rows are *given* change — otherwise the unread divider goes stale.
  const listExtraData = useMemo(
    () => ({ firstUnreadId, userId: user?.id, displayName, peerAvatarUrl, starredIds }),
    [firstUnreadId, user?.id, displayName, peerAvatarUrl, starredIds]
  );

  const handleBack = useCallback(() => {
    // canGoBack() is true whenever *any* navigator up the tree can go back, so
    // on a DM opened straight from the marketplace it pops the tab instead of
    // the chat stack and dumps the user back in Explore. Only pop when there is
    // genuinely a chat screen underneath; otherwise go to the chat list.
    const hasScreenBelow = (navigation.getState?.()?.index ?? 0) > 0;
    if (hasScreenBelow) {
      navigation.goBack();
    } else {
      navigation.navigate('GroupsList');
    }
  }, [navigation]);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      {dmMessageTarget ? (
        <MessageActionBar
          onClose={() => setDmMessageTarget(null)}
          onReply={() => {
            const m = dmMessageTarget;
            setDmMessageTarget(null);
            beginReply(m);
          }}
          onForward={
            (dmMessageTarget.text || '').trim() &&
            !isChatAudioMessage(dmMessageTarget.text) &&
            !isChatImageMessage(dmMessageTarget.text)
              ? () => {
                  const m = dmMessageTarget;
                  setDmMessageTarget(null);
                  setForwardMessage(m);
                }
              : undefined
          }
          onCopy={
            (dmMessageTarget.text || '').trim() &&
            !isChatAudioMessage(dmMessageTarget.text) &&
            !isChatImageMessage(dmMessageTarget.text)
              ? () => {
                  const m = dmMessageTarget;
                  setDmMessageTarget(null);
                  void Clipboard.setStringAsync((m.text || '').trim());
                }
              : undefined
          }
          onStar={() => {
            const m = dmMessageTarget;
            setDmMessageTarget(null);
            toggleStarMessage(m);
          }}
          onPin={() => {
            const m = dmMessageTarget;
            setDmMessageTarget(null);
            togglePinMessage(m);
          }}
          starred={starredIds.has(dmMessageTarget.id)}
          pinned={pinnedMessage?.id === dmMessageTarget.id}
          onMore={dmMessageItems.length > 0 ? () => {
            setDmMessageOverflowOpen(true);
          } : undefined}
        />
      ) : (
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface">
        <Pressable
          onPress={handleBack}
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <ResolvedAvatar
          name={displayName}
          uri={resolveAvatarSrc(peerAvatarUrl)}
          size={36}
        />
        <Text className="flex-1 text-base font-semibold text-lantern-text" numberOfLines={1}>
          {displayName}
        </Text>
        <Pressable
          onPress={openChatMenu}
          disabled={chatActionBusy}
          className="p-2 rounded-lg active:bg-lantern-background-secondary dark:active:bg-lantern-surface-secondary"
          accessibilityLabel="Conversation options"
        >
          <Ionicons name="ellipsis-vertical" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      )}

      {thread?.isArchived || chatMuted ? (
        <View className="flex-row items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40">
          <Ionicons name="information-circle-outline" size={13} color="#d97706" />
          <Text
            className="flex-1 text-[11px] text-amber-800 dark:text-amber-300"
            numberOfLines={1}
          >
            {[
              thread?.isArchived ? 'Archived' : null,
              chatMuted ? `Muted${muteUntilLabel ? ` until ${muteUntilLabel}` : ''}` : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </Text>
          {thread?.isArchived ? (
            <Pressable
              onPress={() => void handleToggleArchive()}
              disabled={chatActionBusy}
              className="px-1.5 py-0.5"
              accessibilityLabel="Unarchive conversation"
            >
              <Text className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                Unarchive
              </Text>
            </Pressable>
          ) : null}
          {chatMuted ? (
            <Pressable
              onPress={() => void clearMute()}
              disabled={muteBusy}
              className="px-1.5 py-0.5"
              accessibilityLabel="Unmute notifications"
            >
              <Text className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                Unmute
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Marketplace DM: listing summary folded into the Chat/Offers row so it
          costs one fixed bar instead of two. */}
      {inquiry?.listing ? (
        <View
          className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface"
          style={columnStyle}
        >
          <Pressable
            onPress={openListing}
            className="flex-row items-center gap-2 flex-1 min-w-0 active:opacity-70"
            accessibilityLabel={`View listing ${inquiry.listing.title}`}
          >
            {inquiry.listing.images?.[0] ? (
              <Image
                source={{ uri: normalizeStorageUrl(inquiry.listing.images[0]) }}
                className="w-9 h-9 rounded-lg bg-lantern-background-secondary"
                resizeMode="cover"
              />
            ) : (
              <View className="w-9 h-9 rounded-lg bg-lantern-background-secondary items-center justify-center">
                <Ionicons name="pricetag-outline" size={16} color="#6366f1" />
              </View>
            )}
            <View className="flex-1 min-w-0">
              <Text className="text-xs font-semibold text-lantern-text" numberOfLines={1}>
                {inquiry.listing.title}
              </Text>
              <View className="flex-row items-center gap-1.5">
                <Text
                  className="text-[11px] font-bold text-lantern-primary"
                  numberOfLines={1}
                >
                  {inquiry.listing.price
                    ? `₦${Number(inquiry.listing.price).toLocaleString()}`
                    : 'Free'}
                </Text>
                <Text
                  className="text-[10px] text-lantern-text-secondary capitalize"
                  numberOfLines={1}
                >
                  · {inquiry.status}
                </Text>
              </View>
            </View>
          </Pressable>

          {/* Chat / Offers segmented control, mirroring web's marketplace tabs. */}
          <View className="flex-row gap-1">
            {(['chat', 'offers'] as const).map((tab) => {
              const active = activeTab === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  className={`px-3 py-1.5 rounded-lg ${
                    active ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      active ? 'text-white' : 'text-lantern-text-secondary'
                    }`}
                  >
                    {tab === 'chat' ? 'Chat' : 'Offers'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Order lifecycle bar — the deal no longer falls out of the chat at
          acceptance. Shows the order status plus the one role-scoped action
          (buyer Pay now / Confirm received; seller Mark ready). Mirrors web. */}
      {order && order.status !== 'completed' && order.status !== 'cancelled' ? (
        <View className="px-4 py-2.5 bg-lantern-primary-background border-b border-lantern-border flex-row flex-wrap items-center gap-2">
          <Text className="text-xs font-semibold text-lantern-text">
            Order: {order.status.replace(/_/g, ' ')} · ₦{Number(order.amount).toLocaleString()}
          </Text>
          {inquiry?.seller_id === user?.id && order.status === 'paid' ? (
            <Pressable
              disabled={orderBusy}
              onPress={async () => {
                setOrderBusy(true);
                try { await updateMarketplaceOrder(order.id, { action: 'mark_ready' }); await reloadOrder(); }
                catch (e: any) { Alert.alert('Error', e?.message || 'Something went wrong'); }
                finally { setOrderBusy(false); }
              }}
              className="px-3 py-1.5 rounded-lantern bg-lantern-primary"
            >
              <Text className="text-xs font-semibold text-white">Mark ready</Text>
            </Pressable>
          ) : null}
          {inquiry?.seller_id === user?.id && ['pending_payment', 'awaiting_payment'].includes(order.status) ? (
            <Text className="text-xs text-lantern-text-secondary">Awaiting buyer payment</Text>
          ) : null}
          {inquiry?.buyer_id === user?.id && ['pending_payment', 'awaiting_payment'].includes(order.status) ? (
            <Pressable
              disabled={orderBusy}
              onPress={async () => {
                setOrderBusy(true);
                try {
                  const res = await resumeMarketplaceOrderCheckout(order.id);
                  const url = res?.authorizationUrl;
                  if (url) {
                    const WB = await import('expo-web-browser');
                    await WB.openBrowserAsync(url);
                    // Re-fetch on return so the bar advances past "Pay now" once paid,
                    // instead of stranding a stale Pay-now that errors on a second tap.
                    await reloadOrder();
                  } else {
                    Alert.alert('Checkout', 'Could not start checkout. Please try again.');
                  }
                } catch (e: any) { Alert.alert('Error', e?.message || 'Could not start checkout'); }
                finally { setOrderBusy(false); }
              }}
              className="px-3 py-1.5 rounded-lantern bg-emerald-600"
            >
              <Text className="text-xs font-semibold text-white">Pay now · ₦{Number(order.amount).toLocaleString()}</Text>
            </Pressable>
          ) : null}
          {inquiry?.buyer_id === user?.id && ['paid', 'ready_for_pickup'].includes(order.status) ? (
            <Pressable
              disabled={orderBusy}
              onPress={async () => {
                setOrderBusy(true);
                try { await updateMarketplaceOrder(order.id, { action: 'confirm_received' }); await reloadOrder(); }
                catch (e: any) { Alert.alert('Error', e?.message || 'Something went wrong'); }
                finally { setOrderBusy(false); }
              }}
              className="px-3 py-1.5 rounded-lantern bg-emerald-600"
            >
              <Text className="text-xs font-semibold text-white">Confirm received</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {inquiry?.listing && activeTab === 'offers' ? (
        <DmOffersPanel
          listingId={inquiry.listing.id || inquiry.listing_id || ''}
          buyerId={inquiry.buyer_id}
          currentUserId={user?.id || ''}
          isSeller={inquiry.seller_id === user?.id}
          onPostToChat={async (text) => {
            if (!user?.id || !recipientId) return;
            await sendDirectMessageTo(user.id, recipientId, text, threadId);
          }}
          onDealChanged={reloadOrder}
          hasLiveOrder={!!order && order.status !== 'cancelled' && order.status !== 'completed'}
        />
      ) : (
        <>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View className="flex-1" style={columnStyle}>
        {loading && messages.length === 0 ? (
          <LoadingState label="Loading conversation" />
        ) : loadError && messages.length === 0 ? (
          <ErrorState message={loadError} onRetry={() => void loadThread()} />
        ) : (
          <View className="flex-1">
            {chatSearchOpen ? (
              <View className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface">
                <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
                <TextInput
                  value={chatSearchQuery}
                  onChangeText={(v) => {
                    setChatSearchQuery(v);
                    setChatSearchIndex(0);
                  }}
                  placeholder="Search this chat…"
                  placeholderTextColor={colors.inputPlaceholder}
                  autoFocus
                  autoCorrect={false}
                  className="flex-1 text-sm text-lantern-text py-1"
                  accessibilityLabel="Search messages in this chat"
                />
                <Text className="text-xs text-lantern-text-secondary">
                  {chatSearchMatches.length > 0
                    ? `${chatSearchIndex + 1}/${chatSearchMatches.length}`
                    : chatSearchQuery.trim().length >= 2
                      ? '0'
                      : ''}
                </Text>
                <Pressable
                  onPress={() => jumpToChatMatch(chatSearchIndex + 1)}
                  hitSlop={6}
                  accessibilityLabel="Previous match"
                  disabled={chatSearchMatches.length === 0}
                >
                  <Ionicons name="chevron-up" size={20} color={colors.text} />
                </Pressable>
                <Pressable
                  onPress={() => jumpToChatMatch(chatSearchIndex - 1)}
                  hitSlop={6}
                  accessibilityLabel="Next match"
                  disabled={chatSearchMatches.length === 0}
                >
                  <Ionicons name="chevron-down" size={20} color={colors.text} />
                </Pressable>
                <Pressable onPress={closeChatSearch} hitSlop={6} accessibilityLabel="Close search">
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : null}
            {pinnedMessage ? (
              <Pressable
                onPress={() => handleScrollToMessage(pinnedMessage.id)}
                className="flex-row items-center gap-2 px-3 py-2 bg-lantern-primary-background border-b border-lantern-border"
                accessibilityRole="button"
                accessibilityLabel="Jump to pinned message"
              >
                <Ionicons name="pin" size={14} color={colors.primary} />
                <Text className="flex-1 text-[12px] text-lantern-text" numberOfLines={1}>
                  {pinnedMessage.text || 'Pinned message'}
                </Text>
                <Pressable
                  onPress={() => togglePinMessage({ id: pinnedMessage.id, text: pinnedMessage.text } as DirectMessage)}
                  hitSlop={8}
                  accessibilityLabel="Unpin message"
                >
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              </Pressable>
            ) : null}
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={item => item.id}
              {...CHAT_LIST_WINDOWING}
              className="flex-1"
              style={{ backgroundColor: colors.chatBackground }}
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
              ListHeaderComponent={
                loadError ? (
                  <InlineErrorBanner
                    title="Couldn't refresh this conversation"
                    detail="Showing the messages saved on this device."
                    onRetry={() => void loadThread()}
                  />
                ) : null
              }
              ListEmptyComponent={
                <EmptyState
                  icon="chatbubble-ellipses-outline"
                  title={`Start a conversation with ${displayName}`}
                />
              }
              // DmMessageRow is memoized and closes over none of these.
              extraData={listExtraData}
              renderItem={({ item }) => (
                <DmMessageRow
                  message={item}
                  isOwn={item.senderId === user?.id}
                  senderName={displayName}
                  senderAvatar={
                    item.senderId === user?.id
                      ? undefined
                      : peerAvatarUrl || item.senderAvatar || undefined
                  }
                  showUnreadDivider={firstUnreadId === item.id}
                  onReplyToMessage={showMessageActions}
                  onSwipeReplyToMessage={beginReply}
                  onScrollToMessage={handleScrollToMessage}
                  onOpenThread={handleOpenThread}
                  onRetryMessage={handleRetryMessage}
                  starred={starredIds.has(item.id)}
                />
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
        {thread?.status === 'pending' &&
        thread.requestedBy &&
        thread.requestedBy !== user?.id ? (
          <View
            className="px-4 py-3 border-t"
            style={{ backgroundColor: colors.primaryBackground, borderTopColor: colors.border }}
          >
            <Text className="text-sm mb-2" style={{ color: colors.text }}>
              Message request — reply or accept to open a two-way chat. Decline to keep it one-way.
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                disabled={dmRequestBusy}
                onPress={() => {
                  void (async () => {
                    setDmRequestBusy(true);
                    try {
                      await acceptDmMessageRequest(threadId);
                      if (user?.id) await fetchDmThreads(user.id);
                    } catch (err) {
                      Alert.alert(
                        'Could not accept',
                        err instanceof Error ? err.message : 'Please try again.'
                      );
                    } finally {
                      setDmRequestBusy(false);
                    }
                  })();
                }}
                className="px-3 py-2 rounded-lg"
                style={{ backgroundColor: colors.primary, opacity: dmRequestBusy ? 0.6 : 1 }}
              >
                <Text className="text-sm font-semibold text-white">Accept</Text>
              </Pressable>
              <Pressable
                disabled={dmRequestBusy}
                onPress={() => {
                  void (async () => {
                    setDmRequestBusy(true);
                    try {
                      await declineDmMessageRequest(threadId);
                      if (user?.id) await fetchDmThreads(user.id);
                    } catch (err) {
                      Alert.alert(
                        'Could not decline',
                        err instanceof Error ? err.message : 'Please try again.'
                      );
                    } finally {
                      setDmRequestBusy(false);
                    }
                  })();
                }}
                className="px-3 py-2 rounded-lg border"
                style={{ borderColor: colors.border, opacity: dmRequestBusy ? 0.6 : 1 }}
              >
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  Decline
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {thread?.status === 'pending' && thread.requestedBy === user?.id ? (
          <Text
            className="px-4 py-2 text-xs border-t"
            style={{ color: colors.textSecondary, borderTopColor: colors.border }}
          >
            Message request sent — they can see your messages. Two-way chat opens when they accept or
            reply.
          </Text>
        ) : null}
        {dmBlocked ? (
          <View
            className="px-4 py-3 border-t items-center gap-2"
            style={{ borderTopColor: colors.border, backgroundColor: colors.surface }}
          >
            <Text className="text-sm text-center" style={{ color: colors.textSecondary }}>
              {iBlockedThem
                ? 'You blocked this user. Messaging is disabled until you unblock them.'
                : 'You can’t message this user.'}
            </Text>
            {iBlockedThem ? (
              <Pressable
                disabled={dmBlockBusy}
                onPress={handleToggleDmBlock}
                className="px-3 py-2 rounded-lg border"
                style={{ borderColor: colors.border, opacity: dmBlockBusy ? 0.6 : 1 }}
              >
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  Unblock
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : thread?.status === 'declined' &&
          thread.requestedBy &&
          thread.requestedBy !== user?.id ? (
          <Text
            className="px-4 py-3 text-sm border-t"
            style={{ color: colors.textSecondary, borderTopColor: colors.border }}
          >
            You declined this message request. It stays one-way unless they send again.
          </Text>
        ) : (
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
            editingMessage={
              editingMessage ? { id: editingMessage.id, text: editingMessage.text } : null
            }
            onCancelEdit={() => {
              setEditingMessage(null);
              setText('');
            }}
            onSendAudioMarkdown={async (markdown) => {
              await handleSend(markdown);
            }}
            onAttachImage={attachImage}
          />
        )}
        </View>
      </KeyboardAvoidingView>
      </>
      )}

      <ChatThreadModal
        visible={!!threadRootId}
        onClose={() => {
          setThreadRootId(null);
          setThreadMessages([]);
          setThreadError(null);
        }}
        rootId={threadRootId}
        loading={threadLoading}
        loadError={threadError}
        messages={threadMessages}
        onReload={reloadThread}
        onSend={async (text, replyToMessageId) => {
          if (!user?.id) return;
          await sendDirectMessageTo(user.id, recipientId, text, threadId, { replyToMessageId });
        }}
        onEdit={(messageId, content) =>
          editDirectMessage(threadId, messageId, content)
        }
        onRemove={(messageId) => removeDirectMessage(threadId, messageId)}
        currentUserId={user?.id}
        otherDisplayName={displayName}
        otherAvatarUrl={peerAvatarUrl}
        threadId={threadId}
      />
      <ActionSheet
        visible={dmMessageOverflowOpen}
        title="More"
        items={dmMessageItems.map((item) => ({
          ...item,
          onPress: () => {
            setDmMessageOverflowOpen(false);
            setDmMessageTarget(null);
            item.onPress();
          },
        }))}
        onClose={() => setDmMessageOverflowOpen(false)}
      />
      <ForwardMessageSheet
        visible={!!forwardMessage}
        onClose={() => setForwardMessage(null)}
        messageText={(forwardMessage?.text || '').trim()}
      />
      <ActionSheet
        visible={chatMenuOpen}
        title="Conversation"
        items={chatMenuItems}
        onClose={() => setChatMenuOpen(false)}
      />
      <ActionSheet
        visible={muteSheetOpen}
        title="Mute"
        items={CHAT_MUTE_DURATIONS.map((opt) => ({
          label: opt.label,
          icon: 'notifications-off-outline' as const,
          onPress: () => void applyMute(opt.id),
        }))}
        onClose={() => setMuteSheetOpen(false)}
      />
      <ReportContentSheet
        visible={showReportUser}
        targetType="user"
        targetId={recipientId}
        targetLabel={displayName}
        onClose={() => setShowReportUser(false)}
      />
    </SafeAreaView>
  );
}

export default DirectMessageScreen;
