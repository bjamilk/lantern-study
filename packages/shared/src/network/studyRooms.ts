/** Phase 4 · V — cross-university study rooms (repurposed study_sessions). */

/**
 * Rooms are temporary by design (founder decision 2026-08-29, lifetime set to
 * 24 hours 2026-09-02): a room whose start is older than this AUTO-CLOSES
 * even if nobody tapped Leave — people kill the app mid-session and
 * abandoned rooms must not linger as "live". A closed room leaves the Room
 * tab at once.
 */
export const STUDY_ROOM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Join-or-create reuses an open room for the same course/community instead
 * of forking a second one. That window is the room's whole life: while a room
 * is open, "Start a room" for that course lands you in it.
 */
export const STUDY_ROOM_ACTIVE_MS = STUDY_ROOM_MAX_AGE_MS;
/** Closed rooms are DELETED (roster included, FK cascade) after this many days. */
export const STUDY_ROOM_PURGE_AFTER_DAYS = 3;
/** User-facing copy for the room lifecycle — one string, both platforms. */
export const STUDY_ROOM_LIFETIME_COPY =
  'Rooms are temporary: this one closes 24 hours after it opens (or when the last person leaves) and is gone after that.';
/** How many open rooms the Room tab lists, newest first. */
export const STUDY_ROOM_LIST_LIMIT = 50;
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

/**
 * Time left before a room auto-closes, for a list row: "Closes in 23h",
 * "Closes in 40m", or "Closed". Hours are rounded down so the label never
 * promises more than the room has.
 */
export function studyRoomTimeLeftLabel(
  startedAt: string | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = STUDY_ROOM_MAX_AGE_MS,
): string {
  if (!startedAt) return 'Closed';
  const ts = Date.parse(startedAt);
  if (!Number.isFinite(ts)) return 'Closed';
  const left = ts + maxAgeMs - now;
  if (left <= 0) return 'Closed';
  const minutes = Math.floor(left / 60_000);
  if (minutes < 60) return `Closes in ${Math.max(minutes, 1)}m`;
  return `Closes in ${Math.floor(minutes / 60)}h`;
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

/** A row of the Room tab: the room plus whether the viewer is in it. */
export interface StudyRoomListItem extends StudyRoom {
  joined: boolean;
}

export interface JoinOrCreateStudyRoomInput {
  courseId?: string | null;
  communityId?: string | null;
  topicId?: string | null;
  topic?: string | null;
  title?: string | null;
}
