/**
 * Personal study sets — owner-only containers on the Study tab.
 */
import { PublicError } from '../utils/safeError';
import type { SupabaseService } from './supabase';
import { isUuid } from './academicCourses';

export interface StudySet {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  courseId?: string | null;
  folderId?: string | null;
  coverPath?: string | null;
  visibility?: 'private' | 'public';
  mode?: 'cram' | 'standard' | 'comprehensive';
  /** "YYYY-MM-DD" — the set's own exam date, independent of any enrolment. */
  examDate?: string | null;
  /** The `exam_date` column is not applied here yet; the rest of the patch landed. */
  examDateUnsupported?: boolean;
  lastStudiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudySetFolder {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
}

export interface StudySetUnitRow {
  id: string;
  studySetId: string;
  title: string;
  position: number;
}

export interface StudySetTopicRow {
  id: string;
  studySetId: string;
  unitId: string;
  title: string;
  position: number;
  status: 'unseen' | 'covered' | 'mastered';
  sourceNoteIds: string[];
}

export const MAX_STUDY_SETS = 80;
export const MAX_STUDY_SET_FOLDERS = 40;
const STUDY_SET_TITLE_MAX = 80;
const STUDY_SET_DESCRIPTION_MAX = 280;

const SET_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, cover_path, visibility, mode, exam_date, last_studied_at, created_at, updated_at';
/** Everything but `exam_date` — the 20260911140000 migration is hand-applied. */
const SET_COLUMNS_NO_EXAM =
  'id, user_id, title, description, course_id, folder_id, cover_path, visibility, mode, last_studied_at, created_at, updated_at';
const SET_COLUMNS_MIN = 'id, user_id, title, course_id, created_at, updated_at';

function normalizeStudySetTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function isValidStudySetTitle(title: string): boolean {
  const next = normalizeStudySetTitle(title);
  return next.length >= 1 && next.length <= STUDY_SET_TITLE_MAX;
}

function fail(message: string): never {
  throw new PublicError(message);
}

function isMissingColumn(error: { message?: string } | null | undefined, column: string): boolean {
  return Boolean(error?.message && new RegExp(column, 'i').test(error.message));
}

/**
 * PostgREST reports an absent column as 42703 on read and PGRST204 on write —
 * the same test `schemaCapabilities.isMissingColumnError` makes. The
 * `exam_date` migration (20260911140000) is hand-applied, so every path that
 * touches the column must degrade instead of 500-ing.
 */
function isMissingColumnCode(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

function mapSet(row: Record<string, unknown>): StudySet {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title || ''),
    description: typeof row.description === 'string' ? row.description : null,
    courseId: typeof row.course_id === 'string' ? row.course_id : null,
    folderId: typeof row.folder_id === 'string' ? row.folder_id : null,
    coverPath: typeof row.cover_path === 'string' ? row.cover_path : null,
    visibility: row.visibility === 'public' ? 'public' : 'private',
    mode:
      row.mode === 'cram' || row.mode === 'comprehensive' || row.mode === 'standard'
        ? row.mode
        : 'standard',
    examDate: typeof row.exam_date === 'string' ? row.exam_date : null,
    lastStudiedAt: typeof row.last_studied_at === 'string' ? row.last_studied_at : null,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function mapFolder(row: Record<string, unknown>): StudySetFolder {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title || ''),
    createdAt: String(row.created_at || ''),
  };
}

function omitExamDate(patch: Record<string, unknown>): Record<string, unknown> {
  const { exam_date: _dropped, ...rest } = patch;
  return rest;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isUuid(value)) fail(`${field} must be a valid UUID`);
  return value;
}

export class StudySetsService {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  /**
   * Run a write whose RETURNING projection names `exam_date`, retrying once
   * without that column when this database has not had 20260911140000 applied.
   * Returns the row plus whether the column was missing.
   */
  private async writeWithExamColumn(
    run: (columns: string) => PromiseLike<{ data: unknown; error: any }>
  ): Promise<{ row: Record<string, unknown> | null; error: any; examMissing: boolean }> {
    const first = await run(SET_COLUMNS);
    if (!first.error) {
      return { row: first.data as Record<string, unknown>, error: null, examMissing: false };
    }
    if (isMissingColumnCode(first.error) || isMissingColumn(first.error, 'exam_date')) {
      const retry = await run(SET_COLUMNS_NO_EXAM);
      if (!retry.error) {
        return { row: retry.data as Record<string, unknown>, error: null, examMissing: true };
      }
      return { row: null, error: retry.error, examMissing: true };
    }
    return { row: null, error: first.error, examMissing: false };
  }

  private async selectSets(userId: string, extra?: (query: any) => any) {
    let query = this.db.from('study_sets').select(SET_COLUMNS).eq('user_id', userId);
    if (extra) query = extra(query);
    const first = await query.order('updated_at', { ascending: false });
    if (first.error && (isMissingColumn(first.error, 'exam_date') || isMissingColumnCode(first.error))) {
      let withoutExam = this.db.from('study_sets').select(SET_COLUMNS_NO_EXAM).eq('user_id', userId);
      if (extra) withoutExam = extra(withoutExam);
      const retry = await withoutExam.order('updated_at', { ascending: false });
      if (!retry.error) {
        return (retry.data || []).map((row) => mapSet(row as Record<string, unknown>));
      }
    }
    if (first.error && isMissingColumn(first.error, 'description')) {
      let fallback = this.db.from('study_sets').select(SET_COLUMNS_MIN).eq('user_id', userId);
      if (extra) fallback = extra(fallback);
      const second = await fallback.order('updated_at', { ascending: false });
      if (second.error) throw second.error;
      return (second.data || []).map((row) => mapSet(row as Record<string, unknown>));
    }
    if (first.error) throw first.error;
    return (first.data || []).map((row) => mapSet(row as Record<string, unknown>));
  }

  async list(userId: string): Promise<StudySet[]> {
    return this.selectSets(userId);
  }

  async get(userId: string, setId: string): Promise<StudySet> {
    if (!isUuid(setId)) fail('study set id is invalid');
    const rows = await this.selectSets(userId, (query) => query.eq('id', setId));
    if (!rows[0]) fail('Study set not found');
    return rows[0];
  }

  async create(
    userId: string,
    input: {
      title?: unknown;
      courseId?: unknown;
      description?: unknown;
      folderId?: unknown;
    }
  ): Promise<StudySet> {
    const title = normalizeStudySetTitle(typeof input.title === 'string' ? input.title : '');
    if (!isValidStudySetTitle(title)) {
      fail(`Name the set in ${STUDY_SET_TITLE_MAX} characters or fewer`);
    }
    const description =
      typeof input.description === 'string' ? input.description.trim().slice(0, STUDY_SET_DESCRIPTION_MAX) : '';
    const courseId = optionalUuid(input.courseId, 'courseId');
    const folderId = optionalUuid(input.folderId, 'folderId');

    const existing = await this.list(userId);
    if (existing.length >= MAX_STUDY_SETS) {
      fail(`You can keep at most ${MAX_STUDY_SETS} study sets`);
    }

    const payload: Record<string, unknown> = {
      user_id: userId,
      title,
      course_id: courseId,
      ...(description ? { description } : {}),
      ...(folderId ? { folder_id: folderId } : {}),
    };
    const inserted = await this.writeWithExamColumn((columns) =>
      this.db.from('study_sets').insert(payload).select(columns).single()
    );
    if (!inserted.error) return mapSet(inserted.row as Record<string, unknown>);
    if (inserted.error && isMissingColumn(inserted.error, 'description')) {
      const retry = await this.db
        .from('study_sets')
        .insert({ user_id: userId, title, course_id: courseId })
        .select(SET_COLUMNS_MIN)
        .single();
      if (retry.error) throw retry.error;
      return mapSet(retry.data as Record<string, unknown>);
    }
    throw inserted.error;
  }

  async update(
    userId: string,
    setId: string,
    input: {
      title?: unknown;
      courseId?: unknown;
      description?: unknown;
      folderId?: unknown;
      visibility?: unknown;
      mode?: unknown;
      coverPath?: unknown;
      examDate?: unknown;
    }
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
      patch.course_id = optionalUuid(input.courseId, 'courseId');
    }
    if (input.description !== undefined) {
      const description =
        input.description === null || input.description === ''
          ? null
          : typeof input.description === 'string'
            ? input.description.trim().slice(0, STUDY_SET_DESCRIPTION_MAX)
            : fail('description must be a string');
      patch.description = description;
    }
    if (input.folderId !== undefined) {
      patch.folder_id = optionalUuid(input.folderId, 'folderId');
    }
    if (input.visibility !== undefined) {
      if (input.visibility !== 'private' && input.visibility !== 'public') {
        fail('visibility must be private or public');
      }
      patch.visibility = input.visibility;
    }
    if (input.mode !== undefined) {
      if (input.mode !== 'cram' && input.mode !== 'standard' && input.mode !== 'comprehensive') {
        fail('mode must be cram, standard, or comprehensive');
      }
      patch.mode = input.mode;
    }
    if (input.coverPath !== undefined) {
      patch.cover_path =
        input.coverPath === null || input.coverPath === ''
          ? null
          : typeof input.coverPath === 'string'
            ? input.coverPath
            : fail('coverPath must be a string');
    }
    if (input.examDate !== undefined) {
      if (input.examDate === null || input.examDate === '') {
        patch.exam_date = null;
      } else if (typeof input.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.examDate)) {
        patch.exam_date = input.examDate;
      } else {
        fail('examDate must be YYYY-MM-DD or null');
      }
    }
    if (Object.keys(patch).length === 0) {
      return this.get(userId, setId);
    }
    const wantsExamDate = patch.exam_date !== undefined;
    const writePatch = { ...patch };
    const updated = await this.writeWithExamColumn((columns) => {
      const body = columns === SET_COLUMNS_NO_EXAM ? omitExamDate(writePatch) : writePatch;
      if (Object.keys(body).length === 0) {
        // Only the exam date was asked for and the column is absent: read the
        // row back rather than sending PostgREST an empty update body.
        return this.db
          .from('study_sets')
          .select(columns)
          .eq('user_id', userId)
          .eq('id', setId)
          .single();
      }
      return this.db
        .from('study_sets')
        .update(body)
        .eq('user_id', userId)
        .eq('id', setId)
        .select(columns)
        .single();
    });
    if (!updated.error) {
      const set = mapSet(updated.row as Record<string, unknown>);
      // Honest degrade: the rest of the patch landed, the date did not.
      return wantsExamDate && updated.examMissing ? { ...set, examDateUnsupported: true } : set;
    }
    if (updated.error && isMissingColumn(updated.error, 'description')) {
      const slim: Record<string, unknown> = {};
      if (patch.title !== undefined) slim.title = patch.title;
      if (patch.course_id !== undefined) slim.course_id = patch.course_id;
      const retry = await this.db
        .from('study_sets')
        .update(slim)
        .eq('user_id', userId)
        .eq('id', setId)
        .select(SET_COLUMNS_MIN)
        .single();
      if (retry.error) throw retry.error;
      return mapSet(retry.data as Record<string, unknown>);
    }
    throw updated.error;
  }

  async touchStudied(userId: string, setId: string): Promise<StudySet> {
    await this.get(userId, setId);
    const now = new Date().toISOString();
    const updated = await this.writeWithExamColumn((columns) =>
      this.db
        .from('study_sets')
        .update({ last_studied_at: now })
        .eq('user_id', userId)
        .eq('id', setId)
        .select(columns)
        .single()
    );
    if (!updated.error) return mapSet(updated.row as Record<string, unknown>);
    if (isMissingColumn(updated.error, 'last_studied_at')) {
      return this.get(userId, setId);
    }
    throw updated.error;
  }

  async remove(userId: string, setId: string): Promise<void> {
    await this.get(userId, setId);
    const { error } = await this.db.from('study_sets').delete().eq('user_id', userId).eq('id', setId);
    if (error) throw error;
  }

  async listFolders(userId: string): Promise<StudySetFolder[]> {
    const { data, error } = await this.db
      .from('study_set_folders')
      .select('id, user_id, title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error && isMissingColumn(error, 'study_set_folders')) return [];
    if (error) throw error;
    return (data || []).map((row) => mapFolder(row as Record<string, unknown>));
  }

  async createFolder(userId: string, input: { title?: unknown }): Promise<StudySetFolder> {
    const title = normalizeStudySetTitle(typeof input.title === 'string' ? input.title : '');
    if (!isValidStudySetTitle(title)) {
      fail(`Name the folder in ${STUDY_SET_TITLE_MAX} characters or fewer`);
    }
    const existing = await this.listFolders(userId);
    if (existing.length >= MAX_STUDY_SET_FOLDERS) {
      fail(`You can keep at most ${MAX_STUDY_SET_FOLDERS} folders`);
    }
    const { data, error } = await this.db
      .from('study_set_folders')
      .insert({ user_id: userId, title })
      .select('id, user_id, title, created_at')
      .single();
    if (error) throw error;
    return mapFolder(data as Record<string, unknown>);
  }

  async removeFolder(userId: string, folderId: string): Promise<void> {
    if (!isUuid(folderId)) fail('folder id is invalid');
    const { error } = await this.db
      .from('study_set_folders')
      .delete()
      .eq('user_id', userId)
      .eq('id', folderId);
    if (error) throw error;
  }

  async getPlan(
    userId: string,
    setId: string
  ): Promise<{ units: StudySetUnitRow[]; topics: StudySetTopicRow[] }> {
    await this.get(userId, setId);
    const unitsRes = await this.db
      .from('study_set_units')
      .select('id, study_set_id, title, position')
      .eq('user_id', userId)
      .eq('study_set_id', setId)
      .order('position', { ascending: true });
    if (unitsRes.error && isMissingColumn(unitsRes.error, 'study_set_units')) {
      return { units: [], topics: [] };
    }
    if (unitsRes.error) throw unitsRes.error;
    const topicsRes = await this.db
      .from('study_set_topics')
      .select('id, study_set_id, unit_id, title, position, status, source_note_ids')
      .eq('user_id', userId)
      .eq('study_set_id', setId)
      .order('position', { ascending: true });
    if (topicsRes.error) throw topicsRes.error;
    return {
      units: (unitsRes.data || []).map((row) => ({
        id: String(row.id),
        studySetId: String(row.study_set_id),
        title: String(row.title || ''),
        position: Number(row.position) || 10,
      })),
      topics: (topicsRes.data || []).map((row) => ({
        id: String(row.id),
        studySetId: String(row.study_set_id),
        unitId: String(row.unit_id),
        title: String(row.title || ''),
        position: Number(row.position) || 10,
        status:
          row.status === 'covered' || row.status === 'mastered' || row.status === 'unseen'
            ? row.status
            : 'unseen',
        sourceNoteIds: Array.isArray(row.source_note_ids)
          ? row.source_note_ids.filter((id: unknown) => typeof id === 'string')
          : [],
      })),
    };
  }

  async replacePlan(
    userId: string,
    setId: string,
    input: {
      units?: Array<{ title?: unknown; position?: unknown }>;
      topics?: Array<{
        unitIndex?: unknown;
        title?: unknown;
        position?: unknown;
        status?: unknown;
        sourceNoteIds?: unknown;
      }>;
    }
  ): Promise<{ units: StudySetUnitRow[]; topics: StudySetTopicRow[] }> {
    await this.get(userId, setId);
    await this.db.from('study_set_topics').delete().eq('user_id', userId).eq('study_set_id', setId);
    await this.db.from('study_set_units').delete().eq('user_id', userId).eq('study_set_id', setId);
    const unitsIn = Array.isArray(input.units) ? input.units : [];
    const insertedUnits: StudySetUnitRow[] = [];
    for (const [index, unit] of unitsIn.entries()) {
      const title = normalizeStudySetTitle(typeof unit.title === 'string' ? unit.title : '');
      if (!title) continue;
      const { data, error } = await this.db
        .from('study_set_units')
        .insert({
          user_id: userId,
          study_set_id: setId,
          title: title.slice(0, 120),
          position: typeof unit.position === 'number' ? unit.position : (index + 1) * 10,
        })
        .select('id, study_set_id, title, position')
        .single();
      if (error) throw error;
      insertedUnits.push({
        id: String(data.id),
        studySetId: String(data.study_set_id),
        title: String(data.title || ''),
        position: Number(data.position) || 10,
      });
    }
    const topicsIn = Array.isArray(input.topics) ? input.topics : [];
    for (const [index, topic] of topicsIn.entries()) {
      const title = normalizeStudySetTitle(typeof topic.title === 'string' ? topic.title : '');
      if (!title) continue;
      const unitIndex = typeof topic.unitIndex === 'number' ? topic.unitIndex : 0;
      const unit = insertedUnits[unitIndex] ?? insertedUnits[0];
      if (!unit) continue;
      const status =
        topic.status === 'covered' || topic.status === 'mastered' ? topic.status : 'unseen';
      const sourceNoteIds = Array.isArray(topic.sourceNoteIds)
        ? topic.sourceNoteIds.filter((id): id is string => typeof id === 'string' && isUuid(id))
        : [];
      const { error } = await this.db.from('study_set_topics').insert({
        user_id: userId,
        study_set_id: setId,
        unit_id: unit.id,
        title: title.slice(0, 160),
        position: typeof topic.position === 'number' ? topic.position : (index + 1) * 10,
        status,
        source_note_ids: sourceNoteIds,
      });
      if (error) throw error;
    }
    return this.getPlan(userId, setId);
  }

  async updateTopicStatus(
    userId: string,
    setId: string,
    topicId: string,
    status: unknown
  ): Promise<StudySetTopicRow> {
    await this.get(userId, setId);
    if (!isUuid(topicId)) fail('topic id is invalid');
    if (status !== 'unseen' && status !== 'covered' && status !== 'mastered') {
      fail('status must be unseen, covered, or mastered');
    }
    const { data, error } = await this.db
      .from('study_set_topics')
      .update({ status })
      .eq('user_id', userId)
      .eq('study_set_id', setId)
      .eq('id', topicId)
      .select('id, study_set_id, unit_id, title, position, status, source_note_ids')
      .single();
    if (error) throw error;
    return {
      id: String(data.id),
      studySetId: String(data.study_set_id),
      unitId: String(data.unit_id),
      title: String(data.title || ''),
      position: Number(data.position) || 10,
      status: data.status,
      sourceNoteIds: Array.isArray(data.source_note_ids) ? data.source_note_ids : [],
    };
  }

  async resume(userId: string): Promise<{
    lastActivity: {
      kind: string;
      title: string;
      studySetId: string;
      href: string;
      at: string;
    } | null;
    recentMaterials: Array<{
      id: string;
      title: string;
      studySetId: string;
      kind: 'note' | 'lecture';
      href: string;
      preview?: string;
      updatedAt: string;
    }>;
    recentActivities: Array<{
      kind: string;
      title: string;
      studySetId: string;
      href: string;
      at: string;
    }>;
  }> {
    const sets = await this.list(userId);
    const lastSet =
      [...sets].sort((a, b) => {
        const aTime = Date.parse(a.lastStudiedAt || a.updatedAt || '') || 0;
        const bTime = Date.parse(b.lastStudiedAt || b.updatedAt || '') || 0;
        return bTime - aTime;
      })[0] ?? null;
    const { data: notes } = await this.db
      .from('notes')
      .select('id, title, body, source_type, study_set_id, updated_at')
      .eq('user_id', userId)
      .not('study_set_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(12);
    const recentMaterials = (notes || []).flatMap((row) => {
      const studySetId = typeof row.study_set_id === 'string' ? row.study_set_id : '';
      if (!studySetId) return [];
      const kind = String(row.source_type || '') === 'lecture' ? 'lecture' : 'note';
      return [
        {
          id: String(row.id),
          title: String(row.title || 'Untitled note'),
          studySetId,
          kind: kind as 'note' | 'lecture',
          href: `/study/sets/${encodeURIComponent(studySetId)}/notes/${encodeURIComponent(String(row.id))}`,
          preview: typeof row.body === 'string' ? row.body.slice(0, 120) : undefined,
          updatedAt: String(row.updated_at || ''),
        },
      ];
    });
    const { data: tests } = await this.db
      .from('test_sessions')
      .select('id, title, study_set_id, updated_at, config')
      .eq('user_id', userId)
      .not('study_set_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(8);
    const recentActivities = (tests || []).flatMap((row) => {
      const studySetId = typeof row.study_set_id === 'string' ? row.study_set_id : '';
      if (!studySetId) return [];
      return [
        {
          kind: 'quiz',
          title: String(row.title || 'Quiz'),
          studySetId,
          href: `/study/sets/${encodeURIComponent(studySetId)}/test/${encodeURIComponent(String(row.id))}`,
          at: String(row.updated_at || ''),
        },
      ];
    });
    const lastMaterial = recentMaterials[0];
    const lastActivity = lastSet
      ? lastMaterial
        ? {
            kind: lastMaterial.kind,
            title: lastMaterial.title,
            studySetId: lastMaterial.studySetId,
            href: lastMaterial.href,
            at: lastMaterial.updatedAt,
          }
        : {
            kind: 'note',
            title: lastSet.title,
            studySetId: lastSet.id,
            href: `/study/sets/${encodeURIComponent(lastSet.id)}`,
            at: lastSet.lastStudiedAt || lastSet.updatedAt,
          }
      : null;
    return { lastActivity, recentMaterials, recentActivities };
  }
}

let singleton: StudySetsService | null = null;

export function getStudySetsService(supabase: SupabaseService): StudySetsService {
  if (!singleton) singleton = new StudySetsService(supabase);
  return singleton;
}
