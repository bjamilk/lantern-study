import { resolvePlatformAdmin } from './platformAdmin';

describe('resolvePlatformAdmin', () => {
  it('is true only when JWT app_metadata.is_platform_admin is boolean true', () => {
    expect(resolvePlatformAdmin({ app_metadata: { is_platform_admin: true } })).toBe(true);
  });

  it('rejects missing, false, and stringly-true flags', () => {
    expect(resolvePlatformAdmin(undefined)).toBe(false);
    expect(resolvePlatformAdmin(null)).toBe(false);
    expect(resolvePlatformAdmin({})).toBe(false);
    expect(resolvePlatformAdmin({ app_metadata: { is_platform_admin: false } })).toBe(false);
    expect(resolvePlatformAdmin({ app_metadata: { is_platform_admin: 'true' } })).toBe(false);
  });

  it('never trusts user-editable settings or user_metadata', () => {
    expect(
      resolvePlatformAdmin(
        { app_metadata: {}, user_metadata: { is_platform_admin: true } } as {
          app_metadata?: Record<string, unknown>;
          user_metadata?: Record<string, unknown>;
        },
        { is_platform_admin: true, isAdmin: true }
      )
    ).toBe(false);
  });
});
