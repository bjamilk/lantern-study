import React from 'react';
import { ShoppingBagIcon } from '@heroicons/react/24/outline';
import type { MarketplaceListing } from '../../types';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';

interface MarketplaceListingRailProps {
  title: string;
  icon?: React.ReactNode;
  listings: MarketplaceListing[];
  onPress: (listing: MarketplaceListing) => void;
}

export const MarketplaceListingRail: React.FC<MarketplaceListingRailProps> = ({
  title,
  icon,
  listings,
  onPress,
}) => {
  if (listings.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="text-xs sm:text-sm font-semibold text-lantern-text mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      <div className="max-w-full overflow-x-auto scrollbar-none">
        <div className="flex gap-3 pb-2 w-max pr-2">
          {listings.map((item) => {
            const price = resolveListingDisplayPrice(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onPress(item)}
                className="flex-shrink-0 w-28 sm:w-36 md:w-40 bg-lantern-surface rounded-lg sm:rounded-xl overflow-hidden ring-1 ring-lantern-border hover:ring-lantern-primary/30 transition-all text-left group"
              >
                <div className="aspect-[4/3] bg-lantern-background-secondary overflow-hidden relative">
                  {item.images && item.images.length > 0 ? (
                    <img
                      src={item.images[0]}
                      alt=""
                      className="w-full h-full max-w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ShoppingBagIcon className="w-6 h-6 text-lantern-text-tertiary" />
                    </div>
                  )}
                  {price.onSale ? (
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-lantern-error text-white text-[10px] font-semibold">
                      Deal
                    </span>
                  ) : null}
                </div>
                <div className="p-2">
                  <p className="text-xs font-semibold text-lantern-text line-clamp-1 group-hover:text-lantern-primary transition-colors">
                    {item.title}
                  </p>
                  <p className="text-sm font-bold text-lantern-primary">
                    {price.effective != null ? `₦${price.effective.toLocaleString()}` : 'Free'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
