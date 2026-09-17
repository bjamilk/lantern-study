/**
 * The three writes that must be SEEN rather than must BLOCK (#108, Phase B).
 *
 * All three were on the "must-succeed stragglers" list, and reading them
 * changed the answer for all three. None of them may throw:
 *
 *  - `adminAudit.logAdminAction` — documented as swallowing its own error so an
 *    admin mutation is never blocked by its logging. That is correct, and the
 *    problem is the other half: a lost audit row is a compliance event and
 *    nothing said so.
 *  - `idempotency.markIdempotencyFailure` — runs in the `catch` of
 *    `withIdempotency`, immediately before the handler's own error is rethrown.
 *    Throwing here would REPLACE that error with this one, and the caller needs
 *    theirs.
 *  - `apiKey.touchLastUsed` — a debounced `last_used_at` stamp. It is not
 *    revocation, which is what the lane's first-pass guess assumed; it is
 *    cosmetic, and already marked `// non-fatal`.
 *
 * ## How long a wedged idempotency key blocks
 *
 * `markIdempotencyFailure` turns a `__processing__` claim into a `__failed__`
 * marker, and only a FAILED marker ages out (10 minutes). There is no
 * staleness handling for `__processing__` at all, so a claim left in that state
 * makes every retry on THAT key take the `wait` path — ~5 s — and answer 409,
 * forever. The user is not stuck: a new key works, and this route's fallback
 * key folds in the order's `updated_at`, so an ordinary retry usually derives
 * one. But that key is dead, which is why the failure is reported at error
 * level under a fingerprint rather than logged quietly.
 */
import { scriptedDb, writePayload } from '../testSupport/scriptedDb';

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

beforeEach(() => jest.clearAllMocks());

describe('an admin audit row that could not be written', () => {
  const logWith = async (fails: boolean) => {
    const { logAdminAction } = await import('./adminAudit');
    const { client, calls } = scriptedDb((call) =>
      fails && call.table === 'admin_audit_log' ? { data: null, error: WRITE_ERROR } : undefined,
    );
    await logAdminAction({ getClient: () => client } as never, {
      actorId: 'admin_1',
      action: 'user_ban',
      targetType: 'user',
      targetId: 'user_9',
      reason: 'spam',
    });
    return calls;
  };

  it('writes the row and says nothing when it succeeds', async () => {
    const calls = await logWith(false);
    const insert = calls.find((call) => call.table === 'admin_audit_log');
    expect(writePayload(insert as never, 'insert')).toEqual(
      expect.objectContaining({ actor_id: 'admin_1', action: 'user_ban', target_id: 'user_9' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(captureScopedException).not.toHaveBeenCalled();
  });

  it('does not block the admin mutation — it still returns', async () => {
    // The swallowing is deliberate and stays: an audit write is not a reason to
    // refuse a ban.
    await expect(logWith(true)).resolves.toBeDefined();
  });

  it('reports the lost row at ERROR level, as the compliance event it is', async () => {
    await logWith(true);
    expect(logger.error).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({
        table: 'admin_audit_log',
        actorId: 'admin_1',
        action: 'user_ban',
        targetId: 'user_9',
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports it to Sentry under a stable fingerprint', async () => {
    await logWith(true);
    expect(captureScopedException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ fingerprint: ['audit-log-write-failed'] }),
    );
  });
});

describe('an idempotency failure marker that could not be written', () => {
  const runWith = async (markerFails: boolean) => {
    const { withIdempotency } = await import('./idempotency');
    const { client, calls } = scriptedDb((call) => {
      const patch = writePayload(call, 'update');
      if (markerFails && patch && (patch.response as any)?._status === '__failed__') {
        return { data: null, error: WRITE_ERROR };
      }
      if (call.table === 'api_idempotency_keys' && call.ops.some((op) => op.fn === 'insert')) {
        return { data: { idempotency_key: 'key_1' }, error: null };
      }
      return { data: null, error: null };
    });
    const handlerError = new Error('the handler itself failed');
    const promise = withIdempotency(client as never, 'user_1', 'op', 'key_1', async () => {
      throw handlerError;
    });
    return { promise, calls, handlerError };
  };

  it('marks the attempt failed and rethrows the handler error', async () => {
    const { promise, calls, handlerError } = await runWith(false);
    await expect(promise).rejects.toBe(handlerError);
    const marker = calls.find((call) => {
      const patch = writePayload(call, 'update');
      return (patch?.response as any)?._status === '__failed__';
    });
    expect(marker).toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still rethrows the HANDLER’s error, not this one', async () => {
    // The whole reason this cannot throw: the caller needs the error that
    // actually failed their request.
    const { promise, handlerError } = await runWith(true);
    await expect(promise).rejects.toBe(handlerError);
  });

  it('reports the wedged key at ERROR level, under a stable fingerprint', async () => {
    const { promise } = await runWith(true);
    await promise.catch(() => undefined);
    expect(logger.error).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'api_idempotency_keys', userId: 'user_1', operation: 'op' }),
    );
    expect(captureScopedException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ fingerprint: ['idempotency-failure-marker-write-failed'] }),
    );
  });
});

describe('the api-key last-used stamp', () => {
  const touchWith = async (fails: boolean) => {
    // `apiKey` keeps a module-level debounce map, so each case needs a fresh
    // registry — which also means a fresh copy of the mocked logger. Reading it
    // back out here is what keeps the assertions pointed at the instance the
    // service actually used.
    jest.resetModules();
    const apiKeyModule = await import('./apiKey');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const freshLogger = (require('../utils/logger') as { logger: { warn: jest.Mock; error: jest.Mock } })
      .logger;
    const { client } = scriptedDb((call) =>
      fails && call.table === 'user_api_keys' ? { data: null, error: WRITE_ERROR } : undefined,
    );
    apiKeyModule.initializeApiKeyService({ getClient: () => client } as never);
    const service: any = new (apiKeyModule as any).ApiKeyService();
    await service.touchLastUsed('key_1', `debounce_${fails}_${Math.random()}`);
    return freshLogger;
  };

  it('does not throw when the stamp fails, and this is cosmetic, not revocation', async () => {
    await expect(touchWith(true)).resolves.toBeDefined();
  });

  it('warns, and only warns, when the stamp is lost', async () => {
    // Warn and not error: a lost timestamp on a debounced stamp is not
    // something anybody should be woken for.
    const freshLogger = await touchWith(true);
    expect(freshLogger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'user_api_keys', apiKeyId: 'key_1' }),
    );
    expect(freshLogger.error).not.toHaveBeenCalled();
  });

  it('says nothing at all when the stamp succeeds', async () => {
    const freshLogger = await touchWith(false);
    expect(freshLogger.warn).not.toHaveBeenCalled();
    expect(freshLogger.error).not.toHaveBeenCalled();
  });
});
