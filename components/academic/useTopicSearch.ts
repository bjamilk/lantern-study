import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COURSE_TOPIC_COPY, TOPIC_TITLE_MAX, sortCourseTopics, upsertCourseTopic } from '@lantern/shared';
import type { CourseTopic } from '../../types';
import { createCourseTopic, fetchCourseTopics, seedCourseTopics } from '../../services/academic';

// Re-exported so TopicPicker keeps a single import site; the number itself lives
// in @lantern/shared (a second literal is how a client starts posting titles the
// server rejects).
export { TOPIC_TITLE_MAX };

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
  const [seeding, setSeeding] = useState(false);
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
        // THE outline order (position, then title, then id), so the picker,
        // the Library rail and mobile all read the same syllabus.
        setTopics(sortCourseTopics(rows));
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
      if (!courseId) throw new Error(COURSE_TOPIC_COPY.noCourse);
      setCreating(true);
      setError(null);
      try {
        const topic = await createCourseTopic(courseId, title);
        // Re-sort rather than append: a new topic gets the next position today,
        // but blind appending is exactly what breaks the moment anyone reorders.
        setTopics((prev) => upsertCourseTopic(prev, topic));
        return topic;
      } catch (e: any) {
        setError(e?.message || COURSE_TOPIC_COPY.createFailed);
        throw e;
      } finally {
        setCreating(false);
      }
    },
    [courseId]
  );

  /**
   * Build a starting outline from tags already used on this course. Resolves
   * with the resulting list so the caller can tell "seeded some" from "seeded
   * nothing" (a course whose tags never cleared the server's threshold), which
   * must read as an honest empty result, not a silent no-op.
   */
  const seed = useCallback(async (): Promise<CourseTopic[]> => {
    if (!courseId) return [];
    setSeeding(true);
    setError(null);
    try {
      const rows = sortCourseTopics(await seedCourseTopics(courseId));
      setTopics(rows);
      return rows;
    } catch (e: any) {
      setError(e?.message || COURSE_TOPIC_COPY.seedFailed);
      throw e;
    } finally {
      setSeeding(false);
    }
  }, [courseId]);

  return { query, setQuery, topics, options, offer, loading, creating, seeding, error, unavailable, create, seed };
}
