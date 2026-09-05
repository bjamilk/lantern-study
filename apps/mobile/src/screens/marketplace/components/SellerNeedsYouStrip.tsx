/**
 * The seller's "Needs you" strip at the top of Your Listings.
 *
 * Three tiles, one per queue a seller can be behind on — orders to hand over,
 * offers waiting on a reply, unread buyer questions — each carrying a count and
 * the params that land on the SELLER side of the destination (Orders used to
 * open on the buyer's purchase history from here). When every count is zero
 * the strip collapses to "You're all caught up", so a quiet shop reads as
 * done rather than empty.
 *
 * The grey line underneath is deliberately un-badged: orders awaiting the
 * buyer's online payment are not the seller's to act on, but a seller who can
 * see them stops wondering whether the sale went through.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { AppIcon, type AppIconName } from '../../../components/ui/AppIcon';

export interface SellerNeedsYouStripProps {
  /** Seller orders that are paid (hand over) or cash-pending (confirm payment). */
  handOver: number;
  /** Received offers where it is the seller's turn. */
  offers: number;
  /** Unread buyer messages on the seller's open inquiries — the badge. */
  inquiries: number;
  /** Open or negotiating inquiries, shown as grey context under the tile; not a badge. */
  openInquiries?: number;
  /** Seller orders where the buyer still has to pay online; shown, not badged. */
  awaitingBuyerPayment: number;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}

type Tile = {
  id: 'orders' | 'offers' | 'inquiries';
  label: string;
  icon: AppIconName;
  count: number;
  screen: string;
  params: Record<string, unknown>;
  /** Grey context under the label (e.g. "3 open"); never counted. */
  sub?: string;
};

export function SellerNeedsYouStrip({
  handOver,
  offers,
  inquiries,
  openInquiries = 0,
  awaitingBuyerPayment,
  onNavigate,
}: SellerNeedsYouStripProps) {
  const { colors } = useTheme();
  const tiles: Tile[] = [
    {
      id: 'orders',
      label: 'To hand over',
      icon: 'cube',
      count: handOver,
      screen: 'Orders',
      params: { role: 'seller' },
    },
    {
      id: 'offers',
      label: 'Offers',
      icon: 'pricetags',
      count: offers,
      screen: 'Offers',
      params: { tab: 'seller' },
    },
    {
      id: 'inquiries',
      label: 'Questions',
      icon: 'chatbubbles',
      count: inquiries,
      screen: 'Inquiries',
      params: { tab: 'seller' },
      // Unread is what needs you; open is what exists. Show both so a quiet
      // seller with three open threads is not told there is nothing.
      sub: openInquiries > 0 ? `${openInquiries} open` : undefined,
    },
  ];
  const caughtUp = tiles.every((t) => t.count <= 0);
  const caughtUpSub = openInquiries > 0 ? ` · ${openInquiries} open question${openInquiries === 1 ? '' : 's'}` : '';

  return (
    <View className="mb-3">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary mb-1.5">
        Needs you
      </Text>
      {caughtUp ? (
        <View
          className="flex-row items-center gap-2 px-3 py-2.5 rounded-lg bg-lantern-surface border border-lantern-border"
          accessibilityRole="text"
          accessibilityLabel="You're all caught up"
        >
          <AppIcon name="checkmark-circle" size={18} color={colors.success} />
          <Text className="text-sm font-medium text-lantern-text">You're all caught up{caughtUpSub}</Text>
        </View>
      ) : (
        <View className="flex-row gap-2">
          {tiles.map((tile) => {
            const pending = tile.count > 0;
            return (
              <Pressable
                key={tile.id}
                onPress={() => onNavigate(tile.screen, tile.params)}
                accessibilityRole="button"
                accessibilityLabel={`${tile.label}: ${tile.count}`}
                className={`flex-1 px-3 py-2 rounded-lg border ${
                  pending
                    ? 'bg-lantern-surface border-lantern-primary'
                    : 'bg-lantern-surface border-lantern-border'
                }`}
              >
                <View className="self-start">
                  <AppIcon
                    name={tile.icon}
                    size={18}
                    color={pending ? colors.primary : colors.textTertiary}
                  />
                  <Badge count={tile.count} />
                </View>
                <Text
                  className={`text-lg font-bold mt-1 ${pending ? 'text-lantern-text' : 'text-lantern-text-tertiary'}`}
                >
                  {tile.count}
                </Text>
                <Text className="text-[11px] text-lantern-text-secondary" numberOfLines={1}>
                  {tile.label}
                  {tile.sub ? <Text className="text-lantern-text-tertiary"> · {tile.sub}</Text> : null}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {awaitingBuyerPayment > 0 ? (
        <Pressable
          onPress={() => onNavigate('Orders', { role: 'seller' })}
          accessibilityRole="button"
          className="mt-2 flex-row items-center gap-1.5 self-start"
        >
          <AppIcon name="time" size={13} color={colors.textTertiary} />
          <Text className="text-xs text-lantern-text-tertiary">
            {awaitingBuyerPayment} order{awaitingBuyerPayment === 1 ? '' : 's'} awaiting buyer payment
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default SellerNeedsYouStrip;
