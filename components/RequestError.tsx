// ===========================================
// Lantern Study Web - The request-failure surface
// ===========================================
/**
 * The web half of the one failure vocabulary. Its mobile twin is
 * apps/mobile/src/components/RequestError.tsx, and both take their words from
 * `requestFailureCopy` in @lantern/shared/network, so a dropped connection
 * reads identically on both clients.
 *
 * Three shapes:
 *   full   — the panel failed and there is nothing to show.
 *   inline — a section inside a screen that still has its chrome.
 *   banner — rows are still on screen; flag them, never blank them.
 *
 * The rule this component exists to enforce: a failed load renders THIS, not
 * an empty state. "No communities match that search" is a claim about the
 * data, and a request that failed told us nothing about the data.
 */
import React from 'react';
import { AppIcon, type AppIconName } from './ui/AppIcon';
import {
  classifyRequestFailure,
  requestFailureCopy,
  type RequestFailureKind,
} from '@lantern/shared/network';

const KIND_ICON: Record<RequestFailureKind, AppIconName> = {
  offline: 'cloud',
  timeout: 'time',
  server: 'cloud',
  notFound: 'help-circle',
  forbidden: 'lock-closed',
  rateLimited: 'time',
  unknown: 'warning',
};

export interface RequestErrorProps {
  /** Whatever the failed load threw. Classified, never printed raw. */
  error: unknown;
  onRetry?: () => void;
  /** Offered when retrying cannot help (a 404 stays a 404). */
  onBack?: () => void;
  variant?: 'full' | 'inline' | 'banner';
  /** Extra sentence for context, replacing the generic body. */
  detail?: string;
  className?: string;
}

export const RequestError: React.FC<RequestErrorProps> = ({
  error,
  onRetry,
  onBack,
  variant = 'inline',
  detail,
  className,
}) => {
  const kind = classifyRequestFailure(error);
  const copy = requestFailureCopy(error);
  const iconName = KIND_ICON[kind];
  const canRetry = copy.retryLabel != null && !!onRetry;
  const retryLabel = copy.retryLabel ?? 'Try again';

  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className={`flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400 ${className ?? ''}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <AppIcon name={iconName} size={16} className="shrink-0" aria-hidden={true} />
          <span>
            {copy.title}. {detail ?? copy.body}
          </span>
        </span>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            aria-label={retryLabel}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium underline"
          >
            <AppIcon name="refresh" size={14} aria-hidden={true} />
            {retryLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`rounded-xl border border-lantern-border p-8 text-center ${
        variant === 'full' ? 'flex flex-col items-center justify-center' : ''
      } ${className ?? ''}`}
    >
      <AppIcon name={iconName} size={32} className="mx-auto text-lantern-text-secondary" aria-hidden={true} />
      <p className="mt-3 text-sm font-medium text-lantern-text">{copy.title}</p>
      <p className="mt-1 text-xs text-lantern-text-secondary">{detail ?? copy.body}</p>
      {canRetry || onBack ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {canRetry ? (
            <button
              type="button"
              onClick={onRetry}
              aria-label={retryLabel}
              className="inline-flex items-center gap-1.5 rounded-md bg-lantern-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-lantern-primary-dark"
            >
              <AppIcon name="refresh" size={14} aria-hidden={true} />
              {retryLabel}
            </button>
          ) : null}
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Go back"
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-lantern-primary hover:bg-lantern-primary/10"
            >
              Go back
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default RequestError;
