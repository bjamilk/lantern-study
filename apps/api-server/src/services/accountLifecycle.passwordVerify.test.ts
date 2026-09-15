/**
 * F6 — `verifyUserPassword` must not leave a live session behind.
 *
 * It re-authenticates with the anon key to confirm the password before an
 * irreversible action (delete-immediate, archive import). That mints a real
 * GoTrue session whose refresh token stayed valid server-side long after the
 * request ended — a password prompt quietly handing out a spare key. The
 * session is now revoked, and with `scope: 'local'` so confirming a password
 * does not sign the user out of every device.
 */
const signInWithPassword = jest.fn();
const signOut = jest.fn(async () => ({ error: null }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithPassword, signOut } }),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { verifyUserPassword } from './accountLifecycle';

describe('verifyUserPassword session cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
  });

  it('revokes the verification session locally after a correct password', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'at', refresh_token: 'rt' } },
      error: null,
    });

    await expect(verifyUserPassword('a@b.com', 'right')).resolves.toBe(true);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('has no session to revoke when the password is wrong', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid' } });

    await expect(verifyUserPassword('a@b.com', 'wrong')).resolves.toBe(false);

    expect(signOut).not.toHaveBeenCalled();
  });

  it('still reports success when the revocation itself fails', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'at' } }, error: null });
    signOut.mockRejectedValueOnce(new Error('network down'));

    await expect(verifyUserPassword('a@b.com', 'right')).resolves.toBe(true);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
