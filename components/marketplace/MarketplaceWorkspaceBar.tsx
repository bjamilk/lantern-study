import React from 'react';
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from '../ui';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

export type MarketplaceWorkspaceSection =
  | 'browse'
  | 'orders'
  | 'cart'
  | 'purchases'
  | 'studyProducts'
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
  /**
   * `full` — chip row for seller/buyer workspace screens that are not already
   * sitting under Discover tabs.
   * `toolbar` — Sell + More only. Used on the Discover marketplace tab so
   * Orders/Cart/Selling do not compete with the listing grid.
   */
  variant?: 'full' | 'toolbar';
  /** Optional Pulse action shown in the toolbar overflow. */
  onPulse?: () => void;
  pulseActive?: boolean;
}

const navBtn = (active: boolean) =>
  `inline-flex items-center gap-1.5 shrink-0 h-9 min-h-[44px] sm:h-8 sm:min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors touch-manipulation ${
    active
      ? 'bg-lantern-primary text-white shadow-sm'
      : 'bg-lantern-background-secondary text-lantern-text-secondary hover:bg-lantern-border/50 hover:text-lantern-text'
  }`;

const iconBtn =
  'h-9 w-9 min-h-[36px] inline-flex items-center justify-center rounded-lg border border-lantern-border bg-lantern-surface text-lantern-text-secondary hover:border-lantern-primary/30 transition-colors';

type OverflowDest = {
  id: string;
  label: string;
  screen: string;
  icon: AppIconName;
};

const OVERFLOW_DESTINATIONS: OverflowDest[] = [
  { id: 'jobs', label: 'Jobs', screen: 'MarketplaceJobs', icon: 'briefcase' },
  { id: 'orders', label: 'Orders', screen: 'MarketplaceOrders', icon: 'receipt' },
  { id: 'cart', label: 'Cart', screen: 'MarketplaceCart', icon: 'cart' },
  { id: 'purchases', label: 'Purchases', screen: 'MarketplacePurchases', icon: 'albums' },
  { id: 'studyProducts', label: 'Study Products', screen: 'StudyProductDrafts', icon: 'sparkles' },
  { id: 'selling', label: 'Selling', screen: 'MyListings', icon: 'bag' },
  { id: 'inquiries', label: 'Inquiries', screen: 'MarketplaceInquiries', icon: 'chatbubble' },
];

/**
 * Compact CRM-style workspace nav for marketplace buyer/seller screens.
 * Keeps one primary Sell action; secondary destinations live as compact tabs
 * or, on the Discover marketplace tab, inside a More menu.
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
  variant = 'full',
  onPulse,
  pulseActive = false,
}) => {
  const overflowItems = guestMode
    ? OVERFLOW_DESTINATIONS.filter((item) => item.id === 'jobs')
    : [
        ...OVERFLOW_DESTINATIONS,
        ...(showFavorites
          ? [
              {
                id: 'favorites',
                label: 'Saved',
                screen: 'MarketplaceFavorites',
                icon: 'heart' as const,
              },
            ]
          : []),
      ];

  const toolbarMenu = (
    <Menu>
      <MenuTrigger aria-label="More marketplace tools" className={iconBtn}>
        <AppIcon name="ellipsis-horizontal" size={16} />
      </MenuTrigger>
      <MenuContent align="end" className="w-56">
        {overflowItems.map((item) => (
          <MenuItem
            key={item.id}
            onSelect={() => onNavigate(item.screen)}
            icon={<AppIcon name={item.icon} size={16} />}
          >
            {item.label}
          </MenuItem>
        ))}
        {onPulse ? (
          <MenuItem
            onSelect={onPulse}
            icon={<AppIcon name="bar-chart" size={16} />}
          >
            {pulseActive ? 'Hide pulse' : 'Marketplace pulse'}
          </MenuItem>
        ) : null}
        {moreItems.length > 0 ? <MenuSeparator /> : null}
        {moreItems.map((item) => (
          <MenuItem key={item.id} onSelect={item.onSelect} icon={item.icon}>
            {item.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );

  const sellerToolsMenu =
    moreItems.length > 0 ? (
      <Menu>
        <MenuTrigger aria-label="More marketplace tools" className={iconBtn}>
          <AppIcon name="ellipsis-horizontal" size={16} />
        </MenuTrigger>
        <MenuContent align="end" className="w-48">
          {moreItems.map((item) => (
            <MenuItem key={item.id} onSelect={item.onSelect} icon={item.icon}>
              {item.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    ) : null;

  const sellButton = onSell ? (
    <button
      type="button"
      onClick={onSell}
      className="h-9 min-h-[36px] sm:h-8 px-2.5 sm:px-3 rounded-lg bg-lantern-primary text-white text-xs sm:text-sm font-semibold hover:bg-lantern-primary-dark transition-colors inline-flex items-center gap-1"
      aria-label={primaryLabel}
    >
      <AppIcon name="add" size={14} aria-hidden />
      <span className="hidden sm:inline">{primaryLabel}</span>
    </button>
  ) : null;

  if (guestMode) {
    return (
      <div
        className={`flex items-center justify-end gap-1.5 ${className}`}
        role="navigation"
        aria-label="Marketplace workspace"
      >
        {variant === 'toolbar' ? toolbarMenu : (
          <span className={navBtn(true)}>
            <AppIcon name="search" size={14} className="shrink-0" aria-hidden />
            <span className="truncate">Browse</span>
          </span>
        )}
        {variant === 'full' ? (
          <button
            type="button"
            onClick={() => onSignInRequired?.()}
            className="h-9 min-h-[36px] sm:h-8 px-3 rounded-lg bg-lantern-primary text-white text-xs sm:text-sm font-semibold hover:bg-lantern-primary-dark transition-colors"
          >
            Sign in
          </button>
        ) : null}
      </div>
    );
  }

  if (variant === 'toolbar') {
    return (
      <div
        className={`flex items-center gap-1.5 shrink-0 ${className}`}
        role="navigation"
        aria-label="Marketplace workspace"
      >
        {toolbarMenu}
        {sellButton}
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
          <AppIcon name="search" size={14} className="shrink-0" aria-hidden />
          <span>Goods</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceJobs')}
          className={navBtn(false)}
          aria-label="Jobs"
        >
          <span>Jobs</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceOrders')}
          className={navBtn(active === 'orders')}
          aria-current={active === 'orders' ? 'page' : undefined}
          aria-label="Orders"
        >
          <AppIcon name="receipt" size={14} className="shrink-0" aria-hidden />
          <span>Orders</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceCart')}
          className={navBtn(active === 'cart')}
          aria-current={active === 'cart' ? 'page' : undefined}
          aria-label="Cart"
        >
          <AppIcon name="cart" size={14} className="shrink-0" aria-hidden />
          <span>Cart</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplacePurchases')}
          className={navBtn(active === 'purchases')}
          aria-current={active === 'purchases' ? 'page' : undefined}
          aria-label="Purchases"
        >
          <AppIcon name="albums" size={14} className="shrink-0" aria-hidden />
          <span>Purchases</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('StudyProductDrafts')}
          className={navBtn(active === 'studyProducts')}
          aria-current={active === 'studyProducts' ? 'page' : undefined}
          aria-label="Study Products"
        >
          <AppIcon name="sparkles" size={14} className="shrink-0" aria-hidden />
          <span>Study Products</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MyListings')}
          className={navBtn(active === 'selling')}
          aria-current={active === 'selling' ? 'page' : undefined}
          aria-label="Selling"
        >
          <AppIcon name="bag" size={14} className="shrink-0" aria-hidden />
          <span>Selling</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('MarketplaceInquiries')}
          className={navBtn(active === 'inquiries')}
          aria-current={active === 'inquiries' ? 'page' : undefined}
          aria-label="Inquiries"
        >
          <AppIcon name="chatbubble" size={14} className="shrink-0" aria-hidden />
          <span>Inquiries</span>
        </button>
        {showFavorites ? (
          <button
            type="button"
            onClick={() => onNavigate('MarketplaceFavorites')}
            className={navBtn(active === 'favorites')}
            aria-current={active === 'favorites' ? 'page' : undefined}
            aria-label="Favorites"
          >
            <AppIcon name="heart" size={14} className="shrink-0" aria-hidden />
            <span className="truncate hidden sm:inline">Saved</span>
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {sellerToolsMenu}
        {sellButton}
      </div>
    </div>
  );
};

export default MarketplaceWorkspaceBar;
