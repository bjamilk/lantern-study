import { useMarketplacePaymentsConfig } from './useMarketplacePaymentsConfig';

/**
 * Whether in-app Paystack checkout is live, per /marketplace/payments/config.
 * Returns null while unknown; resolves false on any failure so escrow copy is
 * never shown unless the server confirms it.
 */
export function usePaystackEnabled(): boolean | null {
  const config = useMarketplacePaymentsConfig();
  return config === null ? null : !!config.paystackEnabled;
}

export default usePaystackEnabled;
