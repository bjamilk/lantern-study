import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
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
import { ErrorState, InlineErrorBanner, LoadingState } from '../ui';
import { useTheme } from '../../theme';

type OfferAction = 'accept' | 'decline' | 'counter' | 'withdraw';

// Terminal / superseded states — collapsed into the "History" section so the
// live offer isn't buried under every past round of the negotiation.
const RESOLVED_OFFER_STATUSES: ReadonlySet<MarketplaceOffer['status']> = new Set([
  'declined',
  'withdrawn',
  'expired',
  'countered',
]);

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
  onDealChanged,
  hasLiveOrder = false,
}: {
  listingId: string;
  /** Buyer on this inquiry — offers from other bidders must not appear here. */
  buyerId?: string | null;
  currentUserId: string;
  isSeller: boolean;
  onPostToChat: (text: string) => void | Promise<void>;
  /** Notify the parent to refresh the order after an accept/pay so the order bar appears. */
  onDealChanged?: () => void | Promise<void>;
  /** A non-cancelled order already exists — don't invite a fresh offer on an ordered item. */
  hasLiveOrder?: boolean;
}) {
  const { colors } = useTheme();
  // Past a tablet breakpoint, cap the offers list to a centered column instead
  // of letting cards run full-bleed edge-to-edge.
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 768;
  const columnStyle: ViewStyle | undefined = isWideScreen
    ? { width: '100%', maxWidth: 680, alignSelf: 'center' }
    : undefined;
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // GET /marketplace/listings/:id/offers is seller-only (403 for a buyer), so
  // read the role-scoped list instead — the same source OffersScreen uses.
  const {
    buyerOffers,
    sellerOffers,
    fetchOffers,
    respondToOffer,
    createMarketplaceOffer,
  } = useMarketplaceStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [newOfferAmount, setNewOfferAmount] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await fetchOffers(isSeller ? 'seller' : 'buyer');
      setLoadError(null);
    } catch (error) {
      // Was a bare try/finally: a 500 rendered as "No offers yet on this
      // listing", which reads as a fact about the listing rather than a fault.
      setLoadError(error instanceof Error ? error.message : 'Could not load offers.');
    } finally {
      setLoading(false);
    }
  }, [fetchOffers, isSeller]);

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
      const result = await respondToOffer(offer.id, action, currentUserId);
      const amount = formatPrice(offer.amount);
      // A buyer accepting a counter gets a Paystack checkout back — open it so
      // they pay in-app (the biggest mobile conversion gap), instead of only
      // being told to "arrange in Orders" while the order sits unpaid.
      const payUrl = result?.authorizationUrl || result?.checkout?.authorizationUrl;
      const buyerPayNow = action === 'accept' && !isSeller && !!payUrl;
      await announce(
        action === 'accept'
          ? buyerPayNow
            ? `[Offer] I accepted the offer of ${amount} — completing payment now.`
            : `[Offer] I accepted the offer of ${amount}. An order has been created — arrange pickup or delivery in Orders.`
          : action === 'decline'
            ? `[Offer] I declined the offer of ${amount}.`
            : `[Offer] I withdrew my offer of ${amount}.`
      );
      await load();
      // Accepting an offer creates an order — tell the parent to surface the order bar.
      if (action === 'accept') await onDealChanged?.();
      if (buyerPayNow && payUrl) {
        try {
          const WebBrowser = await import('expo-web-browser');
          await WebBrowser.openBrowserAsync(payUrl);
          // Refresh the order on return so the deal bar reflects the payment.
          await onDealChanged?.();
        } catch {
          // Checkout failed to open; the order still exists to pay from Orders.
        }
      }
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
  const offers = isSeller ? sellerOffers : buyerOffers;
  const listingOffers = offers.filter(
    (o) => o.listing_id === listingId && (!buyerId || o.buyer_id === buyerId)
  );
  const hasPending = listingOffers.some((o) => o.status === 'pending');

  // Newest first, then split the live round from the resolved history so the
  // actionable offer sits on top and old rounds collapse away.
  const sortedOffers = [...listingOffers].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const activeOffers = sortedOffers.filter((o) => !RESOLVED_OFFER_STATUSES.has(o.status));
  const resolvedOffers = sortedOffers.filter((o) => RESOLVED_OFFER_STATUSES.has(o.status));

  const renderFullOffer = (offer: MarketplaceOffer) => {
    const pending = offer.status === 'pending';
    const busy = busyOfferId === offer.id;
    const canRespond = canRespondToOffer(offer as never, currentUserId);
    const canWithdraw = canWithdrawOffer(offer as never, currentUserId);
    const proposedBy = getOfferProposedBy(offer as never);
    const acceptLabel = proposedBy === 'seller' ? 'Accept counter' : 'Accept';
    const declineLabel = proposedBy === 'seller' ? 'Decline counter' : 'Decline';
    // The one offer that still needs someone to act — promoted visually.
    const actionable = pending && (canRespond || canWithdraw);

    return (
      <View
        key={offer.id}
        className={`mb-3 p-4 rounded-2xl bg-lantern-surface border ${
          actionable ? 'border-lantern-primary' : 'border-lantern-border'
        }`}
        style={actionable ? { borderWidth: 1.5 } : undefined}
      >
        {actionable ? (
          <View className="flex-row items-center gap-1.5 mb-2">
            <View className="w-1.5 h-1.5 rounded-full bg-lantern-primary-fill" />
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-lantern-primary-text">
              {canRespond ? 'Awaiting your response' : 'Awaiting their response'}
            </Text>
          </View>
        ) : null}
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
                accessibilityRole="button"
                accessibilityLabel="Send counter offer"
                accessibilityState={{ disabled: busy, busy }}
                className="px-3 py-2 rounded-xl bg-lantern-primary-fill"
              >
                <Text className="text-xs font-semibold text-white">Send counter</Text>
              </Pressable>
              <Pressable
                onPress={() => setCounterOfferId(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel counter offer"
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
                  accessibilityRole="button"
                  accessibilityLabel={`${acceptLabel}, ${formatPrice(offer.amount)}`}
                  accessibilityState={{ disabled: busy, busy }}
                  className="px-3 py-2 rounded-xl bg-emerald-600"
                >
                  <Text className="text-xs font-semibold text-white">{acceptLabel}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAction(offer, 'decline')}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${declineLabel}, ${formatPrice(offer.amount)}`}
                  accessibilityState={{ disabled: busy, busy }}
                  className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
                >
                  <Text className="text-xs font-semibold text-lantern-text">{declineLabel}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAction(offer, 'counter')}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Counter offer of ${formatPrice(offer.amount)}`}
                  accessibilityState={{ disabled: busy, busy }}
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
                accessibilityRole="button"
                accessibilityLabel={`Withdraw your offer of ${formatPrice(offer.amount)}`}
                accessibilityState={{ disabled: busy, busy }}
                className="px-3 py-2 rounded-xl bg-lantern-background-secondary"
              >
                <Text className="text-xs font-semibold text-lantern-error">Withdraw</Text>
              </Pressable>
            ) : null}
            {busy ? <ActivityIndicator color={colors.primaryText} /> : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderCompactOffer = (offer: MarketplaceOffer) => {
    const proposedBy = getOfferProposedBy(offer as never);
    return (
      <View
        key={offer.id}
        className="flex-row items-center justify-between gap-2 py-2 px-3 mb-1.5 rounded-xl bg-lantern-background-secondary"
      >
        <Text className="text-sm font-medium text-lantern-text" numberOfLines={1}>
          {formatPrice(offer.amount)}
        </Text>
        <Text
          className="text-[11px] text-lantern-text-secondary capitalize"
          numberOfLines={1}
        >
          {offer.status}
          {proposedBy ? ` · from ${proposedBy}` : ''}
        </Text>
      </View>
    );
  };

  if (loading && listingOffers.length === 0) {
    return <LoadingState label="Loading offers" />;
  }

  if (loadError && listingOffers.length === 0) {
    return <ErrorState message={loadError} onRetry={() => void load()} />;
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="p-4">
      <View style={columnStyle}>
        {loadError ? (
          <InlineErrorBanner
            title="Couldn't refresh offers"
            detail="Showing the offers saved on this device."
            onRetry={() => void load()}
          />
        ) : null}

        {listingOffers.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary text-center mt-6">
            No offers yet on this listing.
          </Text>
        ) : null}

        {activeOffers.map(renderFullOffer)}

        {!isSeller && !hasPending && !hasLiveOrder ? (
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
              accessibilityRole="button"
              accessibilityLabel="Send offer"
              accessibilityState={{ disabled: creating, busy: creating }}
              className="mt-2 px-3 py-2 rounded-xl bg-lantern-primary-fill self-start"
            >
              <Text className="text-xs font-semibold text-white">
                {creating ? 'Sending…' : 'Send offer'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {resolvedOffers.length > 0 ? (
          <View className="mt-3">
            <Pressable
              onPress={() => setHistoryExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={`${historyExpanded ? 'Hide' : 'Show'} offer history`}
              accessibilityState={{ expanded: historyExpanded }}
              className="flex-row items-center justify-between py-2"
            >
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
                History ({resolvedOffers.length})
              </Text>
              <Text className="text-xs font-semibold text-lantern-text-secondary">
                {historyExpanded ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
            {historyExpanded ? resolvedOffers.map(renderCompactOffer) : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

export default DmOffersPanel;
