/**
 * Phase 4 V — study rooms on the dormant study_sessions tables.
 *
 * Join-or-create reuses an active room for the same course (+ optional topic)
 * started in the last 4 hours so "23 medical students studying cardiology
 * tonight" lands in one room instead of 23. Roster is pull-based; the client
 * may open ONE Supabase presence channel for the room it is in.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import {
  isStudyRoomReusable,
  studyRoomPresenceChannel,
  type JoinOrCreateStudyRoomInput,
  type StudyRoom,
  type StudyRoomDetail,
  type StudyRoomParticipant,
} from '@lantern/shared/network';
import {
  ensureLinkedHangoutGroup,
  insertHangoutGroup,
  joinHangoutGroup,
} from './hangoutGroups';
import { logger } from '../utils/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPIC_MAX = 80;
const TITLE_MAX = 120;

function notFound(message = 'Study room not found'): never {
  throw Object.assign(new PublicError(message), { statusCode: 404 });
}

function bad(message: string): never {
  throw new PublicError(message);
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function trimTopic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().slice(0, TOPIC_MAX);
  return t || null;
}

type SessionRow = {
  id: string;
  title: string | null;
  course_id: string | null;
  community_id: string | null;
  topic_id: string | null;
  topic: string | null;
  kind: string | null;
  created_by: string | null;
  started_at: string;
  is_active: boolean;
  group_id?: string | null;
};

const SESSION_COLUMNS =
  'id, title, course_id, community_id, topic_id, topic, kind, created_by, started_at, is_active, group_id';

function mapRoom(row: SessionRow, participantCount: number): StudyRoom {
  return {
    id: row.id,
    title: row.title || 'Study room',
    courseId: row.course_id,
    communityId: row.community_id,
    topicId: row.topic_id,
    topic: row.topic,
    kind: row.kind === 'lab' ? 'lab' : 'room',
    createdBy: row.created_by,
    startedAt: row.started_at,
    isActive: row.is_active !== false,
    participantCount,
    presenceChannel: studyRoomPresenceChannel(row.id),
  };
}

export class StudyRoomsService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async joinOrCreate(userId: string, input: JoinOrCreateStudyRoomInput): Promise<StudyRoomDetail> {
    const courseId = uuidOrNull(input.courseId);
    const communityId = uuidOrNull(input.communityId);
    const topicId = uuidOrNull(input.topicId);
    const topic = trimTopic(input.topic);
    if (!courseId && !communityId) {
      bad('Pick a course (or community) to open a study room');
    }

    const existing = await this.findReusable(courseId, communityId, topic);
    if (existing) {
      await this.ensureParticipant(existing.id, userId);
      await this.ensureRoomGroupAndJoin(userId, existing);
      return this.get(userId, existing.id);
    }

    const title =
      (typeof input.title === 'string' && input.title.trim().slice(0, TITLE_MAX)) ||
      (topic ? `Studying ${topic}` : 'Study room');

    const { data, error } = await this.db
      .from('study_sessions')
      .insert({
        deck_id: null,
        created_by: userId,
        is_active: true,
        kind: 'room',
        course_id: courseId,
        community_id: communityId,
        topic_id: topicId,
        topic,
        title,
        started_at: new Date().toISOString(),
      })
      .select(SESSION_COLUMNS)
      .single();
    if (error || !data) throw error || new PublicError('Could not open a study room');

    await this.ensureParticipant(data.id, userId);
    await this.ensureRoomGroupAndJoin(userId, data as SessionRow);
    return this.get(userId, data.id);
  }

  async get(userId: string, roomId: string): Promise<StudyRoomDetail> {
    if (!UUID_RE.test(String(roomId))) notFound();
    const { data, error } = await this.db
      .from('study_sessions')
      .select(SESSION_COLUMNS)
      .eq('id', roomId)
      .maybeSingle();
    if (error) throw error;
    if (!data) notFound();

    const row = data as SessionRow;
    const participants = await this.loadRoster(roomId);
    const joined = participants.some((p) => p.userId === userId);
    return {
      ...mapRoom(row, participants.length),
      participants,
      joined,
      groupId: joined ? row.group_id ?? null : null,
    };
  }

  async join(userId: string, roomId: string): Promise<StudyRoomDetail> {
    const room = await this.get(userId, roomId);
    if (!room.isActive) bad('This study room has closed');
    await this.ensureParticipant(roomId, userId);
    await this.ensureRoomGroupAndJoin(userId, { id: roomId });
    return this.get(userId, roomId);
  }

  async leave(userId: string, roomId: string): Promise<{ left: true }> {
    if (!UUID_RE.test(String(roomId))) notFound();
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('study_session_participants')
      .update({ left_at: now })
      .eq('session_id', roomId)
      .eq('user_id', userId)
      .is('left_at', null);
    if (error) throw error;

    const { count } = await this.db
      .from('study_session_participants')
      .select('user_id', { count: 'exact', head: true })
      .eq('session_id', roomId)
      .is('left_at', null);
    if ((count ?? 0) === 0) {
      await this.db.from('study_sessions').update({ is_active: false, ends_at: now }).eq('id', roomId);
    }
    return { left: true };
  }

  private async findReusable(
    courseId: string | null,
    communityId: string | null,
    topic: string | null,
  ): Promise<{ id: string } | null> {
    let query = this.db
      .from('study_sessions')
      .select('id, started_at, topic')
      .eq('is_active', true)
      .eq('kind', 'room')
      .order('started_at', { ascending: false })
      .limit(20);
    if (courseId) query = query.eq('course_id', courseId);
    else if (communityId) query = query.eq('community_id', communityId);

    const { data, error } = await query;
    if (error) throw error;
    const now = Date.now();
    const match = (data || []).find((row: { id: string; started_at: string; topic: string | null }) => {
      if (!isStudyRoomReusable(row.started_at, now)) return false;
      if (topic) return (row.topic || '').toLowerCase() === topic.toLowerCase();
      return !row.topic;
    });
    return match ? { id: match.id } : null;
  }

  private async ensureRoomGroupAndJoin(
    userId: string,
    session: { id: string; title?: string | null; course_id?: string | null; group_id?: string | null },
  ): Promise<string | null> {
    try {
      const { data: fresh, error } = await this.db
        .from('study_sessions')
        .select('id, title, course_id, group_id')
        .eq('id', session.id)
        .maybeSingle();
      if (error) throw error;
      const row = (fresh || session) as {
        id: string;
        title?: string | null;
        course_id?: string | null;
        group_id?: string | null;
      };
      const groupId = await ensureLinkedHangoutGroup(this.db, {
        parentTable: 'study_sessions',
        parentId: session.id,
        linkColumn: 'group_id',
        existingGroupId: row.group_id ?? null,
        create: () =>
          insertHangoutGroup(this.db, {
            name: row.title || 'Study room',
            visibility: 'private',
            courseId: row.course_id ?? null,
            adminUserId: userId,
            description: 'Study room hangout',
          }),
      });
      await joinHangoutGroup(this.db, groupId, userId);
      return groupId;
    } catch (err) {
      logger.warn('study room hangout join skipped', {
        roomId: session.id,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return session.group_id ?? null;
    }
  }

  private async ensureParticipant(roomId: string, userId: string): Promise<void> {
    const { data: existing } = await this.db
      .from('study_session_participants')
      .select('user_id, left_at')
      .eq('session_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) {
      if (existing.left_at) {
        const { error } = await this.db
          .from('study_session_participants')
          .update({ left_at: null, joined_at: new Date().toISOString() })
          .eq('session_id', roomId)
          .eq('user_id', userId);
        if (error) throw error;
      }
      return;
    }
    const { error } = await this.db.from('study_session_participants').insert({
      session_id: roomId,
      user_id: userId,
      joined_at: new Date().toISOString(),
    });
    if (error && (error as { code?: string }).code !== '23505') throw error;
  }

  private async loadRoster(roomId: string): Promise<StudyRoomParticipant[]> {
    const { data, error } = await this.db
      .from('study_session_participants')
      .select('user_id, joined_at, profiles:user_id (name, avatar_url)')
      .eq('session_id', roomId)
      .is('left_at', null)
      .order('joined_at', { ascending: true })
      .limit(80);
    if (error) throw error;
    return (data || []).map((row: any) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        userId: String(row.user_id),
        name: String(profile?.name || 'Student'),
        avatarUrl: profile?.avatar_url ?? null,
        joinedAt: String(row.joined_at),
      };
    });
  }
}

let service: StudyRoomsService | null = null;

export function getStudyRoomsService(supabaseService: SupabaseService): StudyRoomsService {
  if (!service) service = new StudyRoomsService(supabaseService);
  return service;
}

export function resetStudyRoomsServiceForTests(): void {
  service = null;
}
