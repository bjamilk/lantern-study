/**
 * Platform-admin role management is ON by default.
 *
 * It shipped opt-in behind ENABLE_ADMIN_ROLE_MANAGEMENT=true, which was set
 * nowhere, so the admin console's "Make admin" button always returned 403 and
 * the only way to grant admin was the Supabase dashboard. These tests pin the
 * kill-switch semantics: absent or empty means enabled, only a literal "false"
 * disables, and the value is read per call so a restart is the only thing
 * needed to change it.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { resolveRoleManagementEnabled } from './admin';

describe('resolveRoleManagementEnabled', () => {
  it('is enabled when the variable is unset — the console works out of the box', () => {
    expect(resolveRoleManagementEnabled(undefined)).toBe(true);
    expect(resolveRoleManagementEnabled('')).toBe(true);
  });

  it('is disabled only by a literal false, case and padding insensitive', () => {
    expect(resolveRoleManagementEnabled('false')).toBe(false);
    expect(resolveRoleManagementEnabled('FALSE')).toBe(false);
    expect(resolveRoleManagementEnabled('  False  ')).toBe(false);
  });

  it('treats every other value as enabled, including the old opt-in "true"', () => {
    // A server still carrying the old ENABLE_ADMIN_ROLE_MANAGEMENT=true keeps
    // working; so does a typo, which must never silently lock the founder out.
    expect(resolveRoleManagementEnabled('true')).toBe(true);
    expect(resolveRoleManagementEnabled('1')).toBe(true);
    expect(resolveRoleManagementEnabled('no')).toBe(true);
  });

  it('reads the environment when no argument is given', () => {
    const previous = process.env.ENABLE_ADMIN_ROLE_MANAGEMENT;
    try {
      process.env.ENABLE_ADMIN_ROLE_MANAGEMENT = 'false';
      expect(resolveRoleManagementEnabled()).toBe(false);
      delete process.env.ENABLE_ADMIN_ROLE_MANAGEMENT;
      expect(resolveRoleManagementEnabled()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_ADMIN_ROLE_MANAGEMENT;
      else process.env.ENABLE_ADMIN_ROLE_MANAGEMENT = previous;
    }
  });
});
