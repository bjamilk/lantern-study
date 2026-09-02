import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchSellerPayments } from '../../services/api';
import { Button } from '../../components/ui';
import { useTheme } from '../../theme';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { formatPrice } from './marketplaceHelpers';
import { SellerPayoutSetup } from './SellerPayoutSetup';
import { ShopHeaderActions } from './components/ShopHeaderActions';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

/** One ledger row, exactly as GET /marketplace/seller/payments returns it. */
type PaymentRow = Awaited<ReturnType<typeof fetchSellerPayments>>[number];

/**
 * The route hard-codes getSellerPayments' default page size; the 50 in the
 * service is a ceiling on pageSize, which the route never passes, so every
 * page is 20 rows and a short page is the only "no more" signal we have.
 */
const PAGE_SIZE = 20;

type Tone = 'wait' | 'action' | 'done' | 'bad';

/**
 * The payment-row status vocabulary is marketplacePayments.ts's, not the
 * order's: initialized (Paystack session opened, nobody has paid), paid (money
 * in, held until the buyer confirms), payout_pending (transfer queued),
 * paid_out (landed in the bank), refunded, failed. Rendering `p.status` raw
 * put "payout_pending" in front of sellers; this is the human version.
 */
function describePayment(p: PaymentRow): { label: string; tone: Tone } {
  switch (p.status) {
    case 'initialized':
      return { label: 'Awaiting payment', tone: 'wait' };
    case 'paid':
      return { label: 'Paid', tone: 'action' };
    case 'payout_pending':
      return { label: 'Payout pending', tone: 'action' };
    case 'paid_out':
      return { label: 'Paid out', tone: 'done' };
    case 'refunded':
      return { label: 'Refunded', tone: 'bad' };
    case 'failed':
      return { label: 'Failed', tone: 'bad' };
    default:
      return { label: p.status.replace(/_/g, ' '), tone: 'wait' };
  }
}

const shortDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
};

/**
 * Payouts: the bank form on top, then the earnings ledger. The ledger's status
 * and payoutAt were fetched for months and never rendered (SellerInsightsModal
 * shows title and amount only), so a seller could not tell "paid, held until
 * the buyer confirms" from "already in my account". This is the one screen
 * that answers that.
 */
export function SellerPayoutScreen({ navigation }: { navigation: NavigationProp }) {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(16);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchSellerPayments(nextPage);
      // Rows are keyed by orderId; a re-fetch of page 1 must replace, not append.
      setPayments((prev) => (nextPage === 1 ? rows : [...prev, ...rows]));
      setHasMore(rows.length >= PAGE_SIZE);
      setPage(nextPage);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load your earnings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  const palette = (tone: Tone) =>
    tone === 'action'
      ? { bg: colors.warningBackground, fg: colors.warning }
      : tone === 'done'
        ? { bg: colors.successBackground, fg: colors.success }
        : tone === 'bad'
          ? { bg: colors.errorBackground, fg: colors.error }
          : { bg: colors.backgroundSecondary, fg: colors.textSecondary };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center">
        <Pressable
          hitSlop={10}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="p-2 -ml-2 mr-1"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-lantern-text">Payouts</Text>
        {/* Seller tool: the cart is noise here, You stays for the seller's own badges. */}
        <ShopHeaderActions
          navigate={(screen, params) => navigation.navigate(screen, params)}
          hide={['cart']}
        />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabBarClearance }}
      >
        <SellerPayoutSetup />

        <View className="p-3 rounded-xl bg-lantern-surface border border-lantern-border mb-3">
          <Text className="text-sm font-semibold text-lantern-text mb-1">Earnings</Text>
          <Text className="text-xs text-lantern-text-secondary mb-2">
            What you receive after the Lantern fee, newest first.
          </Text>

          {loading && payments.length === 0 ? (
            <ActivityIndicator className="my-4" color={colors.primary} />
          ) : error && payments.length === 0 ? (
            <View className="py-3 items-start gap-2">
              <Text className="text-sm text-lantern-error">{error}</Text>
              <Button variant="secondary" size="sm" onPress={() => void loadPage(1)}>
                Try again
              </Button>
            </View>
          ) : payments.length === 0 ? (
            <View className="py-6 items-center">
              <Ionicons name="wallet-outline" size={28} color={colors.textTertiary} />
              <Text className="mt-2 text-sm font-medium text-lantern-text">No sales yet</Text>
              <Text className="mt-1 text-xs text-lantern-text-secondary text-center">
                Paystack sales show up here with their payout status.
              </Text>
            </View>
          ) : (
            payments.map((p) => {
              const { label, tone } = describePayment(p);
              const { bg, fg } = palette(tone);
              const paidOn = shortDate(p.paidAt);
              const paidOutOn = shortDate(p.payoutAt);
              return (
                <Pressable
                  key={p.orderId}
                  onPress={() => navigation.navigate('OrderDetail', { orderId: p.orderId })}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}, ${formatPrice(Math.round(p.sellerPayoutKobo / 100))}, ${label}`}
                  className="py-2.5 border-b border-lantern-border/60"
                >
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-sm font-medium text-lantern-text" numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Text className="text-sm font-semibold text-lantern-text">
                      {p.status === 'refunded' || p.status === 'failed'
                        ? // Nothing reached the seller; showing the would-be
                          // payout under an "Earnings" heading overstated it.
                          formatPrice(0)
                        : formatPrice(Math.round(p.sellerPayoutKobo / 100))}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2 mt-1">
                    {/* Inline tint, not a Tailwind class: the config has no
                        *-background classes and an unknown class drops silently. */}
                    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: bg }}>
                      <Text className="text-[11px] font-semibold" style={{ color: fg }}>
                        {label}
                      </Text>
                    </View>
                    <Text className="flex-1 text-[11px] text-lantern-text-tertiary" numberOfLines={1}>
                      {p.status === 'refunded'
                        ? 'Refunded — nothing paid'
                        : p.status === 'failed'
                          ? 'Failed — nothing paid'
                          : paidOutOn
                            ? `Paid out ${paidOutOn}`
                            : paidOn
                              ? `Paid ${paidOn}`
                              : 'Not paid yet'}
                      {p.platformFeeKobo > 0
                        ? ` · fee −${formatPrice(Math.round(p.platformFeeKobo / 100))}`
                        : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}

          {hasMore ? (
            <View className="mt-3 self-center">
              <Button
                variant="secondary"
                size="sm"
                loading={loading}
                onPress={() => void loadPage(page + 1)}
              >
                Load more
              </Button>
            </View>
          ) : null}
          {error && payments.length > 0 ? (
            <Text className="mt-2 text-xs text-lantern-error">{error}</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default SellerPayoutScreen;
