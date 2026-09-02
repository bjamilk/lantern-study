import {
  isStudyRoomExpired,
  isStudyRoomReusable,
  studyRoomPresenceChannel,
  studyRoomTimeLeftLabel,
  STUDY_ROOM_ACTIVE_MS,
  STUDY_ROOM_MAX_AGE_MS,
} from './studyRooms';

describe('isStudyRoomReusable', () => {
  const now = Date.parse('2026-08-27T12:00:00.000Z');

  it('reuses a room started inside the 24-hour window', () => {
    expect(isStudyRoomReusable('2026-08-26T12:00:01.000Z', now)).toBe(true);
  });

  it('does not reuse a room older than the window', () => {
    expect(isStudyRoomReusable('2026-08-26T11:59:00.000Z', now)).toBe(false);
  });

  it('rejects missing dates', () => {
    expect(isStudyRoomReusable(null, now)).toBe(false);
    expect(isStudyRoomReusable('not-a-date', now)).toBe(false);
  });

  it('the reuse window is the whole 24-hour life of a room', () => {
    expect(STUDY_ROOM_ACTIVE_MS).toBe(24 * 60 * 60 * 1000);
    expect(STUDY_ROOM_ACTIVE_MS).toBe(STUDY_ROOM_MAX_AGE_MS);
  });
});

describe('isStudyRoomExpired', () => {
  const now = Date.parse('2026-08-29T12:00:00.000Z');

  it('a room inside the 24-hour lifetime is not expired', () => {
    expect(isStudyRoomExpired('2026-08-28T12:00:01.000Z', now)).toBe(false);
  });

  it('a room past the lifetime is expired', () => {
    expect(isStudyRoomExpired('2026-08-28T11:59:59.000Z', now)).toBe(true);
  });

  it('treats missing or bad dates as expired (never a zombie "live" room)', () => {
    expect(isStudyRoomExpired(null, now)).toBe(true);
    expect(isStudyRoomExpired(undefined, now)).toBe(true);
    expect(isStudyRoomExpired('not-a-date', now)).toBe(true);
  });

  it('the lifetime is never shorter than the reuse window (join-then-instantly-closed is impossible)', () => {
    expect(STUDY_ROOM_MAX_AGE_MS).toBeGreaterThanOrEqual(STUDY_ROOM_ACTIVE_MS);
  });
});

describe('studyRoomTimeLeftLabel', () => {
  const now = Date.parse('2026-09-02T12:00:00.000Z');

  it('rounds hours down so it never promises more than the room has', () => {
    expect(studyRoomTimeLeftLabel('2026-09-02T11:00:00.000Z', now)).toBe('Closes in 23h');
    expect(studyRoomTimeLeftLabel('2026-09-02T00:30:00.000Z', now)).toBe('Closes in 12h');
  });

  it('switches to minutes inside the last hour, never showing 0m while open', () => {
    expect(studyRoomTimeLeftLabel('2026-09-01T12:40:00.000Z', now)).toBe('Closes in 40m');
    expect(studyRoomTimeLeftLabel('2026-09-01T12:00:30.000Z', now)).toBe('Closes in 1m');
  });

  it('reads Closed at and past the lifetime, and for bad dates', () => {
    expect(studyRoomTimeLeftLabel('2026-09-01T12:00:00.000Z', now)).toBe('Closed');
    expect(studyRoomTimeLeftLabel('2026-08-31T12:00:00.000Z', now)).toBe('Closed');
    expect(studyRoomTimeLeftLabel(null, now)).toBe('Closed');
    expect(studyRoomTimeLeftLabel('nope', now)).toBe('Closed');
  });
});

describe('studyRoomPresenceChannel', () => {
  it('is scoped to the room id', () => {
    expect(studyRoomPresenceChannel('abc')).toBe('study-room:abc');
  });
});
