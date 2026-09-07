/**
 * Lecturer-first classes (docs/phase-teach-portal-contract.md).
 *
 * Capability is class-scoped. The API uses the service role; this module is
 * the only place that decides who may see a join code, a roster, or a draft
 * material. Students never receive private notes — only published snapshots.
 */
import { randomBytes } from 'node:crypto';
import type {
  ClassAssignmentKind,
  ClassMaterialKind,
  ClassRole,
  Course,
  CourseTopic,
  InstitutionStaffRole,
} from '@lantern/shared/types';
import {
  CLASS_ANALYTICS_AT_RISK_DAYS,
  CLASS_ASSIGNMENT_KINDS,
  CLASS_GENERATE_MIN_CHARS,
  CLASS_MATERIAL_KINDS,
  CLASS_TITLE_MAX_LENGTH,
  CLASS_TITLE_MIN_LENGTH,
  JOIN_CODE_LENGTH,
  MAX_CLASS_ASSIGNMENTS,
  MAX_CLASS_MATERIALS,
  MAX_CLASS_MEMBERS,
  MAX_CLASSES_CREATED_PER_USER,
  canonicalizeJoinCode,
  currentAcademicYear,
  defaultClassTitle,
  generateJoinCode,
  isClassRole,
  isClassStaffRole,
  isInstitutionCatalogAdmin,
  isStaffRole,
  isValidAcademicYear,
  isValidCourseSemester,
  isValidJoinCode,
} from '@lantern/shared/academic';
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  getAcademicCoursesService,
  isMissingColumnError,
  isMissingRelationError,
  isUuid,
  mapCourseRow,
  type CourseRecord,
} from './academicCourses';
import { getCourseTopicsService } from './courseTopics';
import { generateFlashcardsFromNotes, generateQuestionsFromNotes } from './aiService';
import { recordLearningEvent } from './learningEvents';

const LMS_MESSAGE =
  'Lantern classes work without Canvas, Google Classroom or Moodle. Those connectors are not available in v1.';

/** JWT `app_metadata` only — same rule as packages/shared/src/auth/platformAdmin.ts. */
function resolvePlatformAdmin(authUser?: unknown): boolean {
  if (!authUser || typeof authUser !== 'object') return false;
  const meta = (authUser as { app_metadata?: Record<string, unknown> }).app_metadata;
  return meta?.is_platform_admin === true;
}

export function classFail(message: string, statusCode = 400): never {
  throw Object.assign(new PublicError(message), { statusCode });
}

function cryptoRandom(): number {
  return randomBytes(1)[0] / 256;
}

function newJoinCode(): string {
  return generateJoinCode(JOIN_CODE_LENGTH, cryptoRandom);
}

const COURSE_EMBED = 'id, institution_id, code, title, faculty, level, semester, is_canonical';
const TOPIC_EMBED = 'id, course_id, title, position';
const SECTION_SELECT_BASE = `id, course_id, institution_id, title, academic_year, semester, join_code, created_by, archived_at, created_at, courses(${COURSE_EMBED})`;
const SECTION_SELECT = `${SECTION_SELECT_BASE}, topic_id, course_topics(${TOPIC_EMBED})`;
const MEMBER_SELECT = 'class_id, user_id, role, status, joined_at, profiles!class_members_user_id_fkey(id, name, username, avatar_url)';
const MATERIAL_SELECT = 'id, class_id, note_id, kind, title, body_snapshot, published_at, created_by, created_at';
const ASSIGNMENT_SELECT = 'id, class_id, created_by, title, kind, due_at, note_id, deck_id, payload, created_at';

type Membership = { classId: string; userId: string; role: ClassRole; status: 'active' | 'removed' };

function toSemester(value: unknown): 1 | 2 | null {
  return value === 1 || value === '1' ? 1 : value === 2 || value === '2' ? 2 : null;
}

function mapCourse(row: Record<string, unknown> | null | undefined): Course {
  const mapped = mapCourseRow(row as CourseRecord & Record<string, unknown>);
  if (!mapped) classFail('Course is missing', 404);
  return mapped;
}

function isTopicSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message || '';
  if (error.code === 'PGRST200' && /course_topics|topic_id/i.test(message)) return true;
  if (/could not find a relationship between .* and 'course_topics'/i.test(message)) return true;
  return isMissingColumnError(error) && /topic_id|course_topics/i.test(message);
}

function mapTopicEmbed(row: Record<string, unknown>): CourseTopic | null {
  const raw = Array.isArray(row.course_topics) ? row.course_topics[0] : row.course_topics;
  if (!raw || typeof raw !== 'object') return null;
  const topic = raw as Record<string, unknown>;
  if (!topic.id) return null;
  return {
    id: String(topic.id),
    courseId: String(topic.course_id ?? row.course_id ?? ''),
    title: String(topic.title ?? ''),
    position: typeof topic.position === 'number' ? topic.position : Number(topic.position ?? 0) || 0,
  };
}

function profileFromEmbed(raw: unknown): { name: string; username: string | null; avatarUrl: string | null } {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return { name: 'Student', username: null, avatarUrl: null };
  const p = row as Record<string, unknown>;
  return {
    name: typeof p.name === 'string' && p.name.trim() ? p.name : 'Student',
    username: typeof p.username === 'string' ? p.username : null,
    avatarUrl: typeof p.avatar_url === 'string' ? p.avatar_url : null,
  };
}

export class ClassSectionsService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private courses() {
    return getAcademicCoursesService(this.supabaseService);
  }

  private topics() {
    return getCourseTopicsService(this.supabaseService);
  }

  private async withSectionSelect(
    run: (select: string) => any
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> {
    const first = await run(SECTION_SELECT);
    if (!first.error || !isTopicSchemaError(first.error)) return first;
    return run(SECTION_SELECT_BASE);
  }

  private async membership(classId: string, userId: string): Promise<Membership | null> {
    const { data, error } = await this.db
      .from('class_members')
      .select('class_id, user_id, role, status')
      .eq('class_id', classId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    if (!data) return null;
    const role = isClassRole(data.role) ? data.role : 'student';
    return {
      classId: String(data.class_id),
      userId: String(data.user_id),
      role,
      status: data.status === 'removed' ? 'removed' : 'active',
    };
  }

  private async requireMember(classId: string, userId: string): Promise<Membership> {
    if (!isUuid(classId)) classFail('classId must be a valid id', 400);
    const row = await this.membership(classId, userId);
    if (!row || row.status !== 'active') classFail('You are not in this class', 403);
    return row;
  }

  private async requireStaff(classId: string, userId: string): Promise<Membership> {
    const row = await this.requireMember(classId, userId);
    if (!isClassStaffRole(row.role)) classFail('Only the lecturer or a TA can do that', 403);
    return row;
  }

  private async requireInstructor(classId: string, userId: string): Promise<Membership> {
    const row = await this.requireMember(classId, userId);
    if (row.role !== 'instructor') classFail('Only the lecturer can do that', 403);
    return row;
  }

  /**
   * Join, roster adds and a new join code are for an open class only. Published
   * materials stay readable after archive so last term's students keep the notes
   * they were taught from.
   */
  private async assertClassOpen(classId: string): Promise<void> {
    const { data, error } = await this.db
      .from('class_sections')
      .select('archived_at')
      .eq('id', classId)
      .maybeSingle();
    if (error) throw error;
    if (!data) classFail('Class not found', 404);
    if (data.archived_at) {
      classFail('This class is archived. Open a new class for the next set of students.', 409);
    }
  }

  private mapSection(
    row: Record<string, unknown>,
    role: ClassRole,
    memberCount: number,
    includeJoinCode: boolean,
    topicOverride?: CourseTopic | null
  ) {
    const joined = Array.isArray(row.courses) ? row.courses[0] : row.courses;
    const topic = topicOverride !== undefined ? topicOverride : mapTopicEmbed(row);
    const section = {
      id: String(row.id),
      course: mapCourse((joined as Record<string, unknown>) ?? null),
      topic: topic ?? null,
      institutionId: row.institution_id ? String(row.institution_id) : null,
      title: String(row.title ?? ''),
      academicYear: String(row.academic_year ?? ''),
      semester: toSemester(row.semester),
      archivedAt: row.archived_at ? String(row.archived_at) : null,
      createdAt: String(row.created_at ?? ''),
      memberCount,
      role,
      ...(includeJoinCode && isClassStaffRole(role) ? { joinCode: String(row.join_code ?? '') } : {}),
    };
    return section;
  }

  private async memberCount(classId: string): Promise<number> {
    const { count, error } = await this.db
      .from('class_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('status', 'active');
    if (error) {
      if (isMissingRelationError(error)) return 0;
      throw error;
    }
    return typeof count === 'number' ? count : 0;
  }

  async listForUser(userId: string, roleFilter: 'instructor' | 'student' | 'all' = 'all') {
    const run = (select: string) => {
      let query = this.db
        .from('class_members')
        .select(`role, status, class_id, class_sections(${select})`)
        .eq('user_id', userId)
        .eq('status', 'active');
      if (roleFilter === 'instructor') query = query.in('role', ['instructor', 'ta']);
      if (roleFilter === 'student') query = query.eq('role', 'student');
      return query.order('joined_at', { ascending: false });
    };
    const { data, error } = await this.withSectionSelect(run);
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    const rows = ((data || []) as unknown as Record<string, unknown>[]);
    const out = [];
    for (const row of rows) {
      const section = Array.isArray(row.class_sections) ? row.class_sections[0] : row.class_sections;
      if (!section || typeof section !== 'object') continue;
      const role = isClassRole(row.role) ? row.role : 'student';
      const id = String((section as Record<string, unknown>).id);
      const count = await this.memberCount(id);
      out.push(this.mapSection(section as Record<string, unknown>, role, count, isClassStaffRole(role)));
    }
    return out;
  }

  private async insertSectionWithCode(
    payload: Record<string, unknown>,
    attempts = 6
  ): Promise<Record<string, unknown>> {
    for (let i = 0; i < attempts; i += 1) {
      const join_code = newJoinCode();
      const { data, error } = await this.db
        .from('class_sections')
        .insert({ ...payload, join_code })
        .select(SECTION_SELECT_BASE)
        .single();
      if (!error && data) return data as Record<string, unknown>;
      if (error?.code === '23505') continue;
      if (error && isMissingRelationError(error)) {
        classFail('Classes are not available yet — apply the class_sections migration', 503);
      }
      if (error && isMissingColumnError(error) && payload.topic_id) {
        classFail(
          'Topic-scoped classes need a database update — apply 20260907170000_class_section_topic.sql',
          503
        );
      }
      throw error;
    }
    classFail('Could not allocate a join code — try again');
  }

  private async resolveTopic(
    userId: string,
    courseId: string,
    input: { topicId?: unknown; topicTitle?: unknown }
  ): Promise<CourseTopic | null> {
    const topicId = input.topicId;
    const topicTitle = typeof input.topicTitle === 'string' ? input.topicTitle.trim() : '';
    try {
      if (topicId != null && topicId !== '') {
        if (!isUuid(topicId)) classFail('Pick a topic from this course');
        const topic = await this.topics().get(String(topicId));
        if (!topic) classFail('That topic no longer exists', 404);
        if (topic.courseId !== courseId) classFail('That topic is not in this course');
        return topic;
      }
      if (!topicTitle) return null;
      return await this.topics().findOrCreate(courseId, topicTitle, userId);
    } catch (err) {
      if (err instanceof PublicError) {
        const status = (err as unknown as { statusCode?: number }).statusCode;
        classFail(err.message, typeof status === 'number' ? status : 400);
      }
      throw err;
    }
  }

  async create(
    userId: string,
    input: {
      courseId: unknown;
      title?: unknown;
      academicYear?: unknown;
      semester?: unknown;
      topicId?: unknown;
      topicTitle?: unknown;
    }
  ) {
    if (!isUuid(input.courseId)) classFail('Pick a course');
    const course = await this.courses().getCourseById(String(input.courseId));
    if (!course) classFail('That course no longer exists', 404);

    const topic = await this.resolveTopic(userId, course.id, input);

    const { count, error: countError } = await this.db
      .from('class_sections')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', userId)
      .is('archived_at', null);
    if (countError && !isMissingRelationError(countError)) throw countError;
    if ((count ?? 0) >= MAX_CLASSES_CREATED_PER_USER) {
      classFail(`You can run at most ${MAX_CLASSES_CREATED_PER_USER} open classes`);
    }

    const titleRaw = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
    const title =
      titleRaw.length >= CLASS_TITLE_MIN_LENGTH
        ? titleRaw.slice(0, CLASS_TITLE_MAX_LENGTH)
        : defaultClassTitle(course, topic);

    let academicYear = currentAcademicYear();
    if (input.academicYear != null && input.academicYear !== '') {
      if (!isValidAcademicYear(input.academicYear)) classFail('academicYear must look like 2026/2027');
      academicYear = String(input.academicYear);
    }
    const semester =
      input.semester == null || input.semester === ''
        ? course.semester
        : isValidCourseSemester(Number(input.semester))
          ? (Number(input.semester) as 1 | 2)
          : classFail('semester must be 1 or 2');

    const row = await this.insertSectionWithCode({
      course_id: course.id,
      institution_id: course.institutionId,
      title,
      academic_year: academicYear,
      semester,
      created_by: userId,
      ...(topic ? { topic_id: topic.id } : {}),
    });

    const { error: memberError } = await this.db.from('class_members').insert({
      class_id: row.id,
      user_id: userId,
      role: 'instructor',
      status: 'active',
    });
    if (memberError) throw memberError;

    await this.courses().ensureEnrolment(userId, course.id, academicYear, semester);
    return this.mapSection(row, 'instructor', 1, true, topic);
  }

  private async findSectionByJoinCode(code: string): Promise<Record<string, unknown> | null> {
    const normalised = canonicalizeJoinCode(code);
    if (!isValidJoinCode(normalised)) return null;
    const { data, error } = await this.withSectionSelect((select) =>
      this.db.from('class_sections').select(select).eq('join_code', normalised).maybeSingle()
    );
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    return (data as unknown as Record<string, unknown> | null) ?? null;
  }

  async previewByCode(code: unknown) {
    const section = await this.findSectionByJoinCode(String(code ?? ''));
    if (!section || section.archived_at) classFail('That join code is not valid', 404);
    const { data: instructor } = await this.db
      .from('class_members')
      .select('profiles!class_members_user_id_fkey(name)')
      .eq('class_id', section.id)
      .eq('role', 'instructor')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    const name = profileFromEmbed(instructor?.profiles).name;
    return {
      title: String(section.title),
      course: mapCourse(
        (Array.isArray(section.courses) ? section.courses[0] : section.courses) as Record<string, unknown>
      ),
      topic: mapTopicEmbed(section),
      instructorName: name,
      memberCount: await this.memberCount(String(section.id)),
      academicYear: String(section.academic_year),
      semester: toSemester(section.semester),
    };
  }

  async join(userId: string, code: unknown) {
    const section = await this.findSectionByJoinCode(String(code ?? ''));
    if (!section) classFail('That join code is not valid', 404);
    if (section.archived_at) classFail('This class is closed', 409);
    const classId = String(section.id);
    const existing = await this.membership(classId, userId);
    if (existing?.status === 'active') {
      const role = existing.role;
      return this.mapSection(section, role, await this.memberCount(classId), isClassStaffRole(role));
    }

    const count = await this.memberCount(classId);
    if (count >= MAX_CLASS_MEMBERS) classFail('This class is full');

    const row = {
      class_id: classId,
      user_id: userId,
      role: 'student' as const,
      status: 'active' as const,
    };
    const { error } = existing
      ? await this.db
          .from('class_members')
          .update({ status: 'active', role: existing.role === 'instructor' ? 'instructor' : 'student' })
          .eq('class_id', classId)
          .eq('user_id', userId)
      : await this.db.from('class_members').insert(row);
    if (error) throw error;

    const course = mapCourse(
      (Array.isArray(section.courses) ? section.courses[0] : section.courses) as Record<string, unknown>
    );
    await this.courses().ensureEnrolment(
      userId,
      course.id,
      String(section.academic_year),
      toSemester(section.semester)
    );
    const role = existing?.role === 'instructor' ? 'instructor' : 'student';
    return this.mapSection(section, role, count + (existing ? 0 : 1), false);
  }

  async getById(userId: string, classId: string) {
    const member = await this.requireMember(classId, userId);
    const { data, error } = await this.withSectionSelect((select) =>
      this.db.from('class_sections').select(select).eq('id', classId).maybeSingle()
    );
    if (error) throw error;
    if (!data) classFail('Class not found', 404);
    return this.mapSection(
      data as unknown as Record<string, unknown>,
      member.role,
      await this.memberCount(classId),
      isClassStaffRole(member.role)
    );
  }

  async patch(
    userId: string,
    classId: string,
    input: { title?: unknown; semester?: unknown; archived?: unknown }
  ) {
    // Closing a class for the next session is a lecturer decision, not a TA one.
    if (input.archived !== undefined) await this.requireInstructor(classId, userId);
    else await this.requireStaff(classId, userId);
    const updates: Record<string, unknown> = {};
    if (typeof input.title === 'string') {
      const title = input.title.trim().replace(/\s+/g, ' ');
      if (title.length < CLASS_TITLE_MIN_LENGTH || title.length > CLASS_TITLE_MAX_LENGTH) {
        classFail(`Title must be ${CLASS_TITLE_MIN_LENGTH}–${CLASS_TITLE_MAX_LENGTH} characters`);
      }
      updates.title = title;
    }
    if (input.semester !== undefined) {
      if (input.semester === null) updates.semester = null;
      else if (isValidCourseSemester(Number(input.semester))) updates.semester = Number(input.semester);
      else classFail('semester must be 1 or 2');
    }
    if (input.archived === true) updates.archived_at = new Date().toISOString();
    if (input.archived === false) updates.archived_at = null;
    if (Object.keys(updates).length === 0) classFail('Nothing to update');
    const { data, error } = await this.withSectionSelect((select) =>
      this.db.from('class_sections').update(updates).eq('id', classId).select(select).single()
    );
    if (error) throw error;
    const member = await this.requireMember(classId, userId);
    return this.mapSection(
      data as unknown as Record<string, unknown>,
      member.role,
      await this.memberCount(classId),
      true
    );
  }

  async roster(userId: string, classId: string) {
    await this.requireMember(classId, userId);
    const { data, error } = await this.db
      .from('class_members')
      .select(MEMBER_SELECT)
      .eq('class_id', classId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((row: Record<string, unknown>) => {
      const profile = profileFromEmbed(row.profiles);
      return {
        userId: String(row.user_id),
        name: profile.name,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        role: (isClassRole(row.role) ? row.role : 'student') as ClassRole,
        status: 'active' as const,
        joinedAt: String(row.joined_at ?? ''),
      };
    });
  }

  async addMemberByUsername(
    userId: string,
    classId: string,
    input: { username: unknown; role?: unknown }
  ) {
    await this.requireInstructor(classId, userId);
    await this.assertClassOpen(classId);
    const username = typeof input.username === 'string' ? input.username.trim().replace(/^@/, '').toLowerCase() : '';
    if (!username) classFail('username is required');
    const role: ClassRole = input.role === 'ta' ? 'ta' : input.role === 'instructor' ? 'instructor' : 'student';
    if (role === 'instructor') classFail('Promote an existing member to lecturer instead');
    const { data: profile, error: profileError } = await this.db
      .from('profiles')
      .select('id, name, username, avatar_url')
      .eq('username', username)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) classFail('No student with that username', 404);
    if (await this.memberCount(classId) >= MAX_CLASS_MEMBERS) classFail('This class is full');
    const { error } = await this.db.from('class_members').upsert(
      {
        class_id: classId,
        user_id: profile.id,
        role,
        status: 'active',
      },
      { onConflict: 'class_id,user_id' }
    );
    if (error) throw error;
    const section = await this.getById(userId, classId);
    await this.courses().ensureEnrolment(
      String(profile.id),
      section.course.id,
      section.academicYear,
      section.semester
    );
    return {
      userId: String(profile.id),
      name: String(profile.name || username),
      username: profile.username ?? username,
      avatarUrl: profile.avatar_url ?? null,
      role,
      status: 'active' as const,
      joinedAt: new Date().toISOString(),
    };
  }

  async patchMember(
    actorId: string,
    classId: string,
    targetUserId: string,
    input: { role?: unknown; status?: unknown }
  ) {
    await this.requireInstructor(classId, actorId);
    if (!isUuid(targetUserId)) classFail('userId must be a valid id');
    const target = await this.membership(classId, targetUserId);
    if (!target) classFail('That person is not in this class', 404);

    const updates: Record<string, unknown> = {};
    if (input.role !== undefined) {
      if (!isClassRole(input.role)) classFail('role must be instructor, ta or student');
      updates.role = input.role;
    }
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'removed') classFail("status must be 'active' or 'removed'");
      updates.status = input.status;
    }
    if (Object.keys(updates).length === 0) classFail('Nothing to update');

    const nextRole = (updates.role as ClassRole | undefined) ?? target.role;
    const nextStatus = (updates.status as 'active' | 'removed' | undefined) ?? target.status;
    if (target.role === 'instructor' && (nextRole !== 'instructor' || nextStatus === 'removed')) {
      const { data: instructors, error } = await this.db
        .from('class_members')
        .select('user_id')
        .eq('class_id', classId)
        .eq('role', 'instructor')
        .eq('status', 'active');
      if (error) throw error;
      const others = (instructors || []).filter((row: { user_id: string }) => row.user_id !== targetUserId);
      if (others.length === 0) classFail('A class needs at least one lecturer');
    }

    const { data, error } = await this.db
      .from('class_members')
      .update(updates)
      .eq('class_id', classId)
      .eq('user_id', targetUserId)
      .select(MEMBER_SELECT)
      .single();
    if (error) throw error;
    const profile = profileFromEmbed(data.profiles);
    return {
      userId: String(data.user_id),
      name: profile.name,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      role: (isClassRole(data.role) ? data.role : 'student') as ClassRole,
      status: data.status === 'removed' ? ('removed' as const) : ('active' as const),
      joinedAt: String(data.joined_at ?? ''),
    };
  }

  async rotateCode(userId: string, classId: string) {
    await this.requireInstructor(classId, userId);
    await this.assertClassOpen(classId);
    for (let i = 0; i < 6; i += 1) {
      const join_code = newJoinCode();
      const { data, error } = await this.db
        .from('class_sections')
        .update({ join_code })
        .eq('id', classId)
        .select('join_code')
        .single();
      if (!error && data) return { joinCode: String(data.join_code) };
      if (error?.code === '23505') continue;
      throw error;
    }
    classFail('Could not allocate a join code — try again');
  }

  async listMaterials(userId: string, classId: string) {
    const member = await this.requireMember(classId, userId);
    let query = this.db.from('class_materials').select(MATERIAL_SELECT).eq('class_id', classId);
    if (!isClassStaffRole(member.role)) query = query.not('published_at', 'is', null);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return (data || []).map((row: Record<string, unknown>) => this.mapMaterial(row, isClassStaffRole(member.role)));
  }

  private mapMaterial(row: Record<string, unknown>, includeBody: boolean) {
    const published = row.published_at ? String(row.published_at) : null;
    const kind = CLASS_MATERIAL_KINDS.includes(row.kind as ClassMaterialKind)
      ? (row.kind as ClassMaterialKind)
      : 'lecture';
    return {
      id: String(row.id),
      classId: String(row.class_id),
      noteId: row.note_id ? String(row.note_id) : null,
      kind,
      title: String(row.title ?? ''),
      ...(includeBody || published ? { body: String(row.body_snapshot ?? '') } : {}),
      publishedAt: published,
      createdAt: String(row.created_at ?? ''),
    };
  }

  async addMaterial(
    userId: string,
    classId: string,
    input: { noteId?: unknown; title?: unknown; body?: unknown; kind?: unknown }
  ) {
    await this.requireStaff(classId, userId);
    const { count } = await this.db
      .from('class_materials')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', classId);
    if ((count ?? 0) >= MAX_CLASS_MATERIALS) classFail(`A class can have at most ${MAX_CLASS_MATERIALS} materials`);

    let title = typeof input.title === 'string' ? input.title.trim() : '';
    let body = typeof input.body === 'string' ? input.body : '';
    let noteId: string | null = null;
    if (input.noteId) {
      if (!isUuid(input.noteId)) classFail('noteId must be a valid id');
      const { data: note, error } = await this.db
        .from('notes')
        .select('id, title, body, summary, user_id')
        .eq('id', input.noteId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!note) classFail('You can only publish a note you own', 403);
      noteId = String(note.id);
      if (!title) title = String(note.title || 'Untitled');
      if (!body.trim()) {
        body = [note.summary, note.body].filter((part) => typeof part === 'string' && part.trim()).join('\n\n');
      }
    }
    if (title.length < 2) classFail('Title is required');
    const kind = CLASS_MATERIAL_KINDS.includes(input.kind as ClassMaterialKind)
      ? (input.kind as ClassMaterialKind)
      : 'lecture';
    const { data, error } = await this.db
      .from('class_materials')
      .insert({
        class_id: classId,
        note_id: noteId,
        kind,
        title: title.slice(0, 200),
        body_snapshot: body.slice(0, 200_000),
        created_by: userId,
      })
      .select(MATERIAL_SELECT)
      .single();
    if (error) throw error;
    return this.mapMaterial(data as Record<string, unknown>, true);
  }

  async setMaterialPublished(userId: string, classId: string, materialId: string, published: boolean) {
    await this.requireStaff(classId, userId);
    if (!isUuid(materialId)) classFail('material id is invalid');
    const { data, error } = await this.db
      .from('class_materials')
      .update({ published_at: published ? new Date().toISOString() : null })
      .eq('id', materialId)
      .eq('class_id', classId)
      .select(MATERIAL_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) classFail('Material not found', 404);
    return this.mapMaterial(data as Record<string, unknown>, true);
  }

  async deleteMaterial(userId: string, classId: string, materialId: string) {
    await this.requireInstructor(classId, userId);
    const { error } = await this.db.from('class_materials').delete().eq('id', materialId).eq('class_id', classId);
    if (error) throw error;
    return { success: true };
  }

  /**
   * Student-owned copy of a published lecturer snapshot. The original stays
   * read-only and is never attached to a group or listing — they edit and share
   * this copy, not the hall notes.
   */
  async copyMaterialToNotes(userId: string, classId: string, materialId: string) {
    await this.requireMember(classId, userId);
    if (!isUuid(materialId)) classFail('material id is invalid');
    const { data, error } = await this.db
      .from('class_materials')
      .select(MATERIAL_SELECT)
      .eq('id', materialId)
      .eq('class_id', classId)
      .not('published_at', 'is', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) classFail('That lecture is not published', 404);

    const { data: section, error: sectionError } = await this.db
      .from('class_sections')
      .select('course_id, topic_id')
      .eq('id', classId)
      .maybeSingle();
    if (sectionError) throw sectionError;

    const note = await this.supabaseService.createNote(userId, {
      title: String(data.title || 'Lecturer notes'),
      body: String(data.body_snapshot || ''),
      courseId: section?.course_id ? String(section.course_id) : null,
      topicId: section?.topic_id ? String(section.topic_id) : null,
      sourceType: 'typed',
    });
    return { noteId: String(note.id), title: String(note.title || data.title || 'Lecturer notes') };
  }

  private async publishedCorpus(classId: string): Promise<string> {
    const { data, error } = await this.db
      .from('class_materials')
      .select('title, body_snapshot')
      .eq('class_id', classId)
      .not('published_at', 'is', null);
    if (error) throw error;
    return (data || [])
      .map((row: { title?: string; body_snapshot?: string }) =>
        [`# ${row.title || 'Material'}`, row.body_snapshot || ''].join('\n')
      )
      .join('\n\n')
      .trim();
  }

  async generateFromCorpus(
    userId: string,
    classId: string,
    input: { kind?: unknown; count?: unknown }
  ) {
    await this.requireStaff(classId, userId);
    const kind = input.kind === 'flashcards' || input.kind === 'outline' ? input.kind : 'quiz';
    const corpus = await this.publishedCorpus(classId);
    if (kind === 'outline') {
      const outline = corpus
        .split('\n')
        .map((line) => line.replace(/^#+\s*/, '').trim())
        .filter((line) => line.length >= 3 && line.length <= 120)
        .slice(0, 20);
      return { kind: 'outline' as const, outline: outline.length > 0 ? outline : ['Publish lecture notes to build an outline'] };
    }
    if (corpus.length < CLASS_GENERATE_MIN_CHARS) {
      classFail('Publish at least one lecture or reading (50+ characters) before generating');
    }
    const count = Math.min(20, Math.max(5, Number(input.count) || 10));
    if (kind === 'flashcards') {
      const generated = await generateFlashcardsFromNotes(corpus, { count, style: 'concise' });
      return {
        kind: 'flashcards' as const,
        cards: (generated.flashcards || []).map((card) => ({
          front: card.front,
          back: card.back,
          mnemonic: card.mnemonic,
        })),
      };
    }
    const generated = await generateQuestionsFromNotes(corpus, { count, difficulty: 'mixed' });
    return {
      kind: 'quiz' as const,
      questions: (generated.questions || []).map((q) => ({
        text: q.text,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        difficulty: q.difficulty,
        topic: q.topic,
      })),
    };
  }

  async listAssignments(userId: string, classId: string) {
    const member = await this.requireMember(classId, userId);
    const { data, error } = await this.db
      .from('class_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('class_id', classId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    const assignments = data || [];
    const ids = assignments.map((row: { id: string }) => row.id);
    const progressByAssignment = new Map<string, { completed: number; mine?: Record<string, unknown> }>();
    if (ids.length > 0) {
      const { data: progress } = await this.db
        .from('class_assignment_progress')
        .select('assignment_id, user_id, status, score, completed_at')
        .in('assignment_id', ids);
      for (const row of progress || []) {
        const cur = progressByAssignment.get(row.assignment_id) || { completed: 0 };
        if (row.status === 'completed') cur.completed += 1;
        if (row.user_id === userId) cur.mine = row;
        progressByAssignment.set(row.assignment_id, cur);
      }
    }
    return assignments.map((row: Record<string, unknown>) => {
      const stats = progressByAssignment.get(String(row.id));
      const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
      return {
        id: String(row.id),
        classId: String(row.class_id),
        title: String(row.title),
        kind: CLASS_ASSIGNMENT_KINDS.includes(row.kind as ClassAssignmentKind)
          ? (row.kind as ClassAssignmentKind)
          : 'open',
        dueAt: row.due_at ? String(row.due_at) : null,
        noteId: row.note_id ? String(row.note_id) : null,
        deckId: row.deck_id ? String(row.deck_id) : null,
        payload,
        createdAt: String(row.created_at ?? ''),
        progress: stats?.mine
          ? {
              assignmentId: String(row.id),
              userId,
              status: stats.mine.status === 'completed' ? 'completed' : 'assigned',
              score: typeof stats.mine.score === 'number' ? Number(stats.mine.score) : null,
              completedAt: stats.mine.completed_at ? String(stats.mine.completed_at) : null,
            }
          : member.role === 'student'
            ? {
                assignmentId: String(row.id),
                userId,
                status: 'assigned' as const,
                score: null,
                completedAt: null,
              }
            : null,
        completionCount: isClassStaffRole(member.role) ? stats?.completed ?? 0 : undefined,
      };
    });
  }

  async createAssignment(
    userId: string,
    classId: string,
    input: {
      title?: unknown;
      kind?: unknown;
      dueAt?: unknown;
      noteId?: unknown;
      deckId?: unknown;
      payload?: unknown;
    }
  ) {
    await this.requireStaff(classId, userId);
    await this.assertClassOpen(classId);
    const { count } = await this.db
      .from('class_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', classId);
    if ((count ?? 0) >= MAX_CLASS_ASSIGNMENTS) {
      classFail(`A class can have at most ${MAX_CLASS_ASSIGNMENTS} assignments`);
    }
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length < 2) classFail('Title is required');
    const kind = CLASS_ASSIGNMENT_KINDS.includes(input.kind as ClassAssignmentKind)
      ? (input.kind as ClassAssignmentKind)
      : 'open';
    const dueAt =
      typeof input.dueAt === 'string' && input.dueAt.trim() ? new Date(input.dueAt).toISOString() : null;
    if (dueAt && Number.isNaN(Date.parse(dueAt))) classFail('dueAt must be a valid date');
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
    const { data, error } = await this.db
      .from('class_assignments')
      .insert({
        class_id: classId,
        created_by: userId,
        title: title.slice(0, 200),
        kind,
        due_at: dueAt,
        note_id: isUuid(input.noteId) ? input.noteId : null,
        deck_id: isUuid(input.deckId) ? input.deckId : null,
        payload,
      })
      .select(ASSIGNMENT_SELECT)
      .single();
    if (error) throw error;

    const roster = await this.roster(userId, classId);
    const section = await this.getById(userId, classId);
    const students = roster.filter((m) => m.role === 'student');
    await Promise.allSettled(
      students.slice(0, 100).map((student) =>
        this.supabaseService.createNotification(student.userId, {
          message: `${section.title}: ${title}`,
          type: 'class_assignment',
          link: `class:${classId}`,
          data: { classId, assignmentId: data.id },
        })
      )
    );

    return {
      id: String(data.id),
      classId,
      title: String(data.title),
      kind,
      dueAt,
      noteId: data.note_id ? String(data.note_id) : null,
      deckId: data.deck_id ? String(data.deck_id) : null,
      payload,
      createdAt: String(data.created_at ?? ''),
      completionCount: 0,
    };
  }

  async completeAssignment(
    userId: string,
    classId: string,
    assignmentId: string,
    input: { score?: unknown }
  ) {
    const member = await this.requireMember(classId, userId);
    if (member.role !== 'student' && member.role !== 'ta') {
      classFail('Lecturers mark student work from analytics — complete as a student account');
    }
    if (!isUuid(assignmentId)) classFail('assignment id is invalid');
    const { data: assignment, error } = await this.db
      .from('class_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('id', assignmentId)
      .eq('class_id', classId)
      .maybeSingle();
    if (error) throw error;
    if (!assignment) classFail('Assignment not found', 404);
    let score: number | null = null;
    if (input.score != null && input.score !== '') {
      const n = Number(input.score);
      if (!Number.isFinite(n) || n < 0 || n > 100) classFail('score must be 0–100');
      score = Math.round(n * 10) / 10;
    }
    const completedAt = new Date().toISOString();
    const { data, error: upsertError } = await this.db
      .from('class_assignment_progress')
      .upsert(
        {
          assignment_id: assignmentId,
          user_id: userId,
          status: 'completed',
          score,
          completed_at: completedAt,
        },
        { onConflict: 'assignment_id,user_id' }
      )
      .select('assignment_id, user_id, status, score, completed_at')
      .single();
    if (upsertError) throw upsertError;

    const section = await this.getById(userId, classId);
    const eventType =
      assignment.kind === 'test'
        ? 'question_answered'
        : assignment.kind === 'deck'
          ? 'card_reviewed'
          : 'resource_opened';
    await recordLearningEvent(this.supabaseService, {
      userId,
      eventType,
      courseId: section.course.id,
      count: 1,
    }).catch((err) => logger.warn('class assignment learning event failed', { err }));

    return {
      assignmentId: String(data.assignment_id),
      userId: String(data.user_id),
      status: 'completed' as const,
      score: data.score == null ? null : Number(data.score),
      completedAt: data.completed_at ? String(data.completed_at) : completedAt,
    };
  }

  async analytics(userId: string, classId: string) {
    await this.requireStaff(classId, userId);
    const roster = await this.roster(userId, classId);
    const students = roster.filter((m) => m.role === 'student');
    const assignments = await this.listAssignments(userId, classId);
    const materials = await this.listMaterials(userId, classId);
    const published = materials.filter((m) => m.publishedAt);
    const section = await this.getById(userId, classId);
    const studentIds = students.map((s) => s.userId);
    const lastActivity = new Map<string, string>();
    if (studentIds.length > 0) {
      const { data: events } = await this.db
        .from('learning_events')
        .select('user_id, created_at')
        .in('user_id', studentIds)
        .eq('course_id', section.course.id)
        .order('created_at', { ascending: false })
        .limit(1000);
      for (const ev of events || []) {
        if (!lastActivity.has(ev.user_id)) lastActivity.set(ev.user_id, String(ev.created_at));
      }
    }
    const now = Date.now();
    const atRiskMs = CLASS_ANALYTICS_AT_RISK_DAYS * 24 * 60 * 60 * 1000;
    const overdue = assignments.filter((a) => a.dueAt && Date.parse(a.dueAt) < now);
    const progressRows =
      assignments.length === 0
        ? []
        : (
            await this.db
              .from('class_assignment_progress')
              .select('assignment_id, user_id, status')
              .in(
                'assignment_id',
                assignments.map((a) => a.id)
              )
          ).data || [];
    const completed = new Set(
      progressRows.filter((p: { status: string }) => p.status === 'completed').map((p: { assignment_id: string; user_id: string }) => `${p.user_id}:${p.assignment_id}`)
    );

    return {
      memberCount: roster.length,
      publishedMaterialCount: published.length,
      assignmentCount: assignments.length,
      atRiskDays: CLASS_ANALYTICS_AT_RISK_DAYS,
      students: students.map((s) => {
        const last = lastActivity.get(s.userId) ?? null;
        const idle = !last || now - Date.parse(last) > atRiskMs;
        const missed = overdue.some((a) => !completed.has(`${s.userId}:${a.id}`));
        const completedAssignments = assignments.filter((a) => completed.has(`${s.userId}:${a.id}`)).length;
        return {
          userId: s.userId,
          name: s.name,
          username: s.username,
          completedAssignments,
          lastActivityAt: last,
          atRisk: idle || missed,
        };
      }),
    };
  }

  async listMyStaff(userId: string) {
    const { data, error } = await this.db
      .from('institution_staff')
      .select('institution_id, user_id, role, status, created_at, marketplace_campuses(name)')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return (data || []).map((row: Record<string, unknown>) => {
      const campus = Array.isArray(row.marketplace_campuses)
        ? row.marketplace_campuses[0]
        : row.marketplace_campuses;
      return {
        institutionId: String(row.institution_id),
        institutionName:
          campus && typeof campus === 'object' ? String((campus as { name?: string }).name || '') : undefined,
        userId: String(row.user_id),
        role: row.role as InstitutionStaffRole,
        status: 'active' as const,
        createdAt: String(row.created_at ?? ''),
      };
    });
  }

  private async assertInstitutionAdmin(actorId: string, institutionId: string, authUser?: unknown) {
    if (resolvePlatformAdmin(authUser)) return;
    const { data, error } = await this.db
      .from('institution_staff')
      .select('role, status')
      .eq('institution_id', institutionId)
      .eq('user_id', actorId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    if (!data || data.role !== 'institution_admin') classFail('Only a campus admin can do that', 403);
  }

  async listStaff(
    actorId: string,
    institutionId: string,
    authUser?: unknown
  ) {
    if (!isUuid(institutionId)) classFail('institutionId is invalid');
    await this.assertInstitutionAdmin(actorId, institutionId, authUser);
    const { data, error } = await this.db
      .from('institution_staff')
      .select('institution_id, user_id, role, status, created_at, profiles!institution_staff_user_id_fkey(name, username)')
      .eq('institution_id', institutionId);
    if (error) throw error;
    return (data || []).map((row: Record<string, unknown>) => {
      const profile = profileFromEmbed(row.profiles);
      return {
        institutionId: String(row.institution_id),
        userId: String(row.user_id),
        name: profile.name,
        username: profile.username,
        role: row.role as InstitutionStaffRole,
        status: row.status === 'revoked' ? ('revoked' as const) : ('active' as const),
        createdAt: String(row.created_at ?? ''),
      };
    });
  }

  async addStaff(
    actorId: string,
    institutionId: string,
    input: { userId?: unknown; role?: unknown },
    authUser?: unknown
  ) {
    if (!isUuid(institutionId)) classFail('institutionId is invalid');
    await this.assertInstitutionAdmin(actorId, institutionId, authUser);
    if (!isUuid(input.userId)) classFail('userId is required');
    if (!isStaffRole(input.role)) classFail('role must be instructor, department_admin or institution_admin');
    const { data, error } = await this.db
      .from('institution_staff')
      .upsert(
        {
          institution_id: institutionId,
          user_id: input.userId,
          role: input.role,
          status: 'active',
          created_by: actorId,
        },
        { onConflict: 'institution_id,user_id' }
      )
      .select('institution_id, user_id, role, status, created_at')
      .single();
    if (error) throw error;
    return {
      institutionId: String(data.institution_id),
      userId: String(data.user_id),
      role: data.role as InstitutionStaffRole,
      status: 'active' as const,
      createdAt: String(data.created_at ?? ''),
    };
  }

  async patchStaff(
    actorId: string,
    institutionId: string,
    targetUserId: string,
    input: { role?: unknown; status?: unknown },
    authUser?: unknown
  ) {
    await this.assertInstitutionAdmin(actorId, institutionId, authUser);
    const updates: Record<string, unknown> = {};
    if (input.role !== undefined) {
      if (!isStaffRole(input.role)) classFail('Invalid staff role');
      updates.role = input.role;
    }
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'revoked') classFail('Invalid status');
      updates.status = input.status;
    }
    if (Object.keys(updates).length === 0) classFail('Nothing to update');
    const { data, error } = await this.db
      .from('institution_staff')
      .update(updates)
      .eq('institution_id', institutionId)
      .eq('user_id', targetUserId)
      .select('institution_id, user_id, role, status, created_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) classFail('Staff row not found', 404);
    return {
      institutionId: String(data.institution_id),
      userId: String(data.user_id),
      role: data.role as InstitutionStaffRole,
      status: data.status === 'revoked' ? ('revoked' as const) : ('active' as const),
      createdAt: String(data.created_at ?? ''),
    };
  }

  async institutionAnalytics(
    actorId: string,
    institutionId: string,
    authUser?: unknown
  ) {
    if (!isUuid(institutionId)) classFail('institutionId is invalid');
    await this.assertInstitutionAdmin(actorId, institutionId, authUser);
    const { data: classes, error } = await this.db
      .from('class_sections')
      .select('id')
      .eq('institution_id', institutionId)
      .is('archived_at', null);
    if (error) throw error;
    const ids = (classes || []).map((row: { id: string }) => row.id);
    let memberCount = 0;
    let publishedMaterialCount = 0;
    let assignmentCount = 0;
    if (ids.length > 0) {
      const [members, materials, assignments] = await Promise.all([
        this.db.from('class_members').select('user_id', { count: 'exact', head: true }).in('class_id', ids).eq('status', 'active'),
        this.db
          .from('class_materials')
          .select('id', { count: 'exact', head: true })
          .in('class_id', ids)
          .not('published_at', 'is', null),
        this.db.from('class_assignments').select('id', { count: 'exact', head: true }).in('class_id', ids),
      ]);
      memberCount = members.count ?? 0;
      publishedMaterialCount = materials.count ?? 0;
      assignmentCount = assignments.count ?? 0;
    }
    return {
      institutionId,
      classCount: ids.length,
      memberCount,
      publishedMaterialCount,
      assignmentCount,
    };
  }

  async setCourseCanonical(
    actorId: string,
    courseId: string,
    isCanonical: boolean,
    authUser?: unknown
  ) {
    if (!isUuid(courseId)) classFail('courseId is invalid');
    const course = await this.courses().getCourseById(courseId);
    if (!course) classFail('Course not found', 404);
    if (!resolvePlatformAdmin(authUser)) {
      if (!course.institutionId) classFail('This course is not tied to a campus', 403);
      const { data, error } = await this.db
        .from('institution_staff')
        .select('role, status')
        .eq('institution_id', course.institutionId)
        .eq('user_id', actorId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (!data || !isInstitutionCatalogAdmin(data.role)) {
        classFail('Only a department or campus admin can mark a course official', 403);
      }
    }
    const { data, error } = await this.db
      .from('courses')
      .update({ is_canonical: Boolean(isCanonical) })
      .eq('id', courseId)
      .select(COURSE_EMBED)
      .single();
    if (error) throw error;
    const mapped = mapCourseRow(data);
    if (!mapped) classFail('Course update failed', 500);
    return mapped;
  }

  lmsConnectors() {
    return {
      available: false as const,
      connectors: [] as [],
      message: LMS_MESSAGE,
    };
  }

  async publishedMaterialsForStudentCourse(userId: string, courseId: string | null) {
    // Includes archived classes on purpose: last term's published notes stay in
    // Library after the lecturer closes the section for a new cohort.
    const classes = await this.listForUser(userId, 'all');
    const relevant = courseId ? classes.filter((c) => c.course.id === courseId) : classes;
    const materials = [];
    for (const cls of relevant) {
      const rows = await this.listMaterials(userId, cls.id);
      for (const row of rows) {
        if (row.publishedAt) materials.push({ ...row, classTitle: cls.title, course: cls.course });
      }
    }
    return materials;
  }

  async studentAssignments(userId: string) {
    const classes = await this.listForUser(userId, 'student');
    const out = [];
    for (const cls of classes) {
      const assignments = await this.listAssignments(userId, cls.id);
      for (const a of assignments) out.push({ ...a, classTitle: cls.title, course: cls.course });
    }
    return out;
  }

  async corpusForCompanion(userId: string, classId?: string | null): Promise<string> {
    try {
      if (classId && isUuid(classId)) {
        const member = await this.membership(classId, userId);
        if (member?.status === 'active') return this.publishedCorpus(classId);
        return '';
      }
      const classes = await this.listForUser(userId, 'all');
      const chunks: string[] = [];
      for (const cls of classes.slice(0, 3)) {
        const text = await this.publishedCorpus(cls.id);
        if (text) chunks.push(`Class: ${cls.title}\n${text}`);
      }
      return chunks.join('\n\n').slice(0, 24_000);
    } catch (err) {
      logger.warn('class companion corpus skipped', { err });
      return '';
    }
  }
}

let service: ClassSectionsService | null = null;

export function getClassSectionsService(supabaseService: SupabaseService): ClassSectionsService {
  if (!service) service = new ClassSectionsService(supabaseService);
  return service;
}

export function resetClassSectionsServiceForTests(): void {
  service = null;
}
