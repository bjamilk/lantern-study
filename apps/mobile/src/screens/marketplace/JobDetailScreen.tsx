import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  JOB_EMPLOYMENT_TYPE_LABELS,
  formatJobCompensation,
  formatJobEngagementDuration,
  formatJobLocation,
  formatJobPostedDate,
  type JobPosting,
} from '@lantern/shared';
import { Card, ScreenHeader } from '../../components/ui';
import { applyToJob, fetchJobPosting, trackJobExternalApply } from '../../services/jobsBoard';
import type { MarketStackParamList } from '../../navigation/types';

export function JobDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const route = useRoute<RouteProp<MarketStackParamList, 'JobDetail'>>();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [message, setMessage] = useState('');
  const [resumeUrl, setResumeUrl] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
        {error ? (
          <View className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <Text className="text-sm text-red-700">{error}</Text>
          </View>
        ) : null}
        {job ? (
          <>
            <Card className="mb-3 border border-lantern-border">
              <View className="flex-row gap-3">
                {job.company?.logoUrl ? (
                  <Image
                    source={{ uri: job.company.logoUrl }}
                    className="h-14 w-14 rounded-xl border border-lantern-border bg-white"
                    resizeMode="contain"
                  />
                ) : (
                  <View className="h-14 w-14 items-center justify-center rounded-xl bg-lantern-primary/10">
                    <Text className="text-xl font-bold text-lantern-primary">
                      {(
                        job.company?.displayName ||
                        job.poster?.name ||
                        job.poster?.username ||
                        'J'
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  </View>
                )}
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap gap-1">
                    {job.isSponsored ? (
                      <Text className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        FEATURED
                      </Text>
                    ) : null}
                    {job.company?.verificationStatus === 'verified' ? (
                      <Text className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        VERIFIED
                      </Text>
                    ) : null}
                  </View>
                  <Text className="mt-1 text-xl font-bold text-lantern-text">{job.title}</Text>
                  <Text className="mt-1 text-sm text-lantern-text-secondary">
                    {job.company?.displayName ||
                      job.poster?.name ||
                      job.poster?.username ||
                      'Independent poster'}
                  </Text>
                </View>
              </View>
              <Text className="mt-3 text-xs text-lantern-text-tertiary">
                {formatJobLocation(job)} · {formatJobPostedDate(job.createdAt)}
              </Text>
            </Card>

            <Card className="mb-3 border border-lantern-border">
              <Text className="text-base font-semibold text-lantern-text">Job overview</Text>
              <View className="mt-3 gap-2">
                <View className="rounded-xl bg-lantern-background p-3">
                  <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                    Compensation
                  </Text>
                  <Text className="mt-1 text-sm font-semibold text-lantern-text">
                    {formatJobCompensation(job.compensation)}
                  </Text>
                </View>
                <View className="rounded-xl bg-lantern-background p-3">
                  <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                    Job type
                  </Text>
                  <Text className="mt-1 text-sm font-semibold text-lantern-text">
                    {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]}
                  </Text>
                </View>
                {formatJobEngagementDuration(job.engagementDuration) ? (
                  <View className="rounded-xl bg-lantern-background p-3">
                    <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                      Duration
                    </Text>
                    <Text className="mt-1 text-sm font-semibold text-lantern-text">
                      {formatJobEngagementDuration(job.engagementDuration)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Card>

            <Card className="mb-3 border border-lantern-border">
              <Text className="text-base font-semibold text-lantern-text">About this role</Text>
              <Text className="mt-3 text-sm leading-6 text-lantern-text">{job.description}</Text>
            </Card>
          </>
        ) : null}
        {job && (job.applyMode === 'in_app' || job.applyMode === 'both') ? (
          <Card className="mb-3 border border-lantern-border">
            <Text className="text-base font-semibold text-lantern-text">Apply for this job</Text>
            <Text className="mt-1 text-sm text-lantern-text-secondary">
              Send your details directly to the poster.
            </Text>

            {(job.screeningQuestions || []).map((question) => (
              <View key={question.id} className="mt-4">
                <Text className="text-sm font-medium text-lantern-text">
                  {question.prompt}
                  {question.required ? ' *' : ''}
                </Text>
                {question.questionType === 'single_choice' ? (
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    {(question.options || []).map((option) => (
                      <Pressable
                        key={option}
                        onPress={() =>
                          setAnswers((current) => ({ ...current, [question.id]: option }))
                        }
                        className={`rounded-full border px-3 py-2 ${
                          answers[question.id] === option
                            ? 'border-lantern-primary bg-lantern-primary'
                            : 'border-lantern-border bg-lantern-background'
                        }`}
                      >
                        <Text
                          className={`text-sm ${
                            answers[question.id] === option
                              ? 'font-semibold text-white'
                              : 'text-lantern-text'
                          }`}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <TextInput
                    className="mt-2 rounded-xl border border-lantern-border bg-lantern-background px-3 py-3 text-sm text-lantern-text"
                    value={answers[question.id] || ''}
                    onChangeText={(value) =>
                      setAnswers((current) => ({ ...current, [question.id]: value }))
                    }
                  />
                )}
              </View>
            ))}

            <Text className="mb-2 mt-4 text-sm font-medium text-lantern-text">
              Message to the poster <Text className="text-lantern-text-tertiary">(optional)</Text>
            </Text>
            <TextInput
              className="min-h-[96px] rounded-xl border border-lantern-border bg-lantern-background px-3 py-3 text-sm text-lantern-text"
              placeholder="Briefly introduce yourself and your interest."
              placeholderTextColor="#94a3b8"
              value={message}
              onChangeText={setMessage}
              multiline
              textAlignVertical="top"
            />
            {job.companyId ? (
              <>
                <Text className="mb-2 mt-4 text-sm font-medium text-lantern-text">
                  Resume URL <Text className="text-lantern-text-tertiary">(optional)</Text>
                </Text>
                <TextInput
                  className="rounded-xl border border-lantern-border bg-lantern-background px-3 py-3 text-sm text-lantern-text"
                  placeholder="https://…"
                  placeholderTextColor="#94a3b8"
                  value={resumeUrl}
                  onChangeText={setResumeUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </>
            ) : null}
            <Pressable
              disabled={busy}
              className="mt-4 items-center rounded-xl bg-lantern-primary py-3"
              onPress={() =>
                void (async () => {
                  setBusy(true);
                  setError(null);
                  setSuccess(null);
                  try {
                    const missingRequired = (job.screeningQuestions || []).find(
                      (question) => question.required && !answers[question.id]?.trim()
                    );
                    if (missingRequired) {
                      throw new Error(`Answer “${missingRequired.prompt}” before applying.`);
                    }
                    await applyToJob(job.id, {
                      message: message.trim() || undefined,
                      answers,
                      resumeUrl: resumeUrl.trim() || null,
                    });
                    setSuccess('Application sent. Track it from My applications.');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Apply failed');
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              <Text className="font-semibold text-white">
                {busy ? 'Submitting…' : 'Submit application'}
              </Text>
            </Pressable>
          </Card>
        ) : null}
        {job?.externalUrl && (job.applyMode === 'external' || job.applyMode === 'both') ? (
          <Pressable
            className="mb-3 items-center rounded-xl border border-lantern-primary bg-lantern-surface py-3"
            onPress={() =>
              void trackJobExternalApply(job.id).then((res) => Linking.openURL(res.data.url))
            }
          >
            <Text className="font-semibold text-lantern-primary">Apply on company site</Text>
          </Pressable>
        ) : null}
        {success ? (
          <View className="mb-3 rounded-xl bg-emerald-50 p-3">
            <Text className="text-sm text-emerald-700">{success}</Text>
          </View>
        ) : null}
        {job ? (
          <Text className="text-xs leading-5 text-lantern-text-tertiary">
            Never pay a fee to apply. Do not send BVN, NIN, passwords, or banking details.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default JobDetailScreen;
