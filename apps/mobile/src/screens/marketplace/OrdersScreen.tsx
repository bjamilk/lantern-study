import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useMarketplaceStore } from '../../stores/marketplaceStore';
import * as WebBrowser from 'expo-web-browser';
import { fetchMarketplaceOrders, resumeMarketplaceOrderCheckout } from '../../services/api';
// The same predicates drive the You badge count, so a row sorted to the top is
// always a row that was counted — one definition, two consumers.
import { BUYER_ACTION_ORDER_STATUSES, orderNeedsSeller } from '../../stores/marketplaceStore';
import type { MarketplaceOrder } from '@lantern/shared/types';
import { Button } from '../../components/ui';
import { formatPrice, ListingImage } from './marketplaceHelpers';
import { orderRowMeta } from './orderRowDisplay';
import { OrderStatusPill } from './components/OrderStatusPill';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Role = 'buyer' | 'seller';
type OrdersView = 'all' | 'buy_again';

/** Paystack-payable: a checkout session exists and the money hasn't moved yet. */
const isPayable = (order: MarketplaceOrder): boolean =>
  order.status === 'awaiting_payment' ||
  (order.status === 'pending_payment' && Boolean(order.payment_id));

const needsAction = (order: MarketplaceOrder, role: Role): boolean =>
  role === 'seller' ? orderNeedsSeller(order) : BUYER_ACTION_ORDER_STATUSES.has(order.status);

export function OrdersScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { role?: Role; view?: 'buy_again' } };
}) {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  // The You hub's "Orders to Hand Over" is a seller destination; without this
  // it landed on the buyer's purchase history and the seller had to notice the
  // toggle. Buyer stays the default for every other entry.
  const [role, setRole] = useState<Role>(route?.params?.role ?? 'buyer');
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  // The Market stack keeps screens mounted, so `navigate('Orders', { role })`
  // onto an already-open Orders screen changes the params, not the state the
  // pills read. Follow the param whenever it changes.
  useEffect(() => {
    if (route?.params?.role) setRole(route.params.role);
  }, [route?.params?.role]);

  // Buy Again is a buyer shelf by definition: the role pills are hidden and
  // the seller list never applies, whatever role the caller also passed.
  const view: OrdersView = route?.params?.view === 'buy_again' ? 'buy_again' : 'all';
  const effectiveRole: Role = view === 'buy_again' ? 'buyer' : role;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await fetchMarketplaceOrders(effectiveRole));
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveRole]);

  // Reload on every focus, not just first mount: an order confirmed or paid on
  // OrderDetail must show its new status the moment the user comes back.
  useFocusEffect(
    useCallback(() => {
      void load();
      // The header badge on THIS screen must reflect the action just taken;
      // the summary is TTL-cached, and an invalidate makes this a real refetch.
      void useMarketplaceStore.getState().fetchShopSummary();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const switchRole = (next: Role) => {
    if (next === role) return;
    // Drop the other side's rows now, or they sit under the new title until
    // the fetch lands.
    setOrders([]);
    setRole(next);
  };

  // Action rows first: Amazon puts what needs you at the top, and the badge
  // that brought the user here counts exactly these rows. Sort is stable, so
  // the server's newest-first order survives within each group.
  const visible = useMemo(() => {
    if (view === 'buy_again') return orders.filter((o) => o.status === 'completed');
    return [...orders].sort(
      (a, b) => Number(needsAction(b, effectiveRole)) - Number(needsAction(a, effectiveRole))
    );
  }, [orders, view, effectiveRole]);

  const handleBuyAgain = (order: MarketplaceOrder) => {
    const listing = order.listing;
    const listingId = listing?.id || order.listing_id;
    if (!listingId) {
      appAlert('Unavailable', 'Listing is no longer available.');
      return;
    }
    if (listing?.status && listing.status !== 'active') {
      appAlert('Sold out', 'This listing is sold out or unavailable.');
      return;
    }
    if (listing?.quantity != null && listing.quantity <= 0) {
      appAlert('Sold out', 'This listing is sold out.');
      return;
    }
    const lastQty = Math.max(1, Number(order.quantity) || 1);
    const prefQty =
      listing?.quantity == null
        ? 1
        : Math.min(lastQty, Math.max(1, Number(listing.quantity)));
    navigation.navigate('ListingDetail', { listingId, quantity: prefQty });
  };

  const handlePayNow = async (order: MarketplaceOrder) => {
    setPayingId(order.id);
    try {
      const session = await resumeMarketplaceOrderCheckout(order.id);
      if (session?.authorizationUrl) {
        await WebBrowser.openBrowserAsync(session.authorizationUrl);
        await load();
        return;
      }
      // No hosted-checkout URL: fall back to the order detail to finish payment.
      navigation.navigate('OrderDetail', { orderId: order.id });
    } catch (err: unknown) {
      appAlert('Error', err instanceof Error ? err.message : 'Could not open checkout');
    } finally {
      setPayingId(null);
    }
  };

  /**
   * One primary action per row, the thing the status pill says is on you.
   * Everything that needs a form (proof upload, pickup confirmation, hand
   * over) lives on OrderDetail, so those buttons just open it.
   */
  const primaryAction = (
    item: MarketplaceOrder
  ): { label: string; onPress: () => void; loading?: boolean; secondary?: boolean } | null => {
    const openDetail = () => navigation.navigate('OrderDetail', { orderId: item.id });
    const cashPending = item.status === 'pending_payment' && !item.payment_id;
    if (effectiveRole === 'buyer') {
      if (isPayable(item)) {
        return { label: 'Pay now', onPress: () => void handlePayNow(item), loading: payingId === item.id };
      }
      if (cashPending) return { label: 'Pay the seller', onPress: openDetail };
      if (item.status === 'ready_for_pickup') return { label: 'Confirm received', onPress: openDetail };
      if (item.status === 'completed') {
        // On the Buy Again shelf reordering is the point, so it gets the
        // primary colour; in the full list it is a secondary afterthought.
        return { label: 'Buy again', onPress: () => handleBuyAgain(item), secondary: view !== 'buy_again' };
      }
      return null;
    }
    if (cashPending) return { label: 'Confirm payment', onPress: openDetail };
    if (item.status === 'paid') return { label: 'Hand over', onPress: openDetail };
    return null;
  };

  const title =
    view === 'buy_again' ? 'Buy Again' : effectiveRole === 'buyer' ? 'Your Orders' : 'Orders to Hand Over';
  const emptyText =
    view === 'buy_again'
      ? 'Nothing to reorder yet'
      : effectiveRole === 'buyer'
        ? 'No orders yet'
        : 'No orders to hand over';

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-lantern-text ml-2">{title}</Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
      </View>
      {view === 'all' ? (
        <View className="flex-row gap-2 px-4 mb-3">
          {(['buyer', 'seller'] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => switchRole(r)}
              accessibilityRole="button"
              accessibilityState={{ selected: role === r }}
              className={`px-4 py-2 rounded-full ${role === r ? 'bg-lantern-primary-fill' : 'bg-lantern-background-secondary dark:bg-lantern-surface'}`}
            >
              <Text className={role === r ? 'text-white font-semibold' : 'text-lantern-text-secondary'}>
                {r === 'buyer' ? 'Buying' : 'Selling'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {loading && orders.length === 0 && !refreshing ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabBarClearance }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#6366f1" />
          }
          ListEmptyComponent={
            <View className="items-center mt-12 px-6">
              <Text className="text-center text-lantern-text-secondary">{emptyText}</Text>
              {effectiveRole === 'buyer' ? (
                <View className="mt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => navigation.navigate('MarketplaceHome')}
                  >
                    Start shopping
                  </Button>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const action = primaryAction(item);
            return (
              <View className="p-3 rounded-xl bg-lantern-surface border border-lantern-border">
                {/* Amazon's order row: thumbnail, a status word that says whether
                    anything is on you, then the details. The status used to be
                    the raw enum with underscores swapped for spaces. */}
                <Pressable
                  onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
                  className="flex-row gap-3"
                  accessibilityRole="button"
                  accessibilityLabel={`Order: ${item.listing?.title || 'Listing'}`}
                >
                  <ListingImage
                    uri={item.listing?.images?.[0]}
                    className="w-16 h-16 rounded-lg bg-lantern-background-secondary"
                  />
                  <View className="flex-1">
                    <OrderStatusPill
                      status={item.status}
                      role={effectiveRole}
                      hasPaymentId={Boolean(item.payment_id)}
                    />
                    <Text className="font-semibold text-lantern-text mt-1.5" numberOfLines={2}>
                      {item.listing?.title || 'Listing'}
                    </Text>
                    <View className="flex-row items-center gap-2 mt-1">
                      <Text className="text-lantern-primary-text font-bold">
                        {formatPrice(Number(item.amount))}
                      </Text>
                      {(item.quantity || 1) > 1 ? (
                        <Text className="text-xs text-lantern-text-tertiary">Qty {item.quantity}</Text>
                      ) : null}
                    </View>
                    {/* A reference and the date, so three same-item orders are
                        told apart and a buyer can quote one to the seller. */}
                    {orderRowMeta(item) ? (
                      <Text className="text-caption text-lantern-text-tertiary mt-0.5">
                        {orderRowMeta(item)}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
                {action ? (
                  <View className="mt-3 pt-3 border-t border-lantern-border">
                    <Button
                      size="sm"
                      variant={action.secondary ? 'secondary' : 'primary'}
                      loading={action.loading}
                      onPress={action.onPress}
                    >
                      {action.label}
                    </Button>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
