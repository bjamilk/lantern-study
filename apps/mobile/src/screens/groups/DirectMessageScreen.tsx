import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores';
import { useGroupStore, type DirectMessage } from '../../stores/groupStore';
import { Avatar, Button } from '../../components/ui';
import { DmBubble } from '../../components/chat/DmBubble';

type NavigationProp = {
  goBack: () => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params: { threadId: string; recipientId: string; recipientName?: string } };
}

function DmBubbleWrapper({ message, isOwn }: { message: DirectMessage; isOwn: boolean }) {
  return (
    <DmBubble
      message={{ text: message.text, timestamp: message.timestamp }}
      isOwn={isOwn}
      senderName={isOwn ? undefined : message.senderName}
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
  const listRef = useRef<FlatList<DirectMessage>>(null);

  const messages = directMessages[threadId] || [];
  const displayName = recipientName || 'Direct message';

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

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top', 'bottom']}>
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <Pressable
          onPress={() => navigation.goBack()}
          className="p-2 rounded-lg active:bg-slate-100 dark:active:bg-slate-700"
        >
          <Ionicons name="arrow-back" size={22} color="#475569" />
        </Pressable>
        <View className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 items-center justify-center">
          <Ionicons name="person" size={18} color="#6366f1" />
        </View>
        <Text className="flex-1 text-base font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
          {displayName}
        </Text>
      </View>

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
            contentContainerClassName="px-4 py-4 flex-grow"
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-16">
                <Text className="text-sm text-slate-500 dark:text-slate-400">
                  Start a conversation with {displayName}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <DmBubbleWrapper message={item} isOwn={item.senderId === user?.id} />
            )}
          />
        )}

        <View className="flex-row items-end gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message..."
            placeholderTextColor="#94a3b8"
            multiline
            className="flex-1 max-h-28 px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100"
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
