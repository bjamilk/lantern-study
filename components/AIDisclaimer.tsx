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
    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 ${className}`}
  >
    AI
  </span>
);

export default AIDisclaimer;
