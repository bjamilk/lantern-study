/**
 * The two helpers that make a discarded write error impossible to write by
 * accident (#108). The point of each test is the thing a call site relies on:
 * that `mustWrite` throws with the PostgREST code intact, that
 * `bestEffortWrite` never throws, and that neither of them logs a row payload.
 */
import { bestEffortWrite, mustWrite, WriteFailedError } from './writeResult';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

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

describe('neither helper can leak a row payload', () => {
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
});
