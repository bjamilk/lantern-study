import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { JobApplication, JobApplicationStatus } from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { fetchJobApplicants, updateJobApplicationStatus } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

const STATUSES: JobApplicationStatus[] = [
  'new',
  'interested',
  'chatting',
  'reviewing',
  'interview',
  'offer',
  'hired',
  'rejected',
];

export function JobApplicantsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const route = useRoute<RouteProp<MarketStackParamList, 'JobApplicants'>>();
  const [apps, setApps] = useState<JobApplication[]>([]);

  const load = () =>
    fetchJobApplicants(route.params.jobId)
      .then((res) => setApps(res.data || []))
      .catch(() => setApps([]));

  useEffect(() => {
    void load();
  }, [route.params.jobId]);

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Applicants" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        {apps.map((app) => (
          <Card key={app.id} className="mb-2">
            <Text className="font-semibold text-lantern-text">
              {app.applicant?.name || app.applicant?.username || 'Applicant'}
            </Text>
            <Text className="text-xs text-lantern-text-tertiary mt-1">Status: {app.status}</Text>
            <ScrollView horizontal className="mt-2" showsHorizontalScrollIndicator={false}>
              {STATUSES.map((s) => (
                <Pressable
                  key={s}
                  className={`mr-2 px-2 py-1 rounded border ${
                    app.status === s ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                  }`}
                  onPress={() =>
                    void updateJobApplicationStatus(app.id, { status: s }).then(() => load())
                  }
                >
                  <Text className={`text-[10px] ${app.status === s ? 'text-white' : 'text-lantern-text'}`}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Card>
        ))}
        {apps.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">No applicants yet.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default JobApplicantsScreen;
