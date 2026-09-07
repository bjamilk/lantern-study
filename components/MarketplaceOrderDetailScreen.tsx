import React, { useCallback, useEffect, useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import {
  fetchMarketplaceOrder,
  fetchMarketplaceOrders,
  updateMarketplaceOrder,
  requestOrderPayment,
  addMarketplaceReview,
  submitOrderPaymentProof,
  uploadMarketplaceImage,
  verifyMarketplacePayment,
  resumeMarketplaceOrderCheckout,
} from '../services/supabase';
import { MarketplaceOrder } from '../types';
import { useAuthStore } from '../stores/authStore';
import Button from './ui/Button';
import OrderReceipt from './marketplace/OrderReceipt';
import OpenDisputeModal from './marketplace/OpenDisputeModal';
import { AppIcon } from './ui/AppIcon';

interface MarketplaceOrderDetailScreenProps {
  orderId: string;
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
  onOrderUpdated?: () => void;
}

const TIMELINE_STEPS = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'paid', label: 'Paid' },
  { key: 'ready_for_pickup', label: 'Ready for pickup' },
  { key: 'completed', label: 'Completed' },
] as const;

const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: 'Awaiting Paystack payment',
  pending_payment: 'Sale in progress — awaiting payment',
  paid: 'Sale in progress — arrange fulfillment',
  ready_for_pickup: 'Sale in progress — ready for pickup',
  buyer_confirmed: 'Sale in progress — buyer confirmed',
  completed: 'Completed — receipt available',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

function timelineIndexForStatus(status: string): number {
  if (status === 'cancelled' || status === 'disputed') return -1;
  if (status === 'pending_payment' || status === 'awaiting_payment') return 0;
  if (status === 'paid') return 1;
  if (status === 'ready_for_pickup' || status === 'buyer_confirmed') return 2;
  if (status === 'completed') return 3;
  return 0;
}

const MarketplaceOrderDetailScreen: React.FC<MarketplaceOrderDetailScreenProps> = ({
  orderId,
  onBack,
  onNavigate,
  onOrderUpdated,
}) => {
  const { currentUser } = useAuthStore();
  const [order, setOrder] = useState<MarketplaceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [proofUploading, setProofUploading] = useState(false);
  // Multi-item cart checkout opens one Paystack session per listing; after
  // paying one, surface the rest so the buyer can chain through them.
  const [otherUnpaidOrders, setOtherUnpaidOrders] = useState<MarketplaceOrder[]>([]);
  const [payingNextId, setPayingNextId] = useState<string | null>(null);

  const loadOtherUnpaidOrders = useCallback(async () => {
    try {
      const all = await fetchMarketplaceOrders('buyer');
      setOtherUnpaidOrders(
        (all || []).filter(
          (o: MarketplaceOrder) =>
            o.id !== orderId &&
            (o.status === 'awaiting_payment' ||
              (o.status === 'pending_payment' && o.payment_id))
        )
      );
    } catch {
      setOtherUnpaidOrders([]);
    }
  }, [orderId]);

  const handlePayNext = async (nextOrderId: string) => {
    setPayingNextId(nextOrderId);
    try {
      const session = await resumeMarketplaceOrderCheckout(nextOrderId);
      if (session?.authorizationUrl) {
        window.location.assign(session.authorizationUrl);
        return;
      }
      onNavigate('MarketplaceOrderDetail', { orderId: nextOrderId });
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not open checkout', 'error');
    } finally {
      setPayingNextId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMarketplaceOrder(orderId);
      setOrder(data);
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  // Paystack return URL: ?payment=return&reference=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') !== 'return') return;
    const reference = params.get('reference') || params.get('trxref');
    if (!reference) return;
    let cancelled = false;
    (async () => {
      try {
        await verifyMarketplacePayment(reference);
        if (!cancelled) {
          useToastStore.getState().showToast('Payment confirmed');
          await load();
          await loadOtherUnpaidOrders();
          onOrderUpdated?.();
        }
      } catch (err: any) {
        if (!cancelled) {
          useToastStore.getState().showToast(err?.message || 'Could not verify payment', 'error');
        }
      } finally {
        params.delete('payment');
        params.delete('reference');
        params.delete('trxref');
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
        window.history.replaceState({}, '', next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, loadOtherUnpaidOrders, onOrderUpdated]);

  const [disputeOpen, setDisputeOpen] = useState(false);
  const isSeller = currentUser?.id === order?.seller_id;
  const isBuyer = currentUser?.id === order?.buyer_id;

  const runAction = async (action: string, extra?: Record<string, string>) => {
    setActing(true);
    try {
      const updated = await updateMarketplaceOrder(orderId, { action, ...extra });
      setOrder(updated);
      if (['confirm_received', 'mark_ready', 'mark_paid', 'cancel'].includes(action)) {
        onOrderUpdated?.();
      }
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Action failed', 'error');
    } finally {
      setActing(false);
    }
  };

  const handleReview = async () => {
    if (!order?.listing_id) return;
    setActing(true);
    try {
      await addMarketplaceReview(order.listing_id, {
        rating: reviewRating,
        comment: reviewComment || undefined,
      });
      setReviewSubmitted(true);
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to submit review', 'error');
    } finally {
      setActing(false);
    }
  };

  const handlePaymentProof = async (file: File) => {
    if (!order) return;
    setProofUploading(true);
    try {
      const { url } = await uploadMarketplaceImage(file, order.listing_id);
      const updated = await submitOrderPaymentProof(orderId, url);
      setOrder(updated);
      onOrderUpdated?.();
    } catch (err: unknown) {
      useToastStore.getState().showToast(err instanceof Error ? err.message : 'Failed to upload payment proof', 'error');
    } finally {
      setProofUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-lantern-text-secondary">Loading order...</div>
    );
  }

  if (!order) {
    return (
      <div className="p-8 text-center">
        <p className="text-lantern-text-secondary mb-4">Order not found</p>
        <Button onClick={onBack}>Go back</Button>
      </div>
    );
  }

  const stepIndex = timelineIndexForStatus(order.status);

  return (
    <div className="flex flex-col h-full bg-lantern-background">
      <OpenDisputeModal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        listingTitle={(order as { listing?: { title?: string } }).listing?.title}
        viewerIsSeller={isSeller}
        onSubmit={async ({ disputeCategory, disputeReason }) => {
          const updated = await updateMarketplaceOrder(orderId, {
            action: 'open_dispute',
            disputeCategory,
            disputeReason,
          });
          setOrder(updated);
          onOrderUpdated?.();
        }}
      />
      <div className="flex items-center gap-3 p-4 border-b border-lantern-border bg-lantern-surface dark:bg-lantern-surface">
        <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary">
          <AppIcon name="arrow-back" size={20} />
        </button>
        <h1 className="text-lg font-semibold flex-1 truncate">{order.listing?.title || 'Order'}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="p-4 rounded-xl bg-lantern-surface dark:bg-lantern-surface border border-lantern-border">
          <p className="text-2xl font-bold text-lantern-primary">
            ₦{Number(order.amount).toLocaleString()}
          </p>
          {(order.quantity || 1) > 1 ? (
            <p className="text-sm text-lantern-text-secondary mt-1">
              Qty {order.quantity} · ₦
              {(Number(order.amount) / Math.max(1, Number(order.quantity) || 1)).toLocaleString()}{' '}
              each
            </p>
          ) : null}
          <p className="text-sm text-lantern-text-secondary mt-1">
            {STATUS_LABELS[order.status] || order.status.replace(/_/g, ' ')}
          </p>
          {order.source === 'offer_accept' ? (
            <p className="text-xs text-lantern-text-tertiary mt-1">Started from an accepted offer</p>
          ) : null}
          {order.status === 'completed' && order.completed_at && (
            <p className="text-xs text-lantern-text-tertiary mt-2">
              Completed {new Date(order.completed_at).toLocaleString()}
            </p>
          )}
        </div>

        <div className="p-4 rounded-xl bg-lantern-surface dark:bg-lantern-surface border border-lantern-border">
          <h2 className="text-sm font-semibold mb-3">Sale progress</h2>
          <div className="flex gap-2">
            {TIMELINE_STEPS.map((step, i) => (
              <div
                key={step.key}
                className={`flex-1 h-2 rounded-full ${
                  stepIndex >= i ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'
                }`}
              />
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">
            <li>Accepted {order.created_at ? '✓' : '—'}</li>
            <li>
              {/* Only evidence counts: a paid_at stamp or the order currently
                  in 'paid'. payment_id is NOT evidence — it is written when a
                  Paystack session is initialized, before any money moves, and
                  it survives abandonment and cancellation. Status ordering
                  alone is not evidence either: an order marked ready before
                  any payment used to show "Paid ✓" to both parties. */}
              {(() => {
                const paidEvidence =
                  Boolean((order as { paid_at?: string | null }).paid_at) || order.status === 'paid';
                if (!paidEvidence) return <>Paid —</>;
                return order.payment_id ? <>Paid via Paystack ✓</> : <>Payment confirmed by seller ✓</>;
              })()}
            </li>
            <li>Ready for pickup {order.seller_confirmed_at || order.status === 'ready_for_pickup' || order.status === 'completed' ? '✓' : '—'}</li>
            <li>Completed {order.completed_at ? '✓' : '—'}</li>
          </ul>
          {order.status !== 'completed' && order.status !== 'cancelled' ? (
            <p className="mt-3 text-xs text-lantern-text-tertiary">
              Receipt unlocks when both sides finish and the order is completed.
            </p>
          ) : null}
        </div>

        {/* Cart checkouts create one payment per listing — chain the rest here. */}
        {isBuyer && otherUnpaidOrders.length > 0 && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 space-y-3">
            <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              {otherUnpaidOrders.length === 1
                ? '1 more order is awaiting payment'
                : `${otherUnpaidOrders.length} more orders are awaiting payment`}
            </h2>
            <ul className="space-y-2">
              {otherUnpaidOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-emerald-900 dark:text-emerald-100 line-clamp-1">
                      {o.listing?.title || 'Listing'}
                    </p>
                    <p className="text-xs text-emerald-800 dark:text-emerald-300">
                      ₦{Number(o.amount).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={payingNextId !== null}
                    onClick={() => void handlePayNext(o.id)}
                  >
                    {payingNextId === o.id ? 'Opening…' : 'Pay now'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(order.status === 'awaiting_payment' || order.status === 'pending_payment') &&
          order.payment_id &&
          isBuyer && (
          <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/40 space-y-3">
            <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              Pay with Paystack
            </h2>
            <p className="text-sm text-indigo-800 dark:text-indigo-300">
              Complete checkout to pay the listed price — no extra charge. Funds are
              released to the seller after you confirm delivery.
            </p>
            <Button
              size="sm"
              disabled={acting}
              onClick={async () => {
                setActing(true);
                try {
                  const session = await resumeMarketplaceOrderCheckout(orderId);
                  if (session?.authorizationUrl) {
                    window.location.assign(session.authorizationUrl);
                    return;
                  }
                  useToastStore.getState().showToast('Checkout unavailable', 'error');
                } catch (err: any) {
                  useToastStore
                    .getState()
                    .showToast(err?.message || 'Could not start checkout', 'error');
                } finally {
                  setActing(false);
                }
              }}
            >
              Continue to Paystack
            </Button>
            <Button size="sm" variant="secondary" disabled={acting} onClick={() => runAction('cancel')}>
              Cancel order
            </Button>
          </div>
        )}

        {/* Seller controls for a buyer who started Paystack checkout then
            abandoned it: the order sits in pending_payment/awaiting_payment with
            a payment_id and the seller previously had no actions at all — not
            even cancel. mark_ready is offered only from pending_payment; the API
            rejects it from awaiting_payment. */}
        {(order.status === 'pending_payment' || order.status === 'awaiting_payment') &&
          order.payment_id &&
          isSeller && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 space-y-3">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Buyer hasn't completed payment
            </h2>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              The buyer opened Paystack checkout but hasn't paid yet. You can prepare the item and
              collect at handover, or cancel to release your stock. Cancelling voids the unpaid
              Paystack charge — no refund is issued.
            </p>
            {order.status === 'pending_payment' && (
              <Button size="sm" disabled={acting} onClick={() => runAction('mark_ready')}>
                Mark ready for pickup or delivery
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={acting} onClick={() => runAction('cancel')}>
              Cancel order
            </Button>
          </div>
        )}

        {order.status === 'pending_payment' && !order.payment_id && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 space-y-3">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Payment required</h2>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {isBuyer
                ? 'Pay the seller using the agreed method. For transfers, upload your receipt; for cash, pay at pickup and the seller confirms.'
                : 'Confirm below once you receive the payment — cash at pickup counts. Transfer receipts the buyer uploads appear here.'}
            </p>
            {order.payment_proof_url && (
              <div className="space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Proof submitted {order.payment_proof_submitted_at
                    ? new Date(order.payment_proof_submitted_at).toLocaleString()
                    : ''}
                </p>
                <a
                  href={order.payment_proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <img
                    src={order.payment_proof_url}
                    alt="Payment proof"
                    className="max-h-48 rounded-lg border border-amber-200 dark:border-amber-800"
                  />
                </a>
              </div>
            )}
            {isBuyer && !order.payment_proof_url && (
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-lantern-surface border border-amber-300 dark:border-amber-800 text-sm font-medium cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={proofUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handlePaymentProof(file);
                    e.target.value = '';
                  }}
                />
                {proofUploading ? 'Uploading…' : 'Upload payment proof'}
              </label>
            )}
            {isSeller && (
              /* No longer gated on an uploaded proof: cash at pickup has no
                 receipt, and every manual order now starts pending_payment —
                 proof-gating this button dead-ended the standard cash sale. */
              <Button size="sm" disabled={acting} onClick={() => runAction('mark_paid')}>
                Confirm payment received
              </Button>
            )}
            {isSeller && (
              /* The API has always allowed mark_ready from pending_payment
                 (prepare the item, collect cash at handover); the button was
                 just unreachable in this state. */
              <Button size="sm" variant="secondary" disabled={acting} onClick={() => runAction('mark_ready')}>
                Mark ready for pickup or delivery
              </Button>
            )}
            {(isBuyer || isSeller) && (
              <Button size="sm" variant="secondary" disabled={acting} onClick={() => runAction('cancel')}>
                Cancel order
              </Button>
            )}
          </div>
        )}

        {order.status !== 'completed' &&
          order.status !== 'cancelled' &&
          order.status !== 'pending_payment' &&
          order.status !== 'awaiting_payment' && (
          <div className="flex flex-wrap gap-2">
            {isSeller && ['paid', 'pending_payment'].includes(order.status) && (
              <>
                <Button
                  size="sm"
                  disabled={acting}
                  onClick={() => runAction('mark_ready')}
                >
                  Mark ready for pickup or delivery
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={acting}
                  onClick={async () => {
                    setActing(true);
                    try {
                      await requestOrderPayment(orderId);
                      useToastStore.getState().showToast('Payment request sent to buyer', 'success');
                    } catch (err: any) {
                      useToastStore.getState().showToast(err.message, 'info');
                    } finally {
                      setActing(false);
                    }
                  }}
                >
                  Request payment
                </Button>
              </>
            )}
            {isBuyer && ['paid', 'ready_for_pickup'].includes(order.status) && (
              <Button size="sm" disabled={acting} onClick={() => runAction('confirm_received')}>
                Confirm received
              </Button>
            )}
            {(isBuyer || isSeller) && (
              <Button size="sm" variant="secondary" disabled={acting} onClick={() => runAction('cancel')}>
                Cancel order
              </Button>
            )}
            {/*
              Phase 3 N: `open_dispute` has been supported server-side since
              Phase 1 with no client able to reach it. Offered only once money
              has moved — on an unpaid order the honest action is Cancel.
            */}
            {(isBuyer || isSeller) &&
              ['paid', 'ready_for_pickup', 'buyer_confirmed'].includes(order.status) && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={acting}
                  onClick={() => setDisputeOpen(true)}
                >
                  Report a problem
                </Button>
              )}
          </div>
        )}

        {order.status === 'completed' && (
          <div className="p-4 rounded-xl bg-lantern-surface dark:bg-lantern-surface border border-lantern-border space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <AppIcon name="checkmark-circle" size={20} className="text-green-500" />
              Transaction receipt
            </h2>
            <p className="text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary">
              Logged for your records — {isBuyer ? 'you paid' : 'the buyer paid'}{' '}
              ₦{Number(order.amount).toLocaleString()} for {order.listing?.title}.
              {!isBuyer && ' Your payout, less Lantern\u2019s fee, is itemised in your earnings.'}
            </p>
            <OrderReceipt order={order} />
          </div>
        )}

        {order.status === 'completed' && isBuyer && !reviewSubmitted && (
          <div className="p-4 rounded-xl bg-lantern-surface dark:bg-lantern-surface border border-lantern-border space-y-3">
            <h2 className="font-semibold">Leave a review</h2>
            <label className="text-sm font-medium">Rate this seller</label>
            <select
              className="mt-1 w-full rounded-lg border border-lantern-border bg-transparent p-2"
              value={reviewRating}
              onChange={(e) => setReviewRating(Number(e.target.value))}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{n} stars</option>
              ))}
            </select>
            <textarea
              className="mt-2 w-full rounded-lg border border-lantern-border bg-transparent p-2 text-sm"
              placeholder="Optional comment"
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={2}
            />
            <Button size="sm" className="mt-2" disabled={acting} onClick={handleReview}>
              Submit review
            </Button>
          </div>
        )}

        {order.listing_id && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigate('MarketplaceListingDetail', { listingId: order.listing_id })}
          >
            View listing
          </Button>
        )}
      </div>
    </div>
  );
};

export default MarketplaceOrderDetailScreen;
