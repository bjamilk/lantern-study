import { formatChatPresenceFromStatus, formatChatPresenceLine } from './chatPresence';

describe('formatChatPresenceLine', () => {
  const now = Date.parse('2026-09-13T12:00:00.000Z');

  it('hides the line when the peer opted out', () => {
    expect(
      formatChatPresenceLine({ privacy: { showOnlineStatus: false } }, '2026-09-13T11:59:00.000Z', now),
    ).toEqual({ status: 'hidden', label: null });
  });

  it('says online inside the 5-minute window', () => {
    expect(
      formatChatPresenceLine(null, '2026-09-13T11:56:00.000Z', now).label,
    ).toBe('online');
  });

  it('says last seen 12m ago when offline', () => {
    expect(
      formatChatPresenceLine(null, '2026-09-13T11:48:00.000Z', now).label,
    ).toBe('last seen 12m ago');
  });
});

describe('formatChatPresenceFromStatus', () => {
  it('returns null for hidden or missing', () => {
    expect(formatChatPresenceFromStatus('hidden', new Date())).toBeNull();
    expect(formatChatPresenceFromStatus(undefined)).toBeNull();
  });

  it('returns online for the live status', () => {
    expect(formatChatPresenceFromStatus('online')).toBe('online');
  });
});
