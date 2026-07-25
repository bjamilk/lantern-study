import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  JOBS_CREATE_CONFIRMATION,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_INTENT_TEMPLATE_GROUPS,
  JOB_INTENT_TEMPLATES,
  JOB_PHASE1_EMPLOYMENT_TYPES,
  JOB_PHASE2_EMPLOYMENT_TYPES,
  jobIntentTemplatesByGroup,
  type JobEmploymentType,
} from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { createJobPosting, fetchMyJobCompanies } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function CreateJobScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [employmentType, setEmploymentType] = useState<JobEmploymentType>('part_time');
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState<Array<{ id: string; displayName: string; verificationStatus: string }>>(
    []
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchMyJobCompanies()
      .then((res) =>
        setCompanies(
          (res.data || [])
            .map((row: any) => row.company)
            .filter(Boolean)
            .map((c: any) => ({
              id: c.id,
              displayName: c.displayName || c.display_name,
              verificationStatus: c.verificationStatus || c.verification_status,
            }))
        )
      )
      .catch(() => setCompanies([]));
  }, []);

  const allowedTypes = useMemo(
    () => (companyId ? JOB_PHASE2_EMPLOYMENT_TYPES : JOB_PHASE1_EMPLOYMENT_TYPES),
    [companyId]
  );

  useEffect(() => {
    if (!allowedTypes.includes(employmentType)) {
      setEmploymentType('part_time');
    }
  }, [allowedTypes, employmentType]);

  const applyTemplate = (id: string) => {
    const t = JOB_INTENT_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (!allowedTypes.includes(t.employmentType) && !companyId) {
      setError('That template’s type needs a company account. Select a company below, or pick another template.');
    } else {
      setError(null);
    }
    setEmploymentType(t.employmentType);
    setTitle(t.title);
    setDescription(t.descriptionHint);
  };

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Post a job" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Card className="mb-3 space-y-3">
          {JOB_INTENT_TEMPLATE_GROUPS.map((group) => (
            <View key={group.id} className="mb-2">
              <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary mb-1.5">
                {group.label}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {jobIntentTemplatesByGroup(group.id).map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => applyTemplate(t.id)}
                    className="mr-2 px-3 py-1.5 rounded-lg border border-lantern-border"
                  >
                    <Text className="text-xs text-lantern-text">
                      {t.title.replace(/\s*\[.*?\]\s*/g, ' ').trim()}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}

          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
            placeholder="Title"
            placeholderTextColor="#94a3b8"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text min-h-[100px]"
            placeholder="Description"
            placeholderTextColor="#94a3b8"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-1">
            {allowedTypes.map((t) => (
              <Pressable
                key={t}
                onPress={() => setEmploymentType(t)}
                className={`mr-2 px-3 py-1.5 rounded-lg border ${
                  employmentType === t ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                }`}
              >
                <Text className={`text-xs ${employmentType === t ? 'text-white' : 'text-lantern-text'}`}>
                  {JOB_EMPLOYMENT_TYPE_LABELS[t]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {!companyId ? (
            <Text className="text-[11px] text-lantern-text-tertiary mb-1">
              Internship, full-time, and contract unlock when you post as a company.
            </Text>
          ) : null}

          {companies.length > 0 ? (
            <View className="mb-1">
              <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary mb-1.5">
                Post as
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Pressable
                  onPress={() => setCompanyId('')}
                  className={`mr-2 px-3 py-1.5 rounded-lg border ${
                    !companyId ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                  }`}
                >
                  <Text className={`text-xs ${!companyId ? 'text-white' : 'text-lantern-text'}`}>
                    Individual / org (no company)
                  </Text>
                </Pressable>
                {companies.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setCompanyId(c.id)}
                    className={`mr-2 px-3 py-1.5 rounded-lg border ${
                      companyId === c.id ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                    }`}
                  >
                    <Text className={`text-xs ${companyId === c.id ? 'text-white' : 'text-lantern-text'}`}>
                      {c.displayName}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Pressable onPress={() => setConfirmed((v) => !v)} className="flex-row items-start gap-2">
            <Text className="text-lantern-primary">{confirmed ? '☑' : '☐'}</Text>
            <Text className="flex-1 text-xs text-lantern-text-secondary">{JOBS_CREATE_CONFIRMATION}</Text>
          </Pressable>
          {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
          <Pressable
            disabled={busy || !title.trim() || !confirmed}
            className="rounded-lg bg-lantern-primary py-3 items-center opacity-100"
            onPress={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  if (!allowedTypes.includes(employmentType)) {
                    throw new Error('That employment type requires a verified company account.');
                  }
                  const res = await createJobPosting({
                    title,
                    description,
                    employmentType,
                    compensation: { kind: 'discuss' },
                    applyMode: 'in_app',
                    status: 'active',
                    companyId: companyId || null,
                  });
                  navigation.replace('JobDetail', { jobId: res.data.id });
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed to publish');
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            <Text className="text-white font-semibold">{busy ? 'Publishing…' : 'Publish job'}</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}

export default CreateJobScreen;
