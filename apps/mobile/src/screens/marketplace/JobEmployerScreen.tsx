import React, { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  JOBS_COMPANY_EEO_NOTICE,
  canEditJobCompanyProfile,
  canManageJobCompanyMembers,
  type JobCompany,
  type JobCompanyMemberRole,
} from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import {
  createJobCompany,
  fetchMyJobCompanies,
  inviteJobCompanyMember,
  updateJobCompany,
} from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';

export function JobEmployerScreen() {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [companies, setCompanies] = useState<
    Array<{ role: JobCompanyMemberRole; company: JobCompany }>
  >([]);
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagline, setTagline] = useState('');
  const [about, setAbout] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchMyJobCompanies()
      .then((res) =>
        setCompanies(
          ((res.data || []) as Array<{
            role: JobCompanyMemberRole;
            company: JobCompany;
          }>).filter((row) => !!row.company?.id),
        ),
      )
      .catch(() => setCompanies([]));

  useEffect(() => {
    void load();
  }, []);

  const startEdit = (company: JobCompany) => {
    setEditingId(company.id);
    setTagline(company.tagline || '');
    setAbout(company.about || '');
    setInviteUsername('');
    setMessage(null);
    setError(null);
  };

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Employer" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        <Text className="text-xs text-lantern-text-tertiary mb-3">{JOBS_COMPANY_EEO_NOTICE}</Text>
        <Card className="mb-3">
          <Text className="font-semibold text-lantern-text mb-2">Your companies</Text>
          {companies.map((row) => (
            <View key={row.company.id} className="mb-3 border-b border-lantern-border pb-3">
              <View className="flex-row items-center gap-2 mb-1">
                {row.company.logoUrl ? (
                  <Image
                    source={{ uri: row.company.logoUrl }}
                    className="h-8 w-8 rounded-lg bg-white"
                    resizeMode="contain"
                  />
                ) : null}
                <Text className="text-sm text-lantern-text flex-1">
                  {row.company.displayName} · {row.company.verificationStatus}
                </Text>
              </View>
              {row.company.verificationStatus === "rejected" &&
              row.company.verificationNote ? (
                <Text className="text-xs text-red-700 mb-1">
                  Admin note: {row.company.verificationNote}
                </Text>
              ) : null}
              <View className="flex-row gap-3 mt-1">
                <Pressable
                  onPress={() =>
                    navigation.navigate('JobCompany', { companyId: row.company.id })
                  }
                >
                  <Text className="text-xs font-semibold text-lantern-primary">View page</Text>
                </Pressable>
                {canEditJobCompanyProfile(row.role) ? (
                  <Pressable onPress={() => startEdit(row.company)}>
                    <Text className="text-xs font-semibold text-lantern-primary">Edit</Text>
                  </Pressable>
                ) : null}
              </View>
              {editingId === row.company.id ? (
                <View className="mt-2">
                  <TextInput
                    className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
                    placeholder="Tagline"
                    placeholderTextColor="#94a3b8"
                    value={tagline}
                    onChangeText={setTagline}
                  />
                  <TextInput
                    className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
                    placeholder="About"
                    placeholderTextColor="#94a3b8"
                    value={about}
                    onChangeText={setAbout}
                    multiline
                  />
                  <Pressable
                    className="rounded-lg bg-lantern-primary py-2 items-center mb-2"
                    onPress={() =>
                      void (async () => {
                        setError(null);
                        try {
                          await updateJobCompany(row.company.id, { tagline, about });
                          setMessage('Profile saved.');
                          setEditingId(null);
                          await load();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Failed to save');
                        }
                      })()
                    }
                  >
                    <Text className="text-white font-semibold text-sm">Save</Text>
                  </Pressable>
                  {canManageJobCompanyMembers(row.role) ? (
                    <View className="flex-row gap-2">
                      <TextInput
                        className="flex-1 rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
                        placeholder="Invite @username"
                        placeholderTextColor="#94a3b8"
                        value={inviteUsername}
                        onChangeText={setInviteUsername}
                        autoCapitalize="none"
                      />
                      <Pressable
                        className="rounded-lg border border-lantern-border px-3 justify-center"
                        onPress={() =>
                          void (async () => {
                            setError(null);
                            try {
                              await inviteJobCompanyMember(row.company.id, {
                                username: inviteUsername,
                              });
                              setInviteUsername('');
                              setMessage('Recruiter invited.');
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Invite failed');
                            }
                          })()
                        }
                      >
                        <Text className="text-sm font-semibold text-lantern-text">Invite</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
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
