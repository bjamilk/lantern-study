import React from 'react';
import { MarketplaceListing } from '../../types';
import { MapPinIcon, ClockIcon, StarIcon } from '@heroicons/react/24/outline';
import { HeartIcon } from '@heroicons/react/24/solid';
import { featureAccents } from '@lantern/shared/design';

export interface ListingCardProps {
  listing: MarketplaceListing;
  isFavorite: boolean;
  isOwner: boolean;
  categoryName: string;
  CategoryIcon: React.ComponentType<{ className?: string }>;
  onPress: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}

// Off-screen cards skip layout/paint work entirely; the intrinsic size keeps the
// scrollbar stable. Ignored by browsers without content-visibility support.
const cardRenderStyle: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 320px',
};

const ListingCardComponent: React.FC<ListingCardProps> = ({
  listing,
  isFavorite,
  isOwner,
  categoryName,
  CategoryIcon,
  onPress,
  onToggleFavorite,
}) => {
  const avgRating =
    listing.reviews && listing.reviews.length > 0
      ? listing.reviews.reduce((sum, r) => sum + r.rating, 0) / listing.reviews.length
      : 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  };

  return (
    <article
      style={cardRenderStyle}
      className={`min-w-0 rounded-lantern-xl shadow-lantern border overflow-hidden hover:shadow-lantern-md hover:scale-[1.02] active:scale-[0.99] transition-all duration-200 group focus-within:ring-2 focus-within:ring-lantern-primary ${
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
              <CategoryIcon className="w-10 h-10 text-lantern-text-tertiary" />
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleFavorite}
          className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 z-10 p-2 sm:p-1.5 bg-lantern-surface/90 backdrop-blur-sm rounded-lg hover:bg-lantern-surface transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <HeartIcon
            className={`w-4 h-4 ${isFavorite ? 'text-lantern-error fill-current' : 'text-lantern-text-tertiary'}`}
          />
        </button>

        <span
          className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 max-w-[calc(100%-3.5rem)] px-2 py-0.5 bg-lantern-surface/90 backdrop-blur-sm text-[10px] sm:text-xs font-medium rounded-md text-lantern-text flex items-center gap-1 shadow-sm pointer-events-none z-10"
          style={{ borderLeft: `2px solid ${featureAccents.marketplace}` }}
        >
          <CategoryIcon className="w-3 h-3 shrink-0" />
          <span className="truncate">{categoryName}</span>
        </span>

        {isOwner ? (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-lantern-primary/90 backdrop-blur-sm text-[10px] font-semibold rounded-md text-white shadow-sm pointer-events-none z-10">
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
        <h3 className="font-semibold text-xs sm:text-sm text-lantern-text mb-0.5 sm:mb-1 line-clamp-2 group-hover:text-lantern-primary transition-colors duration-150">
          {listing.title}
        </h3>

        <p className="hidden sm:block text-lantern-text-secondary text-xs mb-2 line-clamp-2 leading-relaxed">
          {listing.description}
        </p>

        <div className="flex items-center justify-between gap-2 mb-2">
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
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-lantern-error/10 text-lantern-error">
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
            <div className="flex items-center text-xs text-lantern-text-tertiary shrink-0">
              <StarIcon className="w-3.5 h-3.5 mr-0.5 text-amber-400 fill-current" />
              {avgRating.toFixed(1)}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3 text-[10px] sm:text-xs text-lantern-text-tertiary">
          {listing.location ? (
            <span className="flex items-center gap-0.5 truncate">
              <MapPinIcon className="w-3 h-3 shrink-0" />
              <span className="truncate">{listing.location}</span>
            </span>
          ) : null}
          {listing.created_at ? (
            <span className="flex items-center gap-0.5 shrink-0">
              <ClockIcon className="w-3 h-3" />
              {new Date(listing.created_at).toLocaleDateString()}
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
    prev.CategoryIcon === next.CategoryIcon
);
