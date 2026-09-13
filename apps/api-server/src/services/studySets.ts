/**
 * Personal study sets — owner-only containers on the Study tab.
 */
import { PublicError } from '../utils/safeError';
import type { SupabaseService } from './supabase';
import { isUuid } from './academicCourses';
import { normalizeCoverRef } from '@lantern/shared/utils/storageUrl';
import {
  SET_TILE_GLYPHS,
  SET_TILE_HUES,
  isSetTileGlyph,
  isSetTileHue,
} from '@lantern/shared/study/setPresentation';
import {
  SET_TILE_MIGRATION,
  SET_TILE_UNSUPPORTED_MESSAGE,
} from '@lantern/shared/study/setTileSave';

/**
 * A tile write that reached a database without `tile_hue`/`tile_glyph`.
 *
 * The read ladder degrades for a missing tile column on purpose — a set list
 * must not 500 because one hand-applied migration is outstanding. A WRITE may
 * not: degrading there answered 200 `Study set updated.` and dropped the pick,
 * which is what the device pass hit three times in a row. The route turns this
 * into 503 + the migration's filename, the same shape `CoverColumnMissingError`
 * already has for 20260913120000.
 */
export class SetTileColumnMissingError extends Error {
  readonly migration = SET_TILE_MIGRATION;

  constructor() {
    super(SET_TILE_UNSUPPORTED_MESSAGE);
    this.name = 'SetTileColumnMissingError';
  }
}

export { SET_TILE_MIGRATION };

export interface StudySet {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  courseId?: string | null;
  folderId?: string | null;
  coverPath?: string | null;
  /** The owner's chosen tile pastel, or null to derive one from the set id. */
  tileHue?: string | null;
  /** The owner's chosen tile glyph, or null to derive one. */
  tileGlyph?: string | null;
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
  'id, user_id, title, description, course_id, folder_id, cover_path, visibility, mode, exam_date, last_studied_at, created_at, updated_at, tile_hue, tile_glyph';
/** Everything but the tile pick — 20260913150000_study_set_tile.sql is hand-applied. */
const SET_NO_TILE_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, cover_path, visibility, mode, exam_date, last_studied_at, created_at, updated_at';
/** Everything but `exam_date` — the 20260911140000 migration is hand-applied. */
const SET_NO_EXAM_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, cover_path, visibility, mode, last_studied_at, created_at, updated_at, tile_hue, tile_glyph';
/** Neither `exam_date` nor the tile pick. */
const SET_NO_EXAM_NO_TILE_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, cover_path, visibility, mode, last_studied_at, created_at, updated_at';
/** Everything but `cover_path` — 20260913120000_cover_images.sql is hand-applied too. */
const SET_NO_COVER_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, visibility, mode, exam_date, last_studied_at, created_at, updated_at, tile_hue, tile_glyph';
/** Neither `cover_path` nor the tile pick. */
const SET_NO_COVER_NO_TILE_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, visibility, mode, exam_date, last_studied_at, created_at, updated_at';
/** Neither of the two older hand-applied columns; the tile pick is there. */
const SET_NO_EXAM_NO_COVER_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, visibility, mode, last_studied_at, created_at, updated_at, tile_hue, tile_glyph';
/** None of the three hand-applied additions. */
const SET_NO_EXAM_NO_COVER_NO_TILE_COLUMNS =
  'id, user_id, title, description, course_id, folder_id, visibility, mode, last_studied_at, created_at, updated_at';
const SET_MIN_COLUMNS = 'id, user_id, title, course_id, created_at, updated_at';

/**
 * The projections to try, widest first.
 *
 * Three columns on this table are added by migrations an operator applies by
 * hand (`exam_date`, `cover_path`, and the `tile_hue`/`tile_glyph` pair added
 * together by 20260913150000), so any of them can be absent on a live
 * database. PostgREST answers 42703/PGRST204 for the WHOLE statement when one
 * name is unknown, which means a set list would 500 outright rather than come
 * back without the column — the failure SF2's cover work would otherwise ship
 * on day one. Walking this ladder degrades instead.
 *
 * Every rung is its OWN literal string constant whose name ends in `COLUMNS`,
 * never a projection assembled at runtime: that is what lets the repo-wide
 * embed guard (`postgrestEmbedDisambiguation.test.ts`) read each rung at its
 * definition and classify any embed inside it. A rung built by concatenation,
 * or named so the guard's scan skips it, would be a projection no guard reads.
 */
const SET_COLUMN_LADDER = [
  SET_COLUMNS,
  // The tile pair is the NEWEST migration and so the likeliest to be missing;
  // dropping it first is what keeps a database that has covers and exam dates
  // from losing either of them to one unapplied migration.
  SET_NO_TILE_COLUMNS,
  SET_NO_EXAM_COLUMNS,
  SET_NO_EXAM_NO_TILE_COLUMNS,
  SET_NO_COVER_COLUMNS,
  SET_NO_COVER_NO_TILE_COLUMNS,
  SET_NO_EXAM_NO_COVER_COLUMNS,
  SET_NO_EXAM_NO_COVER_NO_TILE_COLUMNS,
] as const;

/** Drop the keys a projection cannot name, so a write body matches its RETURNING. */
function omitUnsupported(patch: Record<string, unknown>, columns: string): Record<string, unknown> {
  const next = { ...patch };
  if (!columns.includes('exam_date')) delete next.exam_date;
  if (!columns.includes('cover_path')) delete next.cover_path;
  if (!columns.includes('tile_hue')) {
    delete next.tile_hue;
    delete next.tile_glyph;
  }
  return next;
}

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
    // Legacy rows hold a bucket-less object path; qualify it on read so the
    // client can sign it without a backfill.
    coverPath:
      typeof row.cover_path === 'string' ? normalizeCoverRef(row.cover_path) : null,
    // The six-value CHECK is the database's job; anything else that reached
    // the column is passed through as-is and `setTileArt` ignores it, which
    // draws the derived tile rather than a hole.
    tileHue: typeof row.tile_hue === 'string' ? row.tile_hue : null,
    tileGlyph: typeof row.tile_glyph === 'string' ? row.tile_glyph : null,
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
   * Run a write whose RETURNING projection names the two hand-applied columns,
   * retrying down `SET_COLUMN_LADDER` while the database rejects one of them.
   * Returns the row plus whether `exam_date` was among the ones dropped.
   */
  private async writeWithExamColumn(
    run: (columns: string) => PromiseLike<{ data: unknown; error: any }>
  ): Promise<{
    row: Record<string, unknown> | null;
    error: any;
    examMissing: boolean;
    tileMissing: boolean;
  }> {
    let lastError: any = null;
    for (const columns of SET_COLUMN_LADDER) {
      const attempt = await run(columns);
      if (!attempt.error) {
        return {
          row: attempt.data as Record<string, unknown>,
          error: null,
          examMissing: !columns.includes('exam_date'),
          // Which rung answered IS the probe: every rung below the first two
          // has already dropped `tile_hue`, so a caller that asked for a tile
          // and landed here was written without it.
          tileMissing: !columns.includes('tile_hue'),
        };
      }
      lastError = attempt.error;
      const retryable =
        isMissingColumnCode(attempt.error) ||
        isMissingColumn(attempt.error, 'exam_date') ||
        isMissingColumn(attempt.error, 'cover_path') ||
        isMissingColumn(attempt.error, 'tile_hue') ||
        isMissingColumn(attempt.error, 'tile_glyph');
      if (!retryable) break;
    }
    return { row: null, error: lastError, examMissing: false, tileMissing: false };
  }

  private async selectSets(userId: string, extra?: (query: any) => any) {
    // The projection is chosen at runtime from the ladder, so PostgREST's
    // literal-type inference has nothing to narrow on: the rows come back as
    // plain records, which is what `mapSet` reads anyway.
    const read = async (columns: string): Promise<{ data: unknown[] | null; error: any }> => {
      let query = this.db.from('study_sets').select(columns).eq('user_id', userId);
      if (extra) query = extra(query);
      return query.order('updated_at', { ascending: false }) as unknown as Promise<{
        data: unknown[] | null;
        error: any;
      }>;
    };
    const first = await read(SET_COLUMNS);
    if (
      first.error &&
      (isMissingColumnCode(first.error) ||
        isMissingColumn(first.error, 'exam_date') ||
        isMissingColumn(first.error, 'cover_path') ||
        isMissingColumn(first.error, 'tile_hue') ||
        isMissingColumn(first.error, 'tile_glyph'))
    ) {
      // Widest first: a database missing only `cover_path` keeps its exam
      // dates, and one missing only `exam_date` keeps its covers.
      for (const columns of SET_COLUMN_LADDER.slice(1)) {
        const retry = await read(columns);
        if (!retry.error) {
          return (retry.data || []).map((row) => mapSet(row as Record<string, unknown>));
        }
      }
    }
    if (first.error && isMissingColumn(first.error, 'description')) {
      let fallback = this.db.from('study_sets').select(SET_MIN_COLUMNS).eq('user_id', userId);
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
        .select(SET_MIN_COLUMNS)
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
      tileHue?: unknown;
      tileGlyph?: unknown;
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
    // A tile pick, or `null` to go back to deriving it from the set id. The
    // two halves are set independently: a student who picks a hue and leaves
    // the glyph alone must not have the derived glyph frozen into the row
    // behind their back, because Reset would then have nothing to undo.
    if (input.tileHue !== undefined) {
      patch.tile_hue =
        input.tileHue === null || input.tileHue === ''
          ? null
          : isSetTileHue(input.tileHue)
            ? input.tileHue
            : fail(`tileHue must be one of ${SET_TILE_HUES.join(', ')} or null`);
    }
    if (input.tileGlyph !== undefined) {
      patch.tile_glyph =
        input.tileGlyph === null || input.tileGlyph === ''
          ? null
          : isSetTileGlyph(input.tileGlyph)
            ? input.tileGlyph
            : fail(`tileGlyph must be one of ${SET_TILE_GLYPHS.join(', ')} or null`);
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
    // A tile ASKED for. Unlike the exam date there is no honest degrade for
    // it: `examDateUnsupported` can ride back on a 200 because the rest of the
    // patch landed and the client shows the date as unset, whereas a dropped
    // tile is indistinguishable from a tile that saved.
    const wantsTile = patch.tile_hue !== undefined || patch.tile_glyph !== undefined;
    const writePatch = { ...patch };
    const updated = await this.writeWithExamColumn((columns) => {
      const body = omitUnsupported(writePatch, columns);
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
      if (wantsTile && updated.tileMissing) throw new SetTileColumnMissingError();
      const set = mapSet(updated.row as Record<string, unknown>);
      // Honest degrade: the rest of the patch landed, the date did not.
      return wantsExamDate && updated.examMissing ? { ...set, examDateUnsupported: true } : set;
    }
    if (updated.error && isMissingColumn(updated.error, 'description')) {
      // This rung keeps only title and course: a tile asked for here would be
      // dropped by the projection, so say so instead of writing the rest.
      if (wantsTile) throw new SetTileColumnMissingError();
      const slim: Record<string, unknown> = {};
      if (patch.title !== undefined) slim.title = patch.title;
      if (patch.course_id !== undefined) slim.course_id = patch.course_id;
      const retry = await this.db
        .from('study_sets')
        .update(slim)
        .eq('user_id', userId)
        .eq('id', setId)
        .select(SET_MIN_COLUMNS)
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
