/** Phase 4 · V — cross-university study rooms (repurposed study_sessions). */

export const STUDY_ROOM_ACTIVE_MS = 4 * 60 * 60 * 1000;
export const STUDY_ROOM_PRESENCE_CHANNEL_PREFIX = 'study-room:';

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
