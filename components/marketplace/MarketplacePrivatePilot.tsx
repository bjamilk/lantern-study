import React from 'react';
import { LockClosedIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import { AppMode } from '../../types';

/**
 * Marketplace private pilot (2026-08-29): the goods marketplace is available
 * only to allowlisted accounts while it is piloted. The API enforces this
 * with 403s (code MARKETPLACE_PRIVATE); this panel is the honest UI those
 * accounts-without-access see instead of broken screens. Jobs, Discover,
 * creator profiles and every study feature stay open.
 */

/** Every goods-commerce AppMode the pilot gate covers. Jobs modes stay open. */
export const GOODS_MARKETPLACE_MODES: ReadonlySet<AppMode> = new Set([
  AppMode.MARKETPLACE,
  AppMode.MARKETPLACE_LISTING_DETAIL,
  AppMode.CREATE_MARKETPLACE_LISTING,
  AppMode.MY_LISTINGS,
  AppMode.MARKETPLACE_PURCHASES,
  AppMode.STUDY_PRODUCT_DRAFTS,
  AppMode.MARKETPLACE_FAVORITES,
  AppMode.MARKETPLACE_INQUIRIES,
  AppMode.MARKETPLACE_ORDERS,
  AppMode.MARKETPLACE_CART,
  AppMode.MARKETPLACE_ORDER_DETAIL,
  AppMode.SELLER_CUSTOMERS,
  AppMode.SELLER_PROFILE,
  AppMode.SEMESTER_PRODUCTS,
]);

interface MarketplacePrivatePilotProps {
  /** Access is still being checked — show a quiet placeholder, not the pitch. */
  checking?: boolean;
  /**
   * The probe could not reach the API. This is NOT a denial, and saying
   * "private pilot" here blames the account for an outage.
   */
  unavailable?: boolean;
  onRetry?: () => void;
  onBack: () => void;
  backLabel?: string;
  /** Guests get a sign-in CTA alongside the explanation. */
  onSignIn?: () => void;
}

export const MarketplacePrivatePilot: React.FC<MarketplacePrivatePilotProps> = ({
  checking = false,
  unavailable = false,
  onRetry,
  onBack,
  backLabel = 'Back to Dashboard',
  onSignIn,
}) => (
  <div className="flex-1 flex items-center justify-center p-6 bg-lantern-background">
    <div className="max-w-md w-full text-center">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-lantern-primary-background dark:bg-lantern-primary-dark/30 flex items-center justify-center mb-5 relative">
        <ShoppingBagIcon className="w-8 h-8 text-lantern-primary" aria-hidden />
        <span className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-lantern-surface ring-1 ring-lantern-border flex items-center justify-center">
          <LockClosedIcon className="w-4 h-4 text-lantern-text-secondary" aria-hidden />
        </span>
      </div>
      {checking ? (
        <p className="text-sm text-lantern-text-secondary" role="status">
          Checking marketplace availability…
        </p>
      ) : unavailable ? (
        <>
          <h1 className="text-xl font-bold text-lantern-text mb-2">
            Couldn’t check the marketplace
          </h1>
          <p className="text-sm text-lantern-text-secondary mb-6">
            We couldn’t reach Lantern to confirm your access. This is a
            connection problem, not something about your account.
          </p>
          <div className="flex flex-col items-center gap-2">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="px-5 py-2.5 rounded-xl bg-lantern-primary hover:bg-lantern-primary-dark text-white text-sm font-semibold transition-colors"
              >
                Try again
              </button>
            ) : null}
            <button
              type="button"
              onClick={onBack}
              className="px-5 py-2 text-sm font-medium text-lantern-primary hover:underline"
            >
              {backLabel}
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-lantern-text mb-2">
            The marketplace is in a private pilot
          </h1>
          <p className="text-sm text-lantern-text-secondary mb-6">
            Buying and selling study materials is being tested with a small group
            right now. It will open up campus by campus — you’ll see it here the
            moment it’s available on your account. Everything else in Lantern is
            yours to use in the meantime.
          </p>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="px-5 py-2.5 rounded-xl bg-lantern-primary hover:bg-lantern-primary-dark text-white text-sm font-semibold transition-colors"
            >
              {backLabel}
            </button>
            {onSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className="px-5 py-2 text-sm font-medium text-lantern-primary hover:underline"
              >
                Sign in
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  </div>
);

export default MarketplacePrivatePilot;
