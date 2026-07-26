import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_POSTING_STATUS_LABELS,
  formatJobCompensation,
  formatJobPostedDate,
  isJobPostingEditable,
  jobPostingStatusActions,
  type JobPosting,
  type JobPostingStatus,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import { JobEmployerInsights } from "../../components/jobs/JobEmployerInsights";
import { fetchMyJobPostings, updateJobPosting } from "../../services/jobsBoard";
import type { MarketStackParamList } from "../../navigation/types";

const STATUS_STYLES: Record<JobPosting["status"], string> = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  closed: "bg-slate-100 text-slate-700",
  pending_school_approval: "bg-amber-100 text-amber-800",
  suspended_by_admin: "bg-red-100 text-red-800",
  removed_by_admin: "bg-red-100 text-red-800",
};

export function MyJobPostingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMyJobPostings();
      setJobs(response.data || []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load job posts",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (jobId: string, status: JobPostingStatus) => {
    setSavingId(jobId);
    setError(null);
    try {
      await updateJobPosting(jobId, { status });
      await load();
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not update this job",
      );
    } finally {
      setSavingId(null);
    }
  };

  const activeCount = jobs.filter((job) => job.status === "active").length;
  const totalViews = jobs.reduce((sum, job) => sum + (job.viewsCount || 0), 0);
  const totalApplicants = jobs.reduce(
    (sum, job) => sum + (job.applicationsCount || 0),
    0,
  );
  const totalNeedsReview = jobs.reduce(
    (sum, job) => sum + (job.newApplicationsCount || 0),
    0,
  );

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader
        title="My job posts"
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            onPress={() => navigation.navigate("CreateJob")}
            className="rounded-lg bg-lantern-primary px-3 py-2"
          >
            <Text className="text-sm font-semibold text-white">Post job</Text>
          </Pressable>
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View className="px-4">
          <Text className="text-2xl font-bold text-lantern-text">
            Manage your hiring
          </Text>
          <Text className="mt-1 text-sm text-lantern-text-secondary">
            Review post performance and applicant pipelines.
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4 mt-4"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            <Card className="w-32">
              <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                Posts
              </Text>
              <Text className="mt-2 text-2xl font-bold text-lantern-text">
                {jobs.length}
              </Text>
            </Card>
            <Card className="w-32">
              <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                Active
              </Text>
              <Text className="mt-2 text-2xl font-bold text-lantern-text">
                {activeCount}
              </Text>
            </Card>
            <Card className="w-32">
              <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                Views
              </Text>
              <Text className="mt-2 text-2xl font-bold text-lantern-text">
                {totalViews}
              </Text>
            </Card>
            <Card className="w-32">
              <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                Applicants
              </Text>
              <Text className="mt-2 text-2xl font-bold text-lantern-text">
                {totalApplicants}
              </Text>
              {totalNeedsReview > 0 ? (
                <Text className="mt-1 text-xs font-medium text-lantern-primary">
                  {totalNeedsReview} new
                </Text>
              ) : null}
            </Card>
          </ScrollView>

          <JobEmployerInsights
            onOpenPosting={(postingId) =>
              navigation.navigate("JobApplicants", { jobId: postingId })
            }
          />

          {error ? (
            <View className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
              <Text className="text-sm text-red-700">{error}</Text>
              <Pressable onPress={() => void load()} className="mt-2">
                <Text className="text-sm font-semibold text-red-700">
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : null}

          {loading ? (
            <ActivityIndicator color="#0f766e" className="my-10" />
          ) : null}

          {!loading &&
            jobs.map((job) => (
              <Card key={job.id} className="mt-3 border border-lantern-border">
                <Pressable
                  onPress={() =>
                    navigation.navigate("JobDetail", { jobId: job.id })
                  }
                  accessibilityRole="button"
                >
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="flex-shrink text-base font-semibold text-lantern-text">
                      {job.title}
                    </Text>
                    <Text
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLES[job.status]}`}
                    >
                      {JOB_POSTING_STATUS_LABELS[job.status]}
                    </Text>
                  </View>
                  <Text className="mt-1 text-sm text-lantern-text-secondary">
                    {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]} ·{" "}
                    {formatJobCompensation(job.compensation)}
                  </Text>
                  <Text className="mt-2 text-xs text-lantern-text-tertiary">
                    {formatJobPostedDate(job.createdAt)} · {job.viewsCount || 0}{" "}
                    views · {job.applicationsCount || 0}{" "}
                    {job.applicationsCount === 1 ? "applicant" : "applicants"}
                  </Text>
                </Pressable>

                <View className="mt-4 flex-row flex-wrap gap-2">
                  <Pressable
                    className="flex-row items-center gap-2 rounded-lg bg-lantern-primary px-3 py-2"
                    onPress={() =>
                      navigation.navigate("JobApplicants", { jobId: job.id })
                    }
                  >
                    <Text className="text-sm font-semibold text-white">
                      Review applicants
                    </Text>
                    {job.newApplicationsCount ? (
                      <Text className="rounded-full bg-white/25 px-1.5 text-xs font-bold text-white">
                        {job.newApplicationsCount}
                      </Text>
                    ) : null}
                  </Pressable>
                  <Pressable
                    className="rounded-lg border border-lantern-border px-3 py-2"
                    onPress={() =>
                      navigation.navigate("JobDetail", { jobId: job.id })
                    }
                  >
                    <Text className="text-sm font-medium text-lantern-text">
                      View post
                    </Text>
                  </Pressable>
                  {isJobPostingEditable(job.status) ? (
                    <Pressable
                      className="rounded-lg border border-lantern-border px-3 py-2"
                      onPress={() =>
                        navigation.navigate("CreateJob", { jobId: job.id })
                      }
                    >
                      <Text className="text-sm font-medium text-lantern-text">
                        Edit
                      </Text>
                    </Pressable>
                  ) : null}
                  {jobPostingStatusActions(job.status).map((action) => (
                    <Pressable
                      key={action.status}
                      disabled={savingId === job.id}
                      className="rounded-lg border border-lantern-border px-3 py-2"
                      onPress={() => void changeStatus(job.id, action.status)}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          action.destructive
                            ? "text-lantern-text-secondary"
                            : "text-lantern-text"
                        }`}
                      >
                        {savingId === job.id ? "Saving…" : action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            ))}

          {!loading && jobs.length === 0 ? (
            <View className="mt-4 rounded-2xl border border-dashed border-lantern-border bg-lantern-surface p-8">
              <Text className="text-center text-base font-semibold text-lantern-text">
                Post your first opportunity
              </Text>
              <Text className="mt-2 text-center text-sm text-lantern-text-secondary">
                Reach candidates across Nigeria.
              </Text>
              <Pressable
                onPress={() => navigation.navigate("CreateJob")}
                className="mt-4 items-center rounded-xl bg-lantern-primary py-3"
              >
                <Text className="text-sm font-semibold text-white">
                  Create job post
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

export default MyJobPostingsScreen;
