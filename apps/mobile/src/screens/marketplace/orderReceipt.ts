import type { MarketplaceOrder } from '@lantern/shared/types';
import { formatPrice } from './marketplaceHelpers';

export function buildOrderReceiptText(order: MarketplaceOrder): string {
  const listingTitle = order.listing?.title || 'Marketplace item';
  const buyerName = order.buyer?.name || 'Buyer';
  const sellerName = order.seller?.name || 'Seller';
  const completedAt = order.completed_at
    ? new Date(order.completed_at).toLocaleString()
    : new Date(order.created_at).toLocaleString();

  const qty = Math.max(1, Number(order.quantity) || 1);
  const lines = [
    'Lantern Study Marketplace Receipt',
    `Order: ${order.id}`,
    `Item: ${listingTitle}`,
    `Quantity: ${qty}`,
    ...(qty > 1
      ? [`Unit price: ${formatPrice(Number(order.amount) / qty)}`]
      : []),
    `Amount: ${formatPrice(Number(order.amount))}`,
    `Buyer: ${buyerName}`,
    `Seller: ${sellerName}`,
    `Status: ${order.status.replace(/_/g, ' ')}`,
    `Date: ${completedAt}`,
  ];
  if (order.discount_amount) {
    lines.push(`Discount: ${formatPrice(Number(order.discount_amount))}`);
  }
  lines.push('', 'Keep this receipt for your records.');
  return lines.join('\n');
}
