/**
 * `SemesterProducts` route: a seller tool that proposes one AI study-pack draft
 * per course the user has notes for, and enqueues the selected ones.
 *
 * Exports: SemesterProductsScreen (named and default).
 * Touches: fetchSemesterPackProposals and createStudyPackDraft in
 * ../../services/api; enqueueSemesterDraftsSequentially and
 * STUDY_PACK_DRAFT_CREDITS from @lantern/shared/marketplace. Navigates to
 * `StudyProductDrafts` when the run finishes.
 *
 * Gotchas: drafts are generated one at a time by
 * enqueueSemesterDraftsSequentially, and a partial run still navigates away
 * after reporting how many started. The initial selection is pre-checked up to
 * maxSelectable, so tapping Generate without reading spends credits. The
 * credit cap shown is the value from the last load, not a live balance.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { createStudyPackDraft, fetchSemesterPackProposals } from '../../services/api';
import {
  enqueueSemesterDraftsSequentially,
  STUDY_PACK_DRAFT_CREDITS,
  type SemesterPackProposal,
  type SemesterPackProposalResponse,
} from '@lantern/shared/marketplace';
import { pluralize } from '@lantern/shared/utils/plural';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

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
      appAlert('Error', e instanceof Error ? e.message : 'Could not load proposals');
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
        appAlert(
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
          <ActivityIndicator color={brand.text} />
        ) : proposals.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">
            No courses with notes this year.
          </Text>
        ) : (
          <>
            <Text className="text-xs text-lantern-text-tertiary mb-3">
              {pluralize(remaining, 'credit')} left · max {pluralize(cap, 'pack')} today
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
                    color={checked ? brand.text : '#94a3b8'}
                  />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-lantern-text">{p.suggestedTitle}</Text>
                    <Text className="text-xs text-lantern-text-tertiary mt-0.5">
                      {p.courseCode} · {pluralize(p.noteCount, 'note')} · {pluralize(p.creditCost, 'credit')}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {overCap ? (
              <Text className="text-sm text-red-500 mt-2">
                Selected cost {pluralize(totalCredits, 'credit')}; you have {remaining}. Uncheck some courses.
              </Text>
            ) : (
              <Text className="text-sm text-lantern-text-secondary mt-2">
                Total: {pluralize(totalCredits, 'credit')}
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
