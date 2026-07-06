import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { MARKETPLACE_COMPLIANCE_BANNER } from '@lantern/shared';

interface MarketplaceComplianceBannerProps {
  className?: string;
}

const MarketplaceComplianceBanner: React.FC<MarketplaceComplianceBannerProps> = ({ className = '' }) => (
  <div
    className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
    role="note"
  >
    <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
    <p>{MARKETPLACE_COMPLIANCE_BANNER}</p>
  </div>
);

export default MarketplaceComplianceBanner;
