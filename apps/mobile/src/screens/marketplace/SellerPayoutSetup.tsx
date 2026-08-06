import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fetchPaystackBanks,
  fetchSellerPayoutProfile,
  upsertSellerPayoutProfile,
} from '../../services/api';
import { Button } from '../../components/ui';

type Bank = { name: string; code: string };

export function SellerPayoutSetup() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [profile, setProfile] = useState<{
    account_name?: string | null;
    account_number_last4?: string | null;
    bank_code?: string | null;
    status?: string;
  } | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, b] = await Promise.all([
          fetchSellerPayoutProfile(),
          fetchPaystackBanks().catch(() => []),
        ]);
        if (cancelled) return;
        setProfile(p);
        setBanks(b || []);
        if (p?.bank_code) setBankCode(p.bank_code);
      } catch (err: unknown) {
        if (!cancelled) {
          Alert.alert(
            'Payout settings',
            err instanceof Error ? err.message : 'Could not load payout settings'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBank = banks.find((b) => b.code === bankCode);

  const onSave = async () => {
    if (!accountNumber.trim() || !bankCode) {
      Alert.alert('Missing details', 'Enter account number and select a bank');
      return;
    }
    setSaving(true);
    try {
      const saved = await upsertSellerPayoutProfile({
        accountNumber: accountNumber.trim(),
        bankCode,
      });
      setProfile(saved);
      setAccountNumber('');
      Alert.alert('Saved', 'Payout bank account verified and saved.');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save bank account');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View className="p-3 rounded-xl bg-lantern-background border border-lantern-border mb-3">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="p-3 rounded-xl bg-lantern-background border border-lantern-border mb-3 gap-3">
      <View>
        <Text className="text-sm font-semibold text-lantern-text">Payout bank account</Text>
        <Text className="text-xs text-lantern-text-secondary mt-1">
          Buyers pay via Paystack. After they confirm delivery, your listing amount is transferred
          here. Lantern keeps a 5% service charge.
        </Text>
      </View>

      {profile?.status === 'active' ? (
        <View className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2">
          <Text className="text-sm text-emerald-900 dark:text-emerald-200">
            Active: {profile.account_name} ···{profile.account_number_last4}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => setPickerOpen((v) => !v)}
        className="border border-lantern-border rounded-xl px-3 py-3"
      >
        <Text className="text-xs text-lantern-text-secondary mb-0.5">Bank</Text>
        <Text className="text-lantern-text">
          {selectedBank?.name || 'Select bank'}
        </Text>
      </Pressable>
      {pickerOpen ? (
        <ScrollView className="max-h-40 border border-lantern-border rounded-xl">
          {banks.map((b) => (
            <Pressable
              key={b.code}
              className="px-3 py-2 border-b border-lantern-border/60"
              onPress={() => {
                setBankCode(b.code);
                setPickerOpen(false);
              }}
            >
              <Text className="text-sm text-lantern-text">{b.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <TextInput
        value={accountNumber}
        onChangeText={(t) => setAccountNumber(t.replace(/\D/g, '').slice(0, 12))}
        placeholder="NUBAN account number"
        keyboardType="number-pad"
        placeholderTextColor="#94a3b8"
        className="border border-lantern-border rounded-xl px-3 py-3 text-lantern-text"
      />

      <Button loading={saving} onPress={() => void onSave()}>
        {profile?.status === 'active' ? 'Update bank account' : 'Save bank account'}
      </Button>
    </View>
  );
}
