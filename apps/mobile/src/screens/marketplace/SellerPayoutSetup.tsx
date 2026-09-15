/**
 * The payout-profile gate: the bank-account form a seller must complete before
 * Paystack earnings can be transferred. Embedded at the top of
 * SellerPayoutScreen rather than being its own route.
 *
 * Exports: SellerPayoutSetup.
 * Touches: fetchSellerPayoutProfile, fetchPaystackBanks and
 * upsertSellerPayoutProfile in ../../services/api.
 *
 * Gotchas: the split is stated here and differs by kind — hand-over items are
 * buyer-pays-list with Lantern keeping 5% (seller receives 95% once the buyer
 * confirms); study packs and question banks keep 15% and pay out on purchase.
 * The account number is never displayed back in full, only the stored last 4.
 * A failed bank-list fetch degrades to an empty picker, so the form cannot be
 * completed and says nothing about why.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
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
          appAlert(
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
      appAlert('Missing details', 'Enter account number and select a bank');
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
      appAlert('Saved', 'Payout bank account verified and saved.');
    } catch (err: unknown) {
      appAlert('Error', err instanceof Error ? err.message : 'Could not save bank account');
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
          Buyers pay via Paystack and your earnings are transferred here.
        </Text>
        <Text className="text-xs text-lantern-text-secondary mt-1.5">
          <Text className="font-semibold text-lantern-text">Items you hand over:</Text> buyers pay your
          list price and Lantern keeps 5%, so you receive 95% once they confirm delivery.
        </Text>
        <Text className="text-xs text-lantern-text-secondary mt-1">
          <Text className="font-semibold text-lantern-text">Study packs & question banks:</Text>{' '}
          buyers pay your list price and Lantern keeps a 15% commission, so you receive 85%, paid out
          automatically on purchase.
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
