/**
 * Auth-layer ban enforcement.
 *
 * Banning used to write profiles.settings and sign the user out. Signing out
 * only invalidates tokens already issued — the user could sign straight back
 * in and get a fresh one, which is what made ban evasion practical. These
 * tests pin the GoTrue half: banned_until is set on ban, cleared on unban,
 * and a GoTrue failure never breaks the admin action.
 */
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { AUTH_BAN_DURATION, setAuthBan } from './admin';
import { logger } from '../utils/logger';

function clientWith(updateImpl: (id: string, attrs: any) => any) {
  const calls: Array<{ id: string; attrs: any }> = [];
  const client = {
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: any) => {
          calls.push({ id, attrs });
          return updateImpl(id, attrs);
        },
      },
    },
  };
  return { client, calls };
}

describe('setAuthBan', () => {
  it('bans in GoTrue with a long duration, so no new token can be issued', async () => {
    const { client, calls } = clientWith(() => ({ error: null }));
    const ok = await setAuthBan(client, 'user-1', AUTH_BAN_DURATION);
    expect(ok).toBe(true);
    expect(calls).toEqual([{ id: 'user-1', attrs: { ban_duration: AUTH_BAN_DURATION } }]);
  });

  it('lifts the ban on unban — otherwise an unbanned user could never sign in', async () => {
    const { client, calls } = clientWith(() => ({ error: null }));
    const ok = await setAuthBan(client, 'user-1', 'none');
    expect(ok).toBe(true);
    expect(calls[0].attrs).toEqual({ ban_duration: 'none' });
  });

  it('reports failure without throwing when GoTrue returns an error', async () => {
    // The DB ban is already committed; a GoTrue hiccup must not fail the
    // admin's action or leave the two halves inconsistent.
    const { client } = clientWith(() => ({ error: { message: 'service unavailable' } }));
    await expect(setAuthBan(client, 'user-1', AUTH_BAN_DURATION)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reports failure without throwing when the call itself throws', async () => {
    const { client } = clientWith(() => {
      throw new Error('network down');
    });
    await expect(setAuthBan(client, 'user-1', AUTH_BAN_DURATION)).resolves.toBe(false);
  });

  it('uses a duration far beyond any plausible appeal window', async () => {
    // GoTrue takes a duration, not an end date, and has no "forever"; a ban is
    // lifted explicitly, never by expiry.
    const hours = Number(AUTH_BAN_DURATION.replace('h', ''));
    expect(hours).toBeGreaterThan(24 * 365 * 50);
  });
});
