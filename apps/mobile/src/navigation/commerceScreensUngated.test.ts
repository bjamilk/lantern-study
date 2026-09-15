/**
 * Every Shop and Jobs screen renders for every account (V1, 2026-09-15).
 *
 * Until this change, 30 commerce and jobs screens were registered through
 * `withMarketplaceGate`, a HOC that read the marketplace store's private-pilot
 * answer and rendered a "private pilot" wall for anyone outside the founder's
 * allowlist — and a "couldn't check" wall for anyone whose probe failed. The
 * allowlist is gone and so is the HOC.
 *
 * This is a SOURCE assertion rather than a render one on purpose: the failure
 * mode it guards is a screen being re-wrapped at registration, which no
 * screen-level test can see (each wrapped screen still renders perfectly for
 * the one account that passes). Rendering the whole navigator under jest would
 * need the full native stack; reading what it registers costs nothing and
 * catches exactly the regression that matters.
 */
import fs from 'fs';
import path from 'path';

const NAVIGATOR = path.join(__dirname, 'RootNavigator.tsx');
const CAMPUS_SCREEN = path.join(__dirname, '..', 'screens', 'campus', 'CampusScreen.tsx');

describe('commerce screens are registered ungated', () => {
  it('has no MarketplaceGate module left to wrap a screen with', () => {
    expect(
      fs.existsSync(path.join(__dirname, '..', 'screens', 'marketplace', 'MarketplaceGate.tsx'))
    ).toBe(false);
  });

  it('registers no screen through an access-gate HOC', () => {
    for (const file of [NAVIGATOR, CAMPUS_SCREEN]) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toContain('withMarketplaceGate');
      expect(src).not.toContain('MarketplaceGate');
    }
  });

  it('still registers the commerce and jobs screens themselves', () => {
    const src = fs.readFileSync(NAVIGATOR, 'utf8');
    for (const screen of [
      'ShopBrowseScreen',
      'ListingDetailScreen',
      'CartScreen',
      'CheckoutScreen',
      'OffersScreen',
      'OrdersScreen',
      'CreateListingScreen',
      'MyListingsScreen',
      'SellerPayoutScreen',
      'JobDetailScreen',
      'CreateJobScreen',
    ]) {
      // Registered as the component itself, not as a Gated* alias.
      expect(src).toContain(screen);
      expect(src).not.toContain(`Gated${screen.replace(/Screen$/, '')}`);
    }
  });
});
