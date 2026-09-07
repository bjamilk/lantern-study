import React from 'react';
import { COMMUNITY_GATE_COPY } from '@lantern/shared/network';

export interface DiscoverComingSoonProps {
  onBack?: () => void;
  backLabel?: string;
}

/**
 * Compact empty-state shown when the community gate refuses. The gate is the
 * shared `canAccessDiscoverHub` object form: a platform admin always passes,
 * so the only reader who lands here is a student whose profile has no
 * institution or programme yet — and the copy says exactly that, never
 * "coming soon".
 */
export const DiscoverComingSoon: React.FC<DiscoverComingSoonProps> = ({
  onBack,
  backLabel = 'Back to Dashboard',
}) => (
  <div className="mx-auto w-full max-w-5xl px-4 py-3 space-y-3" data-testid="discover-coming-soon">
    <h1 className="text-lg font-semibold text-lantern-text">{COMMUNITY_GATE_COPY.needsProfileTitle}</h1>
    <div className="rounded-xl border border-dashed border-lantern-border p-8 text-center">
      <p className="text-sm font-medium text-lantern-text">{COMMUNITY_GATE_COPY.needsProfileBody}</p>
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
