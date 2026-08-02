// ===========================================
// Lantern Study Mobile - Test Results Screen
// ===========================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTestStore, type TestQuestion } from '../../stores/testStore';
import { formatCorrectAnswerDisplay } from '../../utils/questionHelpers';
import { useTheme } from '../../theme';
import AIExplainModal from '../../components/AIExplainModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TestResultsRouteParams = {
  TestResults: {
    attemptId: string;
  };
};

export default function TestResultsScreen() {
  const route = useRoute<RouteProp<TestResultsRouteParams, 'TestResults'>>();
  const navigation = useNavigation<any>();
  const { attemptId } = route.params;
  const { colors } = useTheme();

  const { attempts, startQuestionSet } = useTestStore();

  // AI Explain state
  const [showExplain, setShowExplain] = useState(false);
  const [explainData, setExplainData] = useState<{
    question: string;
    userAnswer: string;
    correctAnswer: string;
    options?: string[];
  } | null>(null);

  const attempt = useMemo(() => {
    return attempts.find(a => a.id === attemptId);
  }, [attempts, attemptId]);

  const failedQuestions = useMemo((): TestQuestion[] => {
    if (!attempt) return [];
    return attempt.answers
      .filter(a => !a.isCorrect && a.questionSnapshot)
      .map(a => a.questionSnapshot!);
  }, [attempt]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const formatAnswer = (
    answer: string | string[] | Record<string, string> | undefined,
    snapshot?: TestQuestion
  ): string => {
    if (!answer) return '(No answer)';
    if (typeof answer === 'string') {
      if (snapshot?.diagramLabels) {
        const label = snapshot.diagramLabels.find(l => l.id === answer);
        if (label?.label) return label.label;
      }
      return answer;
    }
    if (Array.isArray(answer)) return answer.join(', ');
    if (snapshot?.diagramLabels) {
      return Object.values(answer)
        .map(value => snapshot.diagramLabels?.find(l => l.id === value)?.label || value)
        .join(', ');
    }
    if (snapshot?.matchingPairs?.length) {
      return Object.entries(answer)
        .map(([left, right]) => `${left} → ${right}`)
        .join('; ');
    }
    return Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join(', ');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!attempt) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Results not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={[styles.errorLink, { color: colors.primary }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const correctCount = attempt.answers.filter(a => a.isCorrect).length;
  const incorrectCount = attempt.answers.length - correctCount;
  const passColor = attempt.passed ? colors.success : colors.error;
  const passBackground = attempt.passed ? colors.successBackground : colors.errorBackground;

  const handlePracticeFailed = async () => {
    if (!failedQuestions.length) return;
    const sessionName = `${attempt.testName} - Practice Failed`;
    await startQuestionSet(sessionName, failedQuestions, 'study');
    navigation.navigate('TestTaking', {
      testId: 'custom',
      testName: sessionName,
      mode: 'study',
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Test Results</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Result Card */}
        <View style={[
          styles.resultCard,
          {
            backgroundColor: colors.card,
            borderColor: passColor,
          }
        ]}>
          <View style={[styles.resultIcon, { backgroundColor: passBackground }]}>
            <Ionicons
              name={attempt.passed ? 'trophy' : 'close-circle'}
              size={48}
              color={passColor}
            />
          </View>

          <Text style={[styles.testName, { color: colors.text }]}>{attempt.testName}</Text>

          <Text style={[styles.resultStatus, { color: passColor }]}>
            {attempt.passed ? 'PASSED!' : 'NOT PASSED'}
          </Text>

          <View style={[styles.scoreCircle, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.scorePercentage, { color: colors.text }]}>{attempt.percentage}%</Text>
            <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>Score</Text>
          </View>

          <Text style={[styles.dateText, { color: colors.textSecondary }]}>
            Completed {formatDate(attempt.completedAt || attempt.startedAt)}
          </Text>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Ionicons name="checkmark-circle" size={24} color={colors.success} />
            <Text style={[styles.statValue, { color: colors.text }]}>{correctCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Correct</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Ionicons name="close-circle" size={24} color={colors.error} />
            <Text style={[styles.statValue, { color: colors.text }]}>{incorrectCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Incorrect</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Ionicons name="star" size={24} color={colors.warning} />
            <Text style={[styles.statValue, { color: colors.text }]}>{attempt.score}/{attempt.totalPoints}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Points</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card }]}>
            <Ionicons name="time" size={24} color={colors.primary} />
            <Text style={[styles.statValue, { color: colors.text }]}>{formatTime(attempt.timeSpent)}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Time</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Performance</Text>
          <View style={[styles.progressBarContainer, { backgroundColor: colors.card }]}>
            <View style={[styles.progressBar, { backgroundColor: colors.borderLight }]}>
              <View
                style={[
                  styles.progressFillCorrect,
                  {
                    width: `${(correctCount / attempt.answers.length) * 100}%`,
                    backgroundColor: colors.success,
                  }
                ]}
              />
              <View
                style={[
                  styles.progressFillIncorrect,
                  {
                    width: `${(incorrectCount / attempt.answers.length) * 100}%`,
                    backgroundColor: colors.error,
                  }
                ]}
              />
            </View>
            <View style={styles.progressLabels}>
              <View style={styles.progressLabel}>
                <View style={[styles.progressDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.progressLabelText, { color: colors.textSecondary }]}>
                  Correct ({correctCount})
                </Text>
              </View>
              <View style={styles.progressLabel}>
                <View style={[styles.progressDot, { backgroundColor: colors.error }]} />
                <Text style={[styles.progressLabelText, { color: colors.textSecondary }]}>
                  Incorrect ({incorrectCount})
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Question Review */}
        <View style={styles.reviewSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Question Review</Text>
          {attempt.answers.map((answer, index) => (
            <View
              key={answer.questionId}
              style={[styles.questionReview, { backgroundColor: colors.card }]}
            >
              <View style={[
                styles.questionStatus,
                {
                  backgroundColor: answer.isCorrect
                    ? colors.successBackground
                    : colors.errorBackground,
                }
              ]}>
                <Ionicons
                  name={answer.isCorrect ? 'checkmark' : 'close'}
                  size={16}
                  color={answer.isCorrect ? colors.success : colors.error}
                />
              </View>
              <View style={styles.questionInfo}>
                <Text style={[styles.questionNumber, { color: colors.text }]}>
                  Question {index + 1}
                </Text>
                {(answer as any).questionText ? (
                  <Text style={[styles.questionStem, { color: colors.text }]}>
                    {(answer as any).questionText}
                  </Text>
                ) : null}
                <Text style={[
                  styles.questionAnswer,
                  { color: answer.isCorrect ? colors.textSecondary : colors.error },
                ]}>
                  Your answer: {formatAnswer(answer.userAnswer, answer.questionSnapshot)}
                </Text>
                {!answer.isCorrect && answer.correctAnswer !== undefined && (
                  <Text style={[styles.questionCorrectAnswer, { color: colors.success }]}>
                    Correct answer: {formatAnswer(
                      answer.correctAnswer,
                      answer.questionSnapshot
                    ) || (answer.questionSnapshot ? formatCorrectAnswerDisplay(answer.questionSnapshot) : '')}
                  </Text>
                )}
                {!answer.isCorrect && (answer as any).explanation ? (
                  <Text style={[styles.questionExplanation, { color: colors.textSecondary }]}>
                    {(answer as any).explanation}
                  </Text>
                ) : null}
              </View>
              {!answer.isCorrect && (
                <TouchableOpacity
                  style={[styles.explainButton, { backgroundColor: colors.primaryBackground }]}
                  onPress={() => {
                    setExplainData({
                      question: (answer as any).questionText || `Question ${index + 1}`,
                      userAnswer: formatAnswer(answer.userAnswer, answer.questionSnapshot),
                      correctAnswer: formatAnswer(answer.correctAnswer, answer.questionSnapshot)
                        || (answer.questionSnapshot ? formatCorrectAnswerDisplay(answer.questionSnapshot) : ''),
                      options: (answer as any).options,
                    });
                    setShowExplain(true);
                  }}
                >
                  <Ionicons name="sparkles" size={14} color={colors.primary} />
                  <Text style={[styles.explainButtonText, { color: colors.primary }]}>Explain</Text>
                </TouchableOpacity>
              )}
              <Text style={[
                styles.questionPoints,
                { color: answer.isCorrect ? colors.success : colors.error }
              ]}>
                {answer.isCorrect ? `+${answer.points}` : '0'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* AI Explain Modal */}
      {explainData && (
        <AIExplainModal
          visible={showExplain}
          onClose={() => {
            setShowExplain(false);
            setExplainData(null);
          }}
          question={explainData.question}
          userAnswer={explainData.userAnswer}
          correctAnswer={explainData.correctAnswer}
          options={explainData.options}
        />
      )}

      {/* Bottom Actions */}
      <View style={[
        styles.bottomActions,
        { backgroundColor: colors.card, borderTopColor: colors.border },
      ]}>
        {failedQuestions.length > 0 ? (
          <TouchableOpacity
            style={[styles.practiceFailedButton, { backgroundColor: colors.successBackground }]}
            onPress={() => void handlePracticeFailed()}
          >
            <Ionicons name="school" size={20} color={colors.success} />
            <Text style={[styles.practiceFailedButtonText, { color: colors.success }]}>
              Practice Failed ({failedQuestions.length})
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.primaryBackground }]}
          onPress={() => navigation.navigate('TestsList')}
        >
          <Ionicons name="refresh" size={20} color={colors.primary} />
          <Text style={[styles.retryButtonText, { color: colors.primary }]}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.doneButton, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('TestsList')}
        >
          <Text style={[styles.doneButtonText, { color: colors.textInverse }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 100,
  },
  resultCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 20,
  },
  resultIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  testName: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  resultStatus: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  scoreCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  scorePercentage: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  scoreLabel: {
    fontSize: 14,
  },
  dateText: {
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: (SCREEN_WIDTH - 52) / 2,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  progressSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  progressBarContainer: {
    borderRadius: 16,
    padding: 16,
  },
  progressBar: {
    height: 12,
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFillCorrect: {
    height: '100%',
  },
  progressFillIncorrect: {
    height: '100%',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  progressLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  progressLabelText: {
    fontSize: 14,
  },
  reviewSection: {
    marginBottom: 24,
  },
  questionReview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  questionStatus: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  questionInfo: {
    flex: 1,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  questionAnswer: {
    fontSize: 12,
  },
  questionStem: {
    fontSize: 13,
    marginBottom: 4,
  },
  questionCorrectAnswer: {
    fontSize: 12,
    marginTop: 2,
  },
  questionExplanation: {
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  questionPoints: {
    fontSize: 16,
    fontWeight: '700',
  },
  explainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
  },
  explainButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  practiceFailedButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  practiceFailedButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  retryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  doneButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    marginBottom: 16,
  },
  errorLink: {
    fontSize: 16,
    fontWeight: '600',
  },
});
