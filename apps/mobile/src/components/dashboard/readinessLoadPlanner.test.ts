import {
  planReadinessLoad,
  type ReadinessLoadInput,
  type ReadinessLoadTrigger,
} from './readinessLoadPlanner';

const input = (over: Partial<ReadinessLoadInput> = {}): ReadinessLoadInput => ({
  trigger: 'focus',
  status: 'ready',
  inFlight: false,
  userId: 'u1',
  loadedForUserId: 'u1',
  ...over,
});

const RECOVERY_TRIGGERS: ReadinessLoadTrigger[] = ['focus', 'pull-to-refresh', 'reconnected'];

describe('planReadinessLoad', () => {
  it('fetches on first render, before anything has been loaded', () => {
    expect(
      planReadinessLoad(input({ trigger: 'user-changed', status: 'loading', loadedForUserId: null }))
    ).toEqual({ fetch: true, reset: false });
  });

  // The reported defect: airplane mode off, and the card kept the failure
  // through two pull-to-refreshes, a tab round trip and a theme remount.
  it.each(RECOVERY_TRIGGERS)('re-fetches a failed card on %s', (trigger) => {
    expect(planReadinessLoad(input({ trigger, status: 'failed' })).fetch).toBe(true);
  });

  it('re-fetches a card that has never answered when the link comes back', () => {
    expect(
      planReadinessLoad(
        input({ trigger: 'reconnected', status: 'loading', loadedForUserId: null })
      ).fetch
    ).toBe(true);
  });

  it('leaves a healthy card alone when the link comes back', () => {
    expect(planReadinessLoad(input({ trigger: 'reconnected', status: 'ready' }))).toEqual({
      fetch: false,
      reset: false,
    });
  });

  it('still re-fetches a healthy card on focus and on pull-to-refresh', () => {
    expect(planReadinessLoad(input({ trigger: 'focus', status: 'ready' })).fetch).toBe(true);
    expect(planReadinessLoad(input({ trigger: 'pull-to-refresh', status: 'ready' })).fetch).toBe(
      true
    );
  });

  it('keeps the failure on screen while the retry is in the air', () => {
    // No `reset`: blanking the card for the length of a request trades one
    // honest sentence for a flash of nothing.
    expect(planReadinessLoad(input({ trigger: 'pull-to-refresh', status: 'failed' }))).toEqual({
      fetch: true,
      reset: false,
    });
  });

  it('never puts two requests in the air at once', () => {
    for (const trigger of RECOVERY_TRIGGERS) {
      expect(planReadinessLoad(input({ trigger, status: 'failed', inFlight: true }))).toEqual({
        fetch: false,
        reset: false,
      });
    }
  });

  it('drops another account’s readiness and reloads when the user changes', () => {
    expect(
      planReadinessLoad(
        input({ trigger: 'user-changed', status: 'ready', loadedForUserId: 'someone-else' })
      )
    ).toEqual({ fetch: true, reset: true });
  });

  it('reloads for a new account even while the previous request is in the air', () => {
    expect(
      planReadinessLoad(
        input({
          trigger: 'user-changed',
          status: 'loading',
          inFlight: true,
          loadedForUserId: 'someone-else',
        })
      )
    ).toEqual({ fetch: true, reset: true });
  });

  it('clears the card and fetches nothing when signed out', () => {
    for (const trigger of ['user-changed', ...RECOVERY_TRIGGERS] as ReadinessLoadTrigger[]) {
      expect(planReadinessLoad(input({ trigger, userId: null }))).toEqual({
        fetch: false,
        reset: true,
      });
    }
  });
});
