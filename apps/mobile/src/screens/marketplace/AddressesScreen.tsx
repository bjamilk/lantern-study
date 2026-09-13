import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MarketplaceAddress } from '@lantern/shared/types';
import { formatMarketplaceAddressLine } from '@lantern/shared/marketplace';
import {
  createMarketplaceAddress,
  deleteMarketplaceAddress,
  fetchMarketplaceAddresses,
} from '../../services/api';
import { appAlert } from '../../components/ui/appDialog';
import { Button } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = { goBack: () => void };

export function AddressesScreen({ navigation }: { navigation: NavigationProp }) {
  const [rows, setRows] = useState<MarketplaceAddress[]>([]);
  const [recipient_name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [line1, setLine1] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setRows(await fetchMarketplaceAddresses().catch(() => []));
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await createMarketplaceAddress({ recipient_name, phone, city, line1, is_default: rows.length === 0 });
      setName('');
      setPhone('');
      setCity('');
      setLine1('');
      await load();
    } catch (error: unknown) {
      appAlert('Could not save', error instanceof Error ? error.message : 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <AppIcon name="arrow-back" size={24} />
        </Pressable>
        <Text className="text-title text-lantern-text ml-2">Addresses</Text>
      </View>
      <ScrollView className="flex-1 px-4" contentContainerClassName="pb-8 gap-4">
        <Text className="text-caption text-lantern-text-secondary">
          We save the address. The seller finds a rider. Lantern is not the courier.
        </Text>
        {rows.map((row) => (
          <View key={row.id} className="p-4 rounded-2xl border border-lantern-border bg-lantern-surface">
            <Text className="text-body text-lantern-text">{row.recipient_name}</Text>
            <Text className="text-caption text-lantern-text-secondary mt-1">
              {formatMarketplaceAddressLine(row)}
            </Text>
            <Pressable onPress={() => void deleteMarketplaceAddress(row.id).then(load)}>
              <Text className="text-caption text-lantern-error mt-2">Remove</Text>
            </Pressable>
          </View>
        ))}
        <TextInput className="min-h-[44px] px-3 rounded-xl border border-lantern-border text-body text-lantern-text" placeholder="Name" value={recipient_name} onChangeText={setName} />
        <TextInput className="min-h-[44px] px-3 rounded-xl border border-lantern-border text-body text-lantern-text" placeholder="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <TextInput className="min-h-[44px] px-3 rounded-xl border border-lantern-border text-body text-lantern-text" placeholder="City" value={city} onChangeText={setCity} />
        <TextInput className="min-h-[44px] px-3 rounded-xl border border-lantern-border text-body text-lantern-text" placeholder="Street or room" value={line1} onChangeText={setLine1} />
        <Button onPress={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save address'}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
