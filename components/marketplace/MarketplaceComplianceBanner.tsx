import React, { useCallback, useState } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { marketplaceComplianceBanner } from '@lantern/shared';
import usePaystackEnabled from './usePaystackEnabled';

interface MarketplaceComplianceBannerProps {
  className?: string;
}

const storageKey = (mode: 'paystack' | 'direct') =>
  `lantern.marketplace.complianceBanner.dismissed.${mode}`;

const readDismissed = (mode: 'paystack' | 'direct'): boolean => {
  try {
    return localStorage.getItem(storageKey(mode)) === '1';
  } catch {
    return false;
  }
};

const writeDismissed = (mode: 'paystack' | 'direct') => {
  try {
    localStorage.setItem(storageKey(mode), '1');
  } catch {
    /* private mode / quota */
  }
};

/**
 * Checkout / logistics notice for marketplace browse and listing detail.
 * Dismissible after reading so it does not keep eating listing space; the
 * same copy stays in Settings. Dismissal is stored per payments mode so a
 * later Paystack cutover can still surface the escrow wording once.
 */
const MarketplaceComplianceBanner: React.FC<MarketplaceComplianceBannerProps> = ({
  className = '',
}) => {
  // Escrow copy only when the server confirms Paystack checkout is live;
  // otherwise (including while loading) the honest direct-arrangement copy.
  const paystackEnabled = usePaystackEnabled();
  const mode: 'paystack' | 'direct' = paystackEnabled ? 'paystack' : 'direct';
  const [closed, setClosed] = useState(false);

  const handleDismiss = useCallback(() => {
    writeDismissed(mode);
    setClosed(true);
  }, [mode]);

  if (closed || readDismissed(mode)) return null;

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
      role="note"
    >
      <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
      <p className="min-w-0 flex-1">{marketplaceComplianceBanner(paystackEnabled)}</p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss marketplace notice"
        className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md text-amber-800 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/50"
      >
        <XMarkIcon className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
};

export default MarketplaceComplianceBanner;
