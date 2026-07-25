import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  JOB_APPLICATION_STATUS_LABELS,
  type JobApplication,
  type JobApplicationStatus,
} from '@lantern/shared';
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
        <Text className="mb-3 text-sm text-lantern-text-secondary">
          {apps.length} {apps.length === 1 ? 'candidate' : 'candidates'} in this pipeline
        </Text>
        {apps.map((app) => (
          <Card key={app.id} className="mb-3 border border-lantern-border">
            <Text className="text-base font-semibold text-lantern-text">
              {app.applicant?.name || app.applicant?.username || 'Applicant'}
            </Text>
            <Text className="mt-1 text-xs text-lantern-text-tertiary">
              Applied{' '}
              {new Date(app.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
            <Text className="mt-3 text-sm font-medium text-lantern-text">
              {JOB_APPLICATION_STATUS_LABELS[app.status]}
            </Text>
            {app.status === 'withdrawn' ? (
              <Text className="mt-2 text-xs text-lantern-text-secondary">
                This candidate withdrew their application.
              </Text>
            ) : (
              <ScrollView horizontal className="mt-3" showsHorizontalScrollIndicator={false}>
                {STATUSES.map((status) => (
                  <Pressable
                    key={status}
                    className={`mr-2 rounded-full border px-3 py-2 ${
                      app.status === status
                        ? 'border-lantern-primary bg-lantern-primary'
                        : 'border-lantern-border'
                    }`}
                    onPress={() =>
                      void updateJobApplicationStatus(app.id, { status }).then(() => load())
                    }
                  >
                    <Text
                      className={`text-xs ${
                        app.status === status ? 'font-semibold text-white' : 'text-lantern-text'
                      }`}
                    >
                      {JOB_APPLICATION_STATUS_LABELS[status]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
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
