import React, { useCallback, useEffect, useState } from 'react';
import { ArrowPathIcon, AcademicCapIcon } from '@heroicons/react/24/outline';
import {
  MASTERY_BAND_LABELS,
  examCountdownLabel,
  masteryBand,
  type ExamReadiness,
  type MasteryGraph,
  type TopicMastery,
} from '@lantern/shared/network';
import { fetchExamReadiness, fetchMasteryGraph, refreshMasteryGraph } from '../services/supabase';

/**
 * The Mastery Graph panel (Phase 3 · P).
 *
 * Shows what the server now knows about topic strength — previously this only
 * existed client-side, which is why the AI companion never knew a weak topic.
 *
 * The honesty rule this panel enforces: a topic with no mastery score is shown
 * as "not enough data yet", never as 0 %. Telling a student they are weak at
 * something we have never tested them on is worse than saying nothing.
 */
export interface MasteryPanelProps {
  courseId?: string;
  className?: string;
}

const BAND_STYLES: Record<string, string> = {
  unknown: 'bg-lantern-background-secondary text-lantern-text-secondary',
  weak: 'bg-red-500/10 text-red-600 dark:text-red-400',
  developing: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  strong: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

const TopicRow: React.FC<{ topic: TopicMastery }> = ({ topic }) => {
  const band = masteryBand(topic.masteryScore);
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-lantern-text">{topic.topic}</p>
        <p className="text-[10px] text-lantern-text-secondary">
          {topic.attempts > 0
            ? `${topic.correct}/${topic.attempts} correct`
            : `${topic.cardsTotal} ${topic.cardsTotal === 1 ? 'card' : 'cards'}`}
          {topic.cardsDue > 0 ? ` · ${topic.cardsDue} due` : ''}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${BAND_STYLES[band]}`}
      >
        {topic.masteryScore == null ? MASTERY_BAND_LABELS.unknown : `${topic.masteryScore}%`}
      </span>
    </li>
  );
};

export const MasteryPanel: React.FC<MasteryPanelProps> = ({ courseId, className = '' }) => {
  const [graph, setGraph] = useState<MasteryGraph | null>(null);
  const [exams, setExams] = useState<ExamReadiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMasteryGraph({ courseId });
      setGraph(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your topics');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
    // Exam readiness is a separate concern; its failure must not blank the panel.
    void fetchExamReadiness()
      .then(setExams)
      .catch(() => setExams([]));
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshMasteryGraph();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const weak = graph?.weak ?? [];
  const strong = graph?.strong ?? [];
  const hasAny = (graph?.topics?.length ?? 0) > 0;

  return (
    <section
      className={`rounded-xl border border-lantern-border bg-lantern-background p-4 ${className}`}
      aria-label="Topic mastery"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-lantern-text">Your topics</h2>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-50"
          aria-label="Recalculate topic mastery"
        >
          <ArrowPathIcon
            className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </button>
      </header>

      {exams.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {exams.slice(0, 2).map((exam) => (
            <div
              key={exam.courseId}
              className="flex items-start gap-2 rounded-lg bg-lantern-background-secondary px-3 py-2"
            >
              <AcademicCapIcon
                className="mt-0.5 h-4 w-4 shrink-0 text-lantern-primary"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-lantern-text">
                  {exam.courseCode ? `${exam.courseCode} — ` : ''}
                  {examCountdownLabel(exam.daysUntil)}
                </p>
                {exam.weakestTopics.length > 0 && (
                  <p className="text-[10px] text-lantern-text-secondary">
                    Biggest gain: {exam.weakestTopics.join(', ')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <p className="text-xs text-lantern-text-secondary" role="status">
          Loading…
        </p>
      )}

      {!loading && error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && !hasAny && (
        <p className="text-xs text-lantern-text-secondary">
          Take a test or review some cards and your topic strengths appear here.
        </p>
      )}

      {!loading && !error && weak.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
            Needs work
          </h3>
          <ul className="divide-y divide-lantern-border/60">
            {weak.map((topic) => (
              <TopicRow key={`${topic.topic}-${topic.courseId ?? 'none'}`} topic={topic} />
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && strong.length > 0 && (
        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
            Strongest
          </h3>
          <ul className="divide-y divide-lantern-border/60">
            {strong.slice(0, 3).map((topic) => (
              <TopicRow key={`s-${topic.topic}-${topic.courseId ?? 'none'}`} topic={topic} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default MasteryPanel;
