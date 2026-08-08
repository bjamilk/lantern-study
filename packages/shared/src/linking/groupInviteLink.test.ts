import { buildGroupInviteLink, parseDeepLink, WEB_BASE_URL } from './index';

describe('group invite deep links', () => {
  const inviteId = 'inv_9f3c1a2b-4d5e-6789-abcd-ef0123456789';

  it('builds a canonical web invite link from the invite token', () => {
    expect(buildGroupInviteLink(inviteId)).toBe(
      `${WEB_BASE_URL}/invite/${encodeURIComponent(inviteId)}`
    );
  });

  it('escapes tokens containing URL-significant characters', () => {
    expect(buildGroupInviteLink('a/b?c=d')).toBe(`${WEB_BASE_URL}/invite/a%2Fb%3Fc%3Dd`);
  });

  it('round-trips through parseDeepLink as an invite, not a group', () => {
    // The distinction matters: `joinGroupByInvite` resolves an invite token, so
    // routing an invite link to the plain `group` case would open a group the
    // recipient is not a member of.
    expect(parseDeepLink(buildGroupInviteLink(inviteId))).toEqual({
      type: 'invite',
      id: inviteId,
    });
  });

  it('parses the app-scheme form of an invite link', () => {
    expect(parseDeepLink(`lanternstudy://invite/${inviteId}`)).toEqual({
      type: 'invite',
      id: inviteId,
    });
  });

  it('keeps a plain group link distinct from an invite link', () => {
    expect(parseDeepLink(`${WEB_BASE_URL}/group/group-123`)).toEqual({
      type: 'group',
      id: 'group-123',
    });
  });
});
