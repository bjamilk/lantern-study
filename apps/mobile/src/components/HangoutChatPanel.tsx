import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchMessages, sendMessage } from '../services/api';
import { useAuthStore } from '../stores';

export interface HangoutChatPanelProps {
  groupId: string;
  title?: string;
  onOpenInChats?: () => void;
}

type HangoutRow = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
};

function asRow(raw: unknown): HangoutRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === 'string' ? m.id : null;
  if (!id) return null;
  const sender = m.sender && typeof m.sender === 'object' ? (m.sender as Record<string, unknown>) : null;
  return {
    id,
    senderId: String(m.senderId || m.sender_id || sender?.id || ''),
    senderName: String(sender?.name || m.senderName || 'Student'),
    text: String(m.text || m.content || '').trim(),
  };
}

/**
 * Thin in-place thread for community lounges and study rooms.
 * Reuses GET/POST /messages/group/:id — not GroupChatScreen.
 */
export function HangoutChatPanel({
  groupId,
  title = 'Hangout',
  onOpenInChats,
}: HangoutChatPanelProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const [rows, setRows] = useState<HangoutRow[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchMessages(groupId, { limit: 50 });
      const list = Array.isArray(result) ? result : (result as { data?: unknown[] })?.data || [];
      setRows(list.map(asRow).filter((row): row is HangoutRow => !!row));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the hangout');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
    const tick = setInterval(() => {
      void load();
    }, 4000);
    return () => clearInterval(tick);
  }, [load]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !userId || sending) return;
    setSending(true);
    try {
      await sendMessage(groupId, userId, { content });
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="rounded-xl border border-lantern-border bg-lantern-surface overflow-hidden">
      <View className="flex-row items-center justify-between px-3 py-2 border-b border-lantern-border">
        <Text className="text-[11px] font-semibold uppercase text-lantern-text-tertiary">{title}</Text>
        {onOpenInChats ? (
          <Pressable onPress={onOpenInChats} accessibilityRole="button" accessibilityLabel="Open in Chats">
            <Text className="text-xs font-medium text-lantern-primary">Open in Chats</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={{ minHeight: 160, maxHeight: 280 }} keyboardShouldPersistTaps="handled">
        {loading && rows.length === 0 ? (
          <ActivityIndicator className="mt-8" />
        ) : rows.length === 0 ? (
          <Text className="px-3 py-8 text-center text-sm text-lantern-text-secondary">
            Say something — this is the hangout.
          </Text>
        ) : (
          rows.map((item) => {
            const own = !!userId && item.senderId === userId;
            return (
              <View key={item.id} className={`px-3 py-1 ${own ? 'items-end' : 'items-start'}`}>
                <View
                  className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${
                    own ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
                  }`}
                >
                  {!own ? (
                    <Text className="text-[10px] text-lantern-text-tertiary mb-0.5">{item.senderName}</Text>
                  ) : null}
                  <Text className={`text-sm ${own ? 'text-white' : 'text-lantern-text'}`}>
                    {item.text || ' '}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
      {error ? <Text className="px-3 pb-1 text-xs text-red-500">{error}</Text> : null}
      <View className="flex-row items-end gap-2 border-t border-lantern-border p-2">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message…"
          multiline
          className="flex-1 min-h-[40px] max-h-[88px] rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
        />
        <Pressable
          onPress={() => void send()}
          disabled={sending || !draft.trim()}
          className="rounded-lg bg-lantern-primary px-3 py-2"
          style={{ opacity: sending || !draft.trim() ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Text className="text-sm font-semibold text-white">{sending ? '…' : 'Send'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default HangoutChatPanel;
