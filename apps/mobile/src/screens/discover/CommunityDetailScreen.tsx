import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  communityKindLabel,
  communityMembershipAction,
  memberCountLabel,
  type CommunityDetail,
  type DiscoverGroup,
} from '@lantern/shared/network';
import {
  discoverGroups,
  fetchCommunity,
  fetchCommunityMembers,
  joinCommunity,
  joinDiscoverableGroup,
  leaveCommunity,
} from '../../services/api';
import { useGroupStore } from '../../stores/groupStore';
import { useAuthStore } from '../../stores';
import { HangoutChatPanel } from '../../components/HangoutChatPanel';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (screen: string, params?: Record<string, unknown>) => void } | undefined;
};

type Member = { id: string; name: string; avatarUrl: string | null; programme: string | null };

/**
 * One community (Phase 3 · L): who is in it and which groups live inside it.
 *
 * The member list is members-only server-side — a non-member sees the
 * community and its groups but not the roster.
 */
export function CommunityDetailScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: { slug: string } };
}) {
  const { slug } = route.params;
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchGroups = useGroupStore((s) => s.fetchGroups);
  const userId = useAuthStore((s) => s.user?.id);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await fetchCommunity(slug);
      setCommunity(detail);

      // Groups and members are secondary — either failing must still leave the
      // community header rendered rather than blanking the screen.
      void discoverGroups({ communityId: detail.id })
        .then(setGroups)
        .catch(() => setGroups([]));
      if (detail.isMember) {
        void fetchCommunityMembers(detail.id, 30)
          .then(setMembers)
          .catch(() => setMembers([]));
      } else {
        setMembers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Community not found');
    }
  }, [slug]);

  useEffect(() => {
    void (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const toggle = async () => {
    if (!community) return;
    setPending(true);
    const wasMember = community.isMember;
    setCommunity({ ...community, isMember: !wasMember });
    try {
      if (wasMember) await leaveCommunity(community.id);
      else await joinCommunity(community.id);
      await load();
    } catch (err) {
      setCommunity({ ...community, isMember: wasMember });
      setError(err instanceof Error ? err.message : 'Could not update membership');
    } finally {
      setPending(false);
    }
  };

  const openOrJoinGroup = async (group: DiscoverGroup) => {
    const tabNav = navigation.getParent?.();
    if (group.isMember) {
      tabNav?.navigate('ChatTab', {
        screen: 'GroupChat',
        params: { groupId: group.id, groupName: group.name },
      });
      return;
    }
    setPendingGroupId(group.id);
    try {
      await joinDiscoverableGroup(group.id);
      if (userId) await fetchGroups(userId).catch(() => undefined);
      tabNav?.navigate('ChatTab', {
        screen: 'GroupChat',
        params: { groupId: group.id, groupName: group.name },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this group');
    } finally {
      setPendingGroupId(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          className="mr-2 -ml-1 p-1"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-lantern-text" numberOfLines={1}>
          {community?.name ?? 'Community'}
        </Text>
      </View>

      {error ? <Text className="mx-4 mt-3 text-xs text-red-500">{error}</Text> : null}

      {community ? (
        <FlatList
          data={groups.filter((g) => g.id !== community.loungeGroupId)}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListHeaderComponent={
            <View className="px-4 py-4">
              <Text className="text-xs text-lantern-text-tertiary">
                {communityKindLabel(community.kind)} · {memberCountLabel(community.member_count)}
              </Text>
              {community.description ? (
                <Text className="text-sm text-lantern-text-secondary mt-2">
                  {community.description}
                </Text>
              ) : null}

              <Pressable
                onPress={() => void toggle()}
                disabled={pending}
                className={`mt-3 self-start rounded-lg px-4 py-2 ${
                  community.isMember ? 'bg-lantern-background-secondary' : 'bg-lantern-primary'
                }`}
                style={{ opacity: pending ? 0.5 : 1 }}
                accessibilityRole="button"
                accessibilityLabel={communityMembershipAction(community.isMember, community.source)}
              >
                <Text
                  className={`text-xs font-semibold ${
                    community.isMember ? 'text-lantern-text-secondary' : 'text-white'
                  }`}
                >
                  {pending
                    ? 'Working…'
                    : communityMembershipAction(community.isMember, community.source)}
                </Text>
              </Pressable>

              {community.isMember && community.loungeGroupId ? (
                <View className="mt-4">
                  <HangoutChatPanel
                    groupId={community.loungeGroupId}
                    title="Lounge"
                    onOpenInChats={() => {
                      const tabNav = navigation.getParent?.();
                      tabNav?.navigate('ChatTab', {
                        screen: 'GroupChat',
                        params: {
                          groupId: community.loungeGroupId,
                          groupName: `${community.name} Lounge`,
                        },
                      });
                    }}
                  />
                </View>
              ) : !community.isMember ? (
                <Text className="mt-4 text-xs text-lantern-text-tertiary">
                  Join this community to chat in the hangout.
                </Text>
              ) : null}

              {members.length > 0 ? (
                <View className="mt-5">
                  <Text className="text-[11px] font-semibold uppercase text-lantern-text-tertiary">
                    Members
                  </Text>
                  {members.slice(0, 10).map((member) => (
                    <Text
                      key={member.id}
                      className="text-xs text-lantern-text mt-1.5"
                      numberOfLines={1}
                    >
                      {member.name}
                      {member.programme ? ` · ${member.programme}` : ''}
                    </Text>
                  ))}
                </View>
              ) : null}

              <Text className="mt-5 text-[11px] font-semibold uppercase text-lantern-text-tertiary">
                Groups
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              className="mx-4 mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-3"
              onPress={() => void openOrJoinGroup(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.isMember ? 'Open' : 'Join'} ${item.name}`}
            >
              <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
                {item.name}
              </Text>
              <Text className="text-xs text-lantern-text-tertiary mt-0.5">
                {memberCountLabel(item.memberCount)}
                {item.isMember ? ' · Member · Open' : ' · Join'}
                {pendingGroupId === item.id ? '…' : ''}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text className="mx-4 text-xs text-lantern-text-tertiary">
              {community?.isMember
                ? 'No groups in this community yet. Create a study group and list it from Group info.'
                : 'No public groups here yet. Join the community to see rooms listed just for members.'}
            </Text>
          }
        />
      ) : null}
    </SafeAreaView>
  );
}

export default CommunityDetailScreen;
