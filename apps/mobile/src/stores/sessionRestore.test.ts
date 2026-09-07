import {
  planSessionRestore,
  restoreRetryDelayMs,
  RESTORE_RETRY_MAX_MS,
  type SessionRestoreNetworkResult,
  type StoredSessionPresence,
} from './sessionRestore';

const NETWORK_RESULTS: SessionRestoreNetworkResult[] = ['ok', 'timeout', 'refused', 'offline'];
const STORED: StoredSessionPresence[] = ['present', 'absent'];

describe('planSessionRestore matrix', () => {
  it('renders the app on a refreshed session', () => {
    expect(planSessionRestore({ networkResult: 'ok', storedSession: 'present' })).toEqual({
      route: 'app',
      sessionState: 'authenticated',
      useStoredSession: false,
      signOut: false,
      retryRefresh: false,
      notice: 'none',
    });
  });

  it('renders the app on the STORED session when the refresh times out', () => {
    expect(planSessionRestore({ networkResult: 'timeout', storedSession: 'present' })).toEqual({
      route: 'app',
      sessionState: 'restoring',
      useStoredSession: true,
      signOut: false,
      retryRefresh: true,
      notice: 'reconnecting',
    });
  });

  it('renders the app on the STORED session when offline, with the offline line', () => {
    expect(planSessionRestore({ networkResult: 'offline', storedSession: 'present' })).toEqual({
      route: 'app',
      sessionState: 'restoring',
      useStoredSession: true,
      signOut: false,
      retryRefresh: true,
      notice: 'offline',
    });
  });

  it('signs out only on a definitive refusal, and only with a session to revoke', () => {
    expect(planSessionRestore({ networkResult: 'refused', storedSession: 'present' })).toEqual({
      route: 'sign-in',
      sessionState: 'signed-out',
      useStoredSession: false,
      signOut: 'revoked',
      retryRefresh: false,
      notice: 'none',
    });
    expect(planSessionRestore({ networkResult: 'refused', storedSession: 'absent' }).signOut).toBe(
      false
    );
  });

  it.each(['timeout', 'offline', 'refused'] as const)(
    'sends a device with no stored session to sign-in (%s)',
    (networkResult) => {
      const plan = planSessionRestore({ networkResult, storedSession: 'absent' });
      expect(plan.route).toBe('sign-in');
      expect(plan.sessionState).toBe('signed-out');
      expect(plan.retryRefresh).toBe(false);
    }
  );

  it('never signs out without positive proof', () => {
    for (const networkResult of NETWORK_RESULTS) {
      for (const storedSession of STORED) {
        const plan = planSessionRestore({ networkResult, storedSession });
        if (plan.signOut !== false) expect(networkResult).toBe('refused');
      }
    }
  });

  it('never sends a device holding a session to the sign-in route on a network failure', () => {
    for (const networkResult of ['timeout', 'offline'] as const) {
      expect(planSessionRestore({ networkResult, storedSession: 'present' }).route).toBe('app');
    }
  });

  it('only shows a notice while restoring', () => {
    for (const networkResult of NETWORK_RESULTS) {
      for (const storedSession of STORED) {
        const plan = planSessionRestore({ networkResult, storedSession });
        expect(plan.notice !== 'none').toBe(plan.sessionState === 'restoring');
      }
    }
  });
});

describe('restoreRetryDelayMs', () => {
  it('backs off exponentially from 1s and caps at 60s', () => {
    expect(restoreRetryDelayMs(1)).toBe(1_000);
    expect(restoreRetryDelayMs(2)).toBe(2_000);
    expect(restoreRetryDelayMs(3)).toBe(4_000);
    expect(restoreRetryDelayMs(7)).toBe(RESTORE_RETRY_MAX_MS);
    expect(restoreRetryDelayMs(500)).toBe(RESTORE_RETRY_MAX_MS);
  });

  it('is finite for any input', () => {
    expect(restoreRetryDelayMs(0)).toBe(1_000);
    expect(restoreRetryDelayMs(Number.NaN)).toBe(1_000);
  });
});
