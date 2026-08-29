import {
  isStudyRoomExpired,
  isStudyRoomReusable,
  studyRoomPresenceChannel,
  STUDY_ROOM_ACTIVE_MS,
  STUDY_ROOM_MAX_AGE_MS,
} from './studyRooms';

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

describe('isStudyRoomExpired', () => {
  const now = Date.parse('2026-08-29T12:00:00.000Z');

  it('a room inside the 6-hour lifetime is not expired', () => {
    expect(isStudyRoomExpired('2026-08-29T06:00:01.000Z', now)).toBe(false);
  });

  it('a room past the lifetime is expired', () => {
    expect(isStudyRoomExpired('2026-08-29T05:59:59.000Z', now)).toBe(true);
  });

  it('treats missing or bad dates as expired (never a zombie "live" room)', () => {
    expect(isStudyRoomExpired(null, now)).toBe(true);
    expect(isStudyRoomExpired(undefined, now)).toBe(true);
    expect(isStudyRoomExpired('not-a-date', now)).toBe(true);
  });

  it('the lifetime is longer than the reuse window (join-then-instantly-closed is impossible)', () => {
    expect(STUDY_ROOM_MAX_AGE_MS).toBeGreaterThan(STUDY_ROOM_ACTIVE_MS);
  });
});

describe('studyRoomPresenceChannel', () => {
  it('is scoped to the room id', () => {
    expect(studyRoomPresenceChannel('abc')).toBe('study-room:abc');
  });
});
