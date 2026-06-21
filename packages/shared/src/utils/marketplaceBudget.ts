/**
 * Deterministic budget transaction IDs for marketplace sales.
 * Server upserts use these IDs so retries and client refresh stay idempotent.
 */

export const MARKETPLACE_BUDGET_CATEGORIES = {
  PURCHASE: 'marketplace_purchase',
  SALE: 'marketplace_sale',
} as const;

export const MARKETPLACE_BUDGET_TYPES = {
  PURCHASE: 'expense',
  SALE: 'income',
} as const;

const NAMESPACE_SEED = 'lantern-marketplace-budget-v1';

function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Portable deterministic UUID-shaped id from a seed string. */
export function deterministicBudgetTxId(seed: string): string {
  const a = fnv1a(`${NAMESPACE_SEED}:${seed}`).toString(16).padStart(8, '0');
  const b = fnv1a(`${seed}:${NAMESPACE_SEED}`).toString(16).padStart(8, '0');
  const c = fnv1a(seed).toString(16).padStart(8, '0');
  const d = fnv1a(`${seed}-d`).toString(16).padStart(8, '0');
  const hex = (a + b + c + d).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildMarketplaceBudgetTxIds(marketplaceTransactionId: string): {
  purchaseTxId: string;
  saleTxId: string;
} {
  return {
    purchaseTxId: deterministicBudgetTxId(`mp-purchase-${marketplaceTransactionId}`),
    saleTxId: deterministicBudgetTxId(`mp-sale-${marketplaceTransactionId}`),
  };
}

export function buildManualSaleBudgetTxId(listingId: string): string {
  return deterministicBudgetTxId(`mp-sale-manual-${listingId}`);
}

export function buildMarketplacePurchaseDescription(title: string): string {
  return `Purchased: ${title}`;
}

export function buildMarketplaceSaleDescription(title: string): string {
  return `Sold: ${title}`;
}
