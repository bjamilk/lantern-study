import React, { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Share,
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
  buildJobApplicantsCsv,
  filterJobApplicants,
  jobApplicantsCsvFilename,
  sortJobApplicants,
  summarizeJobApplicants,
  type JobApplicantSort,
  type JobApplication,
  type JobApplicationStatus,
  type JobPosting,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import { JobApplicantNotes } from "../../components/jobs/JobApplicantNotes";
import { JobBulkActionsBar } from "../../components/jobs/JobBulkActionsBar";
import { JobInterviewScheduler } from "../../components/jobs/JobInterviewScheduler";
import { JobOfferPanel } from "../../components/jobs/JobOfferPanel";
import { JobPostingInsights } from "../../components/jobs/JobPostingInsights";
import {
  bulkUpdateJobApplicationStatus,
  exportJobApplicantsCsv,
  fetchJobApplicants,
  fetchJobApplicationResumeUrl,
  fetchJobPosting,
  updateJobApplicationStatus,
} from "../../services/jobsBoard";
import { useAuthStore } from "../../stores";
import type { MarketStackParamList } from "../../navigation/types";
import { useTabBarClearance } from '../../components/layout/BottomTabBar';

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
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

  const toggleSelected = (applicationId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(applicationId)) next.delete(applicationId);
      else next.add(applicationId);
      return next;
    });
  };

  const questionLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const question of posting?.screeningQuestions || []) {
      labels[question.id] = question.prompt;
    }
    return labels;
  }, [posting]);

  const runBulkStatus = async (status: JobApplicationStatus) => {
    const applicationIds = [...selectedIds];
    if (!applicationIds.length) return;
    setBulkBusy(true);
    setError(null);
    try {
      await bulkUpdateJobApplicationStatus(route.params.jobId, {
        applicationIds,
        status,
      });
      setSelectedIds(new Set());
      await load();
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Could not update selected applicants",
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const shareCsv = async (csv: string, filename: string) => {
    await Share.share({ message: csv, title: filename });
  };

  const exportSelected = async () => {
    const selected = apps.filter((app) => selectedIds.has(app.id));
    if (!selected.length) return;
    const filename = jobApplicantsCsvFilename(posting?.title);
    await shareCsv(
      buildJobApplicantsCsv(selected, {
        postingTitle: posting?.title,
        questionLabels,
      }),
      filename,
    );
  };

  const exportAll = async () => {
    setBulkBusy(true);
    setError(null);
    try {
      const response = await exportJobApplicantsCsv(route.params.jobId);
      await shareCsv(response.data.csv, response.data.filename);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Could not export applicants",
      );
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader title="Applicants" onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mb-2 text-sm text-lantern-text-secondary">
          {summary.total} {summary.total === 1 ? "candidate" : "candidates"} in
          this pipeline
          {summary.needsReview > 0
            ? ` · ${summary.needsReview} awaiting review`
            : ""}
        </Text>

        <JobPostingInsights postingId={route.params.jobId} />

        <JobBulkActionsBar
          selectedCount={selectedIds.size}
          totalCount={apps.length}
          busy={bulkBusy}
          onClear={() => setSelectedIds(new Set())}
          onSelectAll={() =>
            setSelectedIds(new Set(visible.map((app) => app.id)))
          }
          onBulkStatus={runBulkStatus}
          onExportSelected={exportSelected}
          onExportAll={exportAll}
        />

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
          <Card
            key={app.id}
            className={`mb-3 border ${
              selectedIds.has(app.id)
                ? "border-lantern-primary"
                : "border-lantern-border"
            }`}
          >
            <Pressable
              onPress={() => toggleSelected(app.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selectedIds.has(app.id) }}
              className="mb-2 flex-row items-center"
            >
              <View
                className={`mr-2 h-5 w-5 items-center justify-center rounded border ${
                  selectedIds.has(app.id)
                    ? "border-lantern-primary bg-lantern-primary"
                    : "border-lantern-border bg-lantern-background"
                }`}
              >
                {selectedIds.has(app.id) ? (
                  <Text className="text-xs font-bold text-white">✓</Text>
                ) : null}
              </View>
              <Text className="text-xs font-medium text-lantern-text-secondary">
                {selectedIds.has(app.id) ? "Selected" : "Select"}
              </Text>
            </Pressable>
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
