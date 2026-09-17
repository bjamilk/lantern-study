/**
 * What a `transfer.failed` / `transfer.reversed` webhook does when its unwind
 * writes fail (#108, Phase B).
 *
 * Paystack has taken the money back, so both rows must stop reading as paid.
 * Each unwind is written twice: once WITH the `payout_attempt` bump, and — if
 * that fails, which on a database whose hand-applied migration is not in yet it
 * will, because the column is absent — again WITHOUT it. The first attempt's
 * error is already read and logged. The FALLBACK's is not, and that is the one
 * that matters: if it fails too, returned money keeps reading as `paid_out`,
 * the seller shows as paid for cash they no longer have, and the buyer's refund
 * is refused as "after seller payout".
 *
 * Both fallbacks are on the webhook path, so the answer is to fail the request
 * and let Paystack re-deliver. That is safe because each unwind is a CAS on the
 * statuses it is unwinding FROM (`paying` / `paid_out`), so once it has
 * succeeded a replay matches nothing — which also means the attempt counter
 * cannot be bumped twice.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

jest.mock('./paystack', () => ({
  createPaystackReference: (prefix = 'ls') => `${prefix}_test_ref`,
  createPaystackTransferRecipient: jest.fn(),
  getPaystackPublicKey: () => 'pk_test',
  initializePaystackTransaction: jest.fn(),
  initiatePaystackTransfer: jest.fn(),
  isPaystackConfigured: () => true,
  paystackMode: () => 'test',
  assertPaystackLiveKeyInProduction: () => {},
  refundPaystackTransaction: jest.fn(),
  resolvePaystackAccount: jest.fn(),
  verifyPaystackSignature: () => true,
  verifyPaystackTransaction: jest.fn(),
}));

jest.mock('./marketplaceOrders', () => {
  class MarketplaceOrdersService {
    getOrderById = jest.fn();
    getOrderByIdAdmin = jest.fn();
    releaseEscrow = jest.fn();
    notifyOrderParty = jest.fn();
    stampOrderPaidAt = jest.fn();
  }
  return {
    MarketplaceOrdersService,
    invalidateSellerAnalyticsCache: jest.fn(),
    resolveEffectivePrice: () => 1000,
  };
});

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));
jest.mock('../utils/sentry', () => ({
  captureException: jest.fn(),
  captureScopedException: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../utils/logger') as { logger: { error: jest.Mock; warn: jest.Mock } };

const MISSING_COLUMN = { message: 'column "payout_attempt" does not exist', code: '42703' };
const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

/** Which of the four unwind writes this call is. */
function which(call: Call): 'order_bump' | 'order_plain' | 'payment_bump' | 'payment_plain' | 'other' {
  const patch = writePayload(call, 'update');
  if (!patch) return 'other';
  if (call.table === 'marketplace_orders' && patch.payout_status === 'pending') {
    return 'payout_attempt' in patch ? 'order_bump' : 'order_plain';
  }
  if (call.table === 'marketplace_payments' && patch.status === 'paid') {
    return 'payout_attempt' in patch ? 'payment_bump' : 'payment_plain';
  }
  return 'other';
}

/**
 * `bumpFails` models the unmigrated database the fallback exists for;
 * `plainFails` is the fallback failing too, which is what this file is about.
 */
function buildService(options: { bumpFails: boolean; plainFails: boolean }) {
  const { client, calls } = scriptedDb((call) => {
    const kind = which(call);
    if (options.bumpFails && (kind === 'order_bump' || kind === 'payment_bump')) {
      return { data: null, error: MISSING_COLUMN };
    }
    if (options.plainFails && (kind === 'order_plain' || kind === 'payment_plain')) {
      return { data: null, error: WRITE_ERROR };
    }
    if (call.table === 'marketplace_orders' && !writePayload(call, 'update')) {
      return { data: { id: 'ord_1', checkout_id: 'chk_1', payment_id: 'pay_1' }, error: null };
    }
    if (call.table === 'marketplace_payments' && !writePayload(call, 'update')) {
      return { data: { id: 'pay_1', payout_attempt: 0 }, error: null };
    }
    return { data: null, error: null };
  });

  const host = { getClient: () => client, marketplace: {} } as never;
  return { host, calls };
}

async function serviceFor(options: { bumpFails: boolean; plainFails: boolean }) {
  const { MarketplacePaymentsService } = await import('./marketplacePayments');
  const { host, calls } = buildService(options);
  return { service: new MarketplacePaymentsService(host), calls };
}

const TRANSFER_REVERSED = JSON.stringify({
  event: 'transfer.reversed',
  data: { transfer_code: 'TRF_1', reference: 'ls_po_ref' },
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
});

describe('a reversal, with every write succeeding', () => {
  it('unwinds both rows with the attempt bump and answers ok', async () => {
    const { service, calls } = await serviceFor({ bumpFails: false, plainFails: false });
    await expect(service.handleWebhook(TRANSFER_REVERSED, 'sig')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(calls.some((call) => which(call) === 'order_bump')).toBe(true);
    expect(calls.some((call) => which(call) === 'payment_bump')).toBe(true);
    // No fallback needed, so none ran.
    expect(calls.some((call) => which(call) === 'order_plain')).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('unwinds only from the states it is unwinding FROM, which is what makes a replay a no-op', async () => {
    const { service, calls } = await serviceFor({ bumpFails: false, plainFails: false });
    await service.handleWebhook(TRANSFER_REVERSED, 'sig');
    const orderUnwind = calls.find((call) => which(call) === 'order_bump');
    expect(orderUnwind?.ops).toContainEqual({ fn: 'in', args: ['payout_status', ['paying', 'paid_out']] });
    const paymentUnwind = calls.find((call) => which(call) === 'payment_bump');
    expect(paymentUnwind?.ops).toContainEqual({
      fn: 'in',
      args: ['status', ['payout_pending', 'paid_out']],
    });
  });
});

describe('a reversal on a database without the payout_attempt column', () => {
  it('falls back to the plain unwind and still answers ok', async () => {
    const { service, calls } = await serviceFor({ bumpFails: true, plainFails: false });
    await expect(service.handleWebhook(TRANSFER_REVERSED, 'sig')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(calls.some((call) => which(call) === 'order_plain')).toBe(true);
    expect(calls.some((call) => which(call) === 'payment_plain')).toBe(true);
    // The first attempt's failure is already reported today.
    expect(logger.error).toHaveBeenCalledWith(
      'Payout unwind with attempt bump failed; retrying without it',
      expect.objectContaining({ orderId: 'ord_1' }),
    );
  });
});

describe('the fallback unwind failing too', () => {
  it('REJECTS so Paystack re-delivers the reversal', async () => {
    // Nothing was unwound: the order and the payment both still read
    // `paid_out` for money Paystack has taken back. Answering ok would mean the
    // event never comes again and the seller reads as paid for cash they no
    // longer have.
    const { service } = await serviceFor({ bumpFails: true, plainFails: true });
    await expect(service.handleWebhook(TRANSFER_REVERSED, 'sig')).rejects.toThrow(
      /marketplace_orders/,
    );
  });

  it('does not stamp the event processed, so the retry actually re-processes', async () => {
    const { service, calls } = await serviceFor({ bumpFails: true, plainFails: true });
    await service.handleWebhook(TRANSFER_REVERSED, 'sig').catch(() => undefined);
    const stamped = calls.some(
      (call) => call.table === 'paystack_webhook_events' && writePayload(call, 'update'),
    );
    expect(stamped).toBe(false);
  });

  it('names the order, the event and which attempt this was', async () => {
    const { WriteFailedError } = await import('./data/writeResult');
    const { service } = await serviceFor({ bumpFails: true, plainFails: true });
    const error = await service.handleWebhook(TRANSFER_REVERSED, 'sig').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WriteFailedError);
    expect((error as InstanceType<typeof WriteFailedError>).context).toEqual(
      expect.objectContaining({
        orderId: 'ord_1',
        eventType: 'transfer.reversed',
        reason: 'unwind_without_attempt_bump',
      }),
    );
  });

  it('still reports the FIRST attempt before failing on the fallback', async () => {
    // The two are different failures and both are worth reading: the first
    // usually means the migration is not applied, the second that the database
    // refused the write outright.
    const { service } = await serviceFor({ bumpFails: true, plainFails: true });
    await service.handleWebhook(TRANSFER_REVERSED, 'sig').catch(() => undefined);
    expect(logger.error).toHaveBeenCalledWith(
      'Payout unwind with attempt bump failed; retrying without it',
      expect.objectContaining({ orderId: 'ord_1' }),
    );
  });
});
