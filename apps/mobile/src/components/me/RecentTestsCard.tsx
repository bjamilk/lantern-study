import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  averageSecondsPerQuestion,
  getGroupName,
  recentTestsPageCount,
  RECENT_TESTS_PAGE_SIZE,
} from '@lantern/shared/learning';
import * as api from '../../services/api';
import { Card, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { tabularNums } from '../../design/typeScale';
import { navigate as navigateFromRoot } from '../../navigation/navigationRef';
import { toTab } from '../../navigation/nestedTab';
import { useTestStore } from '../../stores/testStore';
import { useToastStore } from '../../stores/toastStore';

/**
 * Recent tests on Me — the phone's half of web's Recent Tests card.
 *
 * Home lists sittings too, but with no way into either of the two screens a
 * student actually wants from history: the paper they answered (Review) and
 * the breakdown of where the marks went (Analyze). Both already exist on this
 * phone; what was missing was a door.
 *
 * The page size, the page count and the average-time arithmetic come from the
 * shared Me module, so this list pages exactly as web's does.
 */

type RecentSort = 'newest' | 'oldest' | 'highestScore';

const SORT_OPTIONS: ReadonlyArray<{ id: RecentSort; label: string }> = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'highestScore', label: 'Top score' },
];

interface RecentRow {
  /** The session id — what both destination screens hydrate from. */
  id: string;
  name: string;
  startedAt: string;
  score: number;
  correct: number;
  total: number;
  averageSeconds: number | null;
}

interface Props {
  userId: string | undefined;
  groups: Array<{ id: string; name: string; parentId?: string | null }>;
}

const openStudy = (screen: string, params?: Record<string, unknown>) =>
  // `toTab` carries `initial: false`, so the target lands ON TOP of the Study
  // tab's own root rather than becoming its only route (navigation/nestedTab).
  navigateFromRoot('Main', { screen: 'StudyTab', params: toTab(screen, params) });

export function RecentTestsCard({ userId, groups }: Props) {
  const { colors } = useTheme();
  const showToast = useToastStore((s) => s.showToast);
  const [sort, setSort] = useState<RecentSort>('newest');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RecentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [sort]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await api.fetchTestResultsPage(userId, {
          page,
          limit: RECENT_TESTS_PAGE_SIZE,
          lean: true,
          sort,
        });
        if (cancelled) return;
        const data = Array.isArray(result.data) ? result.data : [];
        setRows(
          data.map((item, index) => ({
            id: item.session?.id || item.id || `${index}`,
            name: getGroupName(item.session?.config?.groupId, groups, [], item.session?.config?.groupName),
            startedAt: item.session?.startTime ?? '',
            score: item.score ?? 0,
            correct: item.correctAnswersCount ?? 0,
            total: item.totalQuestions ?? 0,
            averageSeconds: averageSecondsPerQuestion(
              item.session?.userAnswers as Record<string, { timeSpentSeconds?: number }> | undefined
            ),
          }))
        );
        setTotal(result.pagination?.total ?? data.length);
        setFailed(false);
      } catch {
        // The rows already on screen stay: a failed page says nothing about
        // the tests we were already showing. The banner says the list is
        // stale rather than pretending the history is empty.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, page, sort, groups]);

  const totalPages = recentTestsPageCount(total);

  const openAnalysis = useCallback((row: RecentRow) => {
    openStudy('TestAnalysis', { sessionId: row.id });
  }, []);

  /**
   * Review needs the sitting as a local ATTEMPT — TestResultsScreen reads
   * `attempts` and prints "Results not found" for an id it does not hold, and
   * `hydrateAttemptDetail` returns early for an attempt that was never loaded.
   * So pull the history once before giving up, and when the attempt genuinely
   * is not there, say so and open the analysis rather than parking the reader
   * on an empty screen.
   */
  const openReview = useCallback(
    async (row: RecentRow) => {
      const hasAttempt = (id: string) => useTestStore.getState().attempts.some((a) => a.id === id);
      if (!hasAttempt(row.id) && userId) {
        await useTestStore.getState().fetchAttempts(userId);
      }
      if (!hasAttempt(row.id)) {
        showToast('That paper is not on this phone — opening the analysis instead.', 'info');
        openAnalysis(row);
        return;
      }
      openStudy('TestResults', { attemptId: row.id });
    },
    [openAnalysis, showToast, userId]
  );

  return (
    <Card className="mb-4">
      <View className="flex-row items-center gap-2">
        <AppIcon name="easel" size={20} color={colors.primaryText} />
        <T.Heading>Recent tests</T.Heading>
      </View>

      <View className="flex-row gap-2 mt-3">
        {SORT_OPTIONS.map((option) => {
          const active = option.id === sort;
          return (
            <Pressable
              key={option.id}
              onPress={() => setSort(option.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Sort by ${option.label}`}
              className="px-3 py-1.5 rounded-full border active:opacity-70"
              style={{
                borderColor: active ? colors.primaryText : colors.border,
                backgroundColor: active ? colors.primaryBackground : 'transparent',
              }}
            >
              <T.Caption style={active ? { color: colors.primaryText, fontWeight: '600' } : undefined}
                tone={active ? 'text' : 'secondary'}
              >
                {option.label}
              </T.Caption>
            </Pressable>
          );
        })}
      </View>

      {failed ? (
        <T.Caption tone="secondary" className="mt-3">
          Could not reach your test history. These are the tests we already had.
        </T.Caption>
      ) : null}

      {rows.length === 0 ? (
        <T.Caption tone="secondary" className="mt-3">
          {loading ? 'Loading tests…' : 'No tests yet. Sit one from a group and it lands here.'}
        </T.Caption>
      ) : (
        <View className="mt-3 gap-3">
          {rows.map((row) => (
            <View key={row.id} className="border-t border-lantern-border pt-3">
              <T.Body className="font-semibold" numberOfLines={1}>
                {row.name}
              </T.Body>
              <View className="flex-row items-center gap-3 mt-0.5">
                <T.Caption tone="secondary">{formatStartedAt(row.startedAt)}</T.Caption>
                <T.Caption tone="secondary" style={tabularNums}>
                  {row.score.toFixed(1)}% · {row.correct}/{row.total}
                </T.Caption>
                {row.averageSeconds !== null ? (
                  <T.Caption tone="secondary" style={tabularNums}>
                    {row.averageSeconds.toFixed(1)}s avg
                  </T.Caption>
                ) : null}
              </View>
              <View className="flex-row gap-2 mt-2">
                <Pressable
                  onPress={() => void openReview(row)}
                  accessibilityRole="button"
                  accessibilityLabel={`Review ${row.name}`}
                  className="px-3 py-2 rounded-full border active:opacity-70"
                  style={{ borderColor: colors.border }}
                >
                  <T.Caption className="font-semibold">Review</T.Caption>
                </Pressable>
                <Pressable
                  onPress={() => openAnalysis(row)}
                  accessibilityRole="button"
                  accessibilityLabel={`Analyze ${row.name}`}
                  className="px-3 py-2 rounded-full active:opacity-70"
                  style={{ backgroundColor: colors.primaryBackground }}
                >
                  <T.Caption style={{ color: colors.primaryText, fontWeight: '600' }}>Analyze</T.Caption>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {total > RECENT_TESTS_PAGE_SIZE ? (
        <View className="flex-row items-center justify-between mt-3">
          <Pressable
            onPress={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            accessibilityRole="button"
            accessibilityLabel="Previous page of tests"
            accessibilityState={{ disabled: page <= 1 || loading }}
            className="px-3 py-2 rounded-full border active:opacity-70"
            style={{ borderColor: colors.border, opacity: page <= 1 || loading ? 0.4 : 1 }}
          >
            <T.Caption>Previous</T.Caption>
          </Pressable>
          <T.Caption tone="secondary" style={tabularNums}>
            Page {page} of {totalPages}
          </T.Caption>
          <Pressable
            onPress={() => setPage((p) => p + 1)}
            disabled={page >= totalPages || loading}
            accessibilityRole="button"
            accessibilityLabel="Next page of tests"
            accessibilityState={{ disabled: page >= totalPages || loading }}
            className="px-3 py-2 rounded-full border active:opacity-70"
            style={{ borderColor: colors.border, opacity: page >= totalPages || loading ? 0.4 : 1 }}
          >
            <T.Caption>Next</T.Caption>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

function formatStartedAt(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

export default RecentTestsCard;
