import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CourseTopic } from '../../types';
import { createCourseTopic, fetchCourseTopics } from '../../services/academic';

/** Mirrors TOPIC_TITLE_MAX in apps/api-server/src/services/courseTopics.ts. */
export const TOPIC_TITLE_MAX = 120;

export interface CreateTopicOffer {
  title: string;
}

interface UseTopicSearchOptions {
  /** Course whose outline to load. Without one there is nothing to pick from. */
  courseId?: string | null;
  enabled?: boolean;
}

/**
 * Typeahead brain for TopicPicker, the topic-side twin of useCourseSearch.
 *
 * A course outline is bounded (the API caps it at 200 rows), so it is fetched
 * once per course and filtered in memory — unlike the course catalogue, which
 * needs a debounced round trip per keystroke.
 *
 * `unavailable` carries the whole graceful-degradation story: the course_topics
 * migration is not applied everywhere yet, so GET /topics can simply fail. That
 * must read as "this course has no outline" — never as an error the user has to
 * clear before they can save the note/deck/listing they were actually writing.
 */
export function useTopicSearch({ courseId, enabled = true }: UseTopicSearchOptions) {
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!courseId) {
      seq.current++;
      setTopics([]);
      setUnavailable(false);
      setError(null);
      setLoading(false);
      return;
    }
    if (!enabled) return;
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    fetchCourseTopics(courseId)
      .then((rows) => {
        if (seq.current !== current) return;
        setTopics(rows);
        setUnavailable(false);
      })
      .catch(() => {
        if (seq.current !== current) return;
        // Outline unavailable (almost always the unapplied migration). Degrade
        // to "no topics" instead of surfacing a scary error on an optional field.
        setTopics([]);
        setUnavailable(true);
      })
      .finally(() => {
        if (seq.current === current) setLoading(false);
      });
  }, [courseId, enabled]);

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return topics;
    return topics.filter((topic) => topic.title.toLowerCase().includes(needle));
  }, [topics, query]);

  /**
   * "Add ‘Gas exchange’". Suppressed when the outline is unavailable — offering
   * a create that is guaranteed to fail is worse than offering nothing — and
   * when the title already exists, since find-or-create would just re-select it.
   */
  const offer: CreateTopicOffer | null = useMemo(() => {
    const title = query.trim().replace(/\s+/g, ' ');
    if (!title || title.length > TOPIC_TITLE_MAX || unavailable) return null;
    return topics.some((topic) => topic.title.toLowerCase() === title.toLowerCase()) ? null : { title };
  }, [topics, query, unavailable]);

  const create = useCallback(
    async (title: string): Promise<CourseTopic> => {
      if (!courseId) throw new Error('Pick a course first');
      setCreating(true);
      setError(null);
      try {
        const topic = await createCourseTopic(courseId, title);
        // New topics land at the end of the outline, so appending keeps position order.
        setTopics((prev) => (prev.some((t) => t.id === topic.id) ? prev : [...prev, topic]));
        return topic;
      } catch (e: any) {
        setError(e?.message || 'Could not add that topic');
        throw e;
      } finally {
        setCreating(false);
      }
    },
    [courseId]
  );

  return { query, setQuery, topics, options, offer, loading, creating, error, unavailable, create };
}
