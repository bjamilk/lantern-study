/**
 * The summary endpoint is the one number every Shop badge reads. These pin
 * the status sets to the client's, the turn logic for offers, the per-pair
 * dedupe of inquiry threads, and the payout balance buckets.
 */
import { computeShopSummary } from './marketplaceSummary';

const ME = 'me';
const OTHER = 'other';

/** Chainable fake: resolves to canned rows / counts per table. */
function fakeDb(fixtures: Record<string, { rows?: any[]; count?: number }>) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const fx = fixtures[table] ?? {};
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve: (v: any) => void) =>
          resolve({ data: fx.rows ?? [], count: fx.count ?? 0, error: null }),
      };
      return chain;
    },
  };
}

describe('computeShopSummary', () => {
  it('counts orders by the same status sets the client badges on', async () => {
    const db = fakeDb({
      marketplace_orders: {
        rows: [
          { status: 'awaiting_payment', payment_id: 'ps_1' },   // buyer must pay / seller awaits buyer
          { status: 'pending_payment', payment_id: 'ps_2' },    // checkout session open: buyer pays, seller waits
          { status: 'pending_payment', payment_id: null },      // manual/offer-accept: SELLER confirms payment
          { status: 'ready_for_pickup', payment_id: 'ps_3' },   // buyer must confirm
          { status: 'paid', payment_id: 'ps_4' },               // seller must hand over
          { status: 'completed', payment_id: 'ps_5' },
          { status: 'cancelled', payment_id: null },
        ],
      },
    });
    const s = await computeShopSummary(db, ME, async () => ({}));
    // The same rows are returned for both roles by the fake; that is fine —
    // what is under test is which statuses each side counts.
    expect(s.buyerActionOrders).toBe(4);          // awaiting, pending x2, ready_for_pickup
    expect(s.sellerActionOrders).toBe(2);         // paid + pending with no session
    expect(s.sellerAwaitingBuyerPayment).toBe(2); // awaiting + pending with a session
  });

  it("counts an offer only when it is the user's turn and it has not expired", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const db = fakeDb({
      marketplace_offers: {
        rows: [
          // buyer proposed, I am the seller -> my turn
          { status: 'pending', proposed_by: 'buyer', buyer_id: OTHER, seller_id: ME, expires_at: future },
          // I (seller) countered -> buyer's turn, not mine
          { status: 'pending', proposed_by: 'seller', buyer_id: OTHER, seller_id: ME, expires_at: future },
          // my turn but expired
          { status: 'pending', proposed_by: 'buyer', buyer_id: OTHER, seller_id: ME, expires_at: past },
        ],
      },
    });
    const s = await computeShopSummary(db, ME, async () => ({}));
    expect(s.offersAwaitingMe).toBe(1);
  });

  it('dedupes inquiry threads per buyer–seller pair before summing unread', async () => {
    const db = fakeDb({
      marketplace_inquiries: {
        rows: [
          { status: 'open', dm_thread_id: 't1' },
          { status: 'negotiating', dm_thread_id: 't1' }, // same pair, same thread
          { status: 'open', dm_thread_id: 't2' },
          { status: 'closed', dm_thread_id: 't3' },      // not open
        ],
      },
    });
    const s = await computeShopSummary(db, ME, async () => ({ t1: 4, t2: 1, t3: 9 }));
    expect(s.sellerInquiryThreadIds).toEqual(['t1', 't2']);
    expect(s.unreadSellerInquiries).toBe(5);
    expect(s.openInquiries).toBe(3);
  });

  it('buckets payout balances by status and never counts refunds or failures', async () => {
    const db = fakeDb({
      marketplace_payments: {
        rows: [
          { status: 'paid', seller_payout_kobo: 100_000 },
          { status: 'payout_pending', seller_payout_kobo: 50_000 },
          { status: 'paid_out', seller_payout_kobo: 250_000 },
          { status: 'refunded', seller_payout_kobo: 80_000 }, // the query excludes these; belt and braces
        ],
      },
    });
    const s = await computeShopSummary(db, ME, async () => ({}));
    expect(s.payouts).toEqual({
      awaitingPayoutKobo: 150_000,
      paidOutKobo: 250_000,
      awaitingPayoutCount: 2,
      paidOutCount: 1,
    });
  });

  it('sums cart quantity, and head-counts listings and favourites', async () => {
    const db = fakeDb({
      marketplace_cart_items: { rows: [{ quantity: 2 }, { quantity: null }] },
      marketplace_listings: { count: 4 },
      marketplace_favorites: { count: 7 },
    });
    const s = await computeShopSummary(db, ME, async () => ({}));
    expect(s.cartCount).toBe(3);
    expect(s.activeListings).toBe(4);
    expect(s.savedCount).toBe(7);
  });

  it('survives a DM-unread failure with zero unread rather than failing the whole summary', async () => {
    const db = fakeDb({ marketplace_inquiries: { rows: [{ status: 'open', dm_thread_id: 't1' }] } });
    const s = await computeShopSummary(db, ME, async () => { throw new Error('rpc down'); });
    expect(s.unreadSellerInquiries).toBe(0);
    expect(s.sellerInquiryThreadIds).toEqual(['t1']);
  });
});
