import React, { Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { parseAppRoute } from '../../utils/appRoutes';
import { AppMode } from '../../types';
import { Button, LanternIcon } from '../ui';
import { navigateToPath } from '../../utils/appNavigation';

const MarketplaceScreen = lazyWithRetry(() => import('../MarketplaceScreen'));
const MarketplaceListingDetailScreen = lazyWithRetry(() => import('../MarketplaceListingDetailScreen'));
const SellerProfileScreen = lazyWithRetry(() => import('../SellerProfileScreen'));

interface GuestMarketplaceShellProps {
  onSignIn: () => void;
  onSignUp: () => void;
}

const GuestMarketplaceShell: React.FC<GuestMarketplaceShellProps> = ({ onSignIn, onSignUp }) => {
  const location = useLocation();
  const parsed = parseAppRoute(location.pathname);

  const promptSignIn = () => {
    const next = `${location.pathname}${location.search || ''}`;
    navigateToPath(`/login?next=${encodeURIComponent(next)}`);
  };

  const renderContent = () => {
    if (parsed.mode === AppMode.MARKETPLACE_LISTING_DETAIL && parsed.params.listingId) {
      return (
        <MarketplaceListingDetailScreen
          listingId={parsed.params.listingId}
          guestMode
          onSignInRequired={promptSignIn}
          onBack={() => navigateToPath('/marketplace')}
          onNavigate={(screen, params) => {
            if (screen === 'MarketplaceListingDetail' && params?.listingId) {
              navigateToPath(`/marketplace/listing/${encodeURIComponent(params.listingId)}`);
            } else if (screen === 'SellerProfile' && params?.userId) {
              navigateToPath(`/marketplace/seller/${encodeURIComponent(params.userId)}`);
            } else {
              promptSignIn();
            }
          }}
        />
      );
    }

    if (parsed.mode === AppMode.SELLER_PROFILE && parsed.params.sellerId) {
      return (
        <SellerProfileScreen
          userId={parsed.params.sellerId}
          guestMode
          onSignInRequired={promptSignIn}
          onBack={() => navigateToPath('/marketplace')}
          onNavigate={(screen, params) => {
            if (screen === 'MarketplaceListingDetail' && params?.listingId) {
              navigateToPath(`/marketplace/listing/${encodeURIComponent(params.listingId)}`);
            } else {
              promptSignIn();
            }
          }}
        />
      );
    }

    return (
      <MarketplaceScreen
        guestMode
        onSignInRequired={promptSignIn}
        onNavigate={(screen, params) => {
          if (screen === 'MarketplaceListingDetail' && params?.listingId) {
            navigateToPath(`/marketplace/listing/${encodeURIComponent(params.listingId)}`);
          } else if (screen === 'SellerProfile' && params?.userId) {
            navigateToPath(`/marketplace/seller/${encodeURIComponent(params.userId)}`);
          } else {
            promptSignIn();
          }
        }}
      />
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-lantern-background text-lantern-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-lantern-primary focus:px-4 focus:py-2 focus:text-white focus:outline-none"
      >
        Skip to main content
      </a>
      <header className="shrink-0 border-b border-lantern-border bg-lantern-surface/90 dark:bg-lantern-background/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2 min-w-0">
            <LanternIcon size={28} />
            <span className="font-semibold truncate">Lantern Study</span>
          </a>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={onSignIn}>
              Sign in
            </Button>
            <Button size="sm" onClick={onSignUp}>
              Get started
            </Button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-2">
          <p className="text-xs text-lantern-text-secondary">
            Browse listings across Nigeria. Sign in to buy, contact sellers, or list items.
          </p>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 min-h-0 flex flex-col">
        <Suspense fallback={<div className="p-6 text-sm text-lantern-text-secondary">Loading marketplace…</div>}>
          {renderContent()}
        </Suspense>
      </main>
    </div>
  );
};

export default GuestMarketplaceShell;
