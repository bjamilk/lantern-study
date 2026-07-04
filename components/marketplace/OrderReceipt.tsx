import React from 'react';
import { useToastStore } from '../../stores/toastStore';
import type { MarketplaceOrder } from '../types';

interface OrderReceiptProps {
  order: MarketplaceOrder;
  appName?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildOrderReceiptHtml(order: MarketplaceOrder, appName = 'Lantern Study'): string {
  const listingTitle = escapeHtml(order.listing?.title || 'Marketplace item');
  const buyerName = escapeHtml(order.buyer?.name || 'Buyer');
  const sellerName = escapeHtml(order.seller?.name || 'Seller');
  const orderId = escapeHtml(order.id);
  const status = escapeHtml(order.status.replace(/_/g, ' '));
  const fulfillment = escapeHtml(order.fulfillment_mode?.replace(/_/g, ' ') || 'campus meetup');
  const safeAppName = escapeHtml(appName);
  const completedAt = escapeHtml(
    order.completed_at
      ? new Date(order.completed_at).toLocaleString()
      : new Date(order.created_at).toLocaleString()
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${order.id.slice(0, 8)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 40px auto; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    .muted { color: #666; font-size: 0.875rem; }
    .amount { font-size: 1.75rem; font-weight: 700; margin: 1rem 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    td { padding: 0.5rem 0; border-bottom: 1px solid #eee; vertical-align: top; }
    td:first-child { color: #666; width: 38%; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>${safeAppName} Marketplace Receipt</h1>
  <p class="muted">Order #${orderId}</p>
  <p class="amount">₦${Number(order.amount).toLocaleString()}</p>
  <table>
    <tr><td>Item</td><td>${listingTitle}</td></tr>
    <tr><td>Buyer</td><td>${buyerName}</td></tr>
    <tr><td>Seller</td><td>${sellerName}</td></tr>
    <tr><td>Status</td><td>${status}</td></tr>
    <tr><td>Fulfillment</td><td>${fulfillment}</td></tr>
    <tr><td>Date</td><td>${completedAt}</td></tr>
    ${order.discount_amount ? `<tr><td>Discount</td><td>₦${Number(order.discount_amount).toLocaleString()}</td></tr>` : ''}
  </table>
  <p class="muted" style="margin-top: 2rem;">Keep this receipt for your records.</p>
</body>
</html>`;
}

export function printOrderReceipt(order: MarketplaceOrder): void {
  const html = buildOrderReceiptHtml(order);
  const win = window.open('', '_blank', 'width=640,height=720');
  if (!win) {
    useToastStore.getState().showToast('Allow pop-ups to print the receipt.', 'info');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

const OrderReceipt: React.FC<OrderReceiptProps> = ({ order }) => (
  <button
    type="button"
    onClick={() => printOrderReceipt(order)}
    className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
  >
    Download / print receipt
  </button>
);

export default OrderReceipt;
