import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { canRespondToOffer, canWithdrawOffer, getOfferProposedBy } from '@lantern/shared';
import { useMarketplaceStore, useAuthStore, type MarketplaceOffer } from '../../stores';
import { resumeMarketplaceOrderCheckout } from '../../services/api';
import { Button } from '../../components/ui';
import { formatPrice } from './marketplaceHelpers';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { StickyActionBar } from './components/StickyActionBar';
import { scrollClearanceForActionBar } from './components/keyboardSafeLayout';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Tab = 'seller' | 'buyer';

type OfferOrder = NonNullable<MarketplaceOffer['order']>;

/** Mirrors isPayable in OrdersScreen: a checkout session exists and the money hasn't moved yet. */
const isPayable = (order: OfferOrder): boolean =>
  order.status === 'awaiting_payment' ||
  (order.status === 'pending_payment' && Boolean(order.paymentId));

export function OffersScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { tab?: Tab } };
}) {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useScreenBottomPadding();
  // ...and, while the counter-offer bar is up, that bar as well. Measured
  // rather than guessed: the bar's height moves with the keyboard.
  const [counterBarHeight, setCounterBarHeight] = useState(0);
  const { user } = useAuthStore();
  const { buyerOffers, sellerOffers, isLoading, fetchOffers, respondToOffer } = useMarketplaceStore();
  // The You hub sends buyers to their own offers (`tab: 'buyer'`) and the
  // seller strip to received ones; seller stays the default for bare entries.
  const [tab, setTab] = useState<Tab>(route?.params?.tab ?? 'seller');
  // The Market stack keeps screens mounted, so navigating here with a param
  // while already open changes the params, not the state the tabs read.
  useEffect(() => {
    if (route?.params?.tab) setTab(route.params.tab);
  }, [route?.params?.tab]);
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.all([fetchOffers('seller'), fetchOffers('buyer')]);
  }, [fetchOffers]);

  // Reload on every focus, not just first mount: a buyer who accepts an offer,
  // opens (then dismisses) the Paystack browser, and returns here needs the
  // freshly-created order to appear so "Pay now" renders. A one-shot effect
  // would leave the card stale until the app restarts.
  useFocusEffect(
    useCallback(() => {
      void load();
      // The header badge on THIS screen must reflect the action just taken;
      // the summary is TTL-cached, and an invalidate makes this a real refetch.
      void useMarketplaceStore.getState().fetchShopSummary();
    }, [load])
  );

  const offers = tab === 'seller' ? sellerOffers : buyerOffers;

  const handleAction = async (
    offer: MarketplaceOffer,
    action: 'accept' | 'decline' | 'counter' | 'withdraw'
  ) => {
    if (!user?.id || busyOfferId) return;
    if (action === 'counter') {
      setCounterOfferId(offer.id);
      setCounterAmount(String(Math.round(offer.amount * 0.9)));
      return;
    }
    setBusyOfferId(offer.id);
    try {
      const result = await respondToOffer(offer.id, action, user.id);
      if (action === 'accept') {
        const payUrl =
          (result as { authorizationUrl?: string } | void)?.authorizationUrl ||
          (result as { checkout?: { authorizationUrl?: string } } | void)?.checkout
            ?.authorizationUrl;
        const isBuyer = offer.buyer_id === user.id;
        if (payUrl && isBuyer) {
          const WebBrowser = await import('expo-web-browser');
          await WebBrowser.openBrowserAsync(payUrl);
          const orderId = (result as { orderId?: string } | void)?.orderId;
          if (orderId) {
            navigation.navigate('OrderDetail', { orderId, paymentReturn: true });
          }
          return;
        }
        if (payUrl && !isBuyer) {
          Alert.alert('Offer accepted', 'The buyer will complete Paystack checkout.');
          await load();
          return;
        }
      }
      await load();
      Alert.alert('Done', `Offer ${action}ed.`);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action failed');
      // An expired-offer 409 (or any conflict) means our card is stale — pull
      // fresh so the now-dead offer stops showing action buttons.
      void load();
    } finally {
      setBusyOfferId(null);
    }
  };

  // Buyers who dismissed the Paystack browser right after accepting an offer come
  // back to this screen; the accepted offer's order is their only way to pay.
  const handlePayNow = async (orderId: string) => {
    if (payingOrderId) return;
    setPayingOrderId(orderId);
    try {
      const session = await resumeMarketplaceOrderCheckout(orderId);
      if (session?.authorizationUrl) {
        const WebBrowser = await import('expo-web-browser');
        await WebBrowser.openBrowserAsync(session.authorizationUrl);
        navigation.navigate('OrderDetail', { orderId, paymentReturn: true });
        return;
      }
      // No hosted-checkout URL: fall back to the order detail to finish payment.
      navigation.navigate('OrderDetail', { orderId });
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not open checkout');
    } finally {
      setPayingOrderId(null);
    }
  };

  const submitCounter = async () => {
    if (!user?.id || !counterOfferId || busyOfferId) return;
    const amount = parseFloat(counterAmount.replace(/,/g, ''));
    if (!amount || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid counter amount.');
      return;
    }
    setBusyOfferId(counterOfferId);
    try {
      await respondToOffer(counterOfferId, 'counter', user.id, amount);
      setCounterOfferId(null);
      setCounterAmount('');
      await load();
      Alert.alert('Counter sent', 'Your counter offer was sent.');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Counter failed');
    } finally {
      setBusyOfferId(null);
    }
  };

  const renderOffer = ({ item }: { item: MarketplaceOffer }) => {
    // An expired offer is dead: the server 409s any accept/counter, so hide the
    // action buttons the way the web client does rather than let a tap fail.
    const isExpired =
      !!item.expires_at && new Date(item.expires_at).getTime() < Date.now();
    const pending = item.status === 'pending' && !isExpired;
    const busy = busyOfferId === item.id;
    const userId = user?.id || '';
    const canRespond = !!userId && canRespondToOffer(item as any, userId);
    const canWithdraw = !!userId && canWithdrawOffer(item as any, userId);
    const proposedBy = getOfferProposedBy(item as any);
    const acceptLabel = proposedBy === 'seller' ? 'Accept Counter' : 'Accept';
    const declineLabel = proposedBy === 'seller' ? 'Decline Counter' : 'Decline';
    // Only present once the offer was accepted, and only for a party to the order.
    const order = item.order || null;
    const isBuyer = !!userId && item.buyer_id === userId;

    return (
      <Pressable
        onPress={() => navigation.navigate('ListingDetail', { listingId: item.listing_id })}
        accessibilityRole="button"
        accessibilityLabel={`Offer ${formatPrice(item.amount)}, status ${item.status}`}
        className="mx-4 mb-3 p-4 rounded-2xl bg-lantern-surface border border-lantern-border"
      >
        {item.listing?.title ? (
          <Text className="text-xs text-lantern-text-secondary mb-0.5" numberOfLines={1}>
            {item.listing.title}
          </Text>
        ) : null}
        <Text className="text-sm font-semibold text-lantern-text">
          {formatPrice(item.amount)}
        </Text>
        <Text className="text-xs text-lantern-text-secondary mt-1 capitalize">
          Status: {isExpired && item.status === 'pending' ? 'expired' : item.status}
          {proposedBy ? ` · from ${proposedBy}` : ''}
        </Text>
        {item.message ? (
          <Text className="text-sm text-lantern-text-secondary mt-2">{item.message}</Text>
        ) : null}
        {pending ? (
          <View className="flex-row flex-wrap gap-2 mt-3">
            {canRespond ? (
              <>
                <Button
                  className="px-3 py-1"
                  loading={busy}
                  disabled={!!busyOfferId}
                  onPress={() => void handleAction(item, 'accept')}
                >
                  {acceptLabel}
                </Button>
                <Button
                  variant="secondary"
                  className="px-3 py-1"
                  disabled={!!busyOfferId}
                  onPress={() => void handleAction(item, 'decline')}
                >
                  {declineLabel}
                </Button>
                <Button
                  variant="secondary"
                  className="px-3 py-1"
                  disabled={!!busyOfferId}
                  onPress={() => void handleAction(item, 'counter')}
                >
                  Counter
                </Button>
              </>
            ) : canWithdraw ? (
              <Button
                variant="secondary"
                className="px-3 py-1"
                loading={busy}
                disabled={!!busyOfferId}
                onPress={() => void handleAction(item, 'withdraw')}
              >
                Withdraw
              </Button>
            ) : (
              <Text className="text-xs text-lantern-text-secondary">
                Waiting for the other party…
              </Text>
            )}
          </View>
        ) : null}
        {order ? (
          <View className="flex-row flex-wrap gap-2 mt-3">
            {isBuyer && isPayable(order) ? (
              <Button
                className="px-3 py-1"
                loading={payingOrderId === order.id}
                disabled={!!payingOrderId}
                onPress={() => void handlePayNow(order.id)}
              >
                Pay now
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="px-3 py-1"
                onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
              >
                View order
              </Button>
            )}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Screen bottom="none">
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable hitSlop={10}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="p-2 -ml-2 mr-1"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-lantern-text">Offers</Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
      </View>

      <View className="flex-row mx-4 mb-3 p-1 rounded-xl bg-lantern-background-secondary/70 dark:bg-lantern-surface">
        {(['seller', 'buyer'] as Tab[]).map(t => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t }}
            accessibilityLabel={t === 'seller' ? 'Received offers' : 'Sent offers'}
            className={`flex-1 py-2 rounded-lg items-center ${tab === t ? 'bg-lantern-surface dark:bg-lantern-surface-secondary' : ''}`}
          >
            <Text className={`text-sm font-semibold capitalize ${tab === t ? 'text-lantern-primary-text' : 'text-lantern-text-secondary'}`}>
              {t === 'seller' ? 'Received' : 'Sent'}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading && offers.length === 0 ? (
        <ActivityIndicator className="mt-8" color="#6366f1" />
      ) : (
        <FlatList
          data={offers}
          keyExtractor={item => item.id}
          renderItem={renderOffer}
          contentContainerStyle={{
            paddingBottom: counterOfferId
              ? scrollClearanceForActionBar({
                  actionBarHeight: counterBarHeight,
                  baseClearance: tabBarClearance,
                })
              : tabBarClearance,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isLoading && offers.length > 0}
              onRefresh={() => void load()}
              tintColor="#6366f1"
            />
          }
          ListEmptyComponent={
            <Text className="text-center text-lantern-text-secondary mt-12 px-6">
              No {tab === 'seller' ? 'received' : 'sent'} offers yet.
            </Text>
          }
        />
      )}

      {/* Was `absolute bottom-0` paying only `insets.bottom + 16`, so the ~102px
          bottom tab bar swallowed the counter amount field and both buttons —
          the exact bug CartScreen already carries a comment about having fixed.
          StickyActionBar pays the tab bar's clearance AND rides above the
          keyboard, which an unscrollable pinned bar cannot otherwise escape. */}
      {counterOfferId ? (
        <StickyActionBar
          accessibilityLabel="Send counter offer"
          className="absolute left-0 right-0 p-4 bg-lantern-surface border-t border-lantern-border"
          onHeightChange={setCounterBarHeight}
        >
          <Text className="text-sm font-semibold text-lantern-text mb-2">Counter amount (₦)</Text>
          <TextInput
            value={counterAmount}
            onChangeText={setCounterAmount}
            keyboardType="numeric"
            accessibilityLabel="Counter amount in naira"
            className="p-3 rounded-xl border border-lantern-border text-lantern-text mb-3"
          />
          <View className="flex-row gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={!!busyOfferId}
              onPress={() => setCounterOfferId(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              loading={busyOfferId === counterOfferId}
              disabled={!!busyOfferId}
              onPress={() => void submitCounter()}
            >
              Send counter
            </Button>
          </View>
        </StickyActionBar>
      ) : null}
    </Screen>
  );
}
