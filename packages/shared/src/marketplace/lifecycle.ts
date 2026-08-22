/**
 * Which status changes a seller may make to their own listing, and which belong
 * to moderation or to the order lifecycle. Shared so the buttons a client
 * offers, the transitions the API accepts, and the database trigger
 * (supabase/migrations/20260822120000_marketplace_listings_moderation_lock.sql)
 * cannot disagree. Mirrors ../jobs/lifecycle.ts for job postings.
 */
import type { MarketplaceListing } from '../types';

export type MarketplaceListingStatus = MarketplaceListing['status'];

export const MARKETPLACE_LISTING_STATUSES: readonly MarketplaceListingStatus[] = [
  'active',
  'inactive',
  'sold',
  'reserved',
  'archived',
  'suspended_by_admin',
  'removed_by_admin',
];

export function isMarketplaceListingStatus(
  value: unknown,
): value is MarketplaceListingStatus {
  return (
    typeof value === 'string' &&
    (MARKETPLACE_LISTING_STATUSES as readonly string[]).includes(value)
  );
}

/** Set by moderation only. A seller can never enter or leave these. */
export const MARKETPLACE_MODERATED_LISTING_STATUSES: readonly MarketplaceListingStatus[] = [
  'suspended_by_admin',
  'removed_by_admin',
];

export function isMarketplaceListingModerated(
  status: MarketplaceListingStatus,
): boolean {
  return MARKETPLACE_MODERATED_LISTING_STATUSES.includes(status);
}

/** Transitions a seller may perform, keyed by the listing's current status. */
const SELLER_TRANSITIONS: Record<
  MarketplaceListingStatus,
  readonly MarketplaceListingStatus[]
> = {
  active: ['inactive', 'sold'],
  inactive: ['active', 'sold'],
  sold: ['active', 'inactive'],
  // Held by an open order; the order lifecycle releases it, not the seller.
  reserved: [],
  // Deleted while order history existed; not revivable from the seller side.
  archived: [],
  suspended_by_admin: [],
  removed_by_admin: [],
};

export function canSellerSetListingStatus(
  from: MarketplaceListingStatus,
  to: MarketplaceListingStatus,
): boolean {
  if (from === to) return true;
  return SELLER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Content edits are blocked once moderation has taken the listing down. */
export function isMarketplaceListingEditable(
  status: MarketplaceListingStatus,
): boolean {
  return !isMarketplaceListingModerated(status);
}

export const MARKETPLACE_LISTING_STATUS_LABELS: Record<
  MarketplaceListingStatus,
  string
> = {
  active: 'Active',
  inactive: 'Inactive',
  sold: 'Sold',
  reserved: 'Sale in progress',
  archived: 'Archived',
  suspended_by_admin: 'Suspended by Lantern',
  removed_by_admin: 'Removed by Lantern',
};

/** Seller-facing explanation of a moderated state; null when not moderated. */
export function marketplaceListingModerationNotice(
  status: MarketplaceListingStatus,
): string | null {
  switch (status) {
    case 'suspended_by_admin':
      return 'Hidden from buyers while Lantern reviews it. It cannot be changed until it is restored.';
    case 'removed_by_admin':
      return 'Removed by Lantern moderation and hidden from buyers. It cannot be edited or relisted.';
    default:
      return null;
  }
}

/**
 * Why a seller-initiated transition is refused, written for the seller; null
 * when the transition is allowed. The API returns this verbatim (HTTP 403).
 */
export function sellerListingTransitionError(
  from: MarketplaceListingStatus,
  to: MarketplaceListingStatus,
): string | null {
  if (canSellerSetListingStatus(from, to)) return null;
  if (isMarketplaceListingModerated(from)) {
    return from === 'removed_by_admin'
      ? 'This listing was removed by Lantern moderation and cannot be relisted or changed.'
      : 'This listing is suspended by Lantern moderation and cannot be changed until it is restored.';
  }
  if (isMarketplaceListingModerated(to)) {
    return 'Only Lantern moderation can set that status.';
  }
  if (from === 'reserved') {
    return 'A sale is in progress on this listing. Manage it from Orders.';
  }
  if (from === 'archived') {
    return 'This listing was deleted and cannot be relisted. Create a new listing instead.';
  }
  const fromLabel = MARKETPLACE_LISTING_STATUS_LABELS[from].toLowerCase();
  const article = /^[aeiou]/.test(fromLabel) ? 'An' : 'A';
  return `${article} ${fromLabel} listing cannot be changed to ${MARKETPLACE_LISTING_STATUS_LABELS[to].toLowerCase()}.`;
}
