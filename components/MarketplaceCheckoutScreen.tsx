import React, { useEffect, useMemo, useState } from 'react';
import type {
  MarketplaceAddress,
  MarketplaceCartItem,
  MarketplaceFulfillmentMode,
  MarketplaceSellerFulfillment,
} from '@lantern/shared/types';
import {
  FULFILLMENT_HINTS,
  FULFILLMENT_LABELS,
  formatMarketplaceAddressLine,
  groupCartItems,
  quoteCheckout,
} from '@lantern/shared/marketplace';
import {
  checkoutMarketplaceCart,
  fetchMarketplaceAddresses,
  fetchMarketplaceCart,
  fetchSellerFulfillment,
} from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import { AppIcon } from './ui/AppIcon';

export default function MarketplaceCheckoutScreen({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const showToast = useToastStore((s) => s.showToast);
  const [items, setItems] = useState<MarketplaceCartItem[]>([]);
  const [addresses, setAddresses] = useState<MarketplaceAddress[]>([]);
  const [prefs, setPrefs] = useState<Record<string, MarketplaceSellerFulfillment>>({});
  const [modes, setModes] = useState<Record<string, MarketplaceFulfillmentMode>>({});
  const [addressId, setAddressId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cart = await fetchMarketplaceCart();
        const saved = await fetchMarketplaceAddresses().catch(() => []);
        if (!alive) return;
        setItems(cart);
        setAddresses(saved);
        setAddressId(saved.find((row) => row.is_default)?.id || saved[0]?.id || null);
        const sellerIds = [...new Set(cart.map((item) => item.listing?.user_id).filter(Boolean))] as string[];
        const nextPrefs: Record<string, MarketplaceSellerFulfillment> = {};
        const nextModes: Record<string, MarketplaceFulfillmentMode> = {};
        await Promise.all(
          sellerIds.map(async (sellerId) => {
            const fulfillment = await fetchSellerFulfillment(sellerId);
            if (fulfillment) nextPrefs[sellerId] = fulfillment;
            nextModes[sellerId] = 'campus_meetup';
          }),
        );
        if (alive) {
          setPrefs(nextPrefs);
          setModes(nextModes);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => groupCartItems(items), [items]);
  const quote = useMemo(
    () =>
      quoteCheckout(
        groups.map((group) => {
          const fulfillment = prefs[group.sellerId];
          return {
            sellerId: group.sellerId,
            itemTotalNaira: group.itemTotalNaira,
            fulfillmentMode: modes[group.sellerId] || 'campus_meetup',
            prefs: fulfillment
              ? {
                  shipping_enabled: fulfillment.shippingEnabled,
                  shipping_fee_naira: fulfillment.shippingFeeNaira,
                  shipping_free_over_naira: fulfillment.shippingFreeOverNaira,
                  hall_dropoff_enabled: fulfillment.hallDropoffEnabled,
                }
              : null,
          };
        }),
      ),
    [groups, modes, prefs],
  );

  const handlePay = async () => {
    setPaying(true);
    try {
      const result = await checkoutMarketplaceCart({
        groups: groups.map((group) => ({
          sellerId: group.sellerId,
          fulfillmentMode: modes[group.sellerId] || 'campus_meetup',
        })),
        addressId: quote.requiresAddress ? addressId : null,
      });
      if (result?.authorizationUrl) {
        showToast('Redirecting to Paystack…', 'info');
        window.location.assign(result.authorizationUrl);
        return;
      }
      showToast('Order placed. Arrange pickup with the seller.');
      onNavigate('MarketplaceOrders');
    } catch (error: any) {
      showToast(error?.message || 'Checkout failed', 'error');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-lantern-background">
      <div className="flex items-center gap-3 px-4 md:px-6 py-4 border-b border-lantern-border bg-lantern-surface">
        <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-lantern-background-secondary" aria-label="Back to cart">
          <AppIcon name="arrow-back" size={20} />
        </button>
        <h1 className="text-title text-lantern-text">Checkout</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 space-y-6">
        {loading ? <p className="text-body text-lantern-text-secondary">Loading checkout…</p> : null}
        {!loading && groups.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">Your cart is empty.</p>
        ) : null}
        {groups.map((group) => {
          const fulfillment = prefs[group.sellerId];
          const options: MarketplaceFulfillmentMode[] = ['campus_meetup'];
          if (fulfillment?.hallDropoffEnabled) options.push('hall_dropoff');
          if (fulfillment?.shippingEnabled) options.push('shipping');
          return (
            <section key={group.sellerId} className="p-4 rounded-2xl border border-lantern-border bg-lantern-surface space-y-3">
              <h2 className="text-heading text-lantern-text">Seller · ₦{group.itemTotalNaira.toLocaleString()}</h2>
              <p className="text-caption text-lantern-text-secondary">
                {group.lines.length} item{group.lines.length === 1 ? '' : 's'}
              </p>
              <div className="flex flex-wrap gap-2">
                {options.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setModes((current) => ({ ...current, [group.sellerId]: mode }))}
                    className={`min-h-[36px] px-3 rounded-full text-caption ${
                      (modes[group.sellerId] || 'campus_meetup') === mode
                        ? 'bg-lantern-feature-groups-tint text-lantern-feature-groups-ink'
                        : 'bg-lantern-background-secondary text-lantern-text-secondary'
                    }`}
                  >
                    {FULFILLMENT_LABELS[mode]}
                    <span className="block text-label opacity-80">{FULFILLMENT_HINTS[mode]}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {quote.requiresAddress ? (
          <section className="space-y-2">
            <h2 className="text-heading text-lantern-text">Delivery address</h2>
            {addresses.length === 0 ? (
              <button
                type="button"
                onClick={() => onNavigate('MarketplaceAddresses')}
                className="text-caption text-lantern-feature-groups-ink"
              >
                Add an address
              </button>
            ) : (
              addresses.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setAddressId(row.id)}
                  className={`w-full text-left p-3 rounded-xl border ${
                    addressId === row.id
                      ? 'border-lantern-feature-groups-ink bg-lantern-feature-groups-tint/40'
                      : 'border-lantern-border bg-lantern-surface'
                  }`}
                >
                  <p className="text-body text-lantern-text">{row.recipient_name}</p>
                  <p className="text-caption text-lantern-text-secondary mt-0.5">
                    {formatMarketplaceAddressLine(row)}
                  </p>
                </button>
              ))
            )}
          </section>
        ) : null}
      </div>
      {groups.length > 0 ? (
        <div className="px-4 md:px-6 py-4 border-t border-lantern-border bg-lantern-surface space-y-2">
          <div className="flex justify-between text-caption text-lantern-text-secondary">
            <span>Items</span>
            <span>₦{quote.itemTotalNaira.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-caption text-lantern-text-secondary">
            <span>Shipping</span>
            <span>₦{quote.shippingTotalNaira.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-body font-medium text-lantern-text">
            <span>You pay</span>
            <span>₦{quote.totalNaira.toLocaleString()}</span>
          </div>
          <p className="text-caption text-lantern-text-tertiary">
            One payment. Cart stays until Paystack confirms. Meetup still works without an address.
          </p>
          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={paying || (quote.requiresAddress && !addressId)}
            className="w-full min-h-[44px] rounded-xl font-semibold text-white text-caption bg-lantern-feature-groups-ink hover:opacity-90 disabled:opacity-50"
          >
            {paying ? 'Starting payment…' : 'Pay'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
