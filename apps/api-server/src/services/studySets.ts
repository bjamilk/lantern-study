/**
 * Personal study sets — owner-only containers on the Study tab.
 */
import { PublicError } from '../utils/safeError';

export interface StudySet {
  id: string;
  userId: string;
  title: string;
  courseId?: string | null;
  createdAt: string;
  updatedAt: string;
}
import type { SupabaseService } from './supabase';
import { isUuid } from './academicCourses';

export const MAX_STUDY_SETS = 80;
const STUDY_SET_TITLE_MAX = 80;

function normalizeStudySetTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function isValidStudySetTitle(title: string): boolean {
  const next = normalizeStudySetTitle(title);
  return next.length >= 1 && next.length <= STUDY_SET_TITLE_MAX;
}
const SET_COLUMNS = 'id, user_id, title, course_id, created_at, updated_at';

function fail(message: string): never {
  throw new PublicError(message);
}

function mapSet(row: Record<string, unknown>): StudySet {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title || ''),
    courseId: typeof row.course_id === 'string' ? row.course_id : null,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export class StudySetsService {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  async list(userId: string): Promise<StudySet[]> {
    const { data, error } = await this.db
      .from('study_sets')
      .select(SET_COLUMNS)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => mapSet(row as Record<string, unknown>));
  }

  async get(userId: string, setId: string): Promise<StudySet> {
    if (!isUuid(setId)) fail('study set id is invalid');
    const { data, error } = await this.db
      .from('study_sets')
      .select(SET_COLUMNS)
      .eq('user_id', userId)
      .eq('id', setId)
      .maybeSingle();
    if (error) throw error;
    if (!data) fail('Study set not found');
    return mapSet(data as Record<string, unknown>);
  }

  async create(
    userId: string,
    input: { title?: unknown; courseId?: unknown }
  ): Promise<StudySet> {
    const title = normalizeStudySetTitle(typeof input.title === 'string' ? input.title : '');
    if (!isValidStudySetTitle(title)) {
      fail(`Name the set in ${STUDY_SET_TITLE_MAX} characters or fewer`);
    }
    const courseId =
      input.courseId === null || input.courseId === undefined || input.courseId === ''
        ? null
        : isUuid(input.courseId)
          ? input.courseId
          : fail('courseId must be a valid UUID');

    const existing = await this.list(userId);
    if (existing.length >= MAX_STUDY_SETS) {
      fail(`You can keep at most ${MAX_STUDY_SETS} study sets`);
    }

    const { data, error } = await this.db
      .from('study_sets')
      .insert({ user_id: userId, title, course_id: courseId })
      .select(SET_COLUMNS)
      .single();
    if (error) throw error;
    return mapSet(data as Record<string, unknown>);
  }

  async update(
    userId: string,
    setId: string,
    input: { title?: unknown; courseId?: unknown }
  ): Promise<StudySet> {
    await this.get(userId, setId);
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) {
      const title = normalizeStudySetTitle(typeof input.title === 'string' ? input.title : '');
      if (!isValidStudySetTitle(title)) {
        fail(`Name the set in ${STUDY_SET_TITLE_MAX} characters or fewer`);
      }
      patch.title = title;
    }
    if (input.courseId !== undefined) {
      patch.course_id =
        input.courseId === null || input.courseId === ''
          ? null
          : isUuid(input.courseId)
            ? input.courseId
            : fail('courseId must be a valid UUID');
    }
    if (Object.keys(patch).length === 0) {
      return this.get(userId, setId);
    }
    const { data, error } = await this.db
      .from('study_sets')
      .update(patch)
      .eq('user_id', userId)
      .eq('id', setId)
      .select(SET_COLUMNS)
      .single();
    if (error) throw error;
    return mapSet(data as Record<string, unknown>);
  }

  async remove(userId: string, setId: string): Promise<void> {
    await this.get(userId, setId);
    const { error } = await this.db.from('study_sets').delete().eq('user_id', userId).eq('id', setId);
    if (error) throw error;
  }
}

let singleton: StudySetsService | null = null;

export function getStudySetsService(supabase: SupabaseService): StudySetsService {
  if (!singleton) singleton = new StudySetsService(supabase);
  return singleton;
}
