import React from 'react';
import { LEGAL_PATHS } from '@lantern/shared';

export interface AIDisclaimerProps {
  className?: string;
  compact?: boolean;
}

export const AIDisclaimer: React.FC<AIDisclaimerProps> = ({ className = '', compact = false }) => (
  <p
    className={`text-xs text-lantern-text-secondary ${className}`}
    role="note"
    aria-label="AI disclaimer"
  >
    {compact ? (
      <>AI-generated content may be inaccurate. Not professional advice.</>
    ) : (
      <>
        Content is <strong className="font-medium">AI-generated</strong> and may be inaccurate. It is not
        professional advice. Review before use.{' '}
        <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer" className="underline hover:text-lantern-primary">
          Privacy Policy
        </a>
      </>
    )}
  </p>
);

export const AIGeneratedBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    className={`inline-flex items-center px-1.5 py-0.5 rounded text-label font-medium uppercase tracking-wide bg-lantern-primary-background text-lantern-primary ${className}`}
  >
    AI
  </span>
);

export default AIDisclaimer;
