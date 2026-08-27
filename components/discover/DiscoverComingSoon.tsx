import React from 'react';
import {
  DISCOVER_COMING_SOON_BODY,
  DISCOVER_COMING_SOON_TITLE,
} from '@lantern/shared/network';

export interface DiscoverComingSoonProps {
  onBack?: () => void;
  backLabel?: string;
}

/**
 * Compact empty-state shown when Discover is not yet open to ordinary users.
 */
export const DiscoverComingSoon: React.FC<DiscoverComingSoonProps> = ({
  onBack,
  backLabel = 'Back to Dashboard',
}) => (
  <div className="mx-auto w-full max-w-5xl px-4 py-3 space-y-3" data-testid="discover-coming-soon">
    <h1 className="text-lg font-semibold text-lantern-text">{DISCOVER_COMING_SOON_TITLE}</h1>
    <div className="rounded-xl border border-dashed border-lantern-border p-8 text-center">
      <p className="text-sm text-lantern-text-secondary">{DISCOVER_COMING_SOON_BODY}</p>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="mt-3 text-xs font-semibold text-lantern-primary hover:underline"
        >
          {backLabel}
        </button>
      ) : null}
    </div>
  </div>
);

export default DiscoverComingSoon;
