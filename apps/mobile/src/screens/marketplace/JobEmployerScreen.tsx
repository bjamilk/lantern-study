import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { JOBS_COMPANY_EEO_NOTICE } from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { createJobCompany, fetchMyJobCompanies } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function JobEmployerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [companies, setCompanies] = useState<any[]>([]);
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchMyJobCompanies()
      .then((res) => setCompanies(res.data || []))
      .catch(() => setCompanies([]));

  useEffect(() => {
    void load();
  }, []);

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Employer" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-xs text-lantern-text-tertiary mb-3">{JOBS_COMPANY_EEO_NOTICE}</Text>
        <Card className="mb-3">
          <Text className="font-semibold text-lantern-text mb-2">Your companies</Text>
          {companies.map((row: any) => (
            <Text key={row.company?.id} className="text-sm text-lantern-text mb-1">
              {row.company?.displayName} · {row.company?.verificationStatus}
            </Text>
          ))}
          {companies.length === 0 ? (
            <Text className="text-sm text-lantern-text-secondary">None yet.</Text>
          ) : null}
        </Card>
        <Card>
          <Text className="font-semibold text-lantern-text mb-2">Register company</Text>
          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
            placeholder="Legal name"
            placeholderTextColor="#94a3b8"
            value={legalName}
            onChangeText={setLegalName}
          />
          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
            placeholder="Display name"
            placeholderTextColor="#94a3b8"
            value={displayName}
            onChangeText={setDisplayName}
          />
          {error ? <Text className="text-red-600 text-sm mb-2">{error}</Text> : null}
          {message ? <Text className="text-emerald-600 text-sm mb-2">{message}</Text> : null}
          <Pressable
            className="rounded-lg bg-lantern-primary py-3 items-center"
            onPress={() =>
              void (async () => {
                setError(null);
                try {
                  await createJobCompany({
                    legalName,
                    displayName: displayName || legalName,
                  });
                  setMessage('Submitted for verification.');
                  setLegalName('');
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed');
                }
              })()
            }
          >
            <Text className="text-white font-semibold">Submit</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}

export default JobEmployerScreen;
