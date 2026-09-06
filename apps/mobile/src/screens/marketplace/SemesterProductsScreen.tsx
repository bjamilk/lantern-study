import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { createStudyPackDraft, fetchSemesterPackProposals } from '../../services/api';
import {
  enqueueSemesterDraftsSequentially,
  STUDY_PACK_DRAFT_CREDITS,
  type SemesterPackProposal,
  type SemesterPackProposalResponse,
} from '@lantern/shared/marketplace';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function SemesterProductsScreen({ navigation }: { navigation: NavigationProp }) {
  const [data, setData] = useState<SemesterPackProposalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchSemesterPackProposals();
      setData(next);
      const cap = Math.min(next.proposals.length, next.maxSelectable);
      setSelected(new Set(next.proposals.slice(0, cap).map((p) => p.courseId)));
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not load proposals');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 40px did not clear the absolute bottom tab bar, so the last course
  // proposal and the generate button were untappable.
  const bottomPadding = useScreenBottomPadding();
  const proposals = data?.proposals ?? [];
  const cap = data?.maxSelectable ?? 0;
  const remaining = data?.creditsRemaining ?? 0;
  const selectedList = useMemo(
    () => proposals.filter((p) => selected.has(p.courseId)),
    [proposals, selected],
  );
  const totalCredits = selectedList.length * STUDY_PACK_DRAFT_CREDITS;
  const overCap = selectedList.length > cap;

  const toggle = (courseId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const run = async () => {
    if (!selectedList.length || overCap || running) return;
    setRunning(true);
    try {
      const result = await enqueueSemesterDraftsSequentially(selectedList, (input) =>
        createStudyPackDraft(input),
      );
      if (result.failed > 0) {
        Alert.alert(
          'Stopped',
          `Started ${result.ok} pack${result.ok === 1 ? '' : 's'}. ${result.errors[0] || 'Credit limit reached.'}`,
        );
      }
      navigation.navigate('StudyProductDrafts');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-2">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2" accessibilityLabel="Back">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-lantern-text">Semester products</Text>
        {/* Seller tool: You carries the seller's own badges, Cart would only be clutter here. */}
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} hide={['cart']} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}>
        <Text className="text-sm text-lantern-text-secondary mb-4">
          Each selected course costs {STUDY_PACK_DRAFT_CREDITS} AI credits. Packs generate one at a
          time.
        </Text>
        {loading ? (
          <ActivityIndicator color="#6366f1" />
        ) : proposals.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">
            No courses with notes this year.
          </Text>
        ) : (
          <>
            <Text className="text-xs text-lantern-text-tertiary mb-3">
              {remaining} credits left · max {cap} pack{cap === 1 ? '' : 's'} today
            </Text>
            {proposals.map((p: SemesterPackProposal) => {
              const checked = selected.has(p.courseId);
              return (
                <Pressable
                  key={p.courseId}
                  onPress={() => toggle(p.courseId)}
                  className="flex-row items-start gap-3 rounded-xl border border-lantern-border bg-lantern-surface p-4 mb-2"
                >
                  <AppIcon
                    name={checked ? 'checkbox' : 'square'}
                    size={22}
                    color={checked ? '#6366f1' : '#94a3b8'}
                  />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-lantern-text">{p.suggestedTitle}</Text>
                    <Text className="text-xs text-lantern-text-tertiary mt-0.5">
                      {p.courseCode} · {p.noteCount} notes · {p.creditCost} credits
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {overCap ? (
              <Text className="text-sm text-red-500 mt-2">
                Selected cost {totalCredits} credits; you have {remaining}. Uncheck some courses.
              </Text>
            ) : (
              <Text className="text-sm text-lantern-text-secondary mt-2">
                Total: {totalCredits} credits
              </Text>
            )}
            <Pressable
              disabled={!selectedList.length || overCap || running}
              onPress={() => void run()}
              className={`mt-4 rounded-xl bg-lantern-primary-fill py-3 items-center ${
                !selectedList.length || overCap || running ? 'opacity-50' : ''
              }`}
            >
              {running ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-semibold">Generate selected packs</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

export default SemesterProductsScreen;
