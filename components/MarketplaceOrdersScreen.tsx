import React, { useEffect, useState } from 'react';
import { fetchMarketplaceOrders } from '../services/supabase';
import { MarketplaceOrder } from '../types';
import { ArrowLeftIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import Button from './ui/Button';
import { useToastStore } from '../stores/toastStore';

interface MarketplaceOrdersScreenProps {
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid — arrange fulfillment',
  ready_for_pickup: 'Ready for pickup or delivery',
  buyer_confirmed: 'Buyer confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

const MarketplaceOrdersScreen: React.FC<MarketplaceOrdersScreenProps> = ({ onBack, onNavigate }) => {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const showToast = useToastStore((s) => s.showToast);

  const handleBuyAgain = (order: MarketplaceOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    const listing = order.listing;
    if (!listing?.id && !order.listing_id) {
      showToast('Listing is no longer available.', 'error');
      return;
    }
    const listingId = listing?.id || order.listing_id;
    const status = listing?.status;
    const stock = listing?.quantity;
    if (status && status !== 'active') {
      showToast('This listing is sold out or unavailable.', 'error');
      return;
    }
    if (stock != null && stock <= 0) {
      showToast('This listing is sold out.', 'error');
      return;
    }
    const lastQty = Math.max(1, Number(order.quantity) || 1);
    const prefQty =
      stock == null ? 1 : Math.min(lastQty, Math.max(1, Number(stock)));
    onNavigate('MarketplaceListingDetail', { listingId, quantity: prefQty });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchMarketplaceOrders(role);
        if (!cancelled) setOrders(data);
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [role]);

  return (
    <div className="flex flex-col h-full bg-lantern-background">
      <div className="flex items-center gap-3 p-4 border-b border-lantern-border bg-lantern-surface dark:bg-lantern-surface">
        <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary">
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1">
          {role === 'buyer' ? 'Purchase history' : 'My orders'}
        </h1>
      </div>

      <div className="flex gap-2 p-4">
        <Button size="sm" variant={role === 'buyer' ? 'primary' : 'secondary'} onClick={() => setRole('buyer')}>
          Purchase history
        </Button>
        <Button size="sm" variant={role === 'seller' ? 'primary' : 'secondary'} onClick={() => setRole('seller')}>
          Selling
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-sm text-lantern-text-secondary">Loading orders...</p>}
        {!loading && orders.length === 0 && (
          <div className="text-center py-12 text-lantern-text-secondary">
            <ShoppingBagIcon className="w-12 h-12 mx-auto mb-2 opacity-40" />
            <p>{role === 'buyer' ? 'No purchases yet' : 'No orders yet'}</p>
          </div>
        )}
        {orders.map((order) => (
          <div
            key={order.id}
            className="w-full text-left p-4 rounded-xl bg-lantern-surface dark:bg-lantern-surface border border-lantern-border hover:border-lantern-primary/40 transition-colors"
          >
            <button
              type="button"
              onClick={() => onNavigate('MarketplaceOrderDetail', { orderId: order.id })}
              className="w-full text-left"
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium line-clamp-1">{order.listing?.title || 'Listing'}</p>
                  <p className="text-sm text-lantern-text-secondary mt-1">{STATUS_LABELS[order.status] || order.status}</p>
                  {(order.quantity || 1) > 1 ? (
                    <p className="text-xs text-lantern-text-tertiary mt-0.5">Qty {order.quantity}</p>
                  ) : null}
                </div>
                <p className="font-semibold text-lantern-primary shrink-0">
                  ₦{Number(order.amount).toLocaleString()}
                </p>
              </div>
              <p className="text-xs text-lantern-text-tertiary mt-2">
                {new Date(order.created_at).toLocaleDateString()}
              </p>
            </button>
            {role === 'buyer' && order.status === 'completed' ? (
              <div className="mt-3 pt-3 border-t border-lantern-border">
                <Button size="sm" variant="secondary" onClick={(e) => handleBuyAgain(order, e)}>
                  Buy again
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MarketplaceOrdersScreen;
