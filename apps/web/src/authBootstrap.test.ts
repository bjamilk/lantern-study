import { describe, expect, it } from 'vitest';
import {
  isAccessTokenFreshEnough,
  shouldRestorePersistedAuthUser,
} from '../../../utils/authBootstrap';

describe('shouldRestorePersistedAuthUser', () => {
  it('restores only when persisted user matches a boot token', () => {
    expect(
      shouldRestorePersistedAuthUser(
        { token: 'tok', userId: 'user-1' },
        { id: 'user-1' },
      ),
    ).toBe(true);
  });

  it('rejects persisted user without a boot token (stale guest case)', () => {
    expect(shouldRestorePersistedAuthUser(null, { id: 'user-1' })).toBe(false);
  });

  it('rejects mismatched user ids', () => {
    expect(
      shouldRestorePersistedAuthUser(
        { token: 'tok', userId: 'user-1' },
        { id: 'user-2' },
      ),
    ).toBe(false);
  });
});

describe('isAccessTokenFreshEnough', () => {
  it('requires a known expiry and remaining lifetime beyond the buffer', () => {
    const now = 1_700_000_000;
    expect(isAccessTokenFreshEnough(null, now)).toBe(false);
    expect(isAccessTokenFreshEnough(now + 30, now, 60)).toBe(false);
    expect(isAccessTokenFreshEnough(now + 120, now, 60)).toBe(true);
  });
});
