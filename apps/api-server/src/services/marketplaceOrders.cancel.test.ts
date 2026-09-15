/**
 * Hotfix H4b · 5: cancelling an order must claim the status BEFORE it spends
 * any money.
 *
 * The old order of operations refunded the buyer, voided escrow and relisted the
 * stock and only then wrote `status = 'cancelled'`. A failure on that last write
 * left an order that still read as live while its money had already gone back
 * and its units were back on sale — and a second cancel attempt refunded again.
 */

const mockRefundPaymentForOrder = jest.fn();
const mockPaystackEnabled = jest.fn(() => true);

jest.mock('./marketplacePayments', () => ({
  marketplacePaystackEnabled: () => mockPaystackEnabled(),
  getMarketplacePaymentsService: () => ({
    refundPaymentForOrder: (...args: unknown[]) => mockRefundPaymentForOrder(...args),
  }),
}));

import { MarketplaceOrdersService } from './marketplaceOrders';

type Row = Record<string, unknown>;
type Op = { fn: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

const BASE_ORDER: Row = {
  id: 'ord_1',
  buyer_id: 'buyer_1',
  seller_id: 'seller_1',
  listing_id: 'lst_1',
  status: 'paid',
  amount: 5000,
  quantity: 2,
  payment_id: 'pay_1',
  transaction_id: null,
  listing: { title: 'Anatomy flashcards' },
};

/**
 * Records every call in order (not just the payloads) so a test can assert that
 * the status claim happened BEFORE the refund, not merely that both happened.
 */
function scriptedDb(resolve: (call: Call) => { data: unknown; error?: unknown } | undefined) {
  const calls: Call[] = [];
  const timeline: string[] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ['select', 'eq', 'neq', 'in', 'is', 'not', 'update', 'insert', 'delete', 'order', 'limit']) {
        chain[fn] = (...args: unknown[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = () => {
        const call: Call = { table, ops };
        calls.push(call);
        if (ops.some((op) => op.fn === 'update')) timeline.push(`update:${table}`);
        return Promise.resolve(resolve(call) ?? { data: null, error: null });
      };
      chain.single = settle;
      chain.maybeSingle = settle;
      chain.then = (ok: any, err: any) => settle().then(ok, err);
      return chain;
    },
  };
  return { client, calls, timeline };
}

const payload = (call: Call) =>
  (call.ops.find((op) => op.fn === 'update')?.args[0] ?? {}) as Record<string, unknown>;
const has = (call: Call, fn: string, ...args: unknown[]) =>
  call.ops.some((op) => op.fn === fn && args.every((a, i) => op.args[i] === a));

function service(client: unknown, timeline: string[], order: Row = BASE_ORDER) {
  const svc = new MarketplaceOrdersService({ getClient: () => client } as any);
  (svc as any).getOrderById = jest.fn(async () => order);
  (svc as any).notifyOrderParty = jest.fn();
  (svc as any).refundEscrow = jest.fn(async () => {
    timeline.push('refundEscrow');
  });
  (svc as any).restoreListingAfterCancelledOrder = jest.fn(async () => {
    timeline.push('restoreListing');
  });
  return svc;
}

describe('cancel claims the status before it spends money (H4b · 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaystackEnabled.mockReturnValue(true);
    mockRefundPaymentForOrder.mockResolvedValue(undefined);
  });

  it('writes status=cancelled with a compare-and-set on the status it read, first', async () => {
    const { client, calls, timeline } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders') return { data: { ...BASE_ORDER, status: 'cancelled' }, error: null };
      return { data: null, error: null };
    });
    mockRefundPaymentForOrder.mockImplementation(async () => {
      timeline.push('refundPayment');
    });

    const svc = service(client, timeline);
    await svc.updateOrderStatus('ord_1', 'buyer_1', 'cancel');

    const claim = calls.find(
      (c) => c.table === 'marketplace_orders' && payload(c).status === 'cancelled',
    );
    expect(claim).toBeDefined();
    // The CAS: only an order still in the status we read may be cancelled.
    expect(has(claim!, 'eq', 'status', 'paid')).toBe(true);
    expect(has(claim!, 'eq', 'id', 'ord_1')).toBe(true);
    // ...and it lands before any of the side effects.
    expect(timeline.indexOf('update:marketplace_orders')).toBeLessThan(
      timeline.indexOf('refundPayment'),
    );
    expect(timeline.indexOf('refundPayment')).toBeLessThan(timeline.indexOf('refundEscrow'));
    expect(timeline.indexOf('refundEscrow')).toBeLessThan(timeline.indexOf('restoreListing'));
  });

  it('refunds nothing and relists nothing when another caller already moved the order', async () => {
    const { client, timeline } = scriptedDb((call) => {
      // The CAS finds no row: someone cancelled (or completed) it first.
      if (call.table === 'marketplace_orders' && call.ops.some((op) => op.fn === 'update')) {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const svc = service(client, timeline);
    await expect(svc.updateOrderStatus('ord_1', 'buyer_1', 'cancel')).rejects.toThrow(
      /changed while cancelling/i,
    );

    expect(mockRefundPaymentForOrder).not.toHaveBeenCalled();
    expect(timeline).not.toContain('refundEscrow');
    expect(timeline).not.toContain('restoreListing');
  });

  it('keeps the order cancelled and records a note when a side effect fails', async () => {
    const { client, calls, timeline } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders') return { data: { ...BASE_ORDER, status: 'cancelled' }, error: null };
      return { data: null, error: null };
    });
    mockRefundPaymentForOrder.mockRejectedValue(new Error('Paystack refund unavailable'));

    const svc = service(client, timeline);
    await expect(svc.updateOrderStatus('ord_1', 'buyer_1', 'cancel')).rejects.toThrow(
      /refund unavailable/i,
    );

    const note = calls.find((c) => typeof payload(c).cancellation_note === 'string');
    expect(note).toBeDefined();
    expect(String(payload(note!).cancellation_note)).toMatch(/refund unavailable/i);
    // The status is NOT rolled back: re-cancelling could refund a second time.
    expect(
      calls.some((c) => c.table === 'marketplace_orders' && payload(c).status === 'paid'),
    ).toBe(false);
    // The stock is not relisted for an order whose refund never happened.
    expect(timeline).not.toContain('restoreListing');
  });

  it('still cancels an unpaid order with no payment attached', async () => {
    const { client, timeline } = scriptedDb((call) => {
      if (call.table === 'marketplace_orders') return { data: { ...BASE_ORDER, status: 'cancelled' }, error: null };
      return { data: null, error: null };
    });

    const svc = service(client, timeline, { ...BASE_ORDER, status: 'pending_payment', payment_id: null });
    await svc.updateOrderStatus('ord_1', 'buyer_1', 'cancel');

    expect(mockRefundPaymentForOrder).not.toHaveBeenCalled();
    expect(timeline).toContain('refundEscrow');
    expect(timeline).toContain('restoreListing');
  });
});
