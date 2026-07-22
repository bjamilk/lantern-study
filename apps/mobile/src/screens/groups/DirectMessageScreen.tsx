import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { normalizeStorageUrl } from '@lantern/shared/utils';
import { useAuthStore } from '../../stores';
import { useGroupStore, type DirectMessage } from '../../stores/groupStore';
import { Avatar, Button } from '../../components/ui';
import { DmBubble } from '../../components/chat/DmBubble';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { fetchInquiryByThread } from '../../services/api';

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

function DmBubbleWrapper({
  message,
  isOwn,
  senderName,
}: {
  message: DirectMessage;
  isOwn: boolean;
  senderName?: string;
}) {
  const timestamp =
    message.timestamp instanceof Date ? message.timestamp.toISOString() : message.timestamp;
  return (
    <DmBubble
      message={{ text: message.text, timestamp }}
      isOwn={isOwn}
      senderName={isOwn ? undefined : senderName}
    />
  );
}

export function DirectMessageScreen({ navigation, route }: Props) {
  const { threadId, recipientId, recipientName } = route.params;
  const user = useAuthStore(s => s.user);
  const { directMessages, fetchDirectMessagesForThread, sendDirectMessageTo, markDMAsRead } =
    useGroupStore();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inquiry, setInquiry] = useState<ThreadInquiry>(null);
  const listRef = useRef<FlatList<DirectMessage>>(null);

  const messages = directMessages[threadId] || [];
  const displayName = recipientName || 'Direct message';
  const { typingUserIds, broadcastTyping } = useTypingIndicator(threadId, user?.id);
  const otherIsTyping = typingUserIds.length > 0;

  const loadThread = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      await Promise.all([
        fetchDirectMessagesForThread(user.id, recipientId, threadId),
        markDMAsRead(threadId, user.id),
      ]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, recipientId, threadId, fetchDirectMessagesForThread, markDMAsRead]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // Marketplace context: if this DM started from a listing inquiry, surface it.
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

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !user?.id || sending) return;
    setSending(true);
    setText('');
    try {
      await sendDirectMessageTo(user.id, recipientId, trimmed, threadId);
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
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            className="flex-1"
            contentContainerClassName="px-4 py-4 flex-grow"
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-16">
                <Text className="text-sm text-lantern-text-secondary">
                  Start a conversation with {displayName}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <DmBubbleWrapper
                message={item}
                isOwn={item.senderId === user?.id}
                senderName={displayName}
              />
            )}
          />
        )}

        {otherIsTyping ? (
          <Text className="px-4 py-1 text-xs text-lantern-text-secondary">
            {displayName} is typing…
          </Text>
        ) : null}
        <View className="flex-row items-end gap-2 px-3 py-2 border-t border-lantern-border bg-lantern-surface">
          <TextInput
            value={text}
            onChangeText={value => {
              setText(value);
              broadcastTyping();
            }}
            placeholder="Message..."
            placeholderTextColor="#94a3b8"
            multiline
            className="flex-1 max-h-28 px-3 py-2.5 rounded-2xl border border-lantern-border bg-lantern-background text-sm text-lantern-text"
          />
          <Button size="sm" loading={sending} disabled={!text.trim()} onPress={handleSend}>
            Send
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default DirectMessageScreen;
