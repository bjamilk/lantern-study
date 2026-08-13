import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  fetchMarketplaceOrder,
  updateMarketplaceOrder,
  requestOrderPayment,
  addMarketplaceReview,
  submitOrderPaymentProof,
  verifyMarketplacePayment,
} from '../../services/api';
import { uploadMarketplaceImage } from '../../services/marketplaceImageUpload';
import type { MarketplaceOrder } from '@lantern/shared/types';
import { useAuthStore, useMarketplaceStore } from '../../stores';
import { Button } from '../../components/ui';
import { formatPrice } from './marketplaceHelpers';
import { buildOrderReceiptText } from './orderReceipt';

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
  const { fetchMyListings, fetchSellerStats } = useMarketplaceStore();
  const [order, setOrder] = useState<MarketplaceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [proofUploading, setProofUploading] = useState(false);

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
          if (!cancelled) Alert.alert('Payment confirmed', 'Your payment was verified.');
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

  const runAction = async (action: string) => {
    setActing(true);
    try {
      setOrder(await updateMarketplaceOrder(route.params.orderId, { action }));
      if (['confirm_received', 'mark_ready', 'mark_paid', 'cancel'].includes(action)) {
        await refreshSellerData();
      }
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActing(false);
    }
  };

  const isSeller = user?.id === order?.seller_id;
  const isBuyer = user?.id === order?.buyer_id;
  const stepIndex = order ? timelineIndexForStatus(order.status) : -1;

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
      <SafeAreaView className="flex-1 items-center justify-center bg-lantern-background">
        {loading ? <ActivityIndicator /> : <Text>Order not found</Text>}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="text-lg font-bold flex-1 ml-2" numberOfLines={1}>
          {order.listing?.title || 'Order'}
        </Text>
      </View>
      <ScrollView className="px-4 pb-8" contentContainerStyle={{ gap: 16 }}>
        <View className="p-4 rounded-xl bg-lantern-surface">
          <Text className="text-2xl font-bold text-lantern-primary">{formatPrice(Number(order.amount))}</Text>
          {(order.quantity || 1) > 1 ? (
            <Text className="text-sm text-lantern-text-secondary mt-1">
              Qty {order.quantity} · unit{' '}
              {formatPrice(Number(order.amount) / Math.max(1, Number(order.quantity) || 1))}
            </Text>
          ) : null}
          <Text className="text-lantern-text-secondary capitalize mt-1">
            {order.status === 'completed'
              ? 'Completed — receipt available'
              : order.status === 'cancelled'
                ? 'Cancelled'
                : order.status === 'awaiting_payment'
                  ? 'Sale in progress — awaiting payment'
                  : `Sale in progress — ${order.status.replace(/_/g, ' ')}`}
          </Text>
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
              Paid{' '}
              {order.status !== 'pending_payment' && order.status !== 'awaiting_payment'
                ? '✓'
                : '—'}
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

        {(order.status === 'pending_payment' || order.status === 'awaiting_payment') && (
          <View className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 gap-3">
            <Text className="font-semibold text-amber-900 dark:text-amber-200">Payment required</Text>
            <Text className="text-sm text-amber-800 dark:text-amber-300">
              Pay the seller, then upload your transfer receipt.
            </Text>
            {order.payment_proof_url ? (
              <>
                <Image
                  source={{ uri: order.payment_proof_url }}
                  className="w-full h-40 rounded-lg"
                  resizeMode="contain"
                />
                {isSeller && (
                  <Button loading={acting} onPress={() => runAction('mark_paid')}>
                    Confirm payment received
                  </Button>
                )}
              </>
            ) : isBuyer ? (
              <Button loading={proofUploading} onPress={() => void uploadPaymentProof()}>
                Upload payment proof
              </Button>
            ) : null}
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
          <Button
            onPress={async () => {
              try {
                await addMarketplaceReview(order.listing_id, { rating: 5 });
                Alert.alert('Thanks', 'Review submitted');
              } catch (e: unknown) {
                Alert.alert('Error', e instanceof Error ? e.message : 'Failed');
              }
            }}
          >
            Leave 5-star review
          </Button>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
