import {
  canSellerSetListingStatus,
  isMarketplaceListingEditable,
  isMarketplaceListingModerated,
  isMarketplaceListingStatus,
  MARKETPLACE_LISTING_STATUSES,
  MARKETPLACE_LISTING_STATUS_LABELS,
  MARKETPLACE_MODERATED_LISTING_STATUSES,
  marketplaceListingModerationNotice,
  sellerListingTransitionError,
} from './lifecycle';

describe('marketplace listing lifecycle transitions', () => {
  it('lets a seller deactivate, relist, and mark sold', () => {
    expect(canSellerSetListingStatus('active', 'inactive')).toBe(true);
    expect(canSellerSetListingStatus('active', 'sold')).toBe(true);
    expect(canSellerSetListingStatus('inactive', 'active')).toBe(true);
    expect(canSellerSetListingStatus('inactive', 'sold')).toBe(true);
    expect(canSellerSetListingStatus('sold', 'active')).toBe(true);
    expect(canSellerSetListingStatus('sold', 'inactive')).toBe(true);
  });

  it('treats a no-op transition as allowed', () => {
    for (const status of MARKETPLACE_LISTING_STATUSES) {
      expect(canSellerSetListingStatus(status, status)).toBe(true);
    }
  });

  it('never lets a seller set a moderated status', () => {
    for (const from of ['active', 'inactive', 'sold'] as const) {
      for (const to of MARKETPLACE_MODERATED_LISTING_STATUSES) {
        expect(canSellerSetListingStatus(from, to)).toBe(false);
      }
    }
  });

  it('never lets a seller escape moderation', () => {
    for (const from of MARKETPLACE_MODERATED_LISTING_STATUSES) {
      for (const to of MARKETPLACE_LISTING_STATUSES) {
        if (to === from) continue;
        expect(canSellerSetListingStatus(from, to)).toBe(false);
      }
    }
  });

  it('keeps reserved and archived listings out of the seller\'s hands', () => {
    for (const to of MARKETPLACE_LISTING_STATUSES) {
      if (to !== 'reserved') {
        expect(canSellerSetListingStatus('reserved', to)).toBe(false);
      }
      if (to !== 'archived') {
        expect(canSellerSetListingStatus('archived', to)).toBe(false);
      }
    }
    // Archiving is the delete path's job, never a seller status edit.
    expect(canSellerSetListingStatus('active', 'archived')).toBe(false);
  });

  it('blocks content edits only on moderated listings', () => {
    expect(isMarketplaceListingEditable('active')).toBe(true);
    expect(isMarketplaceListingEditable('inactive')).toBe(true);
    expect(isMarketplaceListingEditable('sold')).toBe(true);
    expect(isMarketplaceListingEditable('reserved')).toBe(true);
    expect(isMarketplaceListingEditable('suspended_by_admin')).toBe(false);
    expect(isMarketplaceListingEditable('removed_by_admin')).toBe(false);
    expect(isMarketplaceListingModerated('removed_by_admin')).toBe(true);
    expect(isMarketplaceListingModerated('sold')).toBe(false);
  });

  it('explains refusals in seller language and returns null when allowed', () => {
    expect(sellerListingTransitionError('inactive', 'active')).toBeNull();
    expect(sellerListingTransitionError('removed_by_admin', 'active')).toMatch(
      /removed by Lantern moderation/,
    );
    expect(sellerListingTransitionError('suspended_by_admin', 'active')).toMatch(
      /suspended by Lantern moderation/,
    );
    expect(sellerListingTransitionError('active', 'removed_by_admin')).toMatch(
      /Only Lantern moderation/,
    );
    expect(sellerListingTransitionError('reserved', 'active')).toMatch(
      /sale is in progress/i,
    );
    expect(sellerListingTransitionError('archived', 'active')).toMatch(
      /deleted/,
    );
    expect(sellerListingTransitionError('active', 'archived')).toBe(
      'An active listing cannot be changed to archived.',
    );
  });

  it('recognises every status in the shared union and labels each one', () => {
    for (const status of MARKETPLACE_LISTING_STATUSES) {
      expect(isMarketplaceListingStatus(status)).toBe(true);
      expect(MARKETPLACE_LISTING_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(isMarketplaceListingStatus('draft')).toBe(false);
    expect(isMarketplaceListingStatus(undefined)).toBe(false);
    expect(isMarketplaceListingStatus(42)).toBe(false);
  });

  it('has a moderation notice only for moderated states', () => {
    expect(marketplaceListingModerationNotice('removed_by_admin')).toMatch(/hidden from buyers/i);
    expect(marketplaceListingModerationNotice('suspended_by_admin')).toMatch(/restored/);
    expect(marketplaceListingModerationNotice('active')).toBeNull();
    expect(marketplaceListingModerationNotice('reserved')).toBeNull();
  });
});
