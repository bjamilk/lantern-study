import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import {
  SCREEN_KEYBOARD_BEHAVIOR,
  Screen,
  useScreenBottomPadding,
  useScreenInsets,
} from '../../components/layout';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import {
  fetchMarketplaceOrder,
  updateMarketplaceOrder,
  requestOrderPayment,
  addMarketplaceReview,
  submitOrderPaymentProof,
  resumeMarketplaceOrderCheckout,
  verifyMarketplacePayment,
} from '../../services/api';
import { uploadMarketplaceImage } from '../../services/marketplaceImageUpload';
import type { MarketplaceOrder } from '@lantern/shared/types';
import { useAuthStore, useMarketplaceStore } from '../../stores';
import { Button } from '../../components/ui';
import { formatPrice } from './marketplaceHelpers';
import { buildOrderReceiptText } from './orderReceipt';
import { OpenDisputeModal } from './OpenDisputeModal';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { OrderStatusPill, orderNextStep } from './components/OrderStatusPill';
import { AppIcon } from '../../components/ui/AppIcon';

const TIMELINE_STEPS = ['accepted', 'paid', 'ready_for_pickup', 'completed'] as const;

function timelineIndexForStatus(status: string): number {
  if (status === 'cancelled' || status === 'disputed') return -1;
  if (status === 'pending_payment' || status === 'awaiting_payment') return 0;
  if (status === 'paid') return 1;
  if (status === 'ready_for_pickup' || status === 'buyer_confirmed') return 2;
  if (status === 'completed') return 3;
  return 0;
}

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function OrderDetailScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: {
    params: {
      orderId: string;
      paymentReturn?: boolean;
      payment?: string;
      reference?: string;
      trxref?: string;
    };
  };
}) {
  const { user } = useAuthStore();
  const insets = useScreenInsets();
  // The old `className="px-4 pb-8"` put 28px of padding on the ScrollView's
  // OWN style (which clips the scrollable extent on Android) and did not clear
  // the ~102px absolute bottom tab bar, burying 'Leave a review'.
  const bottomPadding = useScreenBottomPadding();
  const { fetchMyListings, fetchSellerStats } = useMarketplaceStore();
  const [order, setOrder] = useState<MarketplaceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [proofUploading, setProofUploading] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrder(await fetchMarketplaceOrder(route.params.orderId));
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [route.params.orderId]);

  // Header badge on this screen must move after Confirm / Hand over; the
  // summary is TTL-cached and every action invalidates it, so this refetches.
  useFocusEffect(
    useCallback(() => {
      void useMarketplaceStore.getState().fetchShopSummary();
    }, [])
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Paystack return / browser close — verify when reference present, else refresh status.
  useEffect(() => {
    const reference = route.params.reference || route.params.trxref;
    const shouldRefresh =
      route.params.paymentReturn ||
      route.params.payment === 'return' ||
      Boolean(reference);
    if (!shouldRefresh) return;
    let cancelled = false;
    (async () => {
      try {
        if (reference) {
          await verifyMarketplacePayment(reference);
          if (!cancelled) Alert.alert('Payment confirmed', 'Your Paystack payment was verified.');
        }
        if (!cancelled) await load();
      } catch (err: unknown) {
        if (!cancelled) {
          Alert.alert(
            'Payment check',
            err instanceof Error ? err.message : 'Could not verify payment yet. Pull to refresh from Orders.'
          );
          await load();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    route.params.paymentReturn,
    route.params.payment,
    route.params.reference,
    route.params.trxref,
    load,
  ]);

  const refreshSellerData = async () => {
    if (!user?.id) return;
    await Promise.all([fetchMyListings(user.id), fetchSellerStats()]);
  };

  const runAction = async (
    action: string,
    // Phase 3 N — `extra` is carried by `open_dispute` only; ignored otherwise.
    // `rethrow` is for callers that render their OWN error state (the dispute
    // modal): without it this swallows the failure into an Alert and the modal
    // closes as though the dispute had been filed.
    extra: { disputeReason?: string; disputeCategory?: string } = {},
    options: { rethrow?: boolean } = {}
  ) => {
    setActing(true);
    try {
      setOrder(await updateMarketplaceOrder(route.params.orderId, { action, ...extra }));
      // Every action moves this order between the "needs you" buckets the You
      // badge counts; stale-mark the summary so the next Shop focus refetches.
      useMarketplaceStore.getState().invalidateShopSummary();
      if (['confirm_received', 'mark_ready', 'mark_paid', 'cancel'].includes(action)) {
        await refreshSellerData();
      }
    } catch (err: unknown) {
      if (options.rethrow) throw err;
      Alert.alert('Error', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActing(false);
    }
  };

  // Phase 3 N: a real modal, not Alert.prompt. Alert.prompt is iOS-only and
  // Android is the only platform currently shipping a build, so the old flow
  // meant no shipped user could type a dispute reason.
  const [disputeOpen, setDisputeOpen] = useState(false);

  const continuePaystack = async () => {
    setActing(true);
    try {
      const session = await resumeMarketplaceOrderCheckout(route.params.orderId);
      if (session?.authorizationUrl) {
        await WebBrowser.openBrowserAsync(session.authorizationUrl);
        await load();
        return;
      }
      Alert.alert('Checkout unavailable', 'Could not open Paystack checkout.');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not start checkout');
    } finally {
      setActing(false);
    }
  };

  const submitReview = async () => {
    if (!order) return;
    setSubmittingReview(true);
    try {
      await addMarketplaceReview(order.listing_id, {
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });
      setShowReview(false);
      setReviewComment('');
      setReviewRating(5);
      Alert.alert('Thanks', 'Review submitted');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  const isSeller = user?.id === order?.seller_id;
  const isBuyer = user?.id === order?.buyer_id;
  const stepIndex = order ? timelineIndexForStatus(order.status) : -1;
  const needsPaystack =
    isBuyer &&
    (order?.status === 'awaiting_payment' ||
      (order?.status === 'pending_payment' && Boolean(order.payment_id)));

  const uploadPaymentProof = async () => {
    if (!order) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload payment proof.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;

    setProofUploading(true);
    try {
      const asset = result.assets[0];
      const { url } = await uploadMarketplaceImage(asset.uri, asset.mimeType, order.listing_id);
      setOrder(await submitOrderPaymentProof(order.id, url));
      await refreshSellerData();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setProofUploading(false);
    }
  };

  if (loading || !order) {
    return (
      <Screen bottom="safe">
        <View className="flex-1 items-center justify-center">
          {loading ? <ActivityIndicator /> : <Text>Order not found</Text>}
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom="none">
      <OpenDisputeModal
        visible={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        listingTitle={order?.listing?.title}
        viewerIsSeller={isSeller}
        onSubmit={async ({ disputeCategory, disputeReason }) => {
          // rethrow so the modal shows the failure inline instead of closing.
          await runAction('open_dispute', { disputeCategory, disputeReason }, { rethrow: true });
        }}
      />
      <View className="px-4 py-3 flex-row items-center">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="text-lg font-bold flex-1 ml-2" numberOfLines={1}>
          {order.listing?.title || 'Order'}
        </Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
      </View>
      <ScrollView
        className="px-4"
        contentContainerStyle={{ gap: 16, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="p-4 rounded-xl bg-lantern-surface">
          <Text className="text-2xl font-bold text-lantern-primary">{formatPrice(Number(order.amount))}</Text>
          {(order.quantity || 1) > 1 ? (
            <Text className="text-sm text-lantern-text-secondary mt-1">
              Qty {order.quantity} · unit{' '}
              {formatPrice(Number(order.amount) / Math.max(1, Number(order.quantity) || 1))}
            </Text>
          ) : null}
          {/* Same pill and next-step copy as the Orders list, phrased for the
              side you are on: a seller on awaiting_payment used to read only
              "Awaiting Paystack payment" and wonder whether it was theirs to do. */}
          <View className="mt-2">
            <OrderStatusPill
              status={order.status}
              role={isSeller ? 'seller' : 'buyer'}
              hasPaymentId={Boolean(order.payment_id)}
            />
          </View>
          {orderNextStep(order.status, isSeller ? 'seller' : 'buyer', Boolean(order.payment_id)) ? (
            <Text className="text-sm text-lantern-text-secondary mt-1">
              {orderNextStep(order.status, isSeller ? 'seller' : 'buyer', Boolean(order.payment_id))}
            </Text>
          ) : null}
          {order.discount_amount ? (
            <Text className="text-sm text-emerald-600 mt-1">
              Discount: {formatPrice(Number(order.discount_amount))}
            </Text>
          ) : null}
        </View>

        {order.status !== 'cancelled' ? (
          <View className="p-4 rounded-xl bg-lantern-surface">
            <Text className="text-sm font-semibold text-lantern-text mb-3">Sale progress</Text>
            <View className="flex-row gap-2 mb-3">
              {TIMELINE_STEPS.map((step, i) => (
                <View
                  key={step}
                  className={`flex-1 h-2 rounded-full ${
                    stepIndex >= i ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
                  }`}
                />
              ))}
            </View>
            <Text className="text-sm text-lantern-text-secondary">
              Accepted {order.created_at ? '✓' : '—'}
            </Text>
            <Text className="text-sm text-lantern-text-secondary">
              {/* Only evidence counts: a paid_at stamp or the order currently
                  in 'paid'. payment_id is NOT evidence — it is written when a
                  Paystack session is initialized, before any money moves, and
                  survives abandonment. Status ordering alone is not evidence
                  either: ready-before-payment used to display as paid. */}
              {(order as { paid_at?: string | null }).paid_at || order.status === 'paid'
                ? (order as { payment_id?: string | null }).payment_id
                  ? 'Paid via Paystack ✓'
                  : 'Payment confirmed by seller ✓'
                : 'Paid —'}
            </Text>
            <Text className="text-sm text-lantern-text-secondary">
              Ready for pickup{' '}
              {order.seller_confirmed_at ||
              order.status === 'ready_for_pickup' ||
              order.status === 'completed'
                ? '✓'
                : '—'}
            </Text>
            <Text className="text-sm text-lantern-text-secondary">
              Completed {order.completed_at ? '✓' : '—'}
            </Text>
            {order.status !== 'completed' ? (
              <Text className="text-xs text-lantern-text-tertiary mt-2">
                Receipt unlocks when the order is completed.
              </Text>
            ) : null}
          </View>
        ) : null}

        {needsPaystack ? (
          <View className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 gap-3">
            <Text className="font-semibold text-indigo-900 dark:text-indigo-200">
              Pay with Paystack
            </Text>
            <Text className="text-sm text-indigo-800 dark:text-indigo-300">
              You pay the listed price — no extra charge. Funds go to the seller after you confirm
              delivery.
            </Text>
            <Button loading={acting} onPress={() => void continuePaystack()}>
              Continue to Paystack
            </Button>
            <Button variant="secondary" loading={acting} onPress={() => runAction('cancel')}>
              Cancel order
            </Button>
          </View>
        ) : null}

        {order.status === 'pending_payment' && !order.payment_id && (
          <View className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 gap-3">
            <Text className="font-semibold text-amber-900 dark:text-amber-200">Payment required</Text>
            <Text className="text-sm text-amber-800 dark:text-amber-300">
              {isBuyer
                ? 'Pay the seller using the agreed method. For transfers, upload your receipt; for cash, pay at pickup and the seller confirms.'
                : 'Confirm below once you receive the payment — cash at pickup counts. Transfer receipts the buyer uploads appear here.'}
            </Text>
            {order.payment_proof_url ? (
              <Image
                source={{ uri: order.payment_proof_url }}
                className="w-full h-40 rounded-lg"
                resizeMode="contain"
              />
            ) : isBuyer ? (
              <Button loading={proofUploading} onPress={() => void uploadPaymentProof()}>
                Upload payment proof
              </Button>
            ) : null}
            {isSeller && (
              /* No longer gated on an uploaded proof: cash at pickup has no
                 receipt, and every manual order now starts pending_payment —
                 proof-gating this button dead-ended the standard cash sale. */
              <Button loading={acting} onPress={() => runAction('mark_paid')}>
                Confirm payment received
              </Button>
            )}
            {isSeller && (
              /* The API has always allowed mark_ready from pending_payment;
                 the button was just unreachable in this state. */
              <Button variant="secondary" loading={acting} onPress={() => runAction('mark_ready')}>
                Mark ready for pickup or delivery
              </Button>
            )}
            {(isBuyer || isSeller) && (
              <Button variant="secondary" loading={acting} onPress={() => runAction('cancel')}>
                Cancel order
              </Button>
            )}
          </View>
        )}
        {order.status !== 'completed' &&
          order.status !== 'cancelled' &&
          order.status !== 'pending_payment' &&
          order.status !== 'awaiting_payment' && (
          <View className="gap-2">
            {isSeller && ['paid', 'pending_payment'].includes(order.status) && (
              <>
                <Button loading={acting} onPress={() => runAction('mark_ready')}>
                  Mark ready for pickup or delivery
                </Button>
                <Button
                  variant="secondary"
                  loading={acting}
                  onPress={async () => {
                    setActing(true);
                    try {
                      await requestOrderPayment(order.id);
                      Alert.alert('Sent', 'Payment request sent to buyer');
                    } catch (e: unknown) {
                      Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
                    } finally {
                      setActing(false);
                    }
                  }}
                >
                  Request payment
                </Button>
              </>
            )}
            {isBuyer && ['paid', 'ready_for_pickup'].includes(order.status) && (
              <Button loading={acting} onPress={() => runAction('confirm_received')}>
                Confirm received
              </Button>
            )}
            {/*
              Phase 3 N: `open_dispute` has been supported server-side since
              Phase 1 with no client able to reach it. Offered only once money
              has moved — on an unpaid order the honest action is Cancel.
            */}
            {(isBuyer || isSeller) &&
              ['paid', 'ready_for_pickup', 'buyer_confirmed'].includes(order.status) && (
                <Button variant="secondary" loading={acting} onPress={() => setDisputeOpen(true)}>
                  Report a problem
                </Button>
              )}
          </View>
        )}
        {order.status === 'completed' && (
          <Button
            variant="secondary"
            onPress={() => {
              void Share.share({ message: buildOrderReceiptText(order) });
            }}
          >
            Share receipt
          </Button>
        )}
        {order.status === 'completed' && isBuyer && (
          <Button onPress={() => setShowReview(true)}>
            Leave a review
          </Button>
        )}
      </ScrollView>

      <Modal visible={showReview} transparent animationType="slide" onRequestClose={() => setShowReview(false)}>
        {/* A bottom-anchored sheet sits exactly where the keyboard lands, so the
            multiline review box and the Submit button below it were covered.
            The KAV lifts the whole sheet — the shape OpenDisputeModal uses. */}
        <KeyboardAvoidingView
          behavior={SCREEN_KEYBOARD_BEHAVIOR}
          className="flex-1 justify-end bg-black/40"
        >
          <View className="bg-lantern-surface rounded-t-3xl p-5" style={{ paddingBottom: insets.bottom + 20 }}>
            <Text className="text-lg font-bold text-lantern-text mb-3">Rate your purchase</Text>
            <View className="flex-row gap-2 mb-4">
              {[1, 2, 3, 4, 5].map(i => (
                <Pressable key={i} onPress={() => setReviewRating(i)}>
                  <AppIcon
                    name="star"
                    filled={i <= reviewRating}
                    size={28}
                    color="#f59e0b"
                  />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Share your experience (optional)"
              placeholderTextColor="#94a3b8"
              multiline
              className="min-h-[80px] p-3 rounded-xl border border-lantern-border text-lantern-text mb-4"
              textAlignVertical="top"
            />
            <View className="flex-row gap-3">
              <Button variant="secondary" className="flex-1" onPress={() => setShowReview(false)}>
                Cancel
              </Button>
              <Button className="flex-1" loading={submittingReview} onPress={() => void submitReview()}>
                Submit
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
