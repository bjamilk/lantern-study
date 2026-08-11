import { useEffect, useState } from 'react';
import { api } from '../services/api';

// Module-level cache: payments mode is server config, one fetch per app run.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

/**
 * Whether in-app Paystack checkout is live, per /marketplace/payments/config.
 * Returns null while unknown; resolves false on any failure so escrow copy is
 * never shown unless the server confirms it.
 */
export function usePaystackEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(cached);

  useEffect(() => {
    if (cached !== null) return;
    if (!inflight) {
      inflight = api
        .fetchMarketplacePaymentsConfig()
        .then((config: { paystackEnabled: boolean }) => {
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
