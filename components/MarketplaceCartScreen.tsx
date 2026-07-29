import React, { useEffect, useState } from 'react';
import {
  checkoutMarketplaceCart,
  fetchMarketplaceCart,
  removeMarketplaceCartItem,
  updateMarketplaceCartItem,
} from '../services/supabase';
import type { MarketplaceCartItem } from '@lantern/shared/types';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import { ArrowLeftIcon, ShoppingCartIcon, TrashIcon } from '@heroicons/react/24/outline';
import Button from './ui/Button';
import { useToastStore } from '../stores/toastStore';

interface MarketplaceCartScreenProps {
  onBack: () => void;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}

const MarketplaceCartScreen: React.FC<MarketplaceCartScreenProps> = ({ onBack, onNavigate }) => {
  const [items, setItems] = useState<MarketplaceCartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const showToast = useToastStore((s) => s.showToast);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await fetchMarketplaceCart());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const lineTotal = (item: MarketplaceCartItem) => {
    if (!item.listing) return 0;
    const unit = resolveListingDisplayPrice(item.listing).effective;
    return unit * item.quantity;
  };

  const cartTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);

  const handleQty = async (listingId: string, quantity: number) => {
    try {
      await updateMarketplaceCartItem(listingId, quantity);
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Could not update cart', 'error');
    }
  };

  const handleRemove = async (listingId: string) => {
    try {
      await removeMarketplaceCartItem(listingId);
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Could not remove item', 'error');
    }
  };

  const handleCheckout = async () => {
    if (items.length === 0) return;
    setCheckingOut(true);
    try {
      const result = await checkoutMarketplaceCart();
      const orderCount = result?.orders?.length || 0;
      const failCount = result?.failures?.length || 0;
      if (failCount > 0) {
        showToast(
          `${orderCount} order${orderCount === 1 ? '' : 's'} created; ${failCount} item${failCount === 1 ? '' : 's'} failed.`,
          orderCount > 0 ? 'info' : 'error'
        );
      } else {
        showToast(
          orderCount === 1
            ? 'Order placed. Arrange pickup with the seller.'
            : `${orderCount} orders placed. Arrange pickup with each seller.`
        );
      }
      if (orderCount === 1 && result.orders[0]?.id) {
        onNavigate('MarketplaceOrderDetail', { orderId: result.orders[0].id });
      } else {
        onNavigate('MarketplaceOrders');
      }
    } catch (error: any) {
      showToast(error?.message || 'Checkout failed', 'error');
      await load();
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-lantern-background">
      <div className="flex items-center gap-3 p-4 border-b border-lantern-border bg-lantern-surface">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-lantern-background-secondary"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1">Cart</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-sm text-lantern-text-secondary">Loading cart…</p>}
        {!loading && items.length === 0 && (
          <div className="text-center py-12 text-lantern-text-secondary">
            <ShoppingCartIcon className="w-12 h-12 mx-auto mb-2 opacity-40" />
            <p>Your cart is empty</p>
            <Button className="mt-4" size="sm" onClick={() => onNavigate('Marketplace')}>
              Browse marketplace
            </Button>
          </div>
        )}
        {items.map((item) => {
          const stock = item.listing?.quantity;
          const maxQty = stock == null ? 1 : Math.max(1, Number(stock));
          const title = item.listing?.title || 'Listing';
          const unavailable =
            !item.listing ||
            item.listing.status !== 'active' ||
            (stock != null && stock < item.quantity);

          return (
            <div
              key={item.id}
              className="p-4 rounded-xl bg-lantern-surface border border-lantern-border space-y-3"
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() =>
                  onNavigate('MarketplaceListingDetail', { listingId: item.listing_id })
                }
              >
                <p className="font-medium line-clamp-2">{title}</p>
                <p className="text-sm text-lantern-primary font-semibold mt-1">
                  ₦{lineTotal(item).toLocaleString()}
                  {item.quantity > 1 ? (
                    <span className="text-lantern-text-secondary font-normal">
                      {' '}
                      · {item.quantity} × ₦
                      {(lineTotal(item) / item.quantity).toLocaleString()}
                    </span>
                  ) : null}
                </p>
                {unavailable ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Update quantity or remove — stock may have changed.
                  </p>
                ) : null}
              </button>
              <div className="flex items-center justify-between gap-2">
                {stock != null ? (
                  <div className="inline-flex items-center rounded-lg border border-lantern-border overflow-hidden">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-sm hover:bg-lantern-background-secondary"
                      onClick={() => void handleQty(item.listing_id, item.quantity - 1)}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="px-3 py-1.5 text-sm font-semibold min-w-[2rem] text-center">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-sm hover:bg-lantern-background-secondary disabled:opacity-40"
                      disabled={item.quantity >= maxQty}
                      onClick={() => void handleQty(item.listing_id, item.quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-lantern-text-secondary">Qty 1</span>
                )}
                <button
                  type="button"
                  onClick={() => void handleRemove(item.listing_id)}
                  className="p-2 rounded-lg text-lantern-text-secondary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  aria-label="Remove from cart"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <div className="p-4 border-t border-lantern-border bg-lantern-surface space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-lantern-text-secondary">Estimated total</span>
            <span className="text-lg font-bold text-lantern-primary">
              ₦{cartTotal.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-lantern-text-tertiary">
            Checkout creates one order per listing so each seller can arrange pickup separately.
          </p>
          <Button
            className="w-full"
            onClick={() => void handleCheckout()}
            disabled={checkingOut}
          >
            {checkingOut ? 'Checking out…' : 'Checkout'}
          </Button>
        </div>
      )}
    </div>
  );
};

export default MarketplaceCartScreen;
