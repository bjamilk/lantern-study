import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ShopBadges } from '../../../hooks/useShopBadges';

interface Props {
  /** From useShopBadges — the caller owns the subscription so one read feeds the whole screen. */
  badges: ShopBadges;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  /**
   * `scroll` is the Shop-home band (horizontal, fixed-width cards). `grid`
   * is the You hub's card row: the first four cards, equal width, no scroll.
   */
  layout?: 'scroll' | 'grid';
  /**
   * Replaces the built-in list. The You hub's Selling side renders seller
   * cards (hand-overs, offers, questions, payouts) through this same tile so
   * both sides of the hub look alike; the band never passes it.
   */
  actions?: QuickAction[];
}

export interface QuickAction {
  key: string;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge: number;
  screen: string;
  params?: Record<string, unknown>;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The band Amazon puts under its search bar — "Your Orders", "Buy Again",
 * "Your Lists" — so the things you are in the middle of are one tap away
 * instead of behind an overflow menu. Each card carries a live count of what
 * needs you, not a lifetime total: a badge that never clears is noise.
 */
/**
 * The band's cards, in Amazon's order. Exported so the hub can pick and
 * reorder a subset with the same hints and badges as the band.
 */
export function buildQuickActions(badges: ShopBadges): QuickAction[] {
  return [
    {
      key: 'orders',
      label: 'Your Orders',
      hint: badges.buyerActionOrders > 0 ? `${badges.buyerActionOrders} need you` : 'Track & buy again',
      icon: 'receipt-outline',
      badge: badges.buyerActionOrders,
      screen: 'Orders',
      params: { role: 'buyer' },
    },
    {
      key: 'buy-again',
      label: 'Buy Again',
      hint: 'Reorder in a tap',
      icon: 'repeat-outline',
      // Nothing to count: a past purchase is never "attention".
      badge: 0,
      screen: 'Orders',
      params: { role: 'buyer', view: 'buy_again' },
    },
    {
      key: 'saved',
      label: 'Saved',
      hint: badges.savedCount > 0 ? plural(badges.savedCount, 'item') : 'Tap ♡ to save',
      icon: 'heart-outline',
      badge: 0,
      screen: 'Favorites',
    },
    {
      key: 'cart',
      label: 'Cart',
      hint: badges.cartCount > 0 ? plural(badges.cartCount, 'item') : 'Empty',
      icon: 'cart-outline',
      badge: badges.cartCount,
      screen: 'Cart',
    },
    {
      key: 'selling',
      label: 'Selling',
      hint:
        badges.sellerAttention > 0
          ? `${badges.sellerAttention} to handle`
          : badges.activeListings > 0
            ? `${badges.activeListings} live`
            : 'List an item',
      icon: 'storefront-outline',
      badge: badges.sellerAttention,
      // The seller's home is MyListings, which carries its own needs-you strip;
      // the hub is where the buyer side lives.
      screen: 'MyListings',
    },
  ];
}

export function ShopQuickActions({ badges, onNavigate, layout = 'scroll', actions: override }: Props) {
  const { colors } = useTheme();
  const actions = override ?? buildQuickActions(badges);

  const renderCard = (action: QuickAction) => (
    <Pressable
      key={action.key}
      onPress={() => onNavigate(action.screen, action.params)}
      accessibilityRole="button"
      accessibilityLabel={
        action.badge > 0 ? `${action.label}, ${action.badge} need attention` : action.label
      }
      className={`${layout === 'grid' ? 'flex-1' : 'w-[132px]'} rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2.5`}
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
  );

  if (layout === 'grid') {
    return (
      <View className="flex-row gap-2 px-4 pt-3" accessibilityLabel="Your shop shortcuts">
        {actions.slice(0, 4).map(renderCard)}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
      className="pt-3"
      accessibilityLabel="Your shop shortcuts"
    >
      {actions.map(renderCard)}
    </ScrollView>
  );
}
