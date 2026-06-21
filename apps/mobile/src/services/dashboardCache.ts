import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DashboardStats, TimePeriod } from '../types/dashboardStats';
import { normalizeDashboardStats } from '../utils/testAnalysisHelpers';

const STATS_CACHE_PREFIX = 'lantern_dashboard_stats:v2:';
const LEGACY_STATS_CACHE_PREFIX = 'lantern_dashboard_stats:';
const TEST_RESULTS_CACHE_TTL_MS = 90_000;

type CachedStatsPayload = {
  stats: DashboardStats;
  period: TimePeriod;
  cachedAt: string;
};

type TestResultsCache = {
  userId: string;
  data: unknown[];
  fetchedAt: number;
};

let testResultsCache: TestResultsCache | null = null;
let inflightTestResults: Promise<unknown[]> | null = null;

export async function loadCachedDashboardStats(
  userId: string
): Promise<CachedStatsPayload | null> {
  try {
    const raw =
      (await AsyncStorage.getItem(`${STATS_CACHE_PREFIX}${userId}`)) ??
      (await AsyncStorage.getItem(`${LEGACY_STATS_CACHE_PREFIX}${userId}`));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedStatsPayload;
    return {
      ...parsed,
      stats: normalizeDashboardStats(parsed.stats),
    };
  } catch {
    return null;
  }
}

export async function saveCachedDashboardStats(
  userId: string,
  period: TimePeriod,
  stats: DashboardStats
): Promise<void> {
  try {
    const payload: CachedStatsPayload = {
      stats: normalizeDashboardStats(stats),
      period,
      cachedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(`${STATS_CACHE_PREFIX}${userId}`, JSON.stringify(payload));
    await AsyncStorage.removeItem(`${LEGACY_STATS_CACHE_PREFIX}${userId}`);
  } catch {
    // Non-critical cache write
  }
}

export function clearTestResultsCache(): void {
  testResultsCache = null;
}

export async function fetchTestResultsCached(
  userId: string,
  fetcher: (userId: string, options?: { limit?: number }) => Promise<unknown[]>,
  options?: { limit?: number; force?: boolean }
): Promise<unknown[]> {
  const limit = options?.limit ?? 50;
  const force = options?.force ?? false;

  if (
    !force &&
    testResultsCache &&
    testResultsCache.userId === userId &&
    Date.now() - testResultsCache.fetchedAt < TEST_RESULTS_CACHE_TTL_MS
  ) {
    return testResultsCache.data;
  }

  if (!force && inflightTestResults) {
    return inflightTestResults;
  }

  inflightTestResults = fetcher(userId, { limit })
    .then(data => {
      testResultsCache = { userId, data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      inflightTestResults = null;
    });

  return inflightTestResults;
}
