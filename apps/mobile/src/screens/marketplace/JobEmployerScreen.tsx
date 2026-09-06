import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  JOBS_COMPANY_EEO_NOTICE,
  canEditJobCompanyProfile,
  canManageJobCompanyMembers,
  canRemoveJobCompanyMember,
  type JobCompany,
  type JobCompanyMember,
  type JobCompanyMemberRole,
} from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { Screen } from '../../components/layout';
import {
  createJobCompany,
  fetchJobCompanyMembers,
  fetchMyJobCompanies,
  inviteJobCompanyMember,
  removeJobCompanyMember,
  updateJobCompany,
  uploadJobCompanyLogo,
} from '../../services/jobsBoard';
import { prepareImageBase64ForUpload } from '../../utils/prepareImage';
import { useAuthStore } from '../../stores';
import type { JobsStackParamList } from '../../navigation/types';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';

export function JobEmployerScreen() {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const navigation = useNavigation<NativeStackNavigationProp<JobsStackParamList>>();
  const actorUserId = useAuthStore((state) => state.user?.id || '');
  const [companies, setCompanies] = useState<
    Array<{ role: JobCompanyMemberRole; company: JobCompany }>
  >([]);
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [website, setWebsite] = useState('');
  const [domain, setDomain] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Edit-form fields for the expanded company, mirroring the web manage card.
  const [editDisplayName, setEditDisplayName] = useState('');
  const [tagline, setTagline] = useState('');
  const [about, setAbout] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [hqLocation, setHqLocation] = useState('');
  const [members, setMembers] = useState<JobCompanyMember[]>([]);
  const [inviteUsername, setInviteUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
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

  const startEdit = (company: JobCompany, role: JobCompanyMemberRole) => {
    setEditingId(company.id);
    setEditDisplayName(company.displayName || '');
    setTagline(company.tagline || '');
    setAbout(company.about || '');
    setEditWebsite(company.website || '');
    setIndustry(company.industry || '');
    setHqLocation(company.hqLocation || '');
    setInviteUsername('');
    setMembers([]);
    setMessage(null);
    setError(null);
    if (canManageJobCompanyMembers(role)) {
      void fetchJobCompanyMembers(company.id)
        .then((res) => setMembers((res.data || []) as JobCompanyMember[]))
        .catch(() => setMembers([]));
    }
  };

  const applyUpdatedCompany = (next: JobCompany) => {
    setCompanies((prev) =>
      prev.map((item) =>
        item.company.id === next.id ? { ...item, company: next } : item,
      ),
    );
  };

  const saveProfile = (company: JobCompany) =>
    void (async () => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await updateJobCompany(company.id, {
          displayName: editDisplayName,
          tagline,
          about,
          website: editWebsite,
          industry,
          hqLocation,
        });
        applyUpdatedCompany(res.data as JobCompany);
        setMessage('Company profile saved.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save');
      } finally {
        setBusy(false);
      }
    })();

  const pickLogo = (company: JobCompany) =>
    void (async () => {
      setError(null);
      setMessage(null);
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Photo library access is needed.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      setLogoUploading(true);
      try {
        const prepared = await prepareImageBase64ForUpload(
          result.assets[0].uri,
          'companyLogo',
          { fileName: `logo-${Date.now()}.jpg` },
        );
        const res = await uploadJobCompanyLogo(company.id, {
          base64Data: prepared.base64Data,
          fileName: prepared.fileName,
        });
        applyUpdatedCompany(res.data as JobCompany);
        setMessage('Logo updated.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to upload logo');
      } finally {
        setLogoUploading(false);
      }
    })();

  const invite = (companyId: string) =>
    void (async () => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await inviteJobCompanyMember(companyId, {
          username: inviteUsername,
        });
        setMembers((prev) => [...prev, res.data as JobCompanyMember]);
        setInviteUsername('');
        setMessage('Recruiter invited.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invite failed');
      } finally {
        setBusy(false);
      }
    })();

  const removeMember = (companyId: string, userId: string) =>
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await removeJobCompanyMember(companyId, userId);
        setMembers((prev) => prev.filter((m) => m.userId !== userId));
        setMessage('Teammate removed.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove teammate');
      } finally {
        setBusy(false);
      }
    })();

  return (
    /* ScreenHeader safeTop already pays the top inset, so `edges={[]}`; the
       list keeps its own tab-bar clearance, so `bottom="none"`. What was
       missing is `keyboard`: this app targets SDK 36, where Android no longer
       honours adjustResize, so with no KeyboardAvoidingView the window never
       resizes, the scroll viewport never shrinks, and a covered input cannot
       be scrolled to. The offset is measured, because a bare KAV under the
       in-flow TopBar under-lifts by the bar's (animating) height. */
    <Screen edges={[]} bottom="none" keyboard>
      <ScreenHeader safeTop title="Employer" onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xs text-lantern-text-tertiary mb-3">{JOBS_COMPANY_EEO_NOTICE}</Text>
        <Card className="mb-3">
          <Text className="font-semibold text-lantern-text mb-2">Your companies</Text>
          {companies.map((row) => {
            const editing = editingId === row.company.id;
            const canEdit = canEditJobCompanyProfile(row.role);
            const canManage = canManageJobCompanyMembers(row.role);
            return (
              <View key={row.company.id} className="mb-3 border-b border-lantern-border pb-3">
                <View className="flex-row items-center gap-2 mb-1">
                  {row.company.logoUrl ? (
                    <Image
                      source={{ uri: row.company.logoUrl }}
                      className="h-8 w-8 rounded-lg bg-white"
                      resizeMode="contain"
                    />
                  ) : (
                    <View className="h-8 w-8 rounded-lg bg-lantern-primary/10 items-center justify-center">
                      <Text className="text-sm font-bold text-lantern-primary-text">
                        {(row.company.displayName || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text className="text-sm text-lantern-text flex-1">
                    {row.company.displayName} · {row.company.verificationStatus}
                  </Text>
                </View>
                {row.company.verificationStatus === 'rejected' &&
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
                    <Text className="text-xs font-semibold text-lantern-primary-text">View page</Text>
                  </Pressable>
                  {canEdit ? (
                    <Pressable
                      onPress={() =>
                        editing ? setEditingId(null) : startEdit(row.company, row.role)
                      }
                    >
                      <Text className="text-xs font-semibold text-lantern-primary-text">
                        {editing ? 'Close' : 'Edit'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {editing && canEdit ? (
                  <View className="mt-2">
                    <View className="flex-row items-center gap-3 mb-2">
                      {row.company.logoUrl ? (
                        <Image
                          source={{ uri: row.company.logoUrl }}
                          className="h-12 w-12 rounded-lg bg-white border border-lantern-border"
                          resizeMode="contain"
                        />
                      ) : (
                        <View className="h-12 w-12 rounded-lg bg-lantern-primary/10 items-center justify-center">
                          <Text className="text-base font-bold text-lantern-primary-text">
                            {(editDisplayName || '?').charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Pressable
                        disabled={logoUploading}
                        onPress={() => pickLogo(row.company)}
                        className="rounded-lg border border-lantern-border px-3 py-2 flex-row items-center gap-2"
                      >
                        {logoUploading ? (
                          <ActivityIndicator size="small" color="#0f766e" />
                        ) : null}
                        <Text className="text-sm font-semibold text-lantern-text">
                          {logoUploading ? 'Uploading…' : 'Change logo'}
                        </Text>
                      </Pressable>
                    </View>
                    <TextInput
                      className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
                      placeholder="Display name"
                      placeholderTextColor="#94a3b8"
                      value={editDisplayName}
                      onChangeText={setEditDisplayName}
                    />
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
                    <TextInput
                      className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
                      placeholder="Website"
                      placeholderTextColor="#94a3b8"
                      value={editWebsite}
                      onChangeText={setEditWebsite}
                      autoCapitalize="none"
                      keyboardType="url"
                    />
                    <TextInput
                      className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
                      placeholder="Industry"
                      placeholderTextColor="#94a3b8"
                      value={industry}
                      onChangeText={setIndustry}
                    />
                    <TextInput
                      className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
                      placeholder="HQ / city"
                      placeholderTextColor="#94a3b8"
                      value={hqLocation}
                      onChangeText={setHqLocation}
                    />
                    <Pressable
                      disabled={busy || !editDisplayName.trim()}
                      className={`rounded-lg py-2 items-center mb-2 ${
                        busy || !editDisplayName.trim()
                          ? 'bg-lantern-primary/50'
                          : 'bg-lantern-primary-fill'
                      }`}
                      onPress={() => saveProfile(row.company)}
                    >
                      <Text className="text-white font-semibold text-sm">Save profile</Text>
                    </Pressable>

                    {canManage ? (
                      <View className="border-t border-lantern-border pt-2 mt-1">
                        <Text className="text-sm font-semibold text-lantern-text mb-2">Team</Text>
                        {members.map((member) => (
                          <View
                            key={member.id}
                            className="flex-row items-center justify-between gap-2 py-1"
                          >
                            <Text className="text-sm text-lantern-text flex-1" numberOfLines={1}>
                              {member.user?.name || member.user?.username || member.userId}
                              <Text className="text-lantern-text-tertiary"> · {member.role}</Text>
                            </Text>
                            {canRemoveJobCompanyMember({
                              actorRole: row.role,
                              targetRole: member.role,
                              actorUserId,
                              targetUserId: member.userId,
                            }) ? (
                              <Pressable
                                disabled={busy}
                                onPress={() => removeMember(row.company.id, member.userId)}
                                hitSlop={8}
                              >
                                <Text className="text-xs font-semibold text-red-600">Remove</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        ))}
                        <View className="flex-row gap-2 mt-1">
                          <TextInput
                            className="flex-1 rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
                            placeholder="Invite @username"
                            placeholderTextColor="#94a3b8"
                            value={inviteUsername}
                            onChangeText={setInviteUsername}
                            autoCapitalize="none"
                          />
                          <Pressable
                            disabled={busy || !inviteUsername.trim()}
                            className="rounded-lg border border-lantern-border px-3 justify-center"
                            onPress={() => invite(row.company.id)}
                          >
                            <Text className="text-sm font-semibold text-lantern-text">Invite</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    {error ? <Text className="text-red-600 text-sm mt-2">{error}</Text> : null}
                    {message ? (
                      <Text className="text-emerald-600 text-sm mt-2">{message}</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
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
          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
            placeholder="Website"
            placeholderTextColor="#94a3b8"
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            keyboardType="url"
          />
          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm mb-2 text-lantern-text"
            placeholder="Work email domain (e.g. company.com)"
            placeholderTextColor="#94a3b8"
            value={domain}
            onChangeText={setDomain}
            autoCapitalize="none"
            keyboardType="url"
          />
          {editingId === null && error ? (
            <Text className="text-red-600 text-sm mb-2">{error}</Text>
          ) : null}
          {editingId === null && message ? (
            <Text className="text-emerald-600 text-sm mb-2">{message}</Text>
          ) : null}
          <Pressable
            disabled={busy || !legalName.trim()}
            className={`rounded-lg py-3 items-center ${
              busy || !legalName.trim() ? 'bg-lantern-primary/50' : 'bg-lantern-primary-fill'
            }`}
            onPress={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                setMessage(null);
                try {
                  await createJobCompany({
                    legalName,
                    displayName: displayName || legalName,
                    website,
                    verificationDomain: domain,
                  });
                  setMessage('Submitted for verification.');
                  setLegalName('');
                  setDisplayName('');
                  setWebsite('');
                  setDomain('');
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed');
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            <Text className="text-white font-semibold">Submit for verification</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}

export default JobEmployerScreen;
