// ===========================================
// Lantern Study Mobile - Test Analysis Screen
// Stack screen (not nested RN Modal) so charts work from Dashboard and
// from TestResults, which is itself presented as a fullScreenModal.
// ===========================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import TestAnalysisContent from '../../components/TestAnalysisContent';
import { api } from '../../services/api';
import { useTestStore } from '../../stores/testStore';
import { useTheme } from '../../theme';
import type { RecentTest } from '../../types/dashboardStats';
import {
  buildAnalysisFromAttempt,
  buildRecentTestFromSessionDetail,
  normalizeRecentTest,
} from '../../utils/testAnalysisHelpers';

type TestAnalysisParams = {
  TestAnalysis: {
    test?: RecentTest;
    sessionId?: string;
    attemptId?: string;
  };
};

function sessionHasUsableDetail(session: any): boolean {
  const questions = session?.questions;
  const answers = session?.userAnswers ?? session?.user_answers;
  const qLen = Array.isArray(questions) ? questions.length : 0;
  const aLen = Array.isArray(answers)
    ? answers.length
    : answers && typeof answers === 'object'
      ? Object.keys(answers).length
      : 0;
  return qLen > 0 || aLen > 0;
}

function analysisQuality(test: RecentTest | null | undefined): number {
  if (!test?.analysis) return 0;
  const bars = test.analysis.timePerQuestion?.length ?? 0;
  const stems = (test.analysis.timePerQuestion ?? []).filter(
    (q) => q.stem && !/^Question\s+\d+$/i.test(q.stem.trim())
  ).length;
  const timed = (test.analysis.timePerQuestion ?? []).filter((q) => q.time > 0).length;
  return bars * 10 + stems * 2 + timed;
}

async function fetchSessionForAnalysis(id: string): Promise<any> {
  try {
    const session = await api.fetchTestSessionDetail(id);
    if (sessionHasUsableDetail(session)) return session;
  } catch {
    // Fall through to web's GET /tests/:id path.
  }
  const fallback = await api.fetchTestById(id);
  if (!sessionHasUsableDetail(fallback)) {
    throw new Error('Session detail empty');
  }
  return fallback;
}

export default function TestAnalysisScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<TestAnalysisParams, 'TestAnalysis'>>();
  const { colors } = useTheme();
  const { test: initialTest, sessionId, attemptId } = route.params ?? {};

  const normalizedInitial = useMemo(
    () => (initialTest ? normalizeRecentTest(initialTest) : null),
    [initialTest]
  );

  const [test, setTest] = useState<RecentTest | null>(normalizedInitial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrateId = sessionId || attemptId || initialTest?.id;

  // Lean dashboard rows ship empty timePerQuestion. Always hydrate when we have
  // a session id so stems/timings match web's fetchTestSessionById path.
  // Keep a rich local attempt (TestResults) if the server body is thinner.
  const needsHydrate = !!hydrateId;

  useEffect(() => {
    if (!needsHydrate) {
      setLoading(false);
      setTest(normalizedInitial);
      return;
    }

    let cancelled = false;
    const id = hydrateId!;

    (async () => {
      setLoading(true);
      setError(null);

      const localAttempt = useTestStore.getState().attempts.find((a) => a.id === id);
      const localFromAttempt =
        localAttempt?.answers?.length
          ? normalizeRecentTest({
              id: localAttempt.id,
              groupName: localAttempt.groupName || localAttempt.testName,
              score: localAttempt.answers.filter((a) => a.isCorrect).length,
              totalQuestions: localAttempt.answers.length,
              percentage: localAttempt.percentage,
              completedAt: localAttempt.completedAt || localAttempt.startedAt,
              timeSpent: localAttempt.timeSpent,
              analysis: buildAnalysisFromAttempt(localAttempt),
            })
          : null;

      // Show the best local payload immediately while the network hydrate runs.
      const localSeed =
        analysisQuality(localFromAttempt) >= analysisQuality(normalizedInitial)
          ? localFromAttempt
          : normalizedInitial;
      if (localSeed && !cancelled) {
        setTest(localSeed);
      }

      try {
        const session = await fetchSessionForAnalysis(id);
        if (cancelled) return;
        const hydrated = buildRecentTestFromSessionDetail(session, normalizedInitial ?? { id });
        // Prefer whichever payload has more bars/stems/timings.
        if (analysisQuality(hydrated) >= analysisQuality(localSeed)) {
          setTest(hydrated);
        } else if (localSeed) {
          setTest(localSeed);
        } else {
          setTest(hydrated);
        }
      } catch {
        if (cancelled) return;
        if (localSeed) {
          setTest(localSeed);
          if (analysisQuality(localSeed) === 0) {
            setError('Could not load full session detail');
          }
        } else if (normalizedInitial) {
          setTest(normalizedInitial);
          setError('Could not load full session detail');
        } else {
          setError('Could not load test analysis');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsHydrate, hydrateId, normalizedInitial]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Test Analysis</Text>
            {test?.groupName ? (
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {test.groupName}
              </Text>
            ) : null}
          </View>
          <View style={{ width: 40 }} />
        </View>

        {loading && !test ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading analysis…
            </Text>
          </View>
        ) : test ? (
          <>
            {loading ? (
              <Text style={[styles.errorBanner, { color: colors.textSecondary }]}>
                Refreshing session detail…
              </Text>
            ) : null}
            {error ? (
              <Text style={[styles.errorBanner, { color: colors.textSecondary }]}>{error}</Text>
            ) : null}
            <TestAnalysisContent test={test} />
          </>
        ) : (
          <View style={styles.centered}>
            <Text style={{ color: colors.textSecondary }}>{error || 'Analysis unavailable'}</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
    width: 40,
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorBanner: {
    textAlign: 'center',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
