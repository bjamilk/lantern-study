/**
 * One round-trip for every Shop badge and the seller's payout balances.
 *
 * The mobile client used to make eight requests (cart, orders x2, offers x2,
 * inquiries x2, stats) and count them itself; that was fine for a founder-only
 * pilot and had to go before the marketplace opened to everyone. This
 * service does the same counting on the server with head-counts where a count
 * is all that is needed, and rows only where a predicate needs fields.
 *
 * The status sets below are the CLIENT's (apps/mobile/src/stores/
 * marketplaceStore.ts: BUYER_ACTION_ORDER_STATUSES, orderNeedsSeller,
 * orderAwaitsBuyerPayment). A badge here and a pill there must agree, so a
 * change to one must change the other — marketplaceSummary.test.ts pins them.
 */
import { canRespondToOffer } from '@lantern/shared/utils/marketplaceOfferTurn';

/** Orders where the BUYER must act: pay, or confirm pickup. */
export const BUYER_ACTION_ORDER_STATUSES = new Set(['awaiting_payment', 'pending_payment', 'ready_for_pickup']);
type OrderRow = { status: string; payment_id?: string | null };
/**
 * Orders where the SELLER must act: paid and waiting to be handed over, or a
 * manual / offer-accept order (pending_payment with no payment session) whose
 * payment the seller has to confirm by hand.
 */
export const orderNeedsSeller = (o: OrderRow): boolean =>
  o.status === 'paid' || (o.status === 'pending_payment' && !o.payment_id);
/**
 * Seller orders the buyer still has to pay online — a checkout session exists
 * and the money has not moved. Not the seller's to act on, so never a badge.
 */
export const orderAwaitsBuyerPayment = (o: OrderRow): boolean =>
  o.status === 'awaiting_payment' || (o.status === 'pending_payment' && !!o.payment_id);
/** Payments whose seller share has not reached the bank yet. */
export const AWAITING_PAYOUT_STATUSES = new Set(['paid', 'payout_pending']);

/** A null section failed to load; the client keeps the value it had. */
export interface ShopSummaryPayload {
  cartCount: number | null;
  buyerActionOrders: number | null;
  sellerActionOrders: number | null;
  sellerAwaitingBuyerPayment: number | null;
  offersAwaitingMe: number | null;
  offersAwaitingYou: number | null;
  openInquiries: number | null;
  unreadSellerInquiries: number | null;
  unreadBuyerInquiries: number | null;
  /** Kept for clients that join unread themselves; the counts above are the truth. */
  sellerInquiryThreadIds: string[] | null;
  buyerInquiryThreadIds: string[] | null;
  activeListings: number | null;
  savedCount: number | null;
  payouts: null | {
    /** Seller share of payments that are paid or payout-pending, in kobo. */
    awaitingPayoutKobo: number;
    /** Seller share already transferred, all time, in kobo. */
    paidOutKobo: number;
    awaitingPayoutCount: number;
    paidOutCount: number;
  };
}

type OfferRow = {
  status: string;
  proposed_by?: string | null;
  parent_offer_id?: string | null;
  buyer_id: string;
  seller_id: string;
  expires_at?: string | null;
};

/** The slice of a Supabase client this service touches, so tests can fake it. */
export interface SummaryDb {
  from(table: string): any;
}

function offerAwaits(offer: OfferRow, userId: string, now: number): boolean {
  if (offer.status !== 'pending') return false;
  if (offer.expires_at) {
    const t = Date.parse(offer.expires_at);
    if (!Number.isNaN(t) && t <= now) return false;
  }
  return canRespondToOffer(offer as Parameters<typeof canRespondToOffer>[0], userId);
}

const inquiryIsOpen = (i: { status: string }) => i.status === 'open' || i.status === 'negotiating';

async function headCount(q: any): Promise<number> {
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function rows<T>(q: any): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function computeShopSummary(
  db: SummaryDb,
  userId: string,
  getDmUnread: (userId: string) => Promise<Record<string, number>>,
  now: number = Date.now(),
): Promise<ShopSummaryPayload> {
  // Every read is independent, and one failing table must not take the other
  // badges down with it: a section that fails comes back null and the client
  // keeps the number it already had — the same contract as /dashboard/summary.
  const settled = await Promise.allSettled([
      rows<{ quantity: number | null }>(db.from('marketplace_cart_items').select('quantity').eq('buyer_id', userId)),
      rows<OrderRow>(db.from('marketplace_orders').select('status, payment_id').eq('buyer_id', userId)),
      rows<OrderRow>(db.from('marketplace_orders').select('status, payment_id').eq('seller_id', userId)),
      rows<OfferRow>(
        db.from('marketplace_offers').select('status, proposed_by, parent_offer_id, buyer_id, seller_id, expires_at').eq('seller_id', userId).eq('status', 'pending'),
      ),
      rows<OfferRow>(
        db.from('marketplace_offers').select('status, proposed_by, parent_offer_id, buyer_id, seller_id, expires_at').eq('buyer_id', userId).eq('status', 'pending'),
      ),
      rows<{ status: string; dm_thread_id: string | null }>(
        db.from('marketplace_inquiries').select('status, dm_thread_id').eq('seller_id', userId).in('status', ['open', 'negotiating']),
      ),
      rows<{ status: string; dm_thread_id: string | null }>(
        db.from('marketplace_inquiries').select('status, dm_thread_id').eq('buyer_id', userId).in('status', ['open', 'negotiating']),
      ),
      headCount(db.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active')),
      headCount(db.from('marketplace_favorites').select('id', { count: 'exact', head: true }).eq('user_id', userId)),
      rows<{ status: string; seller_payout_kobo: number | null }>(
        db.from('marketplace_payments').select('status, seller_payout_kobo').eq('seller_id', userId).in('status', ['paid', 'payout_pending', 'paid_out']),
      ),
      getDmUnread(userId).catch(() => ({} as Record<string, number>)),
    ]);
  const pick = <T,>(i: number): T | null => {
    const r = settled[i];
    return r.status === 'fulfilled' ? (r.value as T) : null;
  };
  const cart = pick<Array<{ quantity: number | null }>>(0);
  const buyerOrders = pick<OrderRow[]>(1);
  const sellerOrders = pick<OrderRow[]>(2);
  const sellerOffers = pick<OfferRow[]>(3);
  const buyerOffers = pick<OfferRow[]>(4);
  const sellerInq = pick<Array<{ status: string; dm_thread_id: string | null }>>(5);
  const buyerInq = pick<Array<{ status: string; dm_thread_id: string | null }>>(6);
  const active = pick<number>(7);
  const saved = pick<number>(8);
  const payments = pick<Array<{ status: string; seller_payout_kobo: number | null }>>(9);
  const dmUnread = pick<Record<string, number>>(10) ?? {};

  // A DM thread is per buyer–seller PAIR, so two inquiries on one seller's
  // listings share a thread; dedupe before summing or it double-counts.
  const threadIds = (list: Array<{ dm_thread_id: string | null }>) =>
    Array.from(new Set(list.map((i) => i.dm_thread_id).filter((id): id is string => !!id)));
  const sellerThreads = sellerInq ? threadIds(sellerInq.filter(inquiryIsOpen)) : null;
  const buyerThreads = buyerInq ? threadIds(buyerInq.filter(inquiryIsOpen)) : null;
  const sumUnread = (ids: string[] | null) =>
    ids ? ids.reduce((n, id) => n + (dmUnread[id] ?? 0), 0) : null;
  const countIf = <T,>(list: T[] | null, keep: (row: T) => boolean) =>
    list ? list.filter(keep).length : null;

  const awaiting = payments ? payments.filter((p) => AWAITING_PAYOUT_STATUSES.has(p.status)) : null;
  const paidOut = payments ? payments.filter((p) => p.status === 'paid_out') : null;
  const kobo = (list: Array<{ seller_payout_kobo: number | null }> | null) =>
    list ? list.reduce((n, p) => n + Math.max(0, Number(p.seller_payout_kobo) || 0), 0) : null;

  return {
    cartCount: cart ? cart.reduce((n, c) => n + Math.max(1, Number(c.quantity) || 1), 0) : null,
    buyerActionOrders: countIf(buyerOrders, (o) => BUYER_ACTION_ORDER_STATUSES.has(o.status)),
    sellerActionOrders: countIf(sellerOrders, orderNeedsSeller),
    sellerAwaitingBuyerPayment: countIf(sellerOrders, orderAwaitsBuyerPayment),
    offersAwaitingMe: countIf(sellerOffers, (o) => offerAwaits(o, userId, now)),
    offersAwaitingYou: countIf(buyerOffers, (o) => offerAwaits(o, userId, now)),
    openInquiries: countIf(sellerInq, inquiryIsOpen),
    unreadSellerInquiries: sumUnread(sellerThreads),
    unreadBuyerInquiries: sumUnread(buyerThreads),
    sellerInquiryThreadIds: sellerThreads,
    buyerInquiryThreadIds: buyerThreads,
    activeListings: active,
    savedCount: saved,
    payouts: payments
      ? {
          awaitingPayoutKobo: kobo(awaiting) ?? 0,
          paidOutKobo: kobo(paidOut) ?? 0,
          awaitingPayoutCount: awaiting?.length ?? 0,
          paidOutCount: paidOut?.length ?? 0,
        }
      : null,
  };
}
