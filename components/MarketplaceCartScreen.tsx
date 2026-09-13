import React, { useEffect, useState } from 'react';
import {
  fetchMarketplaceCart,
  fetchMarketplacePaymentsConfig,
  removeMarketplaceCartItem,
  updateMarketplaceCartItem,
} from '../services/supabase';
import type { MarketplaceCartItem } from '@lantern/shared/types';
import {
  computeMarketplaceCheckoutFees,
  groupCartItems,
  MARKETPLACE_DEFAULT_SERVICE_FEE_BPS,
  nairaToKobo,
  koboToNaira,
} from '@lantern/shared/marketplace';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import Button from './ui/Button';
import { useToastStore } from '../stores/toastStore';
import { AppIcon } from './ui/AppIcon';

interface MarketplaceCartScreenProps {
  onBack: () => void;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}

const MarketplaceCartScreen: React.FC<MarketplaceCartScreenProps> = ({ onBack, onNavigate }) => {
  const [items, setItems] = useState<MarketplaceCartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const sellerGroups = groupCartItems(items);
  // Payment mode drives the fee quote and CTA label. When Paystack is off the
  // server charges no service fee, so the client must not show one either.
  const [paymentConfig, setPaymentConfig] = useState<{
    paystackEnabled: boolean;
    serviceFeeBps: number;
  } | null>(null);
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

  useEffect(() => {
    let alive = true;
    fetchMarketplacePaymentsConfig()
      .then((config) => {
        if (alive) {
          setPaymentConfig({
            paystackEnabled: !!config.paystackEnabled,
            serviceFeeBps: config.serviceFeeBps,
          });
        }
      })
      .catch(() => {
        if (alive) setPaymentConfig(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const lineTotal = (item: MarketplaceCartItem) => {
    if (!item.listing) return 0;
    const unit = resolveListingDisplayPrice(item.listing).effective;
    return unit * item.quantity;
  };

  const cartTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  // Conservative default (no Paystack) until config loads, matching
  // usePaystackEnabled: better to under-quote briefly than show a phantom fee.
  const paystackEnabled = paymentConfig?.paystackEnabled ?? false;
  const serviceFeeBps = paymentConfig?.serviceFeeBps ?? MARKETPLACE_DEFAULT_SERVICE_FEE_BPS;
  const fees = computeMarketplaceCheckoutFees(
    nairaToKobo(cartTotal),
    paystackEnabled ? serviceFeeBps : 0
  );
  const serviceFeeNaira = koboToNaira(fees.serviceFeeKobo);
  const payTotalNaira = koboToNaira(fees.totalChargeKobo);
  const showServiceFee = paystackEnabled && fees.serviceFeeKobo > 0;
  const serviceFeePct = serviceFeeBps / 100;

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

  const handleCheckout = () => {
    if (items.length === 0) return;
    onNavigate('MarketplaceCheckout');
  };

  return (
    <div className="flex flex-col h-full bg-lantern-background">
      <div className="flex items-center gap-3 p-4 border-b border-lantern-border bg-lantern-surface">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-lantern-background-secondary"
        >
          <AppIcon name="arrow-back" size={20} />
        </button>
        <h1 className="text-title text-lantern-text flex-1">Cart</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-sm text-lantern-text-secondary">Loading cart…</p>}
        {!loading && items.length === 0 && (
          <div className="text-center py-12 text-lantern-text-secondary">
            <AppIcon name="cart" size={48} className="mx-auto mb-2 opacity-40" />
            <p>Your cart is empty</p>
            <Button className="mt-4" size="sm" onClick={() => onNavigate('Marketplace')}>
              Browse marketplace
            </Button>
          </div>
        )}
        {sellerGroups.map((group) => (
          <div key={group.sellerId} className="space-y-2">
            <p className="text-caption font-medium text-lantern-text-secondary px-1">
              Seller · ₦{group.itemTotalNaira.toLocaleString()}
            </p>
        {group.lines.map(({ source: item }) => {
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
                  <AppIcon name="trash" size={20} />
                </button>
              </div>
            </div>
          );
        })}
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className="p-4 border-t border-lantern-border bg-lantern-surface space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-lantern-text-secondary">
              <span>Items</span>
              <span>₦{cartTotal.toLocaleString()}</span>
            </div>
            {showServiceFee && (
              <div className="flex justify-between text-lantern-text-secondary">
                <span>Service charge ({serviceFeePct}%)</span>
                <span>₦{serviceFeeNaira.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1">
              <span className="font-medium">You pay</span>
              <span className="text-lg font-bold text-lantern-primary">
                ₦{payTotalNaira.toLocaleString()}
              </span>
            </div>
          </div>
          <p className="text-caption text-lantern-text-tertiary">
            Next: pick meetup, hall dropoff, or shipping, then one payment. The cart stays until Paystack confirms.
          </p>
          <button
            type="button"
            onClick={handleCheckout}
            className="w-full min-h-[44px] rounded-xl font-semibold text-white text-caption bg-lantern-feature-groups-ink hover:opacity-90"
          >
            Continue to checkout
          </button>
        </div>
      )}
    </div>
  );
};

export default MarketplaceCartScreen;
