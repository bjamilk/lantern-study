import React, { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { COMMUNITY_COPY, resolveGroupDiscovery, type MyCommunity } from '@lantern/shared/network';
import { fetchMyCommunities } from '../../services/api';
import { AppIcon } from '../../components/ui/AppIcon';

export type GroupDiscoveryValue = {
  visibility: 'private' | 'community' | 'public';
  communityId: string | null;
};

export function GroupDiscoverabilityFields({
  value,
  onChange,
  lockedCommunity,
}: {
  value: GroupDiscoveryValue;
  onChange: (next: GroupDiscoveryValue) => void;
  /**
   * Creating a channel from inside a community (spec §4.6): the listing is
   * fixed to that community, so this renders one read-only line and never
   * calls `onChange`.
   */
  lockedCommunity?: { id: string; name: string } | null;
}) {
  const [mine, setMine] = useState<MyCommunity[]>([]);
  const locked = !!lockedCommunity;

  useEffect(() => {
    if (locked) return;
    void fetchMyCommunities()
      .then(setMine)
      .catch(() => setMine([]));
  }, [locked]);

  if (lockedCommunity) {
    return (
      <View>
        <Text className="font-semibold text-lantern-text">Discover</Text>
        <View className="mt-2 flex-row items-center">
          <AppIcon name="people" size={16} color="#6366f1" />
          <Text className="ml-2 flex-1 text-sm text-lantern-text-secondary">
            {COMMUNITY_COPY.listedIn(lockedCommunity.name)}
          </Text>
        </View>
      </View>
    );
  }

  const listed = value.visibility !== 'private';

  return (
    <View>
      <Text className="font-semibold text-lantern-text">Discover</Text>
      <Text className="text-sm text-lantern-text-secondary mt-0.5 mb-3">
        Off by default. People can join from Communities or Groups without an invite link.
      </Text>
      <View className="flex-row items-center justify-between py-2">
        <Text className="text-sm font-medium text-lantern-text flex-1 pr-3">Show this group on Discover</Text>
        <Switch
          value={listed}
          onValueChange={(on) =>
            onChange(
              on
                ? resolveGroupDiscovery({ visibility: 'public', communityId: value.communityId })
                : { visibility: 'private', communityId: null }
            )
          }
          trackColor={{ true: '#6366f1' }}
        />
      </View>
      {listed ? (
        <View className="mt-1">
          <Pressable
            onPress={() =>
              onChange(resolveGroupDiscovery({ visibility: 'public', communityId: value.communityId }))
            }
            className="py-2"
          >
            <Text
              className={`text-sm ${value.visibility === 'public' ? 'text-lantern-primary font-semibold' : 'text-lantern-text'}`}
            >
              Anyone on Discover
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              onChange(
                resolveGroupDiscovery({
                  visibility: 'community',
                  communityId: value.communityId || mine[0]?.id || null,
                })
              )
            }
            className="py-2"
          >
            <Text
              className={`text-sm ${value.visibility === 'community' ? 'text-lantern-primary font-semibold' : 'text-lantern-text'}`}
            >
              People in one of my communities
            </Text>
          </Pressable>
          {value.visibility === 'community'
            ? mine.map((community) => (
                <Pressable
                  key={community.id}
                  onPress={() =>
                    onChange(resolveGroupDiscovery({ visibility: 'community', communityId: community.id }))
                  }
                  className="py-1.5 pl-2"
                >
                  <Text
                    className={`text-sm ${
                      value.communityId === community.id
                        ? 'text-lantern-primary font-semibold'
                        : 'text-lantern-text-secondary'
                    }`}
                  >
                    {community.name}
                  </Text>
                </Pressable>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}
