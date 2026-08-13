import { useEffect, useState } from 'react';
import { fetchMarketplacePaymentsConfig } from '../../services/supabase';

// Module-level cache: the payments mode is server config, not per-user state,
// so one fetch per page load is enough for every banner/confirmation mount.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

/**
 * Whether in-app Paystack checkout is live, per /marketplace/payments/config.
 * Returns null while unknown. Resolves to false on any failure (including the
 * 401 guests get) — the conservative answer, so escrow copy is never shown to
 * someone the server can't confirm it for.
 */
export function usePaystackEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(cached);

  useEffect(() => {
    if (cached !== null) return;
    if (!inflight) {
      inflight = fetchMarketplacePaymentsConfig()
        .then((config) => {
          cached = !!config.paystackEnabled;
          return cached;
        })
        .catch(() => {
          cached = false;
          return false;
        });
    }
    let alive = true;
    inflight.then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return enabled;
}

export default usePaystackEnabled;
