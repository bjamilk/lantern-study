/**
 * Course topics (Phase 1 · A) — the syllabus outline inside a course.
 *
 * Deliberately NOT the same thing as `concepts`. Concepts are a cross-course,
 * AI/backfill-populated graph linked many-to-many to individual cards and
 * questions. A course topic is an ordered, human-curated outline belonging to
 * exactly one course — the thing a student revises against. An artefact can
 * carry both: a topic_id (where it sits in the syllabus) and concept links
 * (what it is about).
 *
 * Topics are shared course data, not personal data: anyone enrolled sees the
 * same outline, and anyone enrolled can extend it. That mirrors how `courses`
 * itself works (canonical, user-extendable) — a syllabus nobody may edit goes
 * stale the first time a lecturer changes the running order.
 */
import type { SupabaseService } from './supabase';
import type { CourseTopic } from '@lantern/shared/types';
import { TOPIC_TITLE_MAX } from '@lantern/shared/learning';
import { isMissingRelationError } from './academicCourses';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';

// One definition of the wire shape, from the shared contract. Re-exported so
// this module still owns the name its callers reach for.
export type { CourseTopic };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The single source of the title cap lives in @lantern/shared so client input
// caps and this server validation cannot silently diverge (a client that let a
// 121-char title through would post something the server then rejects).
// Re-exported so callers that reach for services/courseTopics keep the name.
export { TOPIC_TITLE_MAX };
/** An outline longer than this is a symptom, not a syllabus. */
export const TOPICS_PER_COURSE_MAX = 200;

/**
 * A (courseId, topicId) pair that matches no row. Either the topic was deleted
 * by someone else on the course, or the caller is holding an outline belonging
 * to a different course — both mean "do not touch anything".
 */
const TOPIC_NOT_IN_COURSE = 'That topic is not in this course';

function mapRow(row: any): CourseTopic {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    position: row.position ?? 0,
  };
}

export class CourseTopicsService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private assertUuid(id: unknown, label: string): string {
    const value = String(id ?? '');
    if (!UUID_RE.test(value)) throw new PublicError(`Invalid ${label}`);
    return value;
  }

  private normalizeTitle(raw: unknown): string {
    const title = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (title.length < 1 || title.length > TOPIC_TITLE_MAX) {
      throw new PublicError(`Topic title must be 1-${TOPIC_TITLE_MAX} characters`);
    }
    return title;
  }

  async list(courseId: string): Promise<CourseTopic[]> {
    this.assertUuid(courseId, 'course id');
    const { data, error } = await this.db
      .from('course_topics')
      .select('id, course_id, title, position')
      .eq('course_id', courseId)
      .order('position', { ascending: true })
      .order('id', { ascending: true })
      .limit(TOPICS_PER_COURSE_MAX);
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  /**
   * Find-or-create by title, the same shape `courses` uses. Typing a topic that
   * already exists must select it, not create a near-duplicate — the unique
   * index is case-insensitive, so a blind insert would 23505 on "gas exchange"
   * vs "Gas Exchange".
   */
  async findOrCreate(courseId: string, rawTitle: string, userId: string): Promise<CourseTopic> {
    this.assertUuid(courseId, 'course id');
    const title = this.normalizeTitle(rawTitle);

    const { data: existing } = await this.db
      .from('course_topics')
      .select('id, course_id, title, position')
      .eq('course_id', courseId)
      .ilike('title', title)
      .maybeSingle();
    if (existing) return mapRow(existing);

    const { count } = await this.db
      .from('course_topics')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', courseId);
    if ((count ?? 0) >= TOPICS_PER_COURSE_MAX) {
      throw new PublicError('This course already has the maximum number of topics');
    }

    // Sparse positions (10, 20, 30…) so a topic can later be slotted between
    // two others without renumbering the outline.
    const { data: last } = await this.db
      .from('course_topics')
      .select('position')
      .eq('course_id', courseId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = ((last as { position?: number } | null)?.position ?? 0) + 10;

    const { data, error } = await this.db
      .from('course_topics')
      .insert({ course_id: courseId, title, position, created_by: userId })
      .select('id, course_id, title, position')
      .single();

    if (error) {
      // Lost a race against a concurrent create of the same title — re-read.
      if ((error as { code?: string }).code === '23505') {
        const { data: raced } = await this.db
          .from('course_topics')
          .select('id, course_id, title, position')
          .eq('course_id', courseId)
          .ilike('title', title)
          .maybeSingle();
        if (raced) return mapRow(raced);
      }
      throw error;
    }
    return mapRow(data);
  }

  /**
   * Rename a topic *of this course*. Scoped to `courseId` for the same reason
   * `reorder` is: this client is service role, so RLS stops nothing, and an id
   * from another course would otherwise rewrite a syllabus the caller is not
   * even looking at. A mismatched pair matches no row — say so rather than
   * reporting a silent success.
   */
  async rename(courseId: string, topicId: string, rawTitle: string): Promise<CourseTopic> {
    this.assertUuid(courseId, 'course id');
    this.assertUuid(topicId, 'topic id');
    const title = this.normalizeTitle(rawTitle);
    const { data, error } = await this.db
      .from('course_topics')
      .update({ title })
      .eq('id', topicId)
      .eq('course_id', courseId)
      .select('id, course_id, title, position')
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new PublicError('That topic already exists in this course');
      }
      throw error;
    }
    if (!data) throw new PublicError(TOPIC_NOT_IN_COURSE);
    return mapRow(data);
  }

  /**
   * Reorder an outline. Positions are rewritten sparsely from the given order,
   * so the client sends ids in the order it wants and never computes positions.
   */
  async reorder(courseId: string, orderedIds: string[]): Promise<CourseTopic[]> {
    this.assertUuid(courseId, 'course id');
    const ids = (Array.isArray(orderedIds) ? orderedIds : [])
      .map((id) => String(id))
      .filter((id) => UUID_RE.test(id))
      .slice(0, TOPICS_PER_COURSE_MAX);
    if (ids.length === 0) throw new PublicError('No topics to reorder');

    // supabase-js RESOLVES on a Postgres error, so discarding these results
    // would report a HALF-APPLIED reorder as a success: one refused write leaves
    // its topic on its old position while its neighbours are renumbered, and
    // nothing constrains (course_id, position) to be unique, so two topics then
    // share a slot and the tiebreak picks between them arbitrarily. Telling the
    // student their shared outline was rearranged when it was only partly
    // rearranged is worse than telling them it failed.
    const results = await Promise.all(
      ids.map((id, index) =>
        this.db
          .from('course_topics')
          .update({ position: (index + 1) * 10 })
          .eq('id', id)
          // Scope to the course so a caller cannot reposition another course's
          // topic by guessing its id.
          .eq('course_id', courseId)
      )
    );
    const failed = results.find((result) => (result as { error?: unknown } | null)?.error);
    if (failed) throw (failed as { error: unknown }).error;
    return this.list(courseId);
  }

  /**
   * Topics are shared: deleting one only unfiles artefacts (ON DELETE SET NULL).
   *
   * Scoped to `courseId` like {@link rename} and {@link reorder} — a delete that
   * matched by id alone would destroy another course's topic for every student
   * on it, which is exactly what a client holding a stale outline would ask for.
   */
  async remove(courseId: string, topicId: string): Promise<void> {
    this.assertUuid(courseId, 'course id');
    this.assertUuid(topicId, 'topic id');
    const { data, error } = await this.db
      .from('course_topics')
      .delete()
      .eq('id', topicId)
      .eq('course_id', courseId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new PublicError(TOPIC_NOT_IN_COURSE);
  }

  /**
   * Bootstrap an outline from flashcard tags already in use on that course, so
   * the picker is not empty the first time anyone opens it.
   */
  async seedFromTags(courseId: string, userId: string): Promise<CourseTopic[]> {
    this.assertUuid(courseId, 'course id');
    try {
      const { error } = await this.db.rpc('seed_course_topics_from_tags', {
        p_course_id: courseId,
        p_created_by: userId,
        p_limit: 40,
      });
      if (error) throw error;
    } catch (err) {
      logger.warn('course topic seeding failed', {
        courseId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return this.list(courseId);
  }

  /**
   * Validate a topicId supplied on an artefact write. Returns the id when it is
   * genuinely a topic of that course, null when absent.
   *
   * A topic without its course is meaningless, and a topic from a DIFFERENT
   * course would file the artefact under someone else's syllabus — so both are
   * rejected here rather than stored and puzzled over later.
   */
  async resolveForArtefact(
    topicId: unknown,
    courseId: unknown
  ): Promise<string | null> {
    if (topicId === null || topicId === undefined || topicId === '') return null;
    const id = String(topicId);
    if (!UUID_RE.test(id)) throw new PublicError('Invalid topic id');
    if (!courseId || !UUID_RE.test(String(courseId))) {
      throw new PublicError('A topic needs a course — pick the course first');
    }
    const { data, error } = await this.db
      .from('course_topics')
      .select('id')
      .eq('id', id)
      .eq('course_id', String(courseId))
      .maybeSingle();
    // The table itself is missing until 20260826120000 is applied. Still fail
    // closed — but say why, or the user is told their topic belongs to another
    // course when in fact topics do not exist yet.
    if (error && isMissingRelationError(error)) {
      throw new PublicError('Topics are not available yet');
    }
    if (error) throw error;
    if (!data) throw new PublicError('That topic does not belong to the selected course');
    return id;
  }
}

let service: CourseTopicsService | null = null;

export function getCourseTopicsService(supabaseService: SupabaseService): CourseTopicsService {
  if (!service) service = new CourseTopicsService(supabaseService);
  return service;
}
