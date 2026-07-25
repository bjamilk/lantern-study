import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  JOBS_COMPLIANCE_BANNER,
  JOB_EMPLOYMENT_TYPE_LABELS,
  type JobPosting,
} from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { fetchJobPostings } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function JobsHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJobPostings({ page: 1, limit: 40, search: search.trim() || undefined });
      setJobs(res.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader
        title="Campus jobs"
        subtitle="Goods · Jobs"
        onBack={() => navigation.navigate('MarketplaceHome')}
        right={
          <Pressable onPress={() => navigation.navigate('CreateJob')} className="px-2 py-1">
            <Text className="text-sm font-semibold text-lantern-primary">Post</Text>
          </Pressable>
        }
      />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        <Text className="text-xs text-lantern-text-tertiary mb-3">{JOBS_COMPLIANCE_BANNER}</Text>
        <View className="flex-row gap-2 mb-3">
          <TextInput
            className="flex-1 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
            placeholder="Search jobs"
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => void load()}
          />
          <Pressable onPress={() => navigation.navigate('MyJobApplications')} className="justify-center px-2">
            <Text className="text-xs text-lantern-primary">Apps</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('MyJobPostings')} className="justify-center px-2">
            <Text className="text-xs text-lantern-primary">Mine</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('JobEmployer')} className="justify-center px-2">
            <Text className="text-xs text-lantern-primary">Employer</Text>
          </Pressable>
        </View>
        {loading ? <ActivityIndicator /> : null}
        {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
        {jobs.map((job) => (
          <Pressable key={job.id} onPress={() => navigation.navigate('JobDetail', { jobId: job.id })}>
            <Card className="mb-2">
              <Text className="font-semibold text-lantern-text">{job.title}</Text>
              <Text className="text-xs text-lantern-text-tertiary mt-1">
                {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType] || job.employmentType}
                {job.isSponsored ? ' · Sponsored' : ''}
                {job.company?.verificationStatus === 'verified' ? ' · Verified' : ''}
              </Text>
              <Text className="text-sm text-lantern-text-secondary mt-2" numberOfLines={3}>
                {job.description}
              </Text>
            </Card>
          </Pressable>
        ))}
        {!loading && jobs.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">No jobs yet. Be the first to post.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default JobsHomeScreen;
