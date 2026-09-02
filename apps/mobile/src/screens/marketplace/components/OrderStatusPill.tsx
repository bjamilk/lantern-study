import React from 'react';
import { Text, View } from 'react-native';
import type { MarketplaceOrderStatus } from '@lantern/shared/types';
import { useTheme } from '../../../theme';

interface Props {
  status: MarketplaceOrderStatus | string;
  role: 'buyer' | 'seller';
  /** Whether an online payment session exists; decides who a pending order waits on. */
  hasPaymentId: boolean;
}

/**
 * Amazon's order rows lead with a coloured status word — "Arriving", "Delivered"
 * — that tells you at a glance whether anything is on you. This does the same
 * for a campus hand-over, phrased for the side of the order you are on.
 */
export function OrderStatusPill({ status, role, hasPaymentId }: Props) {
  const { colors } = useTheme();
  const { label, tone } = describe(status, role, hasPaymentId);
  // Inline, not Tailwind: the config defines no warning/success/error
  // -background classes, and an unknown class is dropped silently — the pill
  // would render as bare text with no tint and no one would notice why.
  const palette =
    tone === 'action'
      ? { bg: colors.warningBackground, fg: colors.warning }
      : tone === 'done'
        ? { bg: colors.successBackground, fg: colors.success }
        : tone === 'bad'
          ? { bg: colors.errorBackground, fg: colors.error }
          : { bg: colors.backgroundSecondary, fg: colors.textSecondary };
  return (
    <View
      className="self-start px-2 py-0.5 rounded-full"
      style={{ backgroundColor: palette.bg }}
      accessibilityLabel={`Status: ${label}`}
    >
      <Text className="text-[11px] font-semibold" style={{ color: palette.fg }}>
        {label}
      </Text>
    </View>
  );
}

function describe(
  status: string,
  role: 'buyer' | 'seller',
  hasPaymentId: boolean,
): { label: string; tone: 'action' | 'wait' | 'done' | 'bad' } {
  const buyer = role === 'buyer';
  switch (status) {
    case 'pending_payment':
      // Cash / transfer: the seller confirms receipt. Online: the buyer pays.
      if (hasPaymentId) return buyer ? { label: 'Pay now', tone: 'action' } : { label: 'Awaiting payment', tone: 'wait' };
      return buyer ? { label: 'Pay the seller', tone: 'action' } : { label: 'Confirm payment', tone: 'action' };
    case 'awaiting_payment':
      return buyer ? { label: 'Pay now', tone: 'action' } : { label: 'Awaiting payment', tone: 'wait' };
    case 'paid':
      return buyer ? { label: 'Paid · being prepared', tone: 'wait' } : { label: 'Hand over', tone: 'action' };
    case 'ready_for_pickup':
      return buyer ? { label: 'Ready · confirm pickup', tone: 'action' } : { label: 'Waiting for buyer', tone: 'wait' };
    case 'buyer_confirmed':
      return { label: 'Collected', tone: 'done' };
    case 'completed':
      return { label: 'Completed', tone: 'done' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'bad' };
    case 'disputed':
      return { label: 'Disputed', tone: 'bad' };
    default:
      return { label: status.replace(/_/g, ' '), tone: 'wait' };
  }
}
