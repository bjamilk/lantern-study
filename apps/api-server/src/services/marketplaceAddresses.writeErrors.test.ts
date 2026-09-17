/**
 * The default-address flip, and what a half-done one leaves behind (#108).
 *
 * "Make this my default" is TWO writes: clear the flag on every other address,
 * then set it on this one. The first is a bare await, so today a failure
 * between them is invisible and the user ends up with **two defaults**.
 *
 * Nothing in the API resolves "the default" server-side — `getOwned` takes the
 * id the client sends — so the damage is at the client, which prefills
 * checkout with `rows.find((row) => row.is_default)`
 * (`apps/mobile/src/screens/marketplace/CheckoutScreen.tsx`). With two
 * defaults that is whichever row the list happens to return first, so a buyer
 * can be shipped to an address they did not choose.
 *
 * Deleting a default is the mirror image and the opposite class: the promotion
 * of the next address runs AFTER the delete, so a failure leaves **zero
 * defaults**. That is a safe state — the client falls back to `rows[0]`, and
 * the user can set one again — and the delete cannot be undone, so throwing
 * would report failure for a removal that happened.
 *
 * Both failure points are driven below.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));
jest.mock('../utils/sentry', () => ({
  captureException: jest.fn(),
  captureScopedException: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../utils/logger') as { logger: { error: jest.Mock; warn: jest.Mock } };

const EXISTING = {
  id: 'addr_old',
  user_id: 'user_1',
  recipient_name: 'Ada',
  phone: '08000000000',
  city: 'Ibadan',
  line1: '1 Road',
  is_default: true,
};

const DRAFT = {
  recipient_name: 'Ada Lovelace',
  phone: '08011111111',
  city: 'Ibadan',
  line1: '2 Road',
  is_default: true,
};

type FailingWrite = 'none' | 'clear_defaults' | 'promote_next';

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

/** The clear-every-other-default write: `is_default: false`, scoped by user. */
function isClearDefaults(call: Call): boolean {
  const patch = writePayload(call, 'update');
  return Boolean(patch && patch.is_default === false);
}

/** The promote-the-next-one write after a default was deleted. */
function isPromote(call: Call): boolean {
  const patch = writePayload(call, 'update');
  return Boolean(patch && patch.is_default === true);
}

function serviceFor(failOn: FailingWrite, rows: Array<Record<string, unknown>> = [EXISTING]) {
  const { client, calls } = scriptedDb((call) => {
    if (failOn === 'clear_defaults' && isClearDefaults(call)) {
      return { data: null, error: WRITE_ERROR };
    }
    if (failOn === 'promote_next' && isPromote(call)) return { data: null, error: WRITE_ERROR };
    if (call.table !== 'marketplace_addresses') return { data: null, error: null };
    if (call.ops.some((op) => op.fn === 'insert')) {
      return { data: { id: 'addr_new', ...DRAFT }, error: null };
    }
    if (call.terminal === 'then') return { data: rows, error: null };
    if (writePayload(call, 'update')) return { data: { id: 'addr_old', ...DRAFT }, error: null };
    return { data: EXISTING, error: null };
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MarketplaceAddressesService } = require('./marketplaceAddresses');
  const service: any = new MarketplaceAddressesService({ getClient: () => client } as never);
  return { service, calls };
}

beforeEach(() => jest.clearAllMocks());

describe('setting a default, with every write succeeding', () => {
  it('clears the old default BEFORE the new address exists', async () => {
    const { service, calls } = serviceFor('none');
    await service.create('user_1', DRAFT);
    const clearIndex = calls.findIndex(isClearDefaults);
    const insertIndex = calls.findIndex((call) => call.ops.some((op) => op.fn === 'insert'));
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeLessThan(insertIndex);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('clears the old default before promoting an existing address', async () => {
    const { service, calls } = serviceFor('none');
    await service.update('user_1', 'addr_old', DRAFT);
    expect(calls.some(isClearDefaults)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('promotes the next address when the default is removed', async () => {
    const { service, calls } = serviceFor('none', [{ id: 'addr_other', is_default: false }]);
    await service.remove('user_1', 'addr_old');
    expect(calls.some(isPromote)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('TODAY: the default flip half-done', () => {
  it('creates a SECOND default when clearing the old one fails', async () => {
    const { service, calls } = serviceFor('clear_defaults');
    const created = await service.create('user_1', DRAFT);
    expect(created).toEqual(expect.objectContaining({ id: 'addr_new' }));
    // The insert went ahead with is_default true while the old row still has it.
    const inserted = calls.find((call) => call.ops.some((op) => op.fn === 'insert'));
    expect(writePayload(inserted as Call, 'insert')).toEqual(
      expect.objectContaining({ is_default: true }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('creates a SECOND default when clearing fails on update', async () => {
    const { service } = serviceFor('clear_defaults');
    await expect(service.update('user_1', 'addr_old', DRAFT)).resolves.toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('leaves ZERO defaults when the promotion after a delete fails', async () => {
    const { service } = serviceFor('promote_next', [{ id: 'addr_other', is_default: false }]);
    await expect(service.remove('user_1', 'addr_old')).resolves.toEqual({ removed: true });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
