/**
 * A course's syllabus outline plus the filter every topic picker shows.
 *
 * Unlike courses there is no server-side search: an outline is capped at 200
 * rows, so it is fetched whole (cached in services/academic) and filtered here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CourseTopic } from '@lantern/shared/types';
import { getCourseTopics, invalidateCourseTopicsCache } from '../services/academic';
import { filterTopics, suggestTopicCreation } from '../utils/topicSelection';

export function useCourseTopics(
  courseId: string | null | undefined,
  enabled = true
): {
  topics: CourseTopic[];
  loading: boolean;
  /** Set when the outline could not be read — render it as an empty outline. */
  error: string | null;
  /**
   * The outline could not be read at all (almost always the unapplied
   * course_topics migration). Distinct from "no topics yet": creating one is
   * guaranteed to fail, so callers must not offer it.
   */
  unavailable: boolean;
  reload: () => void;
  addTopic: (topic: CourseTopic) => void;
} {
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !courseId) {
      setTopics([]);
      setError(null);
      setUnavailable(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getCourseTopics(courseId, { force: attempt > 0 })
      .then(rows => {
        if (cancelled) return;
        setTopics(rows);
        setError(null);
        setUnavailable(false);
      })
      // course_topics does not exist until migration 20260826120000 is applied,
      // so this fails in production today. An outline that cannot be read is
      // the same as an empty one: the picker stays usable and the artefact
      // still saves.
      .catch((e: unknown) => {
        if (cancelled) return;
        setTopics([]);
        setError(e instanceof Error ? e.message : 'Could not load topics');
        setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, enabled, attempt]);

  /** Splice a just-created topic in without waiting for the next fetch. */
  const addTopic = useCallback((topic: CourseTopic) => {
    setTopics(prev =>
      prev.some(t => t.id === topic.id)
        ? prev
        : [...prev, topic].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    );
  }, []);

  const reload = useCallback(() => {
    if (courseId) invalidateCourseTopicsCache(courseId);
    setAttempt(a => a + 1);
  }, [courseId]);

  return { topics, loading, error, unavailable, reload, addTopic };
}

export function useTopicSearch(options: {
  query: string;
  topics: CourseTopic[];
  /** Suppresses the "Add ‘…’" offer: a create against a missing outline always fails. */
  unavailable?: boolean;
}): { options: CourseTopic[]; addTitle: string | null } {
  const { query, topics, unavailable = false } = options;
  // Memoised so `options` keeps a stable identity between renders — the same
  // re-render loop useCourseSearch documents (a fresh array every render
  // refires any consumer effect that depends on it).
  const filtered = useMemo(() => filterTopics(topics, query), [topics, query]);
  const addTitle = useMemo(
    () => (unavailable ? null : suggestTopicCreation(query, filtered)),
    [query, filtered, unavailable]
  );
  return { options: filtered, addTitle };
}
