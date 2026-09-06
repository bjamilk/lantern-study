import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  REFERRAL_ACTIVATION_EXPLAINER,
  REFERRAL_REWARD_REFEREE,
  REFERRAL_REWARD_REFERRER,
  referralLink,
  referralShareMessage,
  referralStatusLabel,
  type ReferralSummary,
} from '@lantern/shared/network';
import { fetchAmbassadors, fetchReferralSummary } from '../../services/api';
import { fetchLeaderboard } from '../../services/gamification';
import { useAuthStore } from '../../stores/authStore';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = { goBack: () => void };

export function InviteFriendsScreen({ navigation }: { navigation: NavigationProp }) {
  const bottomPadding = useScreenBottomPadding();
  const institutionId = useAuthStore((s) => s.academicProfile?.institutionId ?? null);
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [ambassadors, setAmbassadors] = useState<
    Array<{ id: string; name: string; programme: string | null }>
  >([]);
  const [board, setBoard] = useState<Array<{ rank: number; user: { id: string; name: string; points: number } }>>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await fetchReferralSummary());
      if (institutionId) {
        const [list, rows] = await Promise.all([
          fetchAmbassadors(institutionId).catch(() => []),
          fetchLeaderboard({ ambassador: true, institutionId, limit: 10 }).catch(() => []),
        ]);
        setAmbassadors(list);
        setBoard(rows);
      }
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load invites');
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const code = summary?.code ?? null;
  const link = code ? referralLink(code) : '';

  return (
    <Screen bottom="none">
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-lantern-border">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2" accessibilityRole="button">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="text-lg font-semibold text-lantern-text">Invite friends</Text>
      </View>
      <ScrollView
        className="flex-1 px-4"
        // Vertical padding on a ScrollView's own style clips the scrollable
        // extent on Android, and `py-4` never paid the bottom inset.
        contentContainerStyle={{ paddingTop: 14, paddingBottom: bottomPadding }}
      >
        {loading ? <ActivityIndicator /> : null}
        {error ? <Text className="text-sm text-lantern-error">{error}</Text> : null}
        <Text className="text-sm text-lantern-text-secondary mb-3">
          You get {REFERRAL_REWARD_REFERRER} coins, they get {REFERRAL_REWARD_REFEREE}.
        </Text>
        {link ? (
          <>
            <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">Your invite link</Text>
            <Text selectable className="mt-1 font-mono text-sm text-lantern-text">
              {link}
            </Text>
            <View className="flex-row gap-2 mt-3">
              <Pressable
                onPress={() => void Clipboard.setStringAsync(link)}
                className="rounded-lg bg-lantern-primary-fill px-3 py-2"
              >
                <Text className="text-sm font-semibold text-white">Copy link</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!code) return;
                  void Share.share({ message: referralShareMessage(code) });
                }}
                className="rounded-lg bg-lantern-background-secondary px-3 py-2"
              >
                <Text className="text-sm font-semibold text-lantern-text">Share</Text>
              </Pressable>
            </View>
            <Text className="mt-3 text-xs text-lantern-text-secondary">{REFERRAL_ACTIVATION_EXPLAINER}</Text>
          </>
        ) : null}
        {ambassadors.length > 0 ? (
          <View className="mt-6">
            <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary mb-2">
              Campus ambassadors
            </Text>
            {ambassadors.map((a) => (
              <Text key={a.id} className="text-sm text-lantern-text py-1">
                {a.name}
                {a.programme ? ` · ${a.programme}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
        {board.length > 0 ? (
          <View className="mt-4">
            {board.map((row) => (
              <Text key={row.user.id} className="text-sm text-lantern-text py-1">
                {row.rank}. {row.user.name} · {row.user.points} XP
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default InviteFriendsScreen;
