import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SCREEN_KEYBOARD_BEHAVIOR, useScreenInsets } from '../../../components/layout';
import { createSellerCoupon, fetchSellerCoupons } from '../../../services/api';
import type { MarketplaceCoupon } from '@lantern/shared/types';
import { Button } from '../../../components/ui';
import { formatPrice } from '../marketplaceHelpers';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SellerCouponsModal({ visible, onClose }: Props) {
  const [coupons, setCoupons] = useState<MarketplaceCoupon[]>([]);
  const insets = useScreenInsets();
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setCoupons(await fetchSellerCoupons());
    } catch {
      setCoupons([]);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const handleCreate = async () => {
    setError('');
    const value = Number(discountValue);
    if (!code.trim() || !value || value <= 0) {
      setError('Enter a code and valid discount.');
      return;
    }
    setSaving(true);
    try {
      await createSellerCoupon({ code: code.trim(), discountType, discountValue: value });
      setCode('');
      setDiscountValue('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create coupon');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* A bottom-anchored sheet occupies exactly the band the keyboard
          replaces, so its inputs and its submit button were covered. Lifting
          the sheet with the KAV also makes the percentage max-height resolve
          against the keyboard-free box, so the sheet self-limits. */}
      <KeyboardAvoidingView
        behavior={SCREEN_KEYBOARD_BEHAVIOR}
        className="flex-1 justify-end bg-black/40"
      >
        <View className="bg-lantern-surface rounded-t-3xl max-h-[85%]">
          <View className="flex-row items-center justify-between p-4 border-b border-lantern-border">
            <Text className="text-lg font-bold text-lantern-text">Seller coupons</Text>
            <Pressable onPress={onClose}><Text className="text-lantern-primary font-semibold">Close</Text></Pressable>
          </View>
          <ScrollView
            className="p-4"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="text-sm text-lantern-text-secondary mb-3">Buyers apply these at checkout on your listings.</Text>
            <TextInput
              value={code}
              onChangeText={t => setCode(t.toUpperCase())}
              placeholder="CODE"
              className="border border-lantern-border rounded-xl px-3 py-2 mb-2 text-lantern-text"
              placeholderTextColor="#94a3b8"
            />
            <View className="flex-row gap-2 mb-2">
              {(['percent', 'fixed'] as const).map(t => (
                <Pressable
                  key={t}
                  onPress={() => setDiscountType(t)}
                  className={`flex-1 py-2 rounded-lg items-center ${discountType === t ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'}`}
                >
                  <Text className={discountType === t ? 'text-white text-xs font-semibold' : 'text-lantern-text-secondary text-xs'}>
                    {t === 'percent' ? '% off' : '₦ off'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={discountValue}
              onChangeText={setDiscountValue}
              placeholder={discountType === 'percent' ? '10' : '500'}
              keyboardType="numeric"
              className="border border-lantern-border rounded-xl px-3 py-2 mb-3 text-lantern-text"
              placeholderTextColor="#94a3b8"
            />
            {error ? <Text className="text-sm text-red-600 mb-2">{error}</Text> : null}
            <Button loading={saving} onPress={() => void handleCreate()}>Create coupon</Button>
            {coupons.map(c => (
              <View key={c.id} className="mt-3 p-3 rounded-xl bg-lantern-background-secondary border border-lantern-border">
                <Text className="font-mono font-bold">{c.code}</Text>
                <Text className="text-xs text-lantern-text-secondary mt-1">
                  {c.discount_type === 'percent'
                    ? `${c.discount_value}% off`
                    : `${formatPrice(Number(c.discount_value))} off`}
                  {' · '}{c.uses_count}{c.max_uses != null ? `/${c.max_uses}` : ''} used
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
