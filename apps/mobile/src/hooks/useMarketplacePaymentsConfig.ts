import { useEffect, useState } from 'react';
import { api } from '../services/api';

export type MarketplacePaymentsConfig = {
  paystackEnabled: boolean;
  publicKey: string | null;
  /** Buyer-side surcharge on hand-over items, in basis points. 0 unless deliberately re-enabled. */
  serviceFeeBps: number;
  /** Lantern's cut of a hand-over sale, taken from the seller's payout. */
  physicalCommissionBps?: number;
  digitalBuyerFeeBps?: number;
  creatorFeeBps?: number;
};

/** What the app assumes when the server cannot be asked: checkout off, nothing added. */
const FALLBACK: MarketplacePaymentsConfig = { paystackEnabled: false, publicKey: null, serviceFeeBps: 0 };

// Module-level cache: payments config is server config, one fetch per app run.
let cached: MarketplacePaymentsConfig | null = null;
let inflight: Promise<MarketplacePaymentsConfig> | null = null;

/**
 * The server's payments config, per /marketplace/payments/config. Returns null
 * while unknown. The server is the source of truth for what Paystack charges;
 * this only keeps the app's quotes honest if the fee knobs ever change.
 */
export function useMarketplacePaymentsConfig(): MarketplacePaymentsConfig | null {
  const [config, setConfig] = useState<MarketplacePaymentsConfig | null>(cached);

  useEffect(() => {
    if (cached !== null) return;
    if (!inflight) {
      inflight = api
        .fetchMarketplacePaymentsConfig()
        .then((next: MarketplacePaymentsConfig) => {
          cached = {
            ...FALLBACK,
            ...next,
            paystackEnabled: !!next.paystackEnabled,
            serviceFeeBps: Number.isFinite(Number(next.serviceFeeBps)) ? Number(next.serviceFeeBps) : 0,
          };
          return cached;
        })
        .catch(() => {
          cached = FALLBACK;
          return FALLBACK;
        });
    }
    let alive = true;
    inflight.then((value) => {
      if (alive) setConfig(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return config;
}

export default useMarketplacePaymentsConfig;
