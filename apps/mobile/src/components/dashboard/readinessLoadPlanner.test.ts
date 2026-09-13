import {
  planReadinessLoad,
  readinessCardBody,
  READINESS_LOADING_TIMEOUT_MS,
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
    ).toEqual({ fetch: true, reset: false, settle: false });
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
      settle: true,
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
      settle: false,
    });
  });

  it('never puts two requests in the air at once', () => {
    for (const trigger of RECOVERY_TRIGGERS) {
      expect(planReadinessLoad(input({ trigger, status: 'failed', inFlight: true }))).toEqual({
        fetch: false,
        reset: false,
        settle: false,
      });
    }
  });

  it('drops another account’s readiness and reloads when the user changes', () => {
    expect(
      planReadinessLoad(
        input({ trigger: 'user-changed', status: 'ready', loadedForUserId: 'someone-else' })
      )
    ).toEqual({ fetch: true, reset: true, settle: false });
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
    ).toEqual({ fetch: true, reset: true, settle: false });
  });

  it('clears the card and fetches nothing when signed out', () => {
    for (const trigger of ['user-changed', ...RECOVERY_TRIGGERS] as ReadinessLoadTrigger[]) {
      expect(planReadinessLoad(input({ trigger, userId: null }))).toEqual({
        fetch: false,
        reset: true,
        settle: true,
      });
    }
  });

  // The build-199 blank: a plan that starts no fetch must tell the card to
  // stop waiting, or `loading` is permanent and Home's exam slot renders
  // nothing at all.
  it('settles the card whenever it decides not to fetch and nothing is in the air', () => {
    for (const trigger of ['user-changed', ...RECOVERY_TRIGGERS] as ReadinessLoadTrigger[]) {
      const plan = planReadinessLoad(input({ trigger, userId: null, status: 'loading' }));
      expect(plan.fetch).toBe(false);
      expect(plan.settle).toBe(true);
    }
  });

  it('keeps waiting — does not settle — while a request is genuinely out', () => {
    expect(
      planReadinessLoad(input({ trigger: 'focus', status: 'loading', inFlight: true })).settle
    ).toBe(false);
  });

  it('still reloads an empty card on every recovery trigger', () => {
    for (const trigger of RECOVERY_TRIGGERS) {
      expect(planReadinessLoad(input({ trigger, status: 'empty' })).fetch).toBe(true);
    }
  });
});

describe('readinessCardBody', () => {
  it('draws a skeleton while loading — never nothing', () => {
    expect(readinessCardBody('loading', 0)).toBe('skeleton');
  });

  it('draws the honest empty card when the load settled with no courses', () => {
    expect(readinessCardBody('empty', 0)).toBe('empty');
    expect(readinessCardBody('ready', 0)).toBe('empty');
  });

  it('draws rows when there are courses, and the failure line when it failed', () => {
    expect(readinessCardBody('ready', 2)).toBe('rows');
    expect(readinessCardBody('failed', 0)).toBe('failed');
  });

  it('gives up on the spinner in a few seconds, not never', () => {
    expect(READINESS_LOADING_TIMEOUT_MS).toBeGreaterThan(2000);
    expect(READINESS_LOADING_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });
});
