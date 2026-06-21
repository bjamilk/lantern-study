import { mergeUserSettings, stripPrivilegedSettings } from './sanitizeSettings';

describe('sanitizeSettings', () => {
  it('strips privileged keys from incoming settings', () => {
    const result = stripPrivilegedSettings({
      theme: 'dark',
      is_banned: false,
      account_status: 'active',
      is_platform_admin: true,
    });
    expect(result).toEqual({ theme: 'dark' });
  });

  it('preserves privileged keys from existing profile when merging', () => {
    const merged = mergeUserSettings(
      { theme: 'light', is_banned: true, account_status: 'banned' },
      { theme: 'dark', is_banned: false, account_status: 'active' }
    );
    expect(merged.appearance).toEqual(expect.objectContaining({ theme: 'dark' }));
    expect(merged.is_banned).toBe(true);
    expect(merged.account_status).toBe('banned');
  });
});
