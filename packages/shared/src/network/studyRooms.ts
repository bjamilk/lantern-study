/** Phase 4 · V — cross-university study rooms (repurposed study_sessions). */

export const STUDY_ROOM_ACTIVE_MS = 4 * 60 * 60 * 1000;
/**
 * Rooms are temporary by design (founder decision 2026-08-29): a room whose
 * start is older than this AUTO-CLOSES even if nobody tapped Leave — people
 * kill the app mid-session and abandoned rooms must not linger as "live".
 */
export const STUDY_ROOM_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Closed rooms are DELETED (roster included, FK cascade) after this many days. */
export const STUDY_ROOM_PURGE_AFTER_DAYS = 3;
/** User-facing copy for the room lifecycle — one string, both platforms. */
export const STUDY_ROOM_LIFETIME_COPY =
  'Rooms are temporary: this one closes on its own after 6 hours (or when the last person leaves) and is deleted a few days later.';
export const STUDY_ROOM_PRESENCE_CHANNEL_PREFIX = 'study-room:';

/** A room past its maximum age is closed, whatever is_active still says. */
export function isStudyRoomExpired(
  startedAt: string | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = STUDY_ROOM_MAX_AGE_MS,
): boolean {
  if (!startedAt) return true;
  const ts = Date.parse(startedAt);
  if (!Number.isFinite(ts)) return true;
  return now - ts > maxAgeMs;
}

export function studyRoomPresenceChannel(roomId: string): string {
  return `${STUDY_ROOM_PRESENCE_CHANNEL_PREFIX}${roomId}`;
}

export function isStudyRoomReusable(
  startedAt: string | null | undefined,
  now: number = Date.now(),
  windowMs: number = STUDY_ROOM_ACTIVE_MS,
): boolean {
  if (!startedAt) return false;
  const ts = Date.parse(startedAt);
  if (!Number.isFinite(ts)) return false;
  return now - ts <= windowMs;
}

export interface StudyRoomParticipant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  joinedAt: string;
}

export interface StudyRoom {
  id: string;
  title: string;
  courseId: string | null;
  communityId: string | null;
  topicId: string | null;
  topic: string | null;
  kind: 'room' | 'lab';
  createdBy: string | null;
  startedAt: string;
  isActive: boolean;
  participantCount: number;
  presenceChannel: string;
}

export interface StudyRoomDetail extends StudyRoom {
  participants: StudyRoomParticipant[];
  joined: boolean;
}

export interface JoinOrCreateStudyRoomInput {
  courseId?: string | null;
  communityId?: string | null;
  topicId?: string | null;
  topic?: string | null;
  title?: string | null;
}
