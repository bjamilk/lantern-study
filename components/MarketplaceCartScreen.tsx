import React, { useEffect, useState } from 'react';
import {
  checkoutMarketplaceCart,
  fetchMarketplaceCart,
  fetchMarketplacePaymentsConfig,
  removeMarketplaceCartItem,
  updateMarketplaceCartItem,
} from '../services/supabase';
import type { MarketplaceCartItem } from '@lantern/shared/types';
import {
  computeMarketplaceCheckoutFees,
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
  const [checkingOut, setCheckingOut] = useState(false);
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

  const handleCheckout = async () => {
    if (items.length === 0) return;
    setCheckingOut(true);
    try {
      const result = await checkoutMarketplaceCart();
      const orderCount = result?.orders?.length || 0;
      const failCount = result?.failures?.length || 0;
      const payUrl =
        result?.authorizationUrl ||
        result?.sessions?.find((s) => s?.authorizationUrl)?.authorizationUrl;

      if (payUrl) {
        if (failCount > 0) {
          showToast(
            `${orderCount} checkout(s) started; ${failCount} item(s) failed. Redirecting to Paystack…`,
            'info'
          );
        } else {
          showToast('Redirecting to Paystack…', 'info');
        }
        // Per-line sessions: pay the first unpaid session now; remaining open from Orders.
        window.location.assign(payUrl);
        return;
      }

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
          <AppIcon name="arrow-back" size={20} />
        </button>
        <h1 className="text-lg font-semibold flex-1">Cart</h1>
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
                  <AppIcon name="trash" size={20} />
                </button>
              </div>
            </div>
          );
        })}
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
          <p className="text-xs text-lantern-text-tertiary">
            {paystackEnabled
              ? "Checkout creates one Paystack charge per listing (and one order per seller). Multi-item carts open the first payment now — after paying, you'll be prompted to pay the rest, and every unpaid order also has a Pay now button in Orders."
              : 'Checkout creates one order per seller. Arrange payment and pickup or delivery directly with each seller — no service charge is added.'}
          </p>
          <Button
            className="w-full"
            onClick={() => void handleCheckout()}
            disabled={checkingOut}
          >
            {checkingOut ? 'Checking out…' : paystackEnabled ? 'Pay with Paystack' : 'Place order'}
          </Button>
        </div>
      )}
    </div>
  );
};

export default MarketplaceCartScreen;
