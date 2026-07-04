import React, { useCallback, useEffect, useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import {
  fetchMarketplaceOrder,
  updateMarketplaceOrder,
  requestOrderPayment,
  addMarketplaceReview,
  submitOrderPaymentProof,
  uploadMarketplaceImage,
} from '../services/supabase';
import { MarketplaceOrder } from '../types';
import { useAuthStore } from '../stores/authStore';
import { ArrowLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import Button from './ui/Button';
import OrderReceipt from './marketplace/OrderReceipt';

interface MarketplaceOrderDetailScreenProps {
  orderId: string;
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
  onOrderUpdated?: () => void;
}

const STEPS = ['paid', 'ready_for_pickup', 'completed'];

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
      <div className="p-8 text-center text-gray-500">Loading order...</div>
    );
  }

  if (!order) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 mb-4">Order not found</p>
        <Button onClick={onBack}>Go back</Button>
      </div>
    );
  }

  const stepIndex = order.status === 'completed' ? 3 : STEPS.indexOf(order.status);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1 truncate">{order.listing?.title || 'Order'}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            ₦{Number(order.amount).toLocaleString()}
          </p>
          <p className="text-sm text-gray-500 mt-1 capitalize">{order.status.replace(/_/g, ' ')}</p>
          {order.status === 'completed' && order.completed_at && (
            <p className="text-xs text-gray-400 mt-2">
              Completed {new Date(order.completed_at).toLocaleString()}
            </p>
          )}
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold mb-3">Progress</h2>
          <div className="flex gap-2">
            {STEPS.map((step, i) => (
              <div
                key={step}
                className={`flex-1 h-2 rounded-full ${
                  stepIndex > i ? 'bg-purple-500' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
            <li>Paid {order.created_at ? '✓' : ''}</li>
            <li>Ready for pickup {order.seller_confirmed_at ? '✓' : '—'}</li>
            <li>Completed {order.completed_at ? '✓' : '—'}</li>
          </ul>
        </div>

        {order.status === 'pending_payment' && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 space-y-3">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Payment required</h2>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Pay the seller via bank transfer or campus payment app, then upload your receipt screenshot.
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
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-800 text-sm font-medium cursor-pointer">
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
            {isSeller && order.payment_proof_url && (
              <Button size="sm" disabled={acting} onClick={() => runAction('mark_paid')}>
                Confirm payment received
              </Button>
            )}
            {(isBuyer || isSeller) && (
              <Button size="sm" variant="secondary" disabled={acting} onClick={() => runAction('cancel')}>
                Cancel order
              </Button>
            )}
          </div>
        )}

        {order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'pending_payment' && (
          <div className="flex flex-wrap gap-2">
            {isSeller && ['paid', 'pending_payment'].includes(order.status) && (
              <>
                <Button
                  size="sm"
                  disabled={acting}
                  onClick={() => runAction('mark_ready')}
                >
                  Mark ready for pickup
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
          </div>
        )}

        {order.status === 'completed' && (
          <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <CheckCircleIcon className="w-5 h-5 text-green-500" />
              Receipt
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              You paid ₦{Number(order.amount).toLocaleString()} for {order.listing?.title}.
            </p>
            <OrderReceipt order={order} />
          </div>
        )}

        {order.status === 'completed' && isBuyer && !reviewSubmitted && (
          <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-3">
            <h2 className="font-semibold">Leave a review</h2>
            <label className="text-sm font-medium">Rate this seller</label>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent p-2"
              value={reviewRating}
              onChange={(e) => setReviewRating(Number(e.target.value))}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{n} stars</option>
              ))}
            </select>
            <textarea
              className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent p-2 text-sm"
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
