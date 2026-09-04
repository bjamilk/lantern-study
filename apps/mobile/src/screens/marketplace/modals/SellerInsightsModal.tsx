import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SCREEN_KEYBOARD_BEHAVIOR, useScreenInsets } from '../../../components/layout';
import { Ionicons } from '@expo/vector-icons';
import type { SellerAnalytics } from '@lantern/shared/types';
import { Button } from '../../../components/ui';
import { updateSellerPreferences, fetchSellerPayments } from '../../../services/api';
import { formatPrice } from '../marketplaceHelpers';
import { SellerPayoutSetup } from '../SellerPayoutSetup';

interface Props {
  visible: boolean;
  onClose: () => void;
  analytics: SellerAnalytics | null;
  requirePaymentConfirmation: boolean;
  hallDropoffEnabled: boolean;
  hallDropoffMin: string;
  onRequirePaymentConfirmationChange: (value: boolean) => void;
  onHallDropoffEnabledChange: (value: boolean) => void;
  onHallDropoffMinChange: (value: string) => void;
}

export function SellerInsightsModal({
  visible,
  onClose,
  analytics,
  requirePaymentConfirmation,
  hallDropoffEnabled,
  hallDropoffMin,
  onRequirePaymentConfirmationChange,
  onHallDropoffEnabledChange,
  onHallDropoffMinChange,
}: Props) {
  const insets = useScreenInsets();
  const [savingPrefs, setSavingPrefs] = useState(false);
  // Earnings ledger (Phase 2 · I): what each sale paid out after the Lantern fee.
  const [payments, setPayments] = useState<Awaited<ReturnType<typeof fetchSellerPayments>>>([]);

  useEffect(() => {
    if (!visible) return;
    void fetchSellerPayments(1)
      .then(setPayments)
      .catch(() => setPayments([]));
  }, [visible]);

  const weeklyMax = analytics?.salesByWeek?.length
    ? Math.max(...analytics.salesByWeek.map(w => w.revenue), 1)
    : 1;

  const savePreferences = async () => {
    setSavingPrefs(true);
    try {
      await updateSellerPreferences({
        requirePaymentConfirmation,
        hallDropoffEnabled,
        hallDropoffMinAmount: hallDropoffMin.trim() ? Number(hallDropoffMin) : undefined,
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Bottom-anchored sheet: the keyboard lands exactly where it sits, so
          the preferences input was covered. The KAV lifts the whole sheet. */}
      <KeyboardAvoidingView behavior={SCREEN_KEYBOARD_BEHAVIOR} className="flex-1 justify-end">
        <Pressable className="flex-1 bg-black/40" onPress={onClose} />
        <View
          style={{ paddingBottom: insets.bottom + 12, maxHeight: '88%' }}
          className="bg-lantern-surface rounded-t-3xl border-t border-lantern-border"
        >
          <View className="w-10 h-1 rounded-full bg-lantern-border self-center mt-3 mb-2" />
          <View className="flex-row items-center justify-between px-5 pb-2">
            <Text className="text-lg font-bold text-lantern-text">Performance & preferences</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close insights"
              className="h-11 w-11 items-center justify-center"
            >
              <Ionicons name="close" size={22} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView
            className="px-4"
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            {analytics ? (
              <>
                <View className="flex-row flex-wrap gap-2 mb-3">
                  <Chip label="Revenue (30d)" value={formatPrice(analytics.revenue30d)} accent />
                  <Chip label="Total revenue" value={formatPrice(analytics.totalRevenue)} />
                  <Chip label="Avg sale" value={formatPrice(analytics.avgSalePrice)} />
                  <Chip label="Days to sell" value={String(analytics.avgTimeToSellDays)} />
                  <Chip
                    label={analytics.conversionRate30d != null ? 'View-to-sale (30d)' : 'View-to-sale'}
                    value={`${analytics.conversionRate30d != null ? analytics.conversionRate30d : analytics.conversionRate}%`}
                  />
                  <Chip label="Pending orders" value={String(analytics.pendingOrders)} />
                  <Chip label="Offer accept" value={`${analytics.offerAcceptRate}%`} />
                  <Chip label="Discounts" value={formatPrice(analytics.discountsGiven)} />
                </View>

                {analytics.funnel30d ? (
                  <View className="p-3 mb-2 rounded-xl bg-lantern-background border border-lantern-border">
                    <Text className="text-xs font-semibold text-lantern-text-secondary mb-1">Funnel (30d)</Text>
                    <Text className="text-xs text-lantern-text-secondary">
                      {analytics.funnel30d.impressions} impressions → {analytics.funnel30d.views} views →{' '}
                      {analytics.funnel30d.inquiries} inquiries → {analytics.funnel30d.offers} offers →{' '}
                      {analytics.funnel30d.sales} sales
                    </Text>
                  </View>
                ) : null}

                {analytics.viewsByDay && analytics.viewsByDay.some(d => d.views > 0) ? (
                  <View className="p-3 mb-2 rounded-xl bg-lantern-background border border-lantern-border">
                    <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Listing views (30d)</Text>
                    <View className="flex-row items-end gap-0.5 h-14">
                      {analytics.viewsByDay.map(day => {
                        const max = Math.max(...analytics.viewsByDay!.map(d => d.views), 1);
                        const height = Math.max(2, (day.views / max) * 100);
                        return (
                          <View
                            key={day.date}
                            className="flex-1 bg-emerald-500/80 rounded-t"
                            style={{ height: `${height}%` }}
                          />
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {analytics.salesByWeek.length > 0 ? (
                  <View className="p-3 mb-2 rounded-xl bg-lantern-background border border-lantern-border">
                    <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Weekly sales</Text>
                    <View className="flex-row items-end gap-1 h-16">
                      {analytics.salesByWeek.map(week => {
                        const height = Math.max(4, (week.revenue / weeklyMax) * 100);
                        return (
                          <View
                            key={week.weekStart}
                            className="flex-1 bg-lantern-primary/80 rounded-t"
                            style={{ height: `${height}%` }}
                          />
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {analytics.topListings && analytics.topListings.length > 0 ? (
                  <View className="p-3 mb-2 rounded-xl bg-lantern-background border border-lantern-border">
                    <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Top listings</Text>
                    {analytics.topListings.slice(0, 6).map(l => (
                      <View key={l.id} className="mb-2 pb-2 border-b border-lantern-border/60 last:border-0 last:mb-0 last:pb-0">
                        <Text className="text-sm text-lantern-text" numberOfLines={1}>
                          {l.title}{l.sold ? ' · sold' : ''}
                        </Text>
                        <Text className="text-xs text-lantern-text-secondary">
                          {l.views} views · {l.inquiries} inquiries · {l.offers} offers · {formatPrice(l.revenue)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {(analytics.staleListings?.length || analytics.highViewsLowEngagement?.length) ? (
                  <View className="p-3 mb-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                    <Text className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">Listing insights</Text>
                    {analytics.highViewsLowEngagement?.slice(0, 3).map(l => (
                      <Text key={l.id} className="text-xs text-amber-900 dark:text-amber-200 mb-1">
                        "{l.title}" — {l.views} views, no inquiries.
                      </Text>
                    ))}
                    {analytics.staleListings?.slice(0, 3).map(l => (
                      <Text key={l.id} className="text-xs text-amber-900 dark:text-amber-200 mb-1">
                        "{l.title}" — {l.daysListed} days listed with low activity.
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Text className="text-sm text-lantern-text-secondary mb-3">
                Analytics will appear once you have selling activity.
              </Text>
            )}

            {payments.length > 0 ? (
              <View className="mb-3 p-3 rounded-xl bg-lantern-background border border-lantern-border">
                <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Earnings</Text>
                {payments.slice(0, 10).map((p) => (
                  <View
                    key={p.orderId}
                    className="flex-row items-center py-1.5 border-b border-lantern-border/60"
                  >
                    <Text className="flex-1 text-xs text-lantern-text" numberOfLines={1}>
                      {p.title}
                    </Text>
                    {p.platformFeeKobo > 0 ? (
                      <Text className="text-[11px] text-lantern-text-tertiary mr-2">
                        −{formatPrice(Math.round(p.platformFeeKobo / 100))}
                      </Text>
                    ) : null}
                    <Text className="text-xs font-semibold text-lantern-text">
                      {formatPrice(Math.round(p.sellerPayoutKobo / 100))}
                    </Text>
                  </View>
                ))}
                <Text className="mt-2 text-[11px] text-lantern-text-tertiary">
                  Amounts shown are what you receive after the Lantern fee.
                </Text>
              </View>
            ) : null}

            <SellerPayoutSetup />

            <View className="p-3 rounded-xl bg-lantern-background border border-lantern-border">
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-2">Seller preferences</Text>
              {/* The require-payment-confirmation switch is gone: every order
                  now starts pending_payment and only the seller can confirm
                  payment, so the preference no longer changes anything. Props
                  stay wired for compatibility with the stored preference. */}
              <Text className="text-xs text-lantern-text-secondary mb-2">
                Every sale now waits for you to confirm payment before it counts as paid — cash at pickup included.
              </Text>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-sm text-lantern-text flex-1 mr-2">Offer hall dropoff</Text>
                <Switch value={hallDropoffEnabled} onValueChange={onHallDropoffEnabledChange} />
              </View>
              <TextInput
                value={hallDropoffMin}
                onChangeText={onHallDropoffMinChange}
                placeholder="Hall dropoff min amount (₦)"
                keyboardType="numeric"
                placeholderTextColor="#94a3b8"
                className="border border-lantern-border rounded-xl px-3 py-2 mb-2 text-lantern-text"
              />
              <Button loading={savingPrefs} onPress={() => void savePreferences()}>
                Save preferences
              </Button>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View className="px-3 py-2 rounded-lg bg-lantern-background border border-lantern-border min-w-[45%]">
      <Text className="text-xs text-lantern-text-secondary">{label}</Text>
      <Text className={`font-bold ${accent ? 'text-lantern-primary' : 'text-lantern-text'}`}>{value}</Text>
    </View>
  );
}

export default SellerInsightsModal;
