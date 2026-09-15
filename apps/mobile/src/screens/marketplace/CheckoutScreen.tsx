/**
 * `Checkout` route: pick a fulfillment mode per seller group, pick a delivery
 * address when one is required, and start the single Paystack charge.
 *
 * Exports: CheckoutScreen.
 * Touches: fetchMarketplaceCart, fetchMarketplaceAddresses,
 * fetchSellerFulfillment and checkoutMarketplaceCart in ../../services/api;
 * groupCartItems, quoteCheckout and FULFILLMENT_LABELS from
 * @lantern/shared/marketplace; expo-web-browser to open the Paystack page;
 * useMarketplaceStore.invalidateShopSummary.
 *
 * Gotchas: the total shown is a client-side quote from quoteCheckout — the
 * server prices the real charge. Mode options are gated on the seller's
 * fulfillment prefs, and a failed fetchSellerFulfillment silently leaves that
 * seller with campus meetup only. After opening the Paystack browser the
 * screen navigates to Orders without waiting for the result, so the order
 * status comes from the webhook, not from this screen.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import type {
  MarketplaceAddress,
  MarketplaceCartItem,
  MarketplaceFulfillmentMode,
  MarketplaceSellerFulfillment,
} from '@lantern/shared/types';
import {
  FULFILLMENT_LABELS,
  groupCartItems,
  quoteCheckout,
} from '@lantern/shared/marketplace';
import {
  checkoutMarketplaceCart,
  fetchMarketplaceAddresses,
  fetchMarketplaceCart,
  fetchSellerFulfillment,
} from '../../services/api';
import { appAlert } from '../../components/ui/appDialog';
import { AppIcon } from '../../components/ui/AppIcon';
import { useMarketplaceStore } from '../../stores/marketplaceStore';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function CheckoutScreen({ navigation }: { navigation: NavigationProp }) {
  const [items, setItems] = useState<MarketplaceCartItem[]>([]);
  const [addresses, setAddresses] = useState<MarketplaceAddress[]>([]);
  const [prefs, setPrefs] = useState<Record<string, MarketplaceSellerFulfillment>>({});
  const [modes, setModes] = useState<Record<string, MarketplaceFulfillmentMode>>({});
  const [addressId, setAddressId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    void (async () => {
      const cart = await fetchMarketplaceCart().catch(() => []);
      const saved = await fetchMarketplaceAddresses().catch(() => []);
      setItems(cart);
      setAddresses(saved);
      setAddressId(saved.find((row) => row.is_default)?.id || saved[0]?.id || null);
      const sellerIds = [...new Set(cart.map((item) => item.listing?.user_id).filter(Boolean))] as string[];
      const nextPrefs: Record<string, MarketplaceSellerFulfillment> = {};
      const nextModes: Record<string, MarketplaceFulfillmentMode> = {};
      await Promise.all(
        sellerIds.map(async (sellerId) => {
          const fulfillment = await fetchSellerFulfillment(sellerId).catch(() => null);
          if (fulfillment) nextPrefs[sellerId] = fulfillment;
          nextModes[sellerId] = 'campus_meetup';
        }),
      );
      setPrefs(nextPrefs);
      setModes(nextModes);
    })();
  }, []);

  const groups = useMemo(() => groupCartItems(items), [items]);
  const quote = useMemo(
    () =>
      quoteCheckout(
        groups.map((group) => {
          const fulfillment = prefs[group.sellerId];
          return {
            sellerId: group.sellerId,
            itemTotalNaira: group.itemTotalNaira,
            fulfillmentMode: modes[group.sellerId] || 'campus_meetup',
            prefs: fulfillment
              ? {
                  shipping_enabled: fulfillment.shippingEnabled,
                  shipping_fee_naira: fulfillment.shippingFeeNaira,
                  shipping_free_over_naira: fulfillment.shippingFreeOverNaira,
                  hall_dropoff_enabled: fulfillment.hallDropoffEnabled,
                }
              : null,
          };
        }),
      ),
    [groups, modes, prefs],
  );

  const handlePay = async () => {
    setPaying(true);
    try {
      const result = await checkoutMarketplaceCart({
        groups: groups.map((group) => ({
          sellerId: group.sellerId,
          fulfillmentMode: modes[group.sellerId] || 'campus_meetup',
        })),
        addressId: quote.requiresAddress ? addressId : null,
      });
      if (result?.authorizationUrl) {
        await WebBrowser.openBrowserAsync(result.authorizationUrl);
      } else {
        useMarketplaceStore.getState().invalidateShopSummary();
      }
      navigation.navigate('Orders', { role: 'buyer' });
    } catch (error: unknown) {
      appAlert('Checkout failed', error instanceof Error ? error.message : 'Try again');
    } finally {
      setPaying(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2" accessibilityRole="button">
          <AppIcon name="arrow-back" size={24} />
        </Pressable>
        <Text className="text-title text-lantern-text ml-2">Checkout</Text>
      </View>
      <ScrollView className="flex-1 px-4" contentContainerClassName="pb-8 gap-4">
        {groups.map((group) => {
          const fulfillment = prefs[group.sellerId];
          const options: MarketplaceFulfillmentMode[] = ['campus_meetup'];
          if (fulfillment?.hallDropoffEnabled) options.push('hall_dropoff');
          if (fulfillment?.shippingEnabled) options.push('shipping');
          return (
            <View key={group.sellerId} className="p-4 rounded-2xl border border-lantern-border bg-lantern-surface">
              <Text className="text-heading text-lantern-text">Seller · ₦{group.itemTotalNaira.toLocaleString()}</Text>
              <View className="flex-row flex-wrap gap-2 mt-3">
                {options.map((mode) => (
                  <Pressable
                    key={mode}
                    onPress={() => setModes((current) => ({ ...current, [group.sellerId]: mode }))}
                    className={`min-h-[36px] px-3 rounded-full justify-center ${
                      (modes[group.sellerId] || 'campus_meetup') === mode
                        ? 'bg-lantern-feature-groups-tint'
                        : 'bg-lantern-background-secondary'
                    }`}
                  >
                    <Text className="text-caption text-lantern-text">{FULFILLMENT_LABELS[mode]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
        {quote.requiresAddress ? (
          <View>
            <Text className="text-heading text-lantern-text mb-2">Delivery address</Text>
            {addresses.length === 0 ? (
              <Pressable onPress={() => navigation.navigate('Addresses')}>
                <Text className="text-caption text-lantern-feature-groups-ink">Add an address</Text>
              </Pressable>
            ) : (
              addresses.map((row) => (
                <Pressable
                  key={row.id}
                  onPress={() => setAddressId(row.id)}
                  className={`p-3 rounded-xl border mb-2 ${
                    addressId === row.id ? 'border-lantern-feature-groups-ink' : 'border-lantern-border'
                  }`}
                >
                  <Text className="text-body text-lantern-text">{row.recipient_name}</Text>
                  <Text className="text-caption text-lantern-text-secondary mt-1">{row.city}</Text>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
        <Text className="text-body text-lantern-text">You pay ₦{quote.totalNaira.toLocaleString()}</Text>
        <Text className="text-caption text-lantern-text-tertiary">
          One payment. Cart stays until Paystack confirms.
        </Text>
        <Pressable
          onPress={() => void handlePay()}
          disabled={paying || (quote.requiresAddress && !addressId)}
          className={`min-h-[44px] rounded-xl items-center justify-center ${
            paying || (quote.requiresAddress && !addressId)
              ? 'bg-lantern-background-secondary'
              : 'bg-lantern-feature-groups-ink'
          }`}
        >
          <Text className={`text-body font-semibold ${
            paying || (quote.requiresAddress && !addressId) ? 'text-lantern-text-tertiary' : 'text-white'
          }`}>
            {paying ? 'Starting payment…' : 'Pay'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
