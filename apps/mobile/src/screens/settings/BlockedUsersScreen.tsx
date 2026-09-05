// ===========================================
// Lantern Study Mobile - Blocked Users
// ===========================================
// `listBlockedUsers` existed with no caller, which made blocking one-way: once
// you blocked someone you had to remember which DM you did it from to undo it.
// This is the roster and the unblock action.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useAuthStore } from '../../stores';
import { ScreenHeader } from '../../components/ui';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { listBlockedUsers, unblockUser, fetchUserProfile } from '../../services/api';
import { useTheme } from '../../theme';
import { AppIcon } from '../../components/ui/AppIcon';

interface BlockedUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface Props {
  navigation: { goBack: () => void; canGoBack?: () => boolean };
}

export function BlockedUsersScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const user = useAuthStore(s => s.user);
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      const result = await listBlockedUsers(user.id);
      const ids = result?.blockedUserIds ?? [];
      // The endpoint returns ids only, so each row has to be hydrated. A profile
      // that fails to load still gets a row — otherwise the user silently loses
      // the ability to unblock someone.
      const hydrated = await Promise.all(
        ids.map(async (id): Promise<BlockedUser> => {
          try {
            const profile = await fetchUserProfile(id);
            return { id, name: profile?.name || 'Unknown user', avatarUrl: profile?.avatar_url };
          } catch {
            return { id, name: 'Unknown user' };
          }
        })
      );
      setBlocked(hydrated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load blocked users.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleUnblock = useCallback(
    (target: BlockedUser) => {
      if (!user?.id || busyId) return;
      Alert.alert(
        `Unblock ${target.name}?`,
        'They will be able to message you again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unblock',
            onPress: () => {
              void (async () => {
                setBusyId(target.id);
                try {
                  await unblockUser(user.id, target.id);
                  setBlocked(prev => prev.filter(b => b.id !== target.id));
                } catch (err) {
                  Alert.alert(
                    'Could not unblock',
                    err instanceof Error ? err.message : 'Please try again.'
                  );
                } finally {
                  setBusyId(null);
                }
              })();
            },
          },
        ]
      );
    },
    [user?.id, busyId]
  );

  return (
    <Screen bottom="none">
      <ScreenHeader
        title="Blocked users"
        subtitle={blocked.length > 0 ? `${blocked.length} blocked` : undefined}
        onBack={() => navigation.goBack()}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && blocked.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <AppIcon name="alert-circle" size={40} color={colors.textTertiary} />
          <Text className="text-sm text-center text-lantern-text-secondary">{error}</Text>
          <Pressable
            onPress={() => void load()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading blocked users"
            className="px-4 py-2 rounded-xl bg-lantern-primary"
          >
            <Text className="text-sm font-semibold text-white">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={blocked}
          keyExtractor={item => item.id}
          // The list had no bottom padding at all, so the last row's Unblock
          // button ended under the system navigation bar.
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            error ? (
              <View
                className="mx-4 mt-3 px-3 py-2 rounded-xl flex-row items-center gap-2"
                style={{ backgroundColor: `${colors.error}18` }}
              >
                <AppIcon name="warning" size={16} color={colors.error} />
                <Text className="flex-1 text-xs" style={{ color: colors.error }}>
                  {error}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <AppIcon name="shield-checkmark" size={40} color={colors.textTertiary} />
              <Text className="text-base font-semibold text-lantern-text mt-3 mb-1">
                No blocked users
              </Text>
              <Text className="text-sm text-lantern-text-secondary text-center">
                People you block from a direct message will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View className="flex-row items-center gap-3 px-4 py-3.5 border-b border-lantern-border">
              <ResolvedAvatar name={item.name} uri={item.avatarUrl} size={44} />
              <Text className="flex-1 text-base font-semibold text-lantern-text" numberOfLines={1}>
                {item.name}
              </Text>
              <Pressable
                onPress={() => handleUnblock(item)}
                disabled={busyId === item.id}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.name}`}
                accessibilityState={{ disabled: busyId === item.id }}
                className="px-3 py-1.5 rounded-lg border border-lantern-border active:opacity-70"
                style={{ opacity: busyId === item.id ? 0.5 : 1 }}
              >
                <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                  Unblock
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

export default BlockedUsersScreen;
