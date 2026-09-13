import React, { useEffect, useState } from 'react';
import { AppIcon, type AppIconName } from './ui/AppIcon';

interface Row {
  key: string;
  label: string;
  detail: string;
  icon: AppIconName;
  screen: string;
  params?: Record<string, unknown>;
}

const BUYING: Row[] = [
  { key: 'orders', label: 'Your orders', detail: 'Track, pay, buy again', icon: 'receipt', screen: 'MarketplaceOrders' },
  { key: 'cart', label: 'Cart', detail: 'Check out grouped by seller', icon: 'cart', screen: 'MarketplaceCart' },
  { key: 'addresses', label: 'Addresses', detail: 'Saved delivery spots', icon: 'location', screen: 'MarketplaceAddresses' },
  { key: 'saved', label: 'Saved', detail: 'Listings you kept', icon: 'heart', screen: 'MarketplaceFavorites' },
  { key: 'purchases', label: 'Purchases', detail: 'Study packs you own', icon: 'albums', screen: 'MarketplacePurchases' },
  { key: 'messages', label: 'Messages', detail: 'Questions to sellers', icon: 'chatbubble', screen: 'MarketplaceInquiries' },
];

const SELLING: Row[] = [
  { key: 'listings', label: 'Your listings', detail: 'What you are selling', icon: 'storefront', screen: 'MyListings' },
  { key: 'hand-over', label: 'Orders to fulfill', detail: 'Meetup, dropoff, or ship', icon: 'cube', screen: 'MarketplaceOrders' },
  { key: 'shop', label: 'Your shop', detail: 'Name, bio, shipping', icon: 'bag', screen: 'MyListings' },
];

export default function ShopAccountScreen({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const [side, setSide] = useState<'buying' | 'selling'>('buying');

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('lantern_shop_you_side');
      if (stored === 'selling') setSide('selling');
    } catch {
      /* ignore */
    }
  }, []);

  const choose = (next: 'buying' | 'selling') => {
    setSide(next);
    try {
      sessionStorage.setItem('lantern_shop_you_side', next);
    } catch {
      /* ignore */
    }
  };

  const rows = side === 'buying' ? BUYING : SELLING;

  return (
    <div className="flex flex-col h-full bg-lantern-background">
      <div className="flex items-center gap-3 px-4 md:px-6 py-4 border-b border-lantern-border bg-lantern-surface">
        <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-lantern-background-secondary" aria-label="Back">
          <AppIcon name="arrow-back" size={20} />
        </button>
        <h1 className="text-title text-lantern-text flex-1">You</h1>
      </div>
      <div className="px-4 md:px-6 pt-4 flex gap-2">
        {(['buying', 'selling'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => choose(id)}
            className={`min-h-[36px] px-3 rounded-full text-caption font-medium capitalize ${
              side === id
                ? 'bg-lantern-feature-groups-tint text-lantern-feature-groups-ink'
                : 'bg-lantern-background-secondary text-lantern-text-secondary'
            }`}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto mt-2">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onNavigate(row.screen, row.params)}
            className="w-full flex items-center gap-3 px-4 md:px-6 py-3 min-h-[60px] border-b border-lantern-border text-left hover:bg-lantern-background-secondary"
          >
            <span className="w-10 h-10 rounded-xl bg-lantern-background-secondary inline-flex items-center justify-center">
              <AppIcon name={row.icon} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-lantern-text">{row.label}</span>
              <span className="block text-caption text-lantern-text-secondary mt-0.5">{row.detail}</span>
            </span>
            <AppIcon name="chevron-forward" size={18} className="text-lantern-text-tertiary" />
          </button>
        ))}
      </div>
    </div>
  );
}
