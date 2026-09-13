import React, { useEffect, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import type { SellerAnalytics } from '../../types';
import { Drawer } from '../ui';
import { updateSellerPreferences, fetchSellerPayments, fetchSellerPreferences, type SellerPaymentRow } from '../../services/supabase';
import { SellerPayoutSetup } from './SellerPayoutSetup';
import { useToastStore } from '../../stores/toastStore';

export interface SellerInsightsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  analytics: SellerAnalytics | null;
  requirePaymentConfirmation: boolean;
  hallDropoffEnabled: boolean;
  hallDropoffMin: string;
  onRequirePaymentConfirmationChange: (value: boolean) => void;
  onHallDropoffEnabledChange: (value: boolean) => void;
  onHallDropoffMinChange: (value: string) => void;
}

/**
 * On-demand seller analytics + preferences panel.
 * Keeps inventory as the primary seller viewport.
 */
export const SellerInsightsDrawer: React.FC<SellerInsightsDrawerProps> = ({
  isOpen,
  onClose,
  analytics,
  requirePaymentConfirmation,
  hallDropoffEnabled,
  hallDropoffMin,
  onRequirePaymentConfirmationChange,
  onHallDropoffEnabledChange,
  onHallDropoffMinChange,
}) => {
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [shippingFee, setShippingFee] = useState('');
  const [shippingFreeOver, setShippingFreeOver] = useState('');
  const [shipsFromCity, setShipsFromCity] = useState('');
  // Earnings ledger (Phase 2 · I): what each sale paid out after the Lantern fee.
  const [payments, setPayments] = useState<SellerPaymentRow[] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    void fetchSellerPayments(1)
      .then(setPayments)
      .catch(() => setPayments([]));
    void fetchSellerPreferences()
      .then((prefs) => {
        setShippingEnabled(Boolean(prefs?.shipping_enabled));
        setShippingFee(prefs?.shipping_fee_naira != null ? String(prefs.shipping_fee_naira) : '');
        setShippingFreeOver(
          prefs?.shipping_free_over_naira != null ? String(prefs.shipping_free_over_naira) : '',
        );
        setShipsFromCity(prefs?.ships_from_city || '');
      })
      .catch(() => {});
  }, [isOpen]);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} maxWidthClass="max-w-md" side="right" ariaLabelledBy="seller-insights-title">
      <div className="flex items-center justify-between px-4 py-3 border-b border-lantern-border">
        <h2 id="seller-insights-title" className="text-base font-bold text-lantern-text flex items-center gap-2">
          <AppIcon name="bar-chart" size={20} className="text-lantern-primary" />
          Performance & preferences
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-lantern-background-secondary min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Close insights"
        >
          <AppIcon name="close" size={20} className="text-lantern-text-secondary" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!analytics ? (
          <p className="text-sm text-lantern-text-secondary">Analytics will appear once you have selling activity.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Revenue (30d)" value={`₦${analytics.revenue30d.toLocaleString()}`} accent />
              <Metric label="Total revenue" value={`₦${analytics.totalRevenue.toLocaleString()}`} />
              <Metric label="Avg sale price" value={`₦${analytics.avgSalePrice.toLocaleString()}`} />
              <Metric label="Avg days to sell" value={String(analytics.avgTimeToSellDays)} />
              <Metric
                label={analytics.conversionRate30d != null ? 'View-to-sale (30d)' : 'View-to-sale'}
                value={`${analytics.conversionRate30d != null ? analytics.conversionRate30d : analytics.conversionRate}%`}
              />
              <Metric label="Pending orders" value={String(analytics.pendingOrders)} />
              <Metric label="Offer accept rate" value={`${analytics.offerAcceptRate}%`} />
              <Metric label="Discounts given" value={`₦${analytics.discountsGiven.toLocaleString()}`} />
            </div>

            {analytics.funnel30d ? (
              <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
                <p className="text-xs font-semibold text-lantern-text-secondary mb-2">Funnel (30d)</p>
                <div className="grid grid-cols-5 gap-1 text-center text-xs">
                  {(
                    [
                      ['Impressions', analytics.funnel30d.impressions],
                      ['Views', analytics.funnel30d.views],
                      ['Inquiries', analytics.funnel30d.inquiries],
                      ['Offers', analytics.funnel30d.offers],
                      ['Sales', analytics.funnel30d.sales],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="p-2 rounded-lg bg-lantern-background">
                      <p className="text-lantern-text-secondary">{label}</p>
                      <p className="font-bold text-lantern-text">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {analytics.viewsByDay && analytics.viewsByDay.some(d => d.views > 0) ? (
              <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
                <p className="text-xs font-semibold text-lantern-text-secondary mb-2">Listing views (30d)</p>
                <div className="flex items-end gap-0.5 h-16">
                  {analytics.viewsByDay.map(day => {
                    const max = Math.max(...analytics.viewsByDay!.map(d => d.views), 1);
                    const height = Math.max(2, (day.views / max) * 100);
                    return (
                      <div
                        key={day.date}
                        className="flex-1 bg-emerald-500/80 rounded-t"
                        style={{ height: `${height}%` }}
                        title={`${day.date}: ${day.views} views · ${day.uniqueViewers} unique`}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}

            {analytics.salesByWeek.length > 0 ? (
              <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
                <p className="text-xs font-semibold text-lantern-text-secondary mb-2">Weekly sales</p>
                <div className="flex items-end gap-1 h-16">
                  {analytics.salesByWeek.map(week => {
                    const max = Math.max(...analytics.salesByWeek.map(w => w.revenue), 1);
                    const height = Math.max(4, (week.revenue / max) * 100);
                    return (
                      <div
                        key={week.weekStart}
                        className="flex-1 bg-lantern-primary/80 rounded-t"
                        style={{ height: `${height}%` }}
                        title={`₦${week.revenue} · ${week.count} sales`}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}

            {(analytics.salesBySource?.length || analytics.inquiryToSaleRate != null) ? (
              <div className="grid grid-cols-1 gap-2">
                {analytics.salesBySource && analytics.salesBySource.length > 0 ? (
                  <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
                    <p className="text-xs font-semibold text-lantern-text-secondary mb-2">Sales by channel</p>
                    <div className="space-y-1">
                      {analytics.salesBySource.map(row => (
                        <div key={row.source} className="flex justify-between text-sm">
                          <span className="capitalize">{row.source.replace(/_/g, ' ')}</span>
                          <span>{row.count} · ₦{row.revenue.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {analytics.inquiryToSaleRate != null ? (
                  <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
                    <p className="text-xs text-lantern-text-secondary">Inquiry → sale rate</p>
                    <p className="text-lg font-bold">{analytics.inquiryToSaleRate}%</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {(analytics.staleListings?.length || analytics.highViewsLowEngagement?.length) ? (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">Listing insights</p>
                {analytics.highViewsLowEngagement?.slice(0, 3).map(l => (
                  <p key={l.id} className="text-xs text-amber-900 dark:text-amber-200">
                    &quot;{l.title}&quot; — {l.views} views, no inquiries. Try a price drop or better photos.
                  </p>
                ))}
                {analytics.staleListings?.slice(0, 3).map(l => (
                  <p key={l.id} className="text-xs text-amber-900 dark:text-amber-200 mt-1">
                    &quot;{l.title}&quot; — listed {l.daysListed} days with low activity.
                  </p>
                ))}
              </div>
            ) : null}

            {analytics.favoriteHighlights && analytics.favoriteHighlights.length > 0 ? (
              <div className="p-3 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-900/40">
                <p className="text-xs font-semibold text-pink-800 dark:text-pink-300 mb-2 flex items-center gap-1">
                  <AppIcon name="heart" size={16} /> Favorite highlights
                </p>
                {analytics.favoriteHighlights.map(l => (
                  <p key={l.id} className="text-xs text-pink-900 dark:text-pink-200">
                    &quot;{l.title}&quot; — {l.favoritesCount} favorite{l.favoritesCount === 1 ? '' : 's'}.
                  </p>
                ))}
              </div>
            ) : null}

            {analytics.topListings && analytics.topListings.length > 0 ? (
              <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border overflow-x-auto">
                <p className="text-xs font-semibold text-lantern-text-secondary mb-2">Top listings</p>
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-lantern-text-secondary border-b border-lantern-border">
                      <th className="py-1 pr-2 font-medium">Listing</th>
                      <th className="py-1 px-1 font-medium">Views</th>
                      <th className="py-1 px-1 font-medium">Inquiries</th>
                      <th className="py-1 px-1 font-medium">Offers</th>
                      <th className="py-1 pl-1 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topListings.slice(0, 8).map(l => (
                      <tr key={l.id} className="border-b border-lantern-border/60 last:border-0">
                        <td className="py-1.5 pr-2 text-lantern-text max-w-[10rem] truncate" title={l.title}>
                          {l.title}{l.sold ? ' · sold' : ''}
                        </td>
                        <td className="py-1.5 px-1">{l.views}</td>
                        <td className="py-1.5 px-1">{l.inquiries}</td>
                        <td className="py-1.5 px-1">{l.offers}</td>
                        <td className="py-1.5 pl-1">₦{l.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}

        {payments && payments.length > 0 ? (
          <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border overflow-x-auto">
            <p className="text-xs font-semibold text-lantern-text-secondary mb-2 flex items-center gap-1">
              <AppIcon name="cash" size={16} /> Earnings
            </p>
            <table className="w-full text-xs text-left tabular-nums">
              <thead>
                <tr className="text-lantern-text-secondary border-b border-lantern-border">
                  <th className="py-1 pr-2 font-medium">Sale</th>
                  <th className="py-1 px-1 font-medium">Price</th>
                  <th className="py-1 px-1 font-medium">Fee</th>
                  <th className="py-1 px-1 font-medium">You get</th>
                  <th className="py-1 pl-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 10).map((p) => (
                  <tr key={p.orderId} className="border-b border-lantern-border/60 last:border-0">
                    <td className="py-1.5 pr-2 text-lantern-text max-w-[9rem] truncate" title={p.title}>
                      {p.title}
                    </td>
                    <td className="py-1.5 px-1">₦{Math.round(p.itemAmountKobo / 100).toLocaleString()}</td>
                    <td className="py-1.5 px-1 text-lantern-text-tertiary">
                      {p.platformFeeKobo > 0 ? `−₦${Math.round(p.platformFeeKobo / 100).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-1.5 px-1 font-semibold text-lantern-text">
                      ₦{Math.round(p.sellerPayoutKobo / 100).toLocaleString()}
                    </td>
                    <td className="py-1.5 pl-1 capitalize">
                      {p.payoutAt ? 'paid out' : p.status.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <SellerPayoutSetup
          showToast={(message, type) => useToastStore.getState().showToast(message, type || 'info')}
        />

        <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border space-y-3">
          <p className="text-xs font-semibold text-lantern-text-secondary">Seller preferences</p>
          {/* The require-payment-confirmation toggle is gone: every order now
              starts pending_payment and only the seller can confirm payment
              received, so the preference no longer changes anything — a toggle
              that does nothing is worse than none. The stored preference is
              kept server-side for compatibility. */}
          <p className="text-xs text-lantern-text-tertiary">
            Every sale now waits for you to confirm payment before it counts as paid — cash at pickup included.
          </p>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={hallDropoffEnabled}
              onChange={e => onHallDropoffEnabledChange(e.target.checked)}
            />
            Offer hall dropoff on eligible combined orders
          </label>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={shippingEnabled}
              onChange={(e) => setShippingEnabled(e.target.checked)}
            />
            Ship to a saved address (seller-quoted fee — you find the rider)
          </label>
          <input
            type="number"
            value={shippingFee}
            onChange={(e) => setShippingFee(e.target.value)}
            placeholder="Shipping fee ₦"
            className="lantern-field w-full text-body"
          />
          <input
            type="number"
            value={shippingFreeOver}
            onChange={(e) => setShippingFreeOver(e.target.value)}
            placeholder="Free over ₦ (optional)"
            className="lantern-field w-full text-body"
          />
          <input
            type="text"
            value={shipsFromCity}
            onChange={(e) => setShipsFromCity(e.target.value)}
            placeholder="Ships from city"
            className="lantern-field w-full text-body"
          />
          <div className="flex gap-2">
            <input
              type="number"
              value={hallDropoffMin}
              onChange={e => onHallDropoffMinChange(e.target.value)}
              placeholder="Min ₦ amount"
              className="lantern-field flex-1 text-sm"
            />
            <button
              type="button"
              disabled={savingPrefs}
              onClick={async () => {
                setSavingPrefs(true);
                try {
                  await updateSellerPreferences({
                    hallDropoffEnabled,
                    hallDropoffMinAmount: hallDropoffMin ? Number(hallDropoffMin) : null,
                    shippingEnabled,
                    shippingFeeNaira: shippingFee ? Number(shippingFee) : null,
                    shippingFreeOverNaira: shippingFreeOver ? Number(shippingFreeOver) : null,
                    shipsFromCity: shipsFromCity.trim() || null,
                    requirePaymentConfirmation,
                  });
                } finally {
                  setSavingPrefs(false);
                }
              }}
              className="px-3 py-2 rounded-lg bg-lantern-primary text-white text-sm font-semibold disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Drawer>
  );
};

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
      <p className="text-xs text-lantern-text-secondary">{label}</p>
      <p className={`text-base font-bold ${accent ? 'text-lantern-primary' : 'text-lantern-text'}`}>{value}</p>
    </div>
  );
}

export default SellerInsightsDrawer;
