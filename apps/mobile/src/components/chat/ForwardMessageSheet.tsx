import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import { useAuthStore } from '../../stores/authStore';
import { useGroupStore } from '../../stores/groupStore';
import { useToastStore } from '../../stores/toastStore';
import { useTheme } from '../../theme';
import { ResolvedAvatar } from '../ResolvedAvatar';

interface ForwardTarget {
  key: string;
  kind: 'group' | 'dm';
  id: string;
  name: string;
  avatarUrl?: string | null;
  /** DM targets only. */
  otherUserId?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Plain text to forward (question stem for question messages). */
  messageText: string;
}

/**
 * Pick a chat to forward a message's text into. Sends through the same store
 * paths as the composer, so optimistic delivery, retries and receipts all
 * behave like a normally typed message.
 */
export function ForwardMessageSheet({ visible, onClose, messageText }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const profileName = useAuthStore((s) => s.profileName);
  const groups = useGroupStore((s) => s.groups);
  const dmThreads = useGroupStore((s) => s.dmThreads);
  const [query, setQuery] = useState('');
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const targets = useMemo(() => {
    const uid = user?.id;
    const out: ForwardTarget[] = [];
    for (const g of groups) {
      if (g.isArchived) continue;
      out.push({ key: `g:${g.id}`, kind: 'group', id: g.id, name: g.name, avatarUrl: g.avatarUrl });
    }
    for (const t of dmThreads) {
      if (t.isArchived || t.status === 'declined') continue;
      const otherUserId = (t.participantIds || []).find((p) => p !== uid);
      if (!otherUserId) continue;
      const other = t.participants?.[otherUserId];
      out.push({
        key: `d:${t.id}`,
        kind: 'dm',
        id: t.id,
        name: other?.name || 'Direct chat',
        avatarUrl: other?.avatarUrl,
        otherUserId,
      });
    }
    const q = query.trim().toLowerCase();
    return q ? out.filter((t) => t.name.toLowerCase().includes(q)) : out;
  }, [groups, dmThreads, user?.id, query]);

  const handlePick = async (target: ForwardTarget) => {
    const uid = user?.id;
    if (!uid || !messageText.trim() || sendingKey) return;
    setSendingKey(target.key);
    const store = useGroupStore.getState();
    try {
      if (target.kind === 'group') {
        await store.sendMessage(target.id, messageText.trim(), uid, profileName || undefined);
      } else {
        await store.sendDirectMessageTo(uid, target.otherUserId!, messageText.trim(), target.id);
      }
      useToastStore.getState().showToast(`Forwarded to ${target.name}`, 'success');
      onClose();
    } catch {
      useToastStore.getState().showToast(`Could not forward to ${target.name}`, 'error');
    } finally {
      setSendingKey(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.modalOverlay }}
        onPress={onClose}
      >
        <Pressable
          className="rounded-t-2xl px-4 pt-3"
          style={{
            backgroundColor: colors.modalBackground,
            paddingBottom: insets.bottom + 16,
            maxHeight: '75%',
          }}
          onPress={(e) => e.stopPropagation()}
        >
          <View
            className="w-10 h-1 rounded-full self-center mb-3"
            style={{ backgroundColor: colors.border }}
          />
          <Text className="text-sm font-semibold mb-2 px-1" style={{ color: colors.textSecondary }}>
            Forward to…
          </Text>
          <View className="flex-row items-center gap-2 px-3 mb-2 rounded-xl border border-lantern-border bg-lantern-background-secondary min-h-[42px]">
            <Ionicons name="search" size={15} color={colors.inputPlaceholder} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search chats…"
              placeholderTextColor={colors.inputPlaceholder}
              autoCorrect={false}
              className="flex-1 text-sm py-1"
              style={{ color: colors.text }}
              accessibilityLabel="Search chats to forward to"
            />
          </View>
          <FlatList
            data={targets}
            keyExtractor={(t) => t.key}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text className="text-sm text-center py-6" style={{ color: colors.textSecondary }}>
                No chats found
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void handlePick(item)}
                disabled={!!sendingKey}
                accessibilityRole="button"
                accessibilityLabel={`Forward to ${item.name}`}
                className="flex-row items-center gap-3 px-2 py-2.5 rounded-xl active:bg-lantern-background-secondary"
                style={{ opacity: sendingKey && sendingKey !== item.key ? 0.5 : 1 }}
              >
                <ResolvedAvatar name={item.name} uri={resolveAvatarSrc(item.avatarUrl)} size={38} />
                <Text className="flex-1 text-base font-medium" style={{ color: colors.text }} numberOfLines={1}>
                  {item.name}
                </Text>
                {sendingKey === item.key ? (
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Sending…
                  </Text>
                ) : (
                  <Ionicons name="arrow-redo-outline" size={18} color={colors.primary} />
                )}
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default ForwardMessageSheet;
