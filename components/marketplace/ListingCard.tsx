import React from 'react';
import { MarketplaceListing } from '../../types';
import { featureAccents } from '@lantern/shared/design';
import { shouldShowTrustChip, trustLabel } from '@lantern/shared/network';
import { listingConditionLabel, listingTypeLabel, lowStockLabel } from '@lantern/shared/marketplace';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export interface ListingCardProps {
  listing: MarketplaceListing;
  isFavorite: boolean;
  isOwner: boolean;
  categoryName: string;
  categoryIcon: AppIconName;
  onPress: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
  viewerCampusId?: string | null;
}

// Off-screen cards skip layout/paint work entirely; the intrinsic size keeps the
// scrollbar stable. Ignored by browsers without content-visibility support.
const cardRenderStyle: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 280px',
};

// Values written by the create flow are hyphenated; underscore variants are the
// API's Joi enum. Accept both so the chip labels correctly whichever is present.
/** Compact "posted X ago" freshness, mirroring Jiji/Vinted tiles. */
const formatPostedAge = (iso?: string): string => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return 'Just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const ListingCardComponent: React.FC<ListingCardProps> = ({
  listing,
  isFavorite,
  isOwner,
  categoryName,
  categoryIcon,
  onPress,
  onToggleFavorite,
  viewerCampusId,
}) => {
  // Prefer the trigger-maintained aggregate (present on browse rows once the
  // ratings migration is live); fall back to counting an embedded review list
  // for payloads that still carry one. No data → no stars.
  const aggregateCount =
    typeof listing.rating_count === 'number' ? listing.rating_count : 0;
  const avgRating =
    aggregateCount > 0 && listing.rating_avg != null
      ? Number(listing.rating_avg)
      : listing.reviews && listing.reviews.length > 0
        ? listing.reviews.reduce((sum, r) => sum + r.rating, 0) / listing.reviews.length
        : 0;
  const ratingCount =
    aggregateCount > 0 ? aggregateCount : listing.reviews?.length ?? 0;

  const typeLabel = listingTypeLabel(listing, categoryName);
  const conditionLabel = listingConditionLabel(listing);
  const postedAge = formatPostedAge(listing.created_at);
  const stockLabel = lowStockLabel(listing.quantity);
  const sameCampus = Boolean(viewerCampusId && listing.campus_id && viewerCampusId === listing.campus_id);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  };

  return (
    <article
      style={cardRenderStyle}
      className={`min-w-0 rounded-lantern-xl shadow-lantern border overflow-hidden hover:shadow-lantern-md md:hover:scale-[1.02] active:scale-[0.99] transition-all duration-200 group focus-within:ring-2 focus-within:ring-lantern-primary ${
        isOwner
          ? 'bg-lantern-primary-background border-lantern-primary/30'
          : 'bg-lantern-surface border-lantern-border hover:border-lantern-primary/30'
      }`}
    >
      <div className="relative aspect-[16/10] sm:aspect-[4/3] bg-lantern-background-secondary overflow-hidden">
        <button
          type="button"
          onClick={onPress}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 z-0 w-full h-full cursor-pointer focus:outline-none"
          aria-label={`View listing: ${listing.title}`}
        >
          {listing.images && listing.images.length > 0 ? (
            <img
              src={listing.images[0]}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full max-w-full object-cover group-hover:scale-105 transition-transform duration-300 pointer-events-none"
              onError={e => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center pointer-events-none">
              <AppIcon name={categoryIcon} size={40} className="text-lantern-text-tertiary" />
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleFavorite}
          className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 z-10 p-2 sm:p-1.5 bg-lantern-surface/90 backdrop-blur-sm rounded-lg hover:bg-lantern-surface transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <AppIcon
            name="heart"
            size={16}
            filled
            className={isFavorite ? 'text-lantern-error' : 'text-lantern-text-tertiary'}
          />
        </button>

        <span
          className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 max-w-[calc(100%-3.5rem)] px-2 py-0.5 bg-lantern-surface/90 backdrop-blur-sm text-label tracking-normal sm:text-caption font-medium rounded-md text-lantern-text flex items-center gap-1 shadow-sm pointer-events-none z-10"
          style={{ borderLeft: `2px solid ${featureAccents.marketplace}` }}
        >
          <AppIcon name={categoryIcon} size={12} className="shrink-0" />
          <span className="truncate">{typeLabel}</span>
        </span>

        {listing.is_on_sale && !isOwner ? (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-lantern-error-strong text-label tracking-normal font-semibold rounded-md text-white shadow-sm pointer-events-none z-10">
            {listing.promo_label || 'Deal'}
          </span>
        ) : null}

        {listing.status === 'reserved' ? (
          <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-amber-500/95 text-label tracking-normal font-semibold rounded-md text-white shadow-sm pointer-events-none z-10">
            Sale in progress
          </span>
        ) : null}

        {isOwner ? (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-lantern-primary/90 backdrop-blur-sm text-label tracking-normal font-semibold rounded-md text-white shadow-sm pointer-events-none z-10">
            Your Listing
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onPress}
        onKeyDown={handleKeyDown}
        className="w-full p-2 sm:p-3 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lantern-primary"
      >
        <h3 className="font-semibold text-xs sm:text-sm text-lantern-text mb-1 line-clamp-1 group-hover:text-lantern-primary transition-colors duration-150">
          {listing.title}
        </h3>

        {/* Phase 3 N: the server attaches seller trust to every browse row, but
            no card rendered it — so the signal existed and was invisible.
            'new' shows nothing on purpose: labelling every newcomer reads as a
            warning and punishes exactly the people we want publishing. */}
        {shouldShowTrustChip((listing.seller as { trustLevel?: string } | undefined)?.trustLevel) && (
          <span className="mb-1 inline-block rounded-full bg-lantern-primary/10 px-1.5 py-0.5 text-label tracking-normal font-medium text-lantern-primary">
            {trustLabel((listing.seller as { trustLevel?: string } | undefined)?.trustLevel)}
          </span>
        )}

        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-base sm:text-lg font-bold text-lantern-primary truncate">
            {listing.is_on_sale && listing.effective_price != null ? (
              <>
                <span className="line-through text-lantern-text-tertiary text-xs mr-1">
                  ₦{Number(listing.price).toLocaleString()}
                </span>
                <span className="text-lantern-error font-bold">
                  ₦{Number(listing.effective_price).toLocaleString()}
                </span>
                {listing.promo_label ? (
                  <span className="ml-1 text-label tracking-normal px-1.5 py-0.5 rounded-full bg-lantern-error/10 text-lantern-error">
                    {listing.promo_label}
                  </span>
                ) : null}
              </>
            ) : listing.price ? (
              `₦${listing.price.toLocaleString()}`
            ) : (
              'Free'
            )}
          </span>
          {avgRating > 0 ? (
            <div
              className="flex items-center text-xs text-lantern-text-tertiary shrink-0"
              aria-label={`Rated ${avgRating.toFixed(1)} out of 5 from ${ratingCount} review${ratingCount === 1 ? '' : 's'}`}
            >
              <AppIcon name="star" size={14} className="mr-0.5 text-amber-400 fill-current" />
              {avgRating.toFixed(1)}
              {ratingCount > 0 ? <span className="ml-0.5">({ratingCount})</span> : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 min-w-0 text-label tracking-normal sm:text-caption text-lantern-text-tertiary">
          {conditionLabel ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-lantern-background-secondary text-lantern-text-secondary font-medium">
              {conditionLabel}
            </span>
          ) : null}
          {sameCampus ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium">
              Your campus
            </span>
          ) : null}
          {stockLabel ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 font-medium">
              {stockLabel}
            </span>
          ) : null}
          {listing.location ? (
            <span className="flex items-center gap-0.5 truncate min-w-0">
              <AppIcon name="location" size={12} className="shrink-0" />
              <span className="truncate">{listing.location}</span>
            </span>
          ) : null}
          {postedAge ? (
            <span className="flex items-center gap-0.5 shrink-0 ml-auto">
              <AppIcon name="time" size={12} />
              {postedAge}
            </span>
          ) : null}
        </div>
      </button>
    </article>
  );
};

/**
 * Memoized against data props only. The grid passes fresh inline handlers each
 * render, but they close over the same listing object, so skipping re-render
 * when the data props are unchanged is safe.
 */
export const ListingCard = React.memo(
  ListingCardComponent,
  (prev, next) =>
    prev.listing === next.listing &&
    prev.isFavorite === next.isFavorite &&
    prev.isOwner === next.isOwner &&
    prev.categoryName === next.categoryName &&
    prev.categoryIcon === next.categoryIcon &&
    prev.viewerCampusId === next.viewerCampusId
);
