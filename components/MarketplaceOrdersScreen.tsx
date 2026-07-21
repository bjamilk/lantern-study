import React, { useEffect, useState } from 'react';
import { fetchMarketplaceOrders } from '../services/supabase';
import { MarketplaceOrder } from '../types';
import { ArrowLeftIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import Button from './ui/Button';

interface MarketplaceOrdersScreenProps {
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid — arrange pickup',
  ready_for_pickup: 'Ready for pickup',
  buyer_confirmed: 'Buyer confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

const MarketplaceOrdersScreen: React.FC<MarketplaceOrdersScreenProps> = ({ onBack, onNavigate }) => {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [loading, setLoading] = useState(true);

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
        <h1 className="text-lg font-semibold flex-1">My orders</h1>
      </div>

      <div className="flex gap-2 p-4">
        <Button size="sm" variant={role === 'buyer' ? 'primary' : 'secondary'} onClick={() => setRole('buyer')}>
          Buying
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
            <p>No orders yet</p>
          </div>
        )}
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            onClick={() => onNavigate('MarketplaceOrderDetail', { orderId: order.id })}
            className="w-full text-left p-4 rounded-xl bg-lantern-surface dark:bg-lantern-surface border border-lantern-border hover:border-purple-400 transition-colors"
          >
            <div className="flex justify-between items-start gap-2">
              <div>
                <p className="font-medium line-clamp-1">{order.listing?.title || 'Listing'}</p>
                <p className="text-sm text-lantern-text-secondary mt-1">{STATUS_LABELS[order.status] || order.status}</p>
              </div>
              <p className="font-semibold text-lantern-primary shrink-0">
                ₦{Number(order.amount).toLocaleString()}
              </p>
            </div>
            <p className="text-xs text-lantern-text-tertiary mt-2">
              {new Date(order.created_at).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default MarketplaceOrdersScreen;
