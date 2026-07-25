import React, { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JOB_APPLICANT_SORT_LABELS,
  JOB_APPLICATION_STATUS_LABELS,
  filterJobApplicants,
  sortJobApplicants,
  summarizeJobApplicants,
  type JobApplicantSort,
  type JobApplication,
  type JobApplicationStatus,
  type JobPosting,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import { JobApplicantNotes } from "../../components/jobs/JobApplicantNotes";
import { JobInterviewScheduler } from "../../components/jobs/JobInterviewScheduler";
import { JobOfferPanel } from "../../components/jobs/JobOfferPanel";
import {
  fetchJobApplicants,
  fetchJobApplicationResumeUrl,
  fetchJobPosting,
  updateJobApplicationStatus,
} from "../../services/jobsBoard";
import { useAuthStore } from "../../stores";
import type { MarketStackParamList } from "../../navigation/types";

const STATUSES: JobApplicationStatus[] = [
  "new",
  "interested",
  "chatting",
  "reviewing",
  "interview",
  "offer",
  "hired",
  "rejected",
];
const SORTS: JobApplicantSort[] = ["newest", "oldest", "name"];

export function JobApplicantsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const route = useRoute<RouteProp<MarketStackParamList, "JobApplicants">>();
  const { user } = useAuthStore();
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [openingResumeId, setOpeningResumeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<JobApplicantSort>("newest");
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);
  const [openInterviewsId, setOpenInterviewsId] = useState<string | null>(null);
  const [openOfferId, setOpenOfferId] = useState<string | null>(null);
  // Held so the offer form can seed from the job's own terms.
  const [posting, setPosting] = useState<JobPosting | null>(null);

  // Resumes live in a private bucket, so each view needs a fresh signed link.
  const openResume = async (applicationId: string) => {
    setOpeningResumeId(applicationId);
    setError(null);
    try {
      const response = await fetchJobApplicationResumeUrl(applicationId);
      await Linking.openURL(response.data.url);
    } catch (resumeError) {
      setError(
        resumeError instanceof Error
          ? resumeError.message
          : "Could not open the resume",
      );
    } finally {
      setOpeningResumeId(null);
    }
  };

  const load = () =>
    fetchJobApplicants(route.params.jobId)
      .then((res) => setApps(res.data || []))
      .catch(() => setApps([]));

  useEffect(() => {
    void load();
    void fetchJobPosting(route.params.jobId)
      .then((res) => setPosting(res.data))
      .catch(() => setPosting(null));
  }, [route.params.jobId]);

  const applyNotesCount = (applicationId: string, count: number) =>
    setApps((current) =>
      current.map((app) =>
        app.id === applicationId ? { ...app, notesCount: count } : app,
      ),
    );

  const visible = useMemo(
    () => sortJobApplicants(filterJobApplicants(apps, search), sort),
    [apps, search, sort],
  );
  const summary = useMemo(() => summarizeJobApplicants(apps), [apps]);
  const filtering = !!search.trim();

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Applicants" onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mb-2 text-sm text-lantern-text-secondary">
          {summary.total} {summary.total === 1 ? "candidate" : "candidates"} in
          this pipeline
          {summary.needsReview > 0
            ? ` · ${summary.needsReview} awaiting review`
            : ""}
        </Text>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search candidates"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Search candidates by name"
          className="mb-2 rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2.5 text-sm text-lantern-text"
        />
        <ScrollView
          horizontal
          className="mb-3"
          showsHorizontalScrollIndicator={false}
        >
          {SORTS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setSort(option)}
              accessibilityRole="button"
              className={`mr-2 rounded-full border px-3 py-2 ${
                sort === option
                  ? "border-lantern-primary bg-lantern-primary"
                  : "border-lantern-border"
              }`}
            >
              <Text
                className={`text-xs ${
                  sort === option
                    ? "font-semibold text-white"
                    : "text-lantern-text"
                }`}
              >
                {JOB_APPLICANT_SORT_LABELS[option]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {error ? (
          <View className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <Text className="text-sm text-red-700">{error}</Text>
          </View>
        ) : null}

        {visible.map((app) => (
          <Card key={app.id} className="mb-3 border border-lantern-border">
            <Text className="text-base font-semibold text-lantern-text">
              {app.applicant?.name || app.applicant?.username || "Applicant"}
            </Text>
            <Text className="mt-1 text-xs text-lantern-text-tertiary">
              Applied{" "}
              {new Date(app.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
            <Text className="mt-3 text-sm font-medium text-lantern-text">
              {JOB_APPLICATION_STATUS_LABELS[app.status]}
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {app.resumePath || app.resumeUrl ? (
                <Pressable
                  disabled={openingResumeId === app.id}
                  onPress={() => void openResume(app.id)}
                  accessibilityRole="button"
                  className="rounded-lg border border-lantern-border px-3 py-2"
                >
                  <Text className="text-sm font-medium text-lantern-primary">
                    {openingResumeId === app.id ? "Opening…" : "View resume"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() =>
                  setOpenNotesId((current) =>
                    current === app.id ? null : app.id,
                  )
                }
                accessibilityRole="button"
                className="rounded-lg border border-lantern-border px-3 py-2"
              >
                <Text className="text-sm font-medium text-lantern-primary">
                  {openNotesId === app.id
                    ? "Hide notes"
                    : app.notesCount
                      ? `Notes (${app.notesCount})`
                      : "Add note"}
                </Text>
              </Pressable>
              {app.status === "withdrawn" ? null : (
                <Pressable
                  onPress={() =>
                    setOpenInterviewsId((current) =>
                      current === app.id ? null : app.id,
                    )
                  }
                  accessibilityRole="button"
                  className="rounded-lg border border-lantern-border px-3 py-2"
                >
                  <Text className="text-sm font-medium text-lantern-primary">
                    {openInterviewsId === app.id
                      ? "Hide interviews"
                      : "Interviews"}
                  </Text>
                </Pressable>
              )}
              {app.status === "withdrawn" ? null : (
                <Pressable
                  onPress={() =>
                    setOpenOfferId((current) =>
                      current === app.id ? null : app.id,
                    )
                  }
                  accessibilityRole="button"
                  className="rounded-lg border border-lantern-border px-3 py-2"
                >
                  <Text className="text-sm font-medium text-lantern-primary">
                    {openOfferId === app.id ? "Hide offer" : "Offer"}
                  </Text>
                </Pressable>
              )}
            </View>
            {app.status === "withdrawn" ? (
              <Text className="mt-2 text-xs text-lantern-text-secondary">
                This candidate withdrew their application.
              </Text>
            ) : (
              <ScrollView
                horizontal
                className="mt-3"
                showsHorizontalScrollIndicator={false}
              >
                {STATUSES.map((status) => (
                  <Pressable
                    key={status}
                    className={`mr-2 rounded-full border px-3 py-2 ${
                      app.status === status
                        ? "border-lantern-primary bg-lantern-primary"
                        : "border-lantern-border"
                    }`}
                    onPress={() =>
                      void updateJobApplicationStatus(app.id, { status }).then(
                        () => load(),
                      )
                    }
                  >
                    <Text
                      className={`text-xs ${
                        app.status === status
                          ? "font-semibold text-white"
                          : "text-lantern-text"
                      }`}
                    >
                      {JOB_APPLICATION_STATUS_LABELS[status]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {openInterviewsId === app.id ? (
              <JobInterviewScheduler
                applicationId={app.id}
                candidateName={
                  app.applicant?.name || app.applicant?.username || "Candidate"
                }
                jobTitle={posting?.title}
              />
            ) : null}
            {openOfferId === app.id ? (
              <JobOfferPanel
                applicationId={app.id}
                candidateName={
                  app.applicant?.name || app.applicant?.username || "Candidate"
                }
                posting={posting}
              />
            ) : null}
            {openNotesId === app.id ? (
              <JobApplicantNotes
                applicationId={app.id}
                currentUserId={user?.id}
                onCountChange={applyNotesCount}
              />
            ) : null}
          </Card>
        ))}

        {apps.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">
            No applicants yet.
          </Text>
        ) : visible.length === 0 ? (
          <Text className="text-sm text-lantern-text-secondary">
            No candidates match “{search.trim()}”.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default JobApplicantsScreen;
