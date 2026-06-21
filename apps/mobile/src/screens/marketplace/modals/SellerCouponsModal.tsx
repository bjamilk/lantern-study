import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
      <View className="flex-1 justify-end bg-black/40">
        <View className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[85%]">
          <View className="flex-row items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
            <Text className="text-lg font-bold text-slate-900 dark:text-slate-100">Seller coupons</Text>
            <Pressable onPress={onClose}><Text className="text-indigo-600 font-semibold">Close</Text></Pressable>
          </View>
          <ScrollView className="p-4" contentContainerStyle={{ paddingBottom: 24 }}>
            <Text className="text-sm text-slate-500 mb-3">Buyers apply these at checkout on your listings.</Text>
            <TextInput
              value={code}
              onChangeText={t => setCode(t.toUpperCase())}
              placeholder="CODE"
              className="border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-2 text-slate-900 dark:text-slate-100"
              placeholderTextColor="#94a3b8"
            />
            <View className="flex-row gap-2 mb-2">
              {(['percent', 'fixed'] as const).map(t => (
                <Pressable
                  key={t}
                  onPress={() => setDiscountType(t)}
                  className={`flex-1 py-2 rounded-lg items-center ${discountType === t ? 'bg-indigo-600' : 'bg-slate-100 dark:bg-slate-800'}`}
                >
                  <Text className={discountType === t ? 'text-white text-xs font-semibold' : 'text-slate-600 text-xs'}>
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
              className="border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-3 text-slate-900 dark:text-slate-100"
              placeholderTextColor="#94a3b8"
            />
            {error ? <Text className="text-sm text-red-600 mb-2">{error}</Text> : null}
            <Button loading={saving} onPress={() => void handleCreate()}>Create coupon</Button>
            {coupons.map(c => (
              <View key={c.id} className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <Text className="font-mono font-bold">{c.code}</Text>
                <Text className="text-xs text-slate-500 mt-1">
                  {c.discount_type === 'percent'
                    ? `${c.discount_value}% off`
                    : `${formatPrice(Number(c.discount_value))} off`}
                  {' · '}{c.uses_count}{c.max_uses != null ? `/${c.max_uses}` : ''} used
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
