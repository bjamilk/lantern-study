import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { JobPosting } from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { fetchMyJobPostings } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function MyJobPostingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [jobs, setJobs] = useState<JobPosting[]>([]);

  useEffect(() => {
    void fetchMyJobPostings()
      .then((res) => setJobs(res.data || []))
      .catch(() => setJobs([]));
  }, []);

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="My jobs" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        {jobs.map((job) => (
          <Pressable key={job.id} onPress={() => navigation.navigate('JobDetail', { jobId: job.id })}>
            <Card className="mb-2">
              <Text className="font-semibold text-lantern-text">{job.title}</Text>
              <Text className="text-xs text-lantern-text-tertiary mt-1">{job.status}</Text>
              <Pressable
                className="mt-2"
                onPress={() => navigation.navigate('JobApplicants', { jobId: job.id })}
              >
                <Text className="text-sm text-lantern-primary">View applicants</Text>
              </Pressable>
            </Card>
          </Pressable>
        ))}
        {jobs.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">No job posts yet.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default MyJobPostingsScreen;
