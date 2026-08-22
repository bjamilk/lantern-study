import React, { useEffect, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile, rendered explicitly.
 *
 * Explicit render (not the `class="cf-turnstile"` auto-scan) because both call
 * sites keep the form mounted after a submit attempt. A Turnstile token is
 * redeemed exactly once at siteverify, so a retry after a failed submit needs a
 * fresh one — which means holding this widget's own id and resetting it. The
 * auto-scan gives no id back, so a second attempt would always replay a spent
 * token and be rejected.
 *
 * Renders nothing when no sitekey is configured. That keeps local development
 * and any deployment without Turnstile working exactly as before; the server
 * decides whether a missing token is fatal, not the browser.
 */

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')));
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Public sitekey for the "Lantern Study" widget. Safe to commit — it is useless
 * without the secret the API holds, and it is served to every visitor anyway.
 *
 * Baked in for the same reason PRODUCTION_ENDPOINTS bakes the Supabase anon key:
 * otherwise the sitekey lives only in an untracked .env, and a build from a
 * clean checkout ships a bundle with no widget and no error — Turnstile would
 * appear to be enabled while protecting nothing.
 */
const PRODUCTION_SITEKEY = '0x4AAAAAAEP_wwyHP3SoB5du';

export function getTurnstileSitekey(): string {
  return (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined)?.trim() || PRODUCTION_SITEKEY;
}

export interface TurnstileHandle {
  /** Clear the spent token and show a fresh challenge. */
  reset: () => void;
}

interface TurnstileWidgetProps {
  /** Must match the action the server expects for this surface. */
  action: string;
  onToken: (token: string) => void;
  /** Called when the token expires or the challenge fails, so callers can clear state. */
  onExpire?: () => void;
  /** Called once if the widget script cannot load (ad blocker / network). */
  onLoadFailure?: () => void;
  className?: string;
}

export const TurnstileWidget = React.forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  ({ action, onToken, onExpire, onLoadFailure, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [failed, setFailed] = useState(false);
    const sitekey = getTurnstileSitekey();

    // Latest callbacks without re-rendering the widget: re-rendering would
    // discard an unspent token every time the parent re-rendered.
    const onTokenRef = useRef(onToken);
    const onExpireRef = useRef(onExpire);
    const onLoadFailureRef = useRef(onLoadFailure);
    onTokenRef.current = onToken;
    onExpireRef.current = onExpire;
    onLoadFailureRef.current = onLoadFailure;

    React.useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }));

    useEffect(() => {
      if (!sitekey || !containerRef.current) return;
      let cancelled = false;

      void loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey,
            action,
            callback: (token: string) => onTokenRef.current(token),
            'expired-callback': () => onExpireRef.current?.(),
            'error-callback': () => {
              setFailed(true);
              onLoadFailureRef.current?.();
              onExpireRef.current?.();
            },
          });
        })
        .catch(() => {
          if (!cancelled) { setFailed(true); onLoadFailureRef.current?.(); }
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [sitekey, action]);

    if (!sitekey) return null;

    return (
      <div className={className}>
        <div ref={containerRef} />
        {failed && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            The verification check could not load. Disable any ad blocker for this page and refresh.
          </p>
        )}
      </div>
    );
  }
);

TurnstileWidget.displayName = 'TurnstileWidget';

export default TurnstileWidget;
