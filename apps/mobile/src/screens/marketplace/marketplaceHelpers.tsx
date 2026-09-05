import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { normalizeStorageUrl } from '@lantern/shared/utils';
import type { MarketplaceListing } from '../../stores';
import { AppIcon, type AppIconName } from '../../components/ui/AppIcon';

export function formatPrice(price?: number): string {
  if (price == null || price <= 0) return 'Free';
  return `₦${price.toLocaleString()}`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins || 1}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

type ListingImageProps = {
  uri?: string | null;
  className?: string;
  icon?: AppIconName;
};

export function ListingImage({ uri, className = 'w-full h-full', icon = 'bag' }: ListingImageProps) {
  const [failed, setFailed] = useState(false);
  const src = uri ? normalizeStorageUrl(uri) : null;

  if (!src || failed) {
    return (
      <View className={`${className} items-center justify-center bg-lantern-background-secondary dark:bg-lantern-surface-secondary`}>
        <AppIcon name={icon} size={28} color="#94a3b8" />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: src }}
      className={className}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export function isOwnListing(listing: MarketplaceListing, userId?: string): boolean {
  if (!userId) return false;
  return listing.user_id === userId || listing.seller_id === userId;
}

const CATEGORY_ICON_MAP: Record<string, AppIconName> = {
  book: 'book',
  sparkles: 'star',
  albums: 'albums',
  'document-text': 'document-text',
  briefcase: 'briefcase',
  'chart-bar': 'bar-chart',
  beaker: 'flask',
  home: 'home',
  car: 'car',
  gift: 'gift',
  'shirt-outline': 'shirt',
  people: 'people',
  ticket: 'ticket',
  'phone-portrait': 'phone-portrait',
  restaurant: 'restaurant',
  'help-circle': 'help-circle',
};

export function categoryIcon(name: string): AppIconName {
  return CATEGORY_ICON_MAP[name] ?? 'bag';
}

/** Taxonomy nodes carry a platform-neutral icon key; this is its app icon. */
const TAXONOMY_ICON_MAP: Record<string, AppIconName> = {
  book: 'book',
  notes: 'document-text',
  sparkles: 'sparkles',
  albums: 'albums',
  briefcase: 'briefcase',
  beaker: 'flask',
  chart: 'stats-chart',
  home: 'home',
  car: 'car',
  shirt: 'shirt',
  gift: 'gift',
  people: 'people',
  ticket: 'ticket',
  phone: 'phone-portrait',
  food: 'restaurant',
  plus: 'add-circle',
};

export function taxonomyIcon(key: string): AppIconName {
  return TAXONOMY_ICON_MAP[key] ?? 'pricetag';
}
