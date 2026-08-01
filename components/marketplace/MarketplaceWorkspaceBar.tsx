import React from 'react';
import {
  MagnifyingGlassIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  ChatBubbleLeftIcon,
  ReceiptPercentIcon,
  PlusIcon,
  HeartIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '../ui';

export type MarketplaceWorkspaceSection =
  | 'browse'
  | 'orders'
  | 'cart'
  | 'selling'
  | 'inquiries'
  | 'favorites';

export interface MarketplaceWorkspaceBarProps {
  active: MarketplaceWorkspaceSection;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onSell?: () => void;
  guestMode?: boolean;
  onSignInRequired?: () => void;
  /** Extra overflow actions for seller tools (campaign, coupons, etc.). */
  moreItems?: Array<{
    id: string;
    label: string;
    onSelect: () => void;
    icon?: React.ReactNode;
  }>;
  primaryLabel?: string;
  className?: string;
  showFavorites?: boolean;
}

const navBtn = (active: boolean) =>
  `inline-flex items-center gap-1.5 shrink-0 h-9 min-h-[44px] sm:h-8 sm:min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors touch-manipulation ${
    active
      ? 'bg-lantern-primary text-white shadow-sm'
      : 'bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border/50 hover:text-lantern-text'
  }`;

/**
 * Compact CRM-style workspace nav for marketplace buyer/seller screens.
 * Keeps one primary Sell action; secondary destinations live as compact tabs.
 */
export const MarketplaceWorkspaceBar: React.FC<MarketplaceWorkspaceBarProps> = ({
  active,
  onNavigate,
  onSell,
  guestMode = false,
  onSignInRequired,
  moreItems = [],
  primaryLabel = 'Sell',
  className = '',
  showFavorites = false,
}) => {
  if (guestMode) {
    return (
      <div
        className={`flex items-center justify-between gap-2 ${className}`}
        role="navigation"
        aria-label="Marketplace workspace"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={navBtn(true)}>
            <MagnifyingGlassIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="truncate">Browse</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => onSignInRequired?.()}
          className="h-9 min-h-[44px] sm:h-8 sm:min-h-[36px] px-3 rounded-lg bg-lantern-primary text-white text-xs sm:text-sm font-semibold hover:bg-lantern-primary-dark transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 sm:gap-2 min-w-0 ${className}`}
      role="navigation"
      aria-label="Marketplace workspace"
    >
      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 overflow-x-auto overscroll-x-contain scrollbar-none touch-pan-x">
        <button
          type="button"
          onClick={() => onNavigate('Marketplace')}
          className={navBtn(active === 'browse')}
          aria-current={active === 'browse' ? 'page' : undefined}
        >
          <MagnifyingGlassIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span>Goods</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceJobs')}
          className={navBtn(false)}
        >
          <span>Jobs</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceOrders')}
          className={navBtn(active === 'orders')}
          aria-current={active === 'orders' ? 'page' : undefined}
        >
          <ReceiptPercentIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span>Orders</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceCart')}
          className={navBtn(active === 'cart')}
          aria-current={active === 'cart' ? 'page' : undefined}
        >
          <ShoppingCartIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span>Cart</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MyListings')}
          className={navBtn(active === 'selling')}
          aria-current={active === 'selling' ? 'page' : undefined}
        >
          <ShoppingBagIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span>Selling</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceInquiries')}
          className={navBtn(active === 'inquiries')}
          aria-current={active === 'inquiries' ? 'page' : undefined}
        >
          <ChatBubbleLeftIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Inquiries</span>
          <span className="sm:hidden">Offers</span>
        </button>
        {showFavorites ? (
          <button
            type="button"
            onClick={() => onNavigate('MarketplaceFavorites')}
            className={navBtn(active === 'favorites')}
            aria-current={active === 'favorites' ? 'page' : undefined}
            aria-label="Favorites"
          >
            <HeartIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="truncate hidden sm:inline">Saved</span>
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {moreItems.length > 0 ? (
          <Menu>
            <MenuTrigger
              aria-label="More marketplace tools"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-lantern-border bg-lantern-surface text-lantern-text-secondary hover:border-lantern-primary/30 transition-colors"
            >
              <EllipsisHorizontalIcon className="w-4 h-4" />
            </MenuTrigger>
            <MenuContent align="end" className="w-48">
              {moreItems.map(item => (
                <MenuItem key={item.id} onSelect={item.onSelect} icon={item.icon}>
                  {item.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : null}
        {onSell ? (
          <button
            type="button"
            onClick={onSell}
            className="h-9 min-h-[44px] sm:h-8 sm:min-h-[36px] px-2.5 sm:px-3 rounded-lg bg-lantern-primary text-white text-xs sm:text-sm font-semibold hover:bg-lantern-primary-dark transition-colors inline-flex items-center gap-1"
            aria-label={primaryLabel}
          >
            <PlusIcon className="w-3.5 h-3.5" aria-hidden />
            <span className="hidden sm:inline">{primaryLabel}</span>
            <span className="sm:hidden">Sell</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default MarketplaceWorkspaceBar;
