import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  JOBS_CREATE_CONFIRMATION,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_PHASE1_EMPLOYMENT_TYPES,
  type JobEmploymentType,
} from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { createJobPosting } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function CreateJobScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [employmentType, setEmploymentType] = useState<JobEmploymentType>('tutoring');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Post a job" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Card className="mb-3 space-y-3">
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            {JOB_PHASE1_EMPLOYMENT_TYPES.map((t) => (
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
                  const res = await createJobPosting({
                    title,
                    description,
                    employmentType,
                    compensation: { kind: 'discuss' },
                    applyMode: 'in_app',
                    status: 'active',
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
