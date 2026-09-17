/**
 * The last eighteen discarded write errors (#108, tail batch 3).
 *
 * Twelve files, and the two the coordinator asked to read closely are the two
 * that are not plain best-effort.
 *
 * ## Referrals — which write prevents what
 *
 * A referral reward is paid by `awardWalletOnce(…, 'referral:referrer:<id>')`
 * and then STAMPED on the referral row. It is tempting to read that stamp as
 * the double-reward guard. It is not: the guard is the wallet's own
 * `wallet_award_once` KEY, which makes a second call for the same key a no-op.
 * Losing the stamp therefore costs the record, not the money — the referral
 * reads unrewarded and the reward branch re-runs on every later check, paying
 * nothing each time. Money has already moved when it runs, so it is
 * `reconcileLaterWrite`.
 *
 * The code mint is different and worse. `ensureCode` RETURNS the code to its
 * caller after stamping it on the profile, so a lost stamp hands the user a
 * link that resolves to nobody — and the next call mints a different code. That
 * one changes its answer: it reports, and returns null instead of a code the
 * profile does not carry.
 *
 * ## Communities — counter versus membership
 *
 * The lounge pointer and the orphan-group cleanup are re-derived or invisible,
 * so they warn. The creator's `community_members` row is neither: lose it and
 * the creator is not a member or an admin of the community they just made, and
 * it stops counting for the profile-visibility widening. Error, with a
 * fingerprint, and the community is kept — throwing would answer failure for a
 * community that exists and a retry would make a second one.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

jest.mock('./cache', () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deletePattern: jest.fn(async () => undefined),
    invalidateUserCache: jest.fn(async () => undefined),
  },
  CacheService: class {},
}));
jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));
jest.mock('../utils/sentry', () => ({
  captureException: jest.fn(),
  captureScopedException: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../utils/logger') as { logger: { error: jest.Mock; warn: jest.Mock } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { captureScopedException } = require('../utils/sentry') as {
  captureScopedException: jest.Mock;
};

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };
const MONEY_MOVED = 'Database write failed AFTER the money moved; needs reconciliation';
const BEST_EFFORT = 'Database write failed (best-effort)';

const isProfileUpdate = (call: Call) =>
  call.table === 'profiles' && Boolean(writePayload(call, 'update'));

beforeEach(() => jest.clearAllMocks());

describe('minting a referral code', () => {
  const ensureCode = async (stampFails: boolean) => {
    const { ReferralsService } = await import('./referrals');
    const { client } = scriptedDb((call) => {
      if (stampFails && isProfileUpdate(call)) return { data: null, error: WRITE_ERROR };
      if (call.table === 'rpc:generate_referral_code') return { data: 'LANTERN7', error: null };
      if (call.table === 'profiles') return { data: { referral_code: null }, error: null };
      return { data: null, error: null };
    });
    const service: any = Object.create(ReferralsService.prototype);
    Object.defineProperty(service, 'db', { get: () => client, configurable: true });
    return service.ensureCode('11111111-2222-3333-4444-555555555555');
  };

  it('returns the code it stamped, and says nothing', async () => {
    await expect(ensureCode(false)).resolves.toBe('LANTERN7');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('returns null rather than a code the profile does not carry', async () => {
    // Handing back a code that was never stamped gives the user a link that
    // resolves to nobody, and the next call mints a different one.
    await expect(ensureCode(true)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      BEST_EFFORT,
      expect.objectContaining({ table: 'profiles', reason: 'mint_referral_code' }),
    );
    expect(captureScopedException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ fingerprint: ['referral-code-write-failed'] }),
    );
  });
});

describe('the referral reward stamp', () => {
  const REFEREE = '22222222-3333-4444-5555-666666666666';

  const REFERRAL = {
    id: 'ref_1',
    referrer_id: 'user_1',
    referee_id: REFEREE,
    qualified_at: null,
    rewarded_at: null,
    created_at: new Date().toISOString(),
  };

  const checkActivation = async (stampFails: boolean) => {
    const { ReferralsService } = await import('./referrals');
    const awardWalletOnce = jest.fn(async () => ({ ok: true }));
    const { client, calls } = scriptedDb((call) => {
      if (stampFails && call.table === 'referrals' && writePayload(call, 'update')) {
        return { data: null, error: WRITE_ERROR };
      }
      if (call.table === 'rpc:referral_activation_check') return { data: true, error: null };
      if (call.table === 'referrals') return { data: REFERRAL, error: null };
      return { data: null, error: null };
    });
    const service: any = Object.create(ReferralsService.prototype);
    Object.defineProperty(service, 'db', { get: () => client, configurable: true });
    // `wallet` is a prototype getter, so a plain assignment would be ignored.
    Object.defineProperty(service, 'wallet', {
      get: () => ({ awardWalletOnce }),
      configurable: true,
    });
    service.grantReferralBonusUses = jest.fn(async () => undefined);
    const result = await service.checkActivation(REFEREE);
    return { result, calls, awardWalletOnce };
  };

  it('pays both sides through the keyed award and stamps the row', async () => {
    const { calls, awardWalletOnce } = await checkActivation(false);
    expect(awardWalletOnce).toHaveBeenCalledWith(
      'user_1',
      'referral:referrer:ref_1',
      expect.any(Number),
      expect.any(String),
    );
    expect(calls.some((call) => call.table === 'referrals' && writePayload(call, 'update'))).toBe(
      true,
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not un-pay the reward when the stamp fails — it reports it', async () => {
    // The award key, not this stamp, is what stops a second payment.
    const { awardWalletOnce } = await checkActivation(true);
    expect(awardWalletOnce).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      MONEY_MOVED,
      expect.objectContaining({ table: 'referrals', referralId: 'ref_1', reason: 'stamp_reward_paid' }),
    );
  });
});

describe('the creator’s community membership', () => {
  const createCommunity = async (membershipFails: boolean) => {
    const { CommunitiesService } = await import('./communities');
    const { client, calls } = scriptedDb((call) => {
      if (membershipFails && call.table === 'community_members') {
        return { data: null, error: WRITE_ERROR };
      }
      if (call.table === 'communities') return { data: { id: 'com_1', name: 'Chem' }, error: null };
      return { data: null, error: null };
    });
    const service: any = Object.create(CommunitiesService.prototype);
    Object.defineProperty(service, 'db', { get: () => client, configurable: true });
    // The entitlement gate reads a client this stand-in does not carry; it is
    // not what this test is about.
    service.assertCanAccessCommunities = jest.fn(async () => undefined);
    const community = await (service as any).createCommunity('user_1', {
      name: 'Chem',
      kind: 'interest',
      visibility: 'public',
    });
    return { community, calls };
  };

  it('makes the creator an admin member, and says nothing', async () => {
    const { community, calls } = await createCommunity(false);
    expect(community).toEqual(expect.objectContaining({ id: 'com_1' }));
    const membership = calls.find((call) => call.table === 'community_members');
    expect(writePayload(membership as Call, 'upsert')).toEqual(
      expect.objectContaining({ user_id: 'user_1', role: 'admin', source: 'joined' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps the community and reports the missing membership at ERROR level', async () => {
    const { community } = await createCommunity(true);
    expect(community).toEqual(expect.objectContaining({ id: 'com_1' }));
    expect(logger.error).toHaveBeenCalledWith(
      BEST_EFFORT,
      expect.objectContaining({
        table: 'community_members',
        communityId: 'com_1',
        reason: 'creator_admin_membership',
      }),
    );
    expect(captureScopedException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ fingerprint: ['community-membership-write-failed'] }),
    );
  });
});
