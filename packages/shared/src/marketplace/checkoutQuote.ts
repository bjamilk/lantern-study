import type { MarketplaceFulfillmentMode } from '../types';
import { nairaToKobo } from './fees';
import {
  checkoutRequiresAddress,
  shippingFeeNaira,
  type SellerFulfillmentPrefs,
} from './fulfillment';

export type CheckoutGroupQuoteInput = {
  sellerId: string;
  itemTotalNaira: number;
  fulfillmentMode: MarketplaceFulfillmentMode;
  prefs?: SellerFulfillmentPrefs | null;
};

export type CheckoutGroupQuote = CheckoutGroupQuoteInput & {
  shippingNaira: number;
  groupTotalNaira: number;
};

export type CheckoutQuote = {
  groups: CheckoutGroupQuote[];
  itemTotalNaira: number;
  shippingTotalNaira: number;
  totalNaira: number;
  itemAmountKobo: number;
  shippingAmountKobo: number;
  totalChargeKobo: number;
  requiresAddress: boolean;
};

export function quoteCheckout(groups: CheckoutGroupQuoteInput[]): CheckoutQuote {
  const quoted: CheckoutGroupQuote[] = groups.map((group) => {
    const shippingNaira =
      group.fulfillmentMode === 'shipping'
        ? shippingFeeNaira(group.prefs, group.itemTotalNaira)
        : 0;
    return {
      ...group,
      shippingNaira,
      groupTotalNaira: group.itemTotalNaira + shippingNaira,
    };
  });
  const itemTotalNaira = quoted.reduce((sum, group) => sum + group.itemTotalNaira, 0);
  const shippingTotalNaira = quoted.reduce((sum, group) => sum + group.shippingNaira, 0);
  const totalNaira = itemTotalNaira + shippingTotalNaira;
  return {
    groups: quoted,
    itemTotalNaira,
    shippingTotalNaira,
    totalNaira,
    itemAmountKobo: nairaToKobo(itemTotalNaira),
    shippingAmountKobo: nairaToKobo(shippingTotalNaira),
    totalChargeKobo: nairaToKobo(totalNaira),
    requiresAddress: checkoutRequiresAddress(quoted.map((group) => group.fulfillmentMode)),
  };
}
