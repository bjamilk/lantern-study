import { isStudyRoomReusable, studyRoomPresenceChannel, STUDY_ROOM_ACTIVE_MS } from './studyRooms';

describe('isStudyRoomReusable', () => {
  const now = Date.parse('2026-08-27T12:00:00.000Z');

  it('reuses a room started inside the 4-hour window', () => {
    expect(isStudyRoomReusable('2026-08-27T09:00:01.000Z', now)).toBe(true);
  });

  it('does not reuse a room older than the window', () => {
    expect(isStudyRoomReusable('2026-08-27T07:59:00.000Z', now)).toBe(false);
  });

  it('rejects missing dates', () => {
    expect(isStudyRoomReusable(null, now)).toBe(false);
    expect(isStudyRoomReusable('not-a-date', now)).toBe(false);
  });

  it('uses the documented window', () => {
    expect(STUDY_ROOM_ACTIVE_MS).toBe(4 * 60 * 60 * 1000);
  });
});

describe('studyRoomPresenceChannel', () => {
  it('is scoped to the room id', () => {
    expect(studyRoomPresenceChannel('abc')).toBe('study-room:abc');
  });
});
