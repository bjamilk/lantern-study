import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/supabase', () => ({
  setCachedAuthToken: vi.fn(),
  supabase: {
    auth: {
      refreshSession: vi.fn(),
    },
  },
}));

import { supabase } from '../../../services/supabase';
import {
  handleApiAuthFailure,
  resetSessionExpiredGuard,
  setSessionExpiredHandler,
} from '../../../services/sessionHandler';

describe('handleApiAuthFailure', () => {
  beforeEach(() => {
    resetSessionExpiredGuard();
    vi.clearAllMocks();
  });

  afterEach(() => {
    setSessionExpiredHandler(() => undefined);
    resetSessionExpiredGuard();
  });

  it('notifies once and clears when refresh cannot recover a 401', async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token', status: 401 } as any,
    } as any);

    const first = await handleApiAuthFailure(401);
    const second = await handleApiAuthFailure(401);

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('retries when refresh restores a session', async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'fresh-token',
          user: { id: 'user-1' },
        },
      },
      error: null,
    } as any);

    await expect(handleApiAuthFailure(401)).resolves.toBe(true);
    expect(onExpired).not.toHaveBeenCalled();
  });
});
