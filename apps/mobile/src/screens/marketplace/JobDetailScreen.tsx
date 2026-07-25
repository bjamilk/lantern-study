import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { JOB_EMPLOYMENT_TYPE_LABELS, type JobPosting } from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { applyToJob, fetchJobPosting, trackJobExternalApply } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function JobDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const route = useRoute<RouteProp<MarketStackParamList, 'JobDetail'>>();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void fetchJobPosting(route.params.jobId)
      .then((res) => setJob(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [route.params.jobId]);

  if (!job && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-lantern-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Job" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        {error ? <Text className="text-red-600 text-sm mb-2">{error}</Text> : null}
        {job ? (
          <Card className="mb-4">
            <Text className="text-xs text-lantern-text-tertiary">
              {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]}
            </Text>
            <Text className="text-xl font-semibold text-lantern-text mt-1">{job.title}</Text>
            <Text className="text-sm text-lantern-text mt-3">{job.description}</Text>
          </Card>
        ) : null}
        {job && (job.applyMode === 'in_app' || job.applyMode === 'both') ? (
          <Card className="mb-4">
            <Text className="text-sm font-semibold text-lantern-text mb-2">Easy Apply</Text>
            <TextInput
              className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text mb-3"
              placeholder="Optional message"
              placeholderTextColor="#94a3b8"
              value={message}
              onChangeText={setMessage}
              multiline
            />
            <Pressable
              disabled={busy}
              className="rounded-lg bg-lantern-primary py-3 items-center"
              onPress={() =>
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await applyToJob(job.id, { message });
                    setSuccess('Application sent — check chat for the thread.');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Apply failed');
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              <Text className="text-white font-semibold">{busy ? 'Submitting…' : "I'm interested"}</Text>
            </Pressable>
          </Card>
        ) : null}
        {job?.externalUrl && (job.applyMode === 'external' || job.applyMode === 'both') ? (
          <Pressable
            className="rounded-lg border border-lantern-border py-3 items-center mb-3"
            onPress={() =>
              void trackJobExternalApply(job.id).then((res) => Linking.openURL(res.data.url))
            }
          >
            <Text className="text-lantern-text font-medium">Apply on company site</Text>
          </Pressable>
        ) : null}
        {success ? <Text className="text-emerald-600 text-sm">{success}</Text> : null}
      </ScrollView>
    </View>
  );
}

export default JobDetailScreen;
