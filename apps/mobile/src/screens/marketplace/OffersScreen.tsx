import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { canRespondToOffer, canWithdrawOffer, getOfferProposedBy } from '@lantern/shared';
import { useMarketplaceStore, useAuthStore, type MarketplaceOffer } from '../../stores';
import { Button } from '../../components/ui';
import { formatPrice } from './marketplaceHelpers';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Tab = 'seller' | 'buyer';

export function OffersScreen({ navigation }: { navigation: NavigationProp }) {
  const { user } = useAuthStore();
  const { buyerOffers, sellerOffers, isLoading, fetchOffers, respondToOffer } = useMarketplaceStore();
  const [tab, setTab] = useState<Tab>('seller');
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.all([fetchOffers('seller'), fetchOffers('buyer')]);
  }, [fetchOffers]);

  useEffect(() => {
    void load();
  }, [load]);

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
    } finally {
      setBusyOfferId(null);
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
    const pending = item.status === 'pending';
    const busy = busyOfferId === item.id;
    const userId = user?.id || '';
    const canRespond = !!userId && canRespondToOffer(item as any, userId);
    const canWithdraw = !!userId && canWithdrawOffer(item as any, userId);
    const proposedBy = getOfferProposedBy(item as any);
    const acceptLabel = proposedBy === 'seller' ? 'Accept Counter' : 'Accept';
    const declineLabel = proposedBy === 'seller' ? 'Decline Counter' : 'Decline';

    return (
      <Pressable
        onPress={() => navigation.navigate('ListingDetail', { listingId: item.listing_id })}
        accessibilityRole="button"
        accessibilityLabel={`Offer ${formatPrice(item.amount)}, status ${item.status}`}
        className="mx-4 mb-3 p-4 rounded-2xl bg-lantern-surface border border-lantern-border"
      >
        <Text className="text-sm font-semibold text-lantern-text">
          {formatPrice(item.amount)}
        </Text>
        <Text className="text-xs text-lantern-text-secondary mt-1 capitalize">
          Status: {item.status}
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
      </Pressable>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="p-2 -ml-2 mr-1"
        >
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold text-lantern-text">Offers</Text>
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
            <Text className={`text-sm font-semibold capitalize ${tab === t ? 'text-lantern-primary' : 'text-lantern-text-secondary'}`}>
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
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <Text className="text-center text-lantern-text-secondary mt-12 px-6">
              No {tab === 'seller' ? 'received' : 'sent'} offers yet.
            </Text>
          }
        />
      )}

      {counterOfferId ? (
        <View
          accessibilityViewIsModal
          accessibilityLabel="Send counter offer"
          className="absolute bottom-0 left-0 right-0 p-4 bg-lantern-surface border-t border-lantern-border"
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
        </View>
      ) : null}
    </SafeAreaView>
  );
}
