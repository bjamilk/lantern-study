import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { fetchCreatorProfile, followCreator, unfollowCreator } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { formatPrice } from './marketplaceHelpers';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};
type RouteProp = { params: { userId: string } };

type Creator = Awaited<ReturnType<typeof fetchCreatorProfile>>;

const TRUST_LABEL: Record<string, string> = {
  new: 'New creator',
  rising: 'Rising creator',
  trusted: 'Trusted creator',
  verified: 'Verified creator',
};

/**
 * Mobile creator profile: who they are academically, what they've published and
 * how many students they've helped. Never shows earnings (SEC-08).
 */
export function CreatorProfileScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: RouteProp;
}) {
  const userId = route.params?.userId;
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setCreator(await fetchCreatorProfile(userId));
    } catch {
      setCreator(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFollow = async () => {
    if (!creator) return;
    const next = !creator.isFollowing;
    setBusy(true);
    setCreator({
      ...creator,
      isFollowing: next,
      stats: {
        ...creator.stats,
        followerCount: Math.max(0, creator.stats.followerCount + (next ? 1 : -1)),
      },
    });
    try {
      if (next) await followCreator(userId);
      else await unfollowCreator(userId);
    } catch (e: unknown) {
      appAlert('Error', e instanceof Error ? e.message : 'Could not update follow');
      void load();
    } finally {
      setBusy(false);
    }
  };

  const isSelf = currentUserId === userId;
  // 32px did not clear the absolute bottom tab bar, so the tail of the
  // creator's product list sat under it.
  const bottomPadding = useScreenBottomPadding();

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} className="mr-2 -ml-1 p-1">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="text-lg font-bold text-lantern-text">Creator</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : !creator ? (
        <View className="flex-1 items-center justify-center px-8">
          <AppIcon name="person" size={40} color="#94a3b8" />
          <Text className="mt-3 text-base font-semibold text-lantern-text">Creator not found</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
          <View className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
            <View className="flex-row items-start" style={{ gap: 12 }}>
              <View className="w-16 h-16 rounded-full bg-lantern-primary/10 items-center justify-center">
                <Text className="text-xl font-bold text-lantern-primary-text">
                  {(creator.name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 min-w-0">
                <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
                  <Text className="text-lg font-bold text-lantern-text" numberOfLines={1}>
                    {creator.name}
                  </Text>
                  {creator.isVerified ? (
                    <View className="flex-row items-center rounded-full bg-lantern-primary/10 px-2 py-0.5" style={{ gap: 3 }}>
                      <AppIcon name="checkmark-circle" size={11} color="#6366f1" />
                      <Text className="text-[11px] font-semibold text-lantern-primary-text">Verified</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="text-xs text-lantern-text-tertiary">
                  {TRUST_LABEL[creator.trustLevel] || 'New creator'}
                  {creator.username ? ` · @${creator.username}` : ''}
                </Text>
                {creator.institution || creator.programme || creator.studyLevel ? (
                  <Text className="mt-1 text-sm text-lantern-text-secondary" numberOfLines={2}>
                    {[creator.institution, creator.programme, creator.studyLevel ? `${creator.studyLevel}L` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>

            {creator.bio ? (
              <Text className="mt-3 text-sm text-lantern-text">{creator.bio}</Text>
            ) : null}

            {!isSelf ? (
              <Pressable
                onPress={() => void toggleFollow()}
                disabled={busy}
                className={`mt-3 items-center rounded-lg py-2.5 ${
                  creator.isFollowing ? 'bg-lantern-background-secondary' : 'bg-lantern-primary-fill'
                }`}
                style={{ opacity: busy ? 0.5 : 1 }}
              >
                <Text
                  className={`text-sm font-semibold ${
                    creator.isFollowing ? 'text-lantern-text' : 'text-white'
                  }`}
                >
                  {creator.isFollowing ? 'Following' : 'Follow'}
                </Text>
              </Pressable>
            ) : null}

            <View className="mt-4 flex-row" style={{ gap: 8 }}>
              {[
                { label: 'Packs', value: String(creator.stats.activePacks) },
                { label: 'Helped', value: String(creator.stats.learnersHelped) },
                {
                  label: 'Rating',
                  value: creator.stats.reviewCount > 0 ? creator.stats.avgRating.toFixed(1) : '—',
                },
                { label: 'Followers', value: String(creator.stats.followerCount) },
              ].map((s) => (
                <View key={s.label} className="flex-1 rounded-xl bg-lantern-background-secondary py-2.5 items-center">
                  <Text className="text-base font-bold text-lantern-text">{s.value}</Text>
                  <Text className="text-label text-lantern-text-tertiary">{s.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <Text className="mt-5 mb-2 text-sm font-semibold text-lantern-text">
            Study products{creator.packs.length > 0 ? ` (${creator.packs.length})` : ''}
          </Text>
          {creator.packs.length === 0 ? (
            <Text className="text-sm text-lantern-text-secondary">
              This creator hasn't published anything yet.
            </Text>
          ) : (
            creator.packs.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => navigation.navigate('ListingDetail', { listingId: p.id })}
                className="mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-3"
              >
                <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
                  {p.title}
                </Text>
                <Text className="text-xs text-lantern-text-tertiary mt-0.5">
                  {p.listingKind === 'study_pack' ? 'Study Pack' : 'Question Bank'} ·{' '}
                  {p.price && p.price > 0 ? formatPrice(p.price) : 'Free'}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

export default CreatorProfileScreen;
