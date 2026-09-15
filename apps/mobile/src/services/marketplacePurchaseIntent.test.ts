/**
 * Fix F3: an idempotency key belongs to the user's purchase INTENT, not to the
 * HTTP call.
 *
 * What used to happen: `endpoints.ts` defaulted `Idempotency-Key` to a fresh
 * `createIdempotencyKey(...)` per call, so the buyer whose Buy request aborted
 * at the 10s client timeout — with the order already created server-side — sent
 * a DIFFERENT key on the retry and bought the thing twice.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import {
  PURCHASE_INTENT_CONFLICT_RETRIES,
  purchaseIntentKey,
  resetPurchaseIntentsForTests,
  resolvePurchaseIntent,
  withPurchaseIntent,
} from './marketplacePurchaseIntent';

function httpError(status: number, message = 'nope'): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe('purchase intent idempotency keys', () => {
  beforeEach(() => {
    resetPurchaseIntentsForTests();
    jest.useFakeTimers({ doNotFake: ['nextTick'] } as any);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Advance the backoff timers while the retry loop awaits them. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    }
  }

  it('reuses one key across retries of the same intent', async () => {
    const seen: string[] = [];
    const run = jest.fn(async (key: string) => {
      seen.push(key);
      throw httpError(503, 'server blew up');
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('server blew up');
    }

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });

  it('keeps the key when the request times out with no status at all', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      throw new Error('Request timed out');
    };
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Request timed out');
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Request timed out');
    expect(seen[0]).toBe(seen[1]);
  });

  it('rotates the key once the purchase succeeds', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      return { ok: true };
    };
    await withPurchaseIntent('buy_now:l1:1:', run);
    await withPurchaseIntent('buy_now:l1:1:', run);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('rotates the key after a terminal 4xx the buyer has to fix', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      throw httpError(400, 'Coupon has expired');
    };
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Coupon has expired');
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Coupon has expired');
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('retries a 409 with the SAME key rather than minting a new one', async () => {
    const seen: string[] = [];
    let calls = 0;
    const run = async (key: string) => {
      seen.push(key);
      calls++;
      if (calls === 1) throw httpError(409, 'Concurrent idempotent request timed out');
      return { orderId: 'o1' };
    };

    const promise = withPurchaseIntent('buy_now:l1:1:', run);
    await flush();
    await expect(promise).resolves.toEqual({ orderId: 'o1' });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('gives up on a persistent 409 without ever changing the key', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      throw httpError(409, 'Concurrent idempotent request timed out');
    };

    const promise = withPurchaseIntent('buy_now:l1:1:', run);
    await flush();
    await expect(promise).rejects.toThrow('Concurrent idempotent request timed out');

    expect(seen).toHaveLength(PURCHASE_INTENT_CONFLICT_RETRIES + 1);
    expect(new Set(seen).size).toBe(1);
    // The intent is NOT resolved: the next attempt must still carry that key,
    // because the server may be finishing the first one.
    expect(await purchaseIntentKey('buy_now:l1:1:')).toBe(seen[0]);
  });

  it('gives different intents different keys', async () => {
    const one = await purchaseIntentKey('buy_now:l1:1:');
    const two = await purchaseIntentKey('buy_now:l1:2:');
    const three = await purchaseIntentKey('cart_checkout::s1:campus_meetup');
    expect(new Set([one, two, three]).size).toBe(3);
  });

  it('keeps every key inside the API 128-char header cap', async () => {
    const longScope = `cart_checkout:addr-${'x'.repeat(400)}`;
    expect((await purchaseIntentKey(longScope)).length).toBeLessThanOrEqual(128);
  });

  it('mints a fresh key after the intent is explicitly resolved', async () => {
    const first = await purchaseIntentKey('boost:l1:72');
    await resolvePurchaseIntent('boost:l1:72');
    expect(await purchaseIntentKey('boost:l1:72')).not.toBe(first);
  });
});
