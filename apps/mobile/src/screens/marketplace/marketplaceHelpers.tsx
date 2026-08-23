import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { normalizeStorageUrl } from '@lantern/shared/utils';
import type { MarketplaceListing } from '../../stores';

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
  icon?: keyof typeof Ionicons.glyphMap;
};

export function ListingImage({ uri, className = 'w-full h-full', icon = 'bag-outline' }: ListingImageProps) {
  const [failed, setFailed] = useState(false);
  const src = uri ? normalizeStorageUrl(uri) : null;

  if (!src || failed) {
    return (
      <View className={`${className} items-center justify-center bg-lantern-background-secondary dark:bg-lantern-surface-secondary`}>
        <Ionicons name={icon} size={28} color="#94a3b8" />
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

const CATEGORY_ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  book: 'book-outline',
  sparkles: 'star-outline',
  albums: 'albums-outline',
  'document-text': 'document-text-outline',
  briefcase: 'briefcase-outline',
  'chart-bar': 'bar-chart-outline',
  beaker: 'flask-outline',
  home: 'home-outline',
  car: 'car-outline',
  gift: 'gift-outline',
  'shirt-outline': 'shirt-outline',
  people: 'people-outline',
  ticket: 'ticket-outline',
  'help-circle': 'help-circle-outline',
};

export function categoryIcon(name: string): keyof typeof Ionicons.glyphMap {
  return CATEGORY_ICON_MAP[name] ?? 'bag-outline';
}
