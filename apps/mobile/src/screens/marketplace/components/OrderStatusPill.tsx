import React from 'react';
import { Text, View } from 'react-native';
import type { MarketplaceOrderStatus } from '@lantern/shared/types';
import { useTheme } from '../../../theme';
import { BUYER_ACTION_ORDER_STATUSES, orderNeedsSeller } from '../../../stores/marketplaceStore';

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
  // The "action" tone is derived from the same predicates that count the
  // badges, not hand-listed per label: a row that reads as needing you must
  // be one the You badge counted, and vice versa. Labels stay hand-written
  // because they are phrased for the side you are on.
  const acts = buyer
    ? BUYER_ACTION_ORDER_STATUSES.has(status)
    : orderNeedsSeller({ status, payment_id: hasPaymentId ? 'x' : null });
  const tone: 'action' | 'wait' = acts ? 'action' : 'wait';
  switch (status) {
    case 'pending_payment':
      // Cash / transfer: the seller confirms receipt. Online: the buyer pays.
      if (hasPaymentId) return buyer ? { label: 'Pay now', tone } : { label: 'Awaiting payment', tone };
      return buyer ? { label: 'Pay the seller', tone } : { label: 'Confirm payment', tone };
    case 'awaiting_payment':
      return buyer ? { label: 'Pay now', tone } : { label: 'Awaiting payment', tone };
    case 'paid':
      return buyer ? { label: 'Paid · being prepared', tone } : { label: 'Hand over', tone };
    case 'ready_for_pickup':
      return buyer ? { label: 'Ready · confirm pickup', tone } : { label: 'Waiting for buyer', tone };
    case 'shipped':
      return buyer ? { label: 'Shipped · confirm received', tone } : { label: 'In transit', tone: 'wait' };
    case 'buyer_confirmed':
      return { label: 'Collected', tone: 'done' };
    case 'completed':
      return { label: 'Completed', tone: 'done' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'bad' };
    case 'disputed':
      return { label: 'Disputed', tone: 'bad' };
    default:
      return { label: status.replace(/_/g, ' '), tone };
  }
}

/**
 * The one-line "what happens next" under the pill on the order page, phrased
 * for the side you are on. Empty for a status nobody has words for yet.
 */
export function orderNextStep(
  status: string,
  role: 'buyer' | 'seller',
  hasPaymentId: boolean,
): string {
  const buyer = role === 'buyer';
  switch (status) {
    case 'pending_payment':
      if (hasPaymentId) return buyer ? 'Pay on Paystack to lock it in' : 'Waiting for the buyer to pay on Paystack';
      return buyer ? 'Pay the seller, then upload your proof' : 'Confirm once you have the cash or transfer';
    case 'awaiting_payment':
      return buyer ? 'Pay on Paystack to lock it in' : 'Waiting for the buyer to pay on Paystack';
    case 'paid':
      return buyer ? 'The seller is preparing your item' : 'Mark it ready for pickup or delivery';
    case 'ready_for_pickup':
      return buyer ? 'Collect it, then confirm you received it' : 'Waiting for the buyer to confirm they received it';
    case 'shipped':
      return buyer ? 'Confirm when the parcel arrives' : 'Waiting for the buyer to confirm they received it';
    case 'buyer_confirmed':
    case 'completed':
      return 'Done — your receipt is below';
    case 'cancelled':
      return 'This order was cancelled';
    case 'disputed':
      return 'A problem was reported; support will follow up';
    default:
      return '';
  }
}
