import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  canRespondToOffer,
  canWithdrawOffer,
  getOfferProposedBy,
} from '@lantern/shared';
import {
  useMarketplaceStore,
  type MarketplaceOffer,
} from '../../stores/marketplaceStore';
import { formatPrice } from '../../screens/marketplace/marketplaceHelpers';
import { useTheme } from '../../theme';

type OfferAction = 'accept' | 'decline' | 'counter' | 'withdraw';

/**
 * Offer negotiation inside the DM, mirroring web's Chat/Offers tabs.
 * Every action also posts an "[Offer] …" line into the conversation so the
 * negotiation stays legible in the message history, exactly as web does.
 */
export function DmOffersPanel({
  listingId,
  buyerId,
  currentUserId,
  isSeller,
  onPostToChat,
}: {
  listingId: string;
  /** Buyer on this inquiry — offers from other bidders must not appear here. */
  buyerId?: string | null;
  currentUserId: string;
  isSeller: boolean;
  onPostToChat: (text: string) => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const { offers, fetchListingOffers, respondToOffer, createMarketplaceOffer } =
    useMarketplaceStore();
  const [loading, setLoading] = useState(true);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [newOfferAmount, setNewOfferAmount] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await fetchListingOffers(listingId);
    } finally {
      setLoading(false);
    }
  }, [fetchListingOffers, listingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parseAmount = (raw: string): number | null => {
    const value = parseFloat(raw.replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const announce = async (text: string) => {
    try {
      await onPostToChat(text);
    } catch {
      // The offer itself already succeeded; a failed history line is not fatal.
    }
  };

  const handleAction = async (offer: MarketplaceOffer, action: OfferAction) => {
    if (!currentUserId || busyOfferId) return;
    if (action === 'counter') {
      setCounterOfferId(offer.id);
      // Only a buyer negotiates downward. Seeding a seller's counter at 90%
      // pre-loaded them below the bid they were countering.
      setCounterAmount(
        String(isSeller ? Math.round(offer.amount) : Math.round(offer.amount * 0.9))
      );
      return;
    }
    setBusyOfferId(offer.id);
    try {
      await respondToOffer(offer.id, action, currentUserId);
      const amount = formatPrice(offer.amount);
      await announce(
        action === 'accept'
          ? `[Offer] I accepted the offer of ${amount}. An order has been created — arrange pickup or delivery in Orders.`
          : action === 'decline'
            ? `[Offer] I declined the offer of ${amount}.`
            : `[Offer] I withdrew my offer of ${amount}.`
      );
      await load();
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusyOfferId(null);
    }
  };

  const submitCounter = async () => {
    if (!currentUserId || !counterOfferId || busyOfferId) return;
    const amount = parseAmount(counterAmount);
    if (!amount) {
      Alert.alert('Invalid amount', 'Enter a valid counter amount.');
      return;
    }
    setBusyOfferId(counterOfferId);
    try {
      await respondToOffer(counterOfferId, 'counter', currentUserId, amount);
      setCounterOfferId(null);
      setCounterAmount('');
      await announce(`[Offer] I countered with ${formatPrice(amount)}.`);
      await load();
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Counter failed');
    } finally {
      setBusyOfferId(null);
    }
  };

  const submitNewOffer = async () => {
    if (!currentUserId || creating) return;
    const amount = parseAmount(newOfferAmount);
    if (!amount) {
      Alert.alert('Invalid amount', 'Enter a valid offer amount.');
      return;
    }
    setCreating(true);
    try {
      await createMarketplaceOffer(listingId, amount);
      setNewOfferAmount('');
      await announce(`[Offer] I offered ${formatPrice(amount)}.`);
      await load();
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Could not send offer');
    } finally {
      setCreating(false);
    }
  };

  // Scope to this conversation. A listing can have several bidders, and without
  // the buyer filter each one saw the others' amounts in their own DM.
  const listingOffers = offers.filter(
    (o) => o.listing_id === listingId && (!buyerId || o.buyer_id === buyerId)
  );
  const hasPending = listingOffers.some((o) => o.status === 'pending');

  if (loading && listingOffers.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="p-4">
      {listingOffers.length === 0 ? (
        <Text className="text-sm text-lantern-text-secondary text-center mt-6">
          No offers yet on this listing.
        </Text>
      ) : null}

      {listingOffers.map((offer) => {
        const pending = offer.status === 'pending';
        const busy = busyOfferId === offer.id;
        const canRespond = canRespondToOffer(offer as never, currentUserId);
        const canWithdraw = canWithdrawOffer(offer as never, currentUserId);
        const proposedBy = getOfferProposedBy(offer as never);
        const acceptLabel = proposedBy === 'seller' ? 'Accept counter' : 'Accept';
        const declineLabel = proposedBy === 'seller' ? 'Decline counter' : 'Decline';

        return (
          <View
            key={offer.id}
            className="mb-3 p-4 rounded-2xl bg-lantern-surface border border-lantern-border"
          >
            <Text className="text-base font-semibold text-lantern-text">
              {formatPrice(offer.amount)}
            </Text>
            <Text className="text-xs text-lantern-text-secondary mt-1 capitalize">
              Status: {offer.status}
              {proposedBy ? ` · from ${proposedBy}` : ''}
            </Text>
            {offer.message ? (
              <Text className="text-sm text-lantern-text-secondary mt-2">{offer.message}</Text>
            ) : null}

            {pending && counterOfferId === offer.id ? (
              <View className="mt-3">
                <TextInput
                  value={counterAmount}
                  onChangeText={setCounterAmount}
                  keyboardType="numeric"
                  placeholder="Counter amount"
                  placeholderTextColor={colors.textTertiary}
                  className="px-3 py-2 rounded-xl bg-lantern-background-secondary text-lantern-text"
                  style={{ color: colors.text }}
                  accessibilityLabel="Counter offer amount"
                />
                <View className="flex-row gap-2 mt-2">
                  <Pressable
                    onPress={() => void submitCounter()}
                    disabled={busy}
                    className="px-3 py-2 rounded-xl bg-lantern-primary"
                  >
                    <Text className="text-xs font-semibold text-white">Send counter</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCounterOfferId(null)}
                    className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
                  >
                    <Text className="text-xs font-semibold text-lantern-text">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : pending ? (
              <View className="flex-row flex-wrap gap-2 mt-3">
                {canRespond ? (
                  <>
                    <Pressable
                      onPress={() => void handleAction(offer, 'accept')}
                      disabled={busy}
                      className="px-3 py-2 rounded-xl bg-emerald-600"
                    >
                      <Text className="text-xs font-semibold text-white">{acceptLabel}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void handleAction(offer, 'decline')}
                      disabled={busy}
                      className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
                    >
                      <Text className="text-xs font-semibold text-lantern-text">{declineLabel}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void handleAction(offer, 'counter')}
                      disabled={busy}
                      className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
                    >
                      <Text className="text-xs font-semibold text-lantern-text">Counter</Text>
                    </Pressable>
                  </>
                ) : null}
                {canWithdraw ? (
                  <Pressable
                    onPress={() => void handleAction(offer, 'withdraw')}
                    disabled={busy}
                    className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
                  >
                    <Text className="text-xs font-semibold text-lantern-error">Withdraw</Text>
                  </Pressable>
                ) : null}
                {busy ? <ActivityIndicator color={colors.primary} /> : null}
              </View>
            ) : null}
          </View>
        );
      })}

      {!isSeller && !hasPending ? (
        <View className="mt-2 p-4 rounded-2xl bg-lantern-surface border border-lantern-border">
          <Text className="text-sm font-semibold text-lantern-text mb-2">Make an offer</Text>
          <TextInput
            value={newOfferAmount}
            onChangeText={setNewOfferAmount}
            keyboardType="numeric"
            placeholder="Your offer"
            placeholderTextColor={colors.textTertiary}
            className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
            style={{ color: colors.text }}
            accessibilityLabel="Offer amount"
          />
          <Pressable
            onPress={() => void submitNewOffer()}
            disabled={creating}
            className="mt-2 px-3 py-2 rounded-xl bg-lantern-primary self-start"
          >
            <Text className="text-xs font-semibold text-white">
              {creating ? 'Sending…' : 'Send offer'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default DmOffersPanel;
