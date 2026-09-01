import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ShopSummary } from '../../../stores/marketplaceStore';

interface Props {
  summary: ShopSummary;
  savedCount: number;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}

interface QuickAction {
  key: string;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge: number;
  screen: string;
  params?: Record<string, unknown>;
}

/**
 * The band Amazon puts under its search bar — "Your Orders", "Buy Again",
 * "Your Lists" — so the things you are in the middle of are one tap away
 * instead of behind an overflow menu. Each card carries a live count of what
 * needs you, not a lifetime total: a badge that never clears is noise.
 */
export function ShopQuickActions({ summary, savedCount, onNavigate }: Props) {
  const { colors } = useTheme();
  const sellerAttention =
    summary.sellerActionOrders + summary.pendingOffersReceived + summary.openInquiries;

  const actions: QuickAction[] = [
    {
      key: 'orders',
      label: 'Your Orders',
      hint: summary.buyerActionOrders > 0 ? `${summary.buyerActionOrders} need you` : 'Track & buy again',
      icon: 'receipt-outline',
      badge: summary.buyerActionOrders,
      screen: 'Orders',
    },
    {
      key: 'cart',
      label: 'Cart',
      hint: summary.cartCount > 0 ? `${summary.cartCount} item${summary.cartCount === 1 ? '' : 's'}` : 'Empty',
      icon: 'cart-outline',
      badge: summary.cartCount,
      screen: 'Cart',
    },
    {
      key: 'saved',
      label: 'Saved',
      hint: savedCount > 0 ? `${savedCount} item${savedCount === 1 ? '' : 's'}` : 'Tap ♡ to save',
      icon: 'heart-outline',
      badge: 0,
      screen: 'Favorites',
    },
    {
      key: 'selling',
      label: 'Selling',
      hint:
        sellerAttention > 0
          ? `${sellerAttention} to handle`
          : summary.activeListings > 0
            ? `${summary.activeListings} live`
            : 'List an item',
      icon: 'storefront-outline',
      badge: sellerAttention,
      screen: 'ShopAccount',
    },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
      className="pt-3"
      accessibilityLabel="Your shop shortcuts"
    >
      {actions.map(action => (
        <Pressable
          key={action.key}
          onPress={() => onNavigate(action.screen, action.params)}
          accessibilityRole="button"
          accessibilityLabel={
            action.badge > 0 ? `${action.label}, ${action.badge} need attention` : action.label
          }
          className="w-[132px] rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2.5"
          style={{ minHeight: 64 }}
        >
          <View className="flex-row items-center justify-between">
            <View className="w-8 h-8 rounded-lg items-center justify-center bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
              <Ionicons name={action.icon} size={17} color={colors.primary} />
              <Badge count={action.badge} />
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </View>
          <Text numberOfLines={1} className="mt-1.5 text-xs font-semibold text-lantern-text">
            {action.label}
          </Text>
          <Text numberOfLines={1} className="text-[10px] text-lantern-text-tertiary">
            {action.hint}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
