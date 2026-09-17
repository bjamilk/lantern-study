/**
 * The two helpers that make a discarded write error impossible to write by
 * accident (#108). The point of each test is the thing a call site relies on:
 * that `mustWrite` throws with the PostgREST code intact, that
 * `bestEffortWrite` never throws, and that neither of them logs a row payload.
 */
import { bestEffortWrite, mustWrite, reconcileLaterWrite, WriteFailedError } from './writeResult';
import { logger } from '../../utils/logger';
import { captureScopedException } from '../../utils/sentry';

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/sentry', () => ({ captureScopedException: jest.fn() }));

const mockCapture = captureScopedException as unknown as jest.Mock;

const mockLogger = logger as unknown as {
  error: jest.Mock;
  warn: jest.Mock;
};

const CTX = { table: 'marketplace_orders', op: 'update' as const, orderId: 'ord_1' };

beforeEach(() => jest.clearAllMocks());

describe('mustWrite', () => {
  it('returns the result untouched when the write succeeded', () => {
    const result = { data: { id: 'ord_1' }, error: null };
    expect(mustWrite(result, CTX)).toBe(result);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('tolerates a result that carries no error field at all', () => {
    expect(mustWrite({ data: 1 } as never, CTX)).toEqual({ data: 1 });
  });

  it('throws a typed error carrying the table, the op and the PostgREST code', () => {
    let thrown: unknown;
    try {
      mustWrite({ data: null, error: { message: 'column missing', code: '42703' } }, CTX);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WriteFailedError);
    const failure = thrown as WriteFailedError;
    expect(failure.name).toBe('WriteFailedError');
    expect(failure.table).toBe('marketplace_orders');
    expect(failure.op).toBe('update');
    expect(failure.code).toBe('42703');
    expect(failure.context).toEqual({ orderId: 'ord_1' });
    expect(failure.message).toContain('update on marketplace_orders');
    expect(failure.message).toContain('42703');
  });

  it('is NOT a PublicError, so it reaches the client as a 500 and not as the buyer’s fault', async () => {
    const { PublicError } = await import('../../utils/safeError');
    const failure = new WriteFailedError(CTX, { message: 'nope' });
    expect(failure).not.toBeInstanceOf(PublicError);
    expect(failure).toBeInstanceOf(Error);
  });

  it('logs the context and the message, and nothing else', () => {
    expect(() => mustWrite({ error: { message: 'boom', code: '23505' } }, CTX)).toThrow(
      WriteFailedError,
    );
    expect(mockLogger.error).toHaveBeenCalledWith('Database write failed', {
      table: 'marketplace_orders',
      op: 'update',
      orderId: 'ord_1',
      code: '23505',
      error: 'boom',
    });
  });

  it('truncates a long PostgREST message rather than carrying it whole', () => {
    const long = 'x'.repeat(5_000);
    try {
      mustWrite({ error: { message: long, details: long } }, CTX);
    } catch (err) {
      const failure = err as WriteFailedError;
      expect(failure.message.length).toBeLessThan(400);
      expect(String(failure.details).length).toBeLessThan(400);
      expect(failure.code).toBeNull();
    }
    expect.assertions(3);
  });
});

describe('bestEffortWrite', () => {
  it('returns true and logs nothing on success', () => {
    expect(bestEffortWrite({ data: [], error: null }, CTX)).toBe(true);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('returns false and warns on failure, without throwing', () => {
    expect(bestEffortWrite({ error: { message: 'boom', code: 'PGRST204' } }, CTX)).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith('Database write failed (best-effort)', {
      table: 'marketplace_orders',
      op: 'update',
      orderId: 'ord_1',
      code: 'PGRST204',
      error: 'boom',
    });
  });

  it('escalates to error level when asked, for a failure that wedges a row', () => {
    expect(bestEffortWrite({ error: { message: 'boom' } }, CTX, 'error')).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('treats a null or undefined result as success rather than crashing', () => {
    expect(bestEffortWrite(null, CTX)).toBe(true);
    expect(bestEffortWrite(undefined, CTX)).toBe(true);
  });
});

describe('reconcileLaterWrite', () => {
  // The money has already moved. Throwing would tell the user their refund
  // failed when Paystack has already paid it, and on a retried path could move
  // money twice; a warn would be too quiet for a row that disagrees with the
  // money. Founder decision, 2026-09-17.
  const MONEY = {
    table: 'marketplace_payments',
    op: 'update' as const,
    orderId: 'ord_1',
    paymentId: 'pay_1',
    amountKobo: 105_000,
  };

  it('returns true and reports nothing on success', () => {
    expect(reconcileLaterWrite({ error: null }, MONEY)).toBe(true);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('never throws, so the caller can still answer the user truthfully', () => {
    expect(() => reconcileLaterWrite({ error: { message: 'boom' } }, MONEY)).not.toThrow();
    expect(reconcileLaterWrite({ error: { message: 'boom' } }, MONEY)).toBe(false);
  });

  it('logs at error level, never warn', () => {
    reconcileLaterWrite({ error: { message: 'boom', code: '40001' } }, MONEY);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Database write failed AFTER the money moved; needs reconciliation',
      expect.objectContaining({ table: 'marketplace_payments', orderId: 'ord_1', code: '40001' }),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('reports with a STABLE fingerprint, so one class is one Sentry issue', () => {
    reconcileLaterWrite({ error: { message: 'a' } }, MONEY);
    reconcileLaterWrite({ error: { message: 'a totally different message' } }, MONEY);
    const [first, second] = mockCapture.mock.calls;
    expect(first[1].fingerprint).toEqual(['money-moved-write-failed:marketplace_payments:update']);
    expect(second[1].fingerprint).toEqual(first[1].fingerprint);
  });

  it('tags the ids a human needs to find the row, and nothing else', () => {
    reconcileLaterWrite({ error: { message: 'boom' } }, MONEY);
    expect(mockCapture.mock.calls[0][1].tags).toEqual({
      table: 'marketplace_payments',
      op: 'update',
      orderId: 'ord_1',
      paymentId: 'pay_1',
    });
    // Amounts are allowed, but they belong in extra: a tag is indexed, and an
    // amount is not something anyone searches by.
    expect(mockCapture.mock.calls[0][1].extra).toEqual(
      expect.objectContaining({ amountKobo: 105_000 }),
    );
  });

  it('omits a tag whose id is absent rather than sending "undefined"', () => {
    reconcileLaterWrite(
      { error: { message: 'boom' } },
      { table: 'marketplace_orders', op: 'update', orderId: 'ord_1' },
    );
    expect(mockCapture.mock.calls[0][1].tags).toEqual({
      table: 'marketplace_orders',
      op: 'update',
      orderId: 'ord_1',
      paymentId: undefined,
    });
  });

  it('carries the PostgREST code into the reported error message', () => {
    reconcileLaterWrite({ error: { message: 'boom', code: '42703' } }, MONEY);
    expect(String(mockCapture.mock.calls[0][0])).toContain('42703');
    expect(String(mockCapture.mock.calls[0][0])).toContain('update on marketplace_payments');
  });
});

describe('no helper can leak a row payload', () => {
  // The context type takes ids on purpose; this pins that the helpers log the
  // context they were given and never reach into the result for `data`.
  const secretish = {
    data: { email: 'buyer@example.com', access_token: 'sk_live_xyz' },
    error: { message: 'boom' },
  };

  it('mustWrite logs no field from data', () => {
    expect(() => mustWrite(secretish, CTX)).toThrow();
    const [, meta] = mockLogger.error.mock.calls[0];
    expect(JSON.stringify(meta)).not.toContain('buyer@example.com');
    expect(JSON.stringify(meta)).not.toContain('sk_live_xyz');
  });

  it('bestEffortWrite logs no field from data', () => {
    bestEffortWrite(secretish, CTX);
    const [, meta] = mockLogger.warn.mock.calls[0];
    expect(JSON.stringify(meta)).not.toContain('buyer@example.com');
    expect(JSON.stringify(meta)).not.toContain('sk_live_xyz');
  });

  it('reconcileLaterWrite neither logs nor REPORTS a field from data', () => {
    // This one also reaches Sentry, so the same rule has to hold twice.
    reconcileLaterWrite(secretish, CTX);
    const [, meta] = mockLogger.error.mock.calls[0];
    const [, scope] = mockCapture.mock.calls[0];
    for (const payload of [JSON.stringify(meta), JSON.stringify(scope)]) {
      expect(payload).not.toContain('buyer@example.com');
      expect(payload).not.toContain('sk_live_xyz');
    }
  });
});
