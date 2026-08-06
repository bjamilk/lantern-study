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

export default function TestAnalysisScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<TestAnalysisParams, 'TestAnalysis'>>();
  const { colors } = useTheme();
  const { test: initialTest, sessionId, attemptId } = route.params ?? {};

  const [test, setTest] = useState<RecentTest | null>(
    initialTest ? normalizeRecentTest(initialTest) : null
  );
  const [loading, setLoading] = useState(!initialTest?.analysis?.timePerQuestion?.length);
  const [error, setError] = useState<string | null>(null);

  const needsHydrate = useMemo(() => {
    const bars = initialTest?.analysis?.timePerQuestion?.length ?? 0;
    return bars === 0 && !!(sessionId || attemptId || initialTest?.id);
  }, [initialTest, sessionId, attemptId]);

  useEffect(() => {
    if (!needsHydrate) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const id = sessionId || attemptId || initialTest?.id;
    if (!id) {
      setLoading(false);
      setError('Missing test session id');
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = await api.fetchTestSessionDetail(id);
        if (cancelled) return;
        setTest(buildRecentTestFromSessionDetail(session, initialTest ?? { id }));
      } catch {
        if (cancelled) return;
        const attempt = useTestStore.getState().attempts.find((a) => a.id === id);
        if (attempt?.answers?.length) {
          setTest(
            normalizeRecentTest({
              id: attempt.id,
              groupName: attempt.groupName || attempt.testName,
              score: attempt.answers.filter((a) => a.isCorrect).length,
              totalQuestions: attempt.answers.length,
              percentage: attempt.percentage,
              completedAt: attempt.completedAt || attempt.startedAt,
              timeSpent: attempt.timeSpent,
              analysis: buildAnalysisFromAttempt(attempt),
            })
          );
        } else if (initialTest) {
          setTest(normalizeRecentTest(initialTest));
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
  }, [needsHydrate, sessionId, attemptId, initialTest]);

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

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading analysis…
            </Text>
          </View>
        ) : test ? (
          <>
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
