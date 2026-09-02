/**
 * Phase 4 V — study rooms on the dormant study_sessions tables.
 *
 * Join-or-create reuses an active room for the same course (+ optional topic)
 * started while it is still open (24 hours) so "23 medical students studying cardiology
 * tonight" lands in one room instead of 23. Roster is pull-based; the client
 * may open ONE Supabase presence channel for the room it is in.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  isStudyRoomReusable,
  isStudyRoomExpired,
  STUDY_ROOM_LIST_LIMIT,
  STUDY_ROOM_MAX_AGE_MS,
  STUDY_ROOM_PURGE_AFTER_DAYS,
  type StudyRoomListItem,
  studyRoomPresenceChannel,
  type JoinOrCreateStudyRoomInput,
  type StudyRoom,
  type StudyRoomDetail,
  type StudyRoomParticipant,
} from '@lantern/shared/network';

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
};

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
    // Rooms are temporary: past the max age a room reads as closed even if
    // the abandoned-room sweep has not flipped the row yet.
    isActive: row.is_active !== false && !isStudyRoomExpired(row.started_at),
    participantCount,
    presenceChannel: studyRoomPresenceChannel(row.id),
  };
}

export class StudyRoomsService {
  constructor(private supabaseService: SupabaseService) {}

  private lastSweepAt = 0;

  private get db() {
    return this.supabaseService.getClient();
  }

  /**
   * Auto-delete lifecycle (rooms are temporary by design):
   * 1. CLOSE rooms older than STUDY_ROOM_MAX_AGE_MS whose members never
   *    tapped Leave — abandoned rooms must not linger as "live".
   * 2. DELETE closed rooms after STUDY_ROOM_PURGE_AFTER_DAYS (the roster
   *    rows go with them via ON DELETE CASCADE).
   * Piggybacks on room traffic with a 10-minute in-process debounce — no
   * cron dependency, never on the caller's critical path, never throws.
   */
  private sweepExpired(): void {
    const now = Date.now();
    if (now - this.lastSweepAt < 10 * 60_000) return;
    this.lastSweepAt = now;
    void (async () => {
      try {
        const nowIso = new Date(now).toISOString();
        const closeCutoff = new Date(now - STUDY_ROOM_MAX_AGE_MS).toISOString();
        const { data: closed, error: closeError } = await this.db
          .from('study_sessions')
          .update({ is_active: false, ends_at: nowIso })
          .eq('kind', 'room')
          .eq('is_active', true)
          .lt('started_at', closeCutoff)
          .select('id');
        if (closeError) throw closeError;
        if (closed && closed.length > 0) {
          await this.db
            .from('study_session_participants')
            .update({ left_at: nowIso })
            .in('session_id', closed.map((r: { id: string }) => r.id))
            .is('left_at', null);
        }

        const purgeCutoff = new Date(
          now - STUDY_ROOM_PURGE_AFTER_DAYS * 86_400_000
        ).toISOString();
        const { error: purgeError } = await this.db
          .from('study_sessions')
          .delete()
          .eq('kind', 'room')
          .eq('is_active', false)
          .lt('started_at', purgeCutoff);
        if (purgeError) throw purgeError;
      } catch (err) {
        // Best-effort: an expired room still reads closed via mapRoom.
        this.lastSweepAt = 0;
        logger.warn('study room sweep failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  async joinOrCreate(userId: string, input: JoinOrCreateStudyRoomInput): Promise<StudyRoomDetail> {
    this.sweepExpired();
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
      .select(
        'id, title, course_id, community_id, topic_id, topic, kind, created_by, started_at, is_active',
      )
      .single();
    if (error || !data) throw error || new PublicError('Could not open a study room');

    await this.ensureParticipant(data.id, userId);
    return this.get(userId, data.id);
  }

  /**
   * The Room tab: every open room, newest first, with the viewer's own rooms
   * first of all. Rooms are cross-university by design (Phase 4 · V), so
   * there is no campus filter; the age cutoff matches isStudyRoomExpired so a
   * room the sweep has not flipped yet is still left out.
   *
   * The viewer's open memberships are fetched before the newest-N page and
   * unioned in, so "your rooms first" holds even when more than N rooms are
   * open and theirs is not among the newest.
   */
  async list(userId: string): Promise<StudyRoomListItem[]> {
    this.sweepExpired();
    const cutoff = new Date(Date.now() - STUDY_ROOM_MAX_AGE_MS).toISOString();
    const columns =
      'id, title, course_id, community_id, topic_id, topic, kind, created_by, started_at, is_active';

    const { data: memberships, error: memberError } = await this.db
      .from('study_session_participants')
      .select('session_id')
      .eq('user_id', userId)
      .is('left_at', null)
      .limit(STUDY_ROOM_LIST_LIMIT);
    if (memberError) throw memberError;
    const mine = new Set(
      ((memberships || []) as Array<{ session_id: string }>).map((m) => String(m.session_id)),
    );

    const { data, error } = await this.db
      .from('study_sessions')
      .select(columns)
      .eq('is_active', true)
      .eq('kind', 'room')
      .gt('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(STUDY_ROOM_LIST_LIMIT);
    if (error) throw error;
    const rows = [...((data || []) as SessionRow[])];
    const onPage = new Set(rows.map((row) => row.id));
    const missing = [...mine].filter((id) => !onPage.has(id));
    if (missing.length) {
      const { data: extra, error: extraError } = await this.db
        .from('study_sessions')
        .select(columns)
        .in('id', missing)
        .eq('is_active', true)
        .eq('kind', 'room')
        .gt('started_at', cutoff);
      if (extraError) throw extraError;
      rows.push(...((extra || []) as SessionRow[]));
    }
    if (!rows.length) return [];

    const { data: roster, error: rosterError } = await this.db
      .from('study_session_participants')
      .select('session_id, user_id')
      .in(
        'session_id',
        rows.map((row) => row.id),
      )
      .is('left_at', null)
      // 50 rooms × the roster cap loadRoster uses; explicit rather than
      // PostgREST's silent max-rows.
      .limit(STUDY_ROOM_LIST_LIMIT * 80);
    if (rosterError) throw rosterError;
    const counts = new Map<string, number>();
    for (const entry of (roster || []) as Array<{ session_id: string; user_id: string }>) {
      counts.set(entry.session_id, (counts.get(entry.session_id) ?? 0) + 1);
      if (entry.user_id === userId) mine.add(entry.session_id);
    }
    return rows
      .map((row) => ({ ...mapRoom(row, counts.get(row.id) ?? 0), joined: mine.has(row.id) }))
      .filter((room) => room.isActive)
      // Your rooms first, then newest.
      .sort((a, b) => Number(b.joined) - Number(a.joined) || b.startedAt.localeCompare(a.startedAt));
  }

  async get(userId: string, roomId: string): Promise<StudyRoomDetail> {
    this.sweepExpired();
    if (!UUID_RE.test(String(roomId))) notFound();
    const { data, error } = await this.db
      .from('study_sessions')
      .select(
        'id, title, course_id, community_id, topic_id, topic, kind, created_by, started_at, is_active',
      )
      .eq('id', roomId)
      .maybeSingle();
    if (error) throw error;
    if (!data) notFound();

    const participants = await this.loadRoster(roomId);
    return {
      ...mapRoom(data as SessionRow, participants.length),
      participants,
      joined: participants.some((p) => p.userId === userId),
    };
  }

  async join(userId: string, roomId: string): Promise<StudyRoomDetail> {
    const room = await this.get(userId, roomId);
    if (!room.isActive) bad('This study room has closed');
    await this.ensureParticipant(roomId, userId);
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
      .limit(STUDY_ROOM_LIST_LIMIT);
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
