import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { JobApplication } from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { fetchMyJobApplications } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function MyJobApplicationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [apps, setApps] = useState<JobApplication[]>([]);

  useEffect(() => {
    void fetchMyJobApplications()
      .then((res) => setApps(res.data || []))
      .catch(() => setApps([]));
  }, []);

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="My applications" onBack={() => navigation.goBack()} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        {apps.map((app) => (
          <Pressable
            key={app.id}
            onPress={() => navigation.navigate('JobDetail', { jobId: app.postingId })}
          >
            <Card className="mb-2">
              <Text className="font-semibold text-lantern-text">{app.posting?.title || 'Job'}</Text>
              <Text className="text-xs text-lantern-text-tertiary mt-1">Status: {app.status}</Text>
            </Card>
          </Pressable>
        ))}
        {apps.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">No applications yet.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default MyJobApplicationsScreen;
