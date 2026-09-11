import React, { useCallback, useEffect, useState } from 'react';
import { COURSE_TOPIC_COPY } from '@lantern/shared';
import type { Group, OfflineSessionBundle, TestResult, User, UserAnswerRecord } from '../../types';
import { fetchTestResultsPage, fetchTestSessionById, type TestResultsSort } from '../../services/supabase';
import { useLibraryStore } from '../../stores/libraryStore';
import { useAcademicStore } from '../../stores/academicStore';
import { UNFILED_COURSE_ID, UNTOPICED_TOPIC_ID } from '../../utils/libraryArchive';
import { AppIcon } from '../ui/AppIcon';
import { getGroupName, RECENT_TESTS_PAGE_SIZE } from './progressHelpers';

interface RecentTestsCardProps {
  currentUser: User;
  groups: Group[];
  offlineBundles?: OfflineSessionBundle[];
  onViewAnalysis: (result: TestResult) => void;
  onViewTestResult?: (result: TestResult) => void;
}

export const RecentTestsCard: React.FC<RecentTestsCardProps> = ({
  currentUser,
  groups,
  offlineBundles = [],
  onViewAnalysis,
  onViewTestResult,
}) => {
  const recentCourseId = useLibraryStore((s) => s.courseFilterId);
  const recentTopicId = useLibraryStore((s) => s.topicFilterId);
  const recentTopicLabel = useLibraryStore((s) => s.topicFilterLabel);
  const clearRecentCourse = useLibraryStore((s) => s.setCourseFilter);
  const clearRecentTopic = useLibraryStore((s) => s.setTopicFilter);
  const resolveRecentCourse = useAcademicStore((s) => s.resolveCourse);
  const [recentSort, setRecentSort] = useState<TestResultsSort>('newest');
  const [recentPage, setRecentPage] = useState(1);
  const [recentPageData, setRecentPageData] = useState<TestResult[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentLoading, setRecentLoading] = useState(false);
  const [isRecentTestsExpanded, setIsRecentTestsExpanded] = useState(true);

  useEffect(() => {
    setRecentPage(1);
  }, [recentSort, recentCourseId, recentTopicId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setRecentLoading(true);
      try {
        const { data, pagination } = await fetchTestResultsPage(currentUser.id, {
          page: recentPage,
          limit: RECENT_TESTS_PAGE_SIZE,
          lean: true,
          sort: recentSort,
          courseId: recentCourseId,
          topicId: recentTopicId,
        });
        if (!cancelled) {
          setRecentPageData(data as TestResult[]);
          setRecentTotal(pagination.total ?? 0);
        }
      } catch (error) {
        console.error('Failed to load recent tests page', error);
        if (!cancelled) {
          setRecentPageData([]);
          setRecentTotal(0);
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, recentPage, recentSort, recentCourseId, recentTopicId]);

  const recentTotalPages = Math.max(1, Math.ceil(recentTotal / RECENT_TESTS_PAGE_SIZE));

  const hydrateRecentTestResult = useCallback(async (result: TestResult): Promise<TestResult> => {
    const sessionId = result.session?.id || result.id;
    const hasQuestions = Array.isArray(result.session?.questions) && result.session.questions.length > 0;
    const hasAnswers = !!result.session?.userAnswers && Object.keys(result.session.userAnswers).length > 0;
    if ((hasQuestions && hasAnswers) || !sessionId) {
      return result;
    }
    const full = await fetchTestSessionById(sessionId);
    if (!full?.session?.questions?.length) {
      return result;
    }
    return {
      ...result,
      ...full,
      session: {
        ...result.session,
        ...full.session,
        questions: full.session.questions,
        userAnswers: full.session.userAnswers || {},
      },
      score: result.score ?? full.score ?? 0,
      totalQuestions: result.totalQuestions ?? full.totalQuestions ?? full.session.questions.length,
      correctAnswersCount:
        result.correctAnswersCount ??
        full.correctAnswersCount ??
        Object.values(full.session.userAnswers || {}).filter((a) => a?.isCorrect).length,
    };
  }, []);

  const handleViewRecentAnalysis = useCallback(
    async (result: TestResult) => {
      onViewAnalysis(await hydrateRecentTestResult(result));
    },
    [hydrateRecentTestResult, onViewAnalysis]
  );

  const handleViewRecentReview = useCallback(
    async (result: TestResult) => {
      if (!onViewTestResult) {
        onViewAnalysis(await hydrateRecentTestResult(result));
        return;
      }
      onViewTestResult(await hydrateRecentTestResult(result));
    },
    [hydrateRecentTestResult, onViewAnalysis, onViewTestResult]
  );

  return (
    <div className="rounded-2xl border border-lantern-border bg-lantern-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setIsRecentTestsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-lantern-background-secondary/60 transition-colors"
        aria-expanded={isRecentTestsExpanded}
      >
        <h2 className="text-heading font-semibold text-lantern-text flex items-center">
          <AppIcon name="easel" size={20} className="mr-2 text-blue-500" />
          Recent Tests
        </h2>
        {isRecentTestsExpanded ? (
          <AppIcon name="chevron-up" size={20} className="text-lantern-text-tertiary" />
        ) : (
          <AppIcon name="chevron-down" size={20} className="text-lantern-text-tertiary" />
        )}
      </button>
      {isRecentTestsExpanded && (
        <div className="border-t border-lantern-border">
          <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-lantern-border bg-lantern-background-secondary/40">
            <label className="flex items-center gap-2 text-caption text-lantern-text-secondary">
              <span>Sort</span>
              <select
                value={recentSort}
                onChange={(e) => setRecentSort(e.target.value as TestResultsSort)}
                className="rounded-md border border-lantern-border bg-lantern-surface px-2 py-1 text-caption text-lantern-text"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="highestScore">Highest score</option>
              </select>
            </label>
            <p className="text-caption text-lantern-text-tertiary">
              {recentTotal > 0
                ? `Page ${recentPage} of ${recentTotalPages} · ${recentTotal} test${recentTotal !== 1 ? 's' : ''}`
                : 'No tests yet'}
            </p>
          </div>
          {recentCourseId && (
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-lantern-border bg-lantern-background-secondary/20 text-caption text-lantern-text-secondary">
              <span>
                Filtered to{' '}
                <span className="font-semibold text-lantern-text">
                  {recentCourseId === UNFILED_COURSE_ID
                    ? 'unfiled tests'
                    : resolveRecentCourse(recentCourseId)?.code || 'one course'}
                </span>
                {recentTopicId ? (
                  <>
                    {' · '}
                    <span className="font-semibold text-lantern-text">
                      {recentTopicId === UNTOPICED_TOPIC_ID ? COURSE_TOPIC_COPY.none : recentTopicLabel || COURSE_TOPIC_COPY.filterLabel}
                    </span>
                  </>
                ) : null}
              </span>
              {recentTopicId ? (
                <button
                  type="button"
                  onClick={() => clearRecentTopic(recentCourseId, null)}
                  className="rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
                  title={COURSE_TOPIC_COPY.filterClearHint}
                >
                  Whole course
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => clearRecentCourse(null)}
                className="inline-flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-surface px-2 py-0.5 font-medium text-lantern-text hover:bg-lantern-background-secondary"
              >
                <AppIcon name="close" size={12} aria-hidden /> Clear
              </button>
            </div>
          )}
          <div className="divide-y divide-lantern-border">
            {recentLoading ? (
              <div className="p-8 text-center text-body text-lantern-text-tertiary">Loading tests…</div>
            ) : recentPageData.length > 0 ? (
              recentPageData.map((result, index) => {
                const answers = result.session?.userAnswers || {};
                const answersWithTime = Object.values(answers).filter(
                  (ans: UserAnswerRecord) => ans?.timeSpentSeconds !== undefined
                );
                const testTimeSpentSeconds = answersWithTime.reduce(
                  (sum: number, answer: UserAnswerRecord) => sum + (answer.timeSpentSeconds || 0),
                  0
                );
                const avgTime =
                  answersWithTime.length > 0 ? (testTimeSpentSeconds / answersWithTime.length).toFixed(1) : null;
                const recentTestKey =
                  result.id ??
                  `${result.session.startTime}-${result.session.config?.groupId ?? 'group'}-${result.totalQuestions}-${index}`;

                return (
                  <div
                    key={recentTestKey}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-lantern-background-secondary transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-body text-lantern-text truncate">
                        {getGroupName(
                          result.session.config?.groupId,
                          groups,
                          offlineBundles,
                          result.session.config?.groupName
                        )}
                      </p>
                      <p className="text-caption text-lantern-text-tertiary mt-0.5">
                        {new Date(result.session.startTime).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-center">
                        <p className="text-heading font-bold tabular-nums text-lantern-primary-text">
                          {result.score.toFixed(1)}%
                        </p>
                        <p className="text-caption text-lantern-text-tertiary">
                          {result.correctAnswersCount}/{result.totalQuestions}
                        </p>
                      </div>
                      {avgTime && (
                        <div className="text-center">
                          <p className="text-heading font-bold tabular-nums text-lantern-text-secondary">{avgTime}s</p>
                          <p className="text-caption text-lantern-text-tertiary">avg/q</p>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleViewRecentReview(result)}
                        className="px-3 py-1.5 bg-lantern-background-secondary hover:bg-lantern-border/40 text-lantern-text rounded-lantern text-caption font-semibold flex items-center gap-1 transition-colors border border-lantern-border"
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleViewRecentAnalysis(result)}
                        className="px-3 py-1.5 bg-lantern-primary-background hover:bg-lantern-primary/15 text-lantern-primary-text rounded-lantern text-caption font-semibold flex items-center gap-1 transition-colors"
                      >
                        <AppIcon name="easel" size={14} />
                        Analyze
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center">
                <AppIcon name="school" size={48} className="text-lantern-text-tertiary mx-auto mb-3" />
                <p className="text-body text-lantern-text-tertiary">
                  No tests taken yet. Start a test from one of your groups!
                </p>
              </div>
            )}
          </div>
          {recentTotal > RECENT_TESTS_PAGE_SIZE && (
            <div className="p-3 flex items-center justify-between border-t border-lantern-border">
              <button
                type="button"
                disabled={recentPage <= 1 || recentLoading}
                onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-caption font-semibold rounded-lantern border border-lantern-border disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={recentPage >= recentTotalPages || recentLoading}
                onClick={() => setRecentPage((p) => p + 1)}
                className="px-3 py-1.5 text-caption font-semibold rounded-lantern border border-lantern-border disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecentTestsCard;
