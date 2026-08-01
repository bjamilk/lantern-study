import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JOB_APPLICATION_STATUS_DESCRIPTIONS,
  JOB_APPLICATION_STATUS_LABELS,
  type JobApplicantProfile,
  type JobApplication,
  type JobApplicationStatus,
  type JobInterview,
  type JobOffer,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import { JobInterviewInvite } from "../../components/jobs/JobInterviewInvite";
import { JobOfferCard } from "../../components/jobs/JobOfferCard";
import { ResumeUploadField } from "../../components/jobs/ResumeUploadField";
import {
  fetchJobApplicantProfile,
  fetchJobApplicationResumeUrl,
  fetchMyJobApplications,
  fetchMyJobInterviews,
  fetchMyJobOffers,
  updateJobApplicationStatus,
} from "../../services/jobsBoard";
import type { MarketStackParamList } from "../../navigation/types";

const CLOSED_STATUSES = new Set<JobApplicationStatus>([
  "hired",
  "rejected",
  "withdrawn",
]);

const STATUS_STYLES: Record<JobApplicationStatus, string> = {
  interested: "bg-sky-100 text-sky-800",
  chatting: "bg-indigo-100 text-indigo-800",
  new: "bg-blue-100 text-blue-800",
  reviewing: "bg-violet-100 text-violet-800",
  interview: "bg-amber-100 text-amber-800",
  offer: "bg-emerald-100 text-emerald-800",
  hired: "bg-emerald-100 text-emerald-800",
  rejected: "bg-slate-100 text-slate-700",
  withdrawn: "bg-slate-100 text-slate-700",
};

export function MyJobApplicationsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [interviews, setInterviews] = useState<JobInterview[]>([]);
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "closed">("active");
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [profile, setProfile] = useState<JobApplicantProfile | null>(null);
  const [openingResumeId, setOpeningResumeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMyJobApplications();
      setApps(response.data || []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load applications",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchJobApplicantProfile()
      .then((response) => setProfile(response.data))
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    // One request for every interview beats one per application card.
    void fetchMyJobInterviews()
      .then((response) => setInterviews(response.data || []))
      .catch(() => setInterviews([]));
    void fetchMyJobOffers()
      .then((response) => setOffers(response.data || []))
      .catch(() => setOffers([]));
  }, []);

  /**
   * The newest unfinished interview per application. Cancelled and completed
   * rounds stay out so an old invitation cannot be answered, but a declined one
   * is kept so the candidate can see their own answer landed.
   */
  const interviewsByApplication = useMemo(() => {
    const map = new Map<string, JobInterview>();
    for (const interview of interviews) {
      if (
        interview.status === "cancelled" ||
        interview.status === "completed"
      ) {
        continue;
      }
      const current = map.get(interview.applicationId);
      if (
        !current ||
        new Date(interview.createdAt).getTime() >
          new Date(current.createdAt).getTime()
      ) {
        map.set(interview.applicationId, interview);
      }
    }
    return map;
  }, [interviews]);

  const applyInterviewUpdate = useCallback((updated: JobInterview) => {
    setInterviews((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  /**
   * The newest offer per application. Withdrawn ones stay out; an accepted or
   * declined one is kept so the candidate can still see the terms they answered.
   */
  const offersByApplication = useMemo(() => {
    const map = new Map<string, JobOffer>();
    for (const offer of offers) {
      if (offer.status === "withdrawn") continue;
      const current = map.get(offer.applicationId);
      if (
        !current ||
        new Date(offer.createdAt).getTime() >
          new Date(current.createdAt).getTime()
      ) {
        map.set(offer.applicationId, offer);
      }
    }
    return map;
  }, [offers]);

  /**
   * Accepting an offer also moves the application to hired, so the list is
   * refreshed rather than patched to keep the status badge honest.
   */
  const applyOfferUpdate = useCallback(
    (updated: JobOffer) => {
      setOffers((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      void load();
    },
    [load],
  );

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

  const filteredApps = useMemo(
    () =>
      [...apps]
        .filter((application) =>
          view === "closed"
            ? CLOSED_STATUSES.has(application.status)
            : !CLOSED_STATUSES.has(application.status),
        )
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [apps, view],
  );

  const withdraw = async (applicationId: string) => {
    setWithdrawingId(applicationId);
    setError(null);
    try {
      await updateJobApplicationStatus(applicationId, {
        status: "withdrawn",
        asApplicant: true,
      });
      await load();
    } catch (withdrawError) {
      setError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Could not withdraw",
      );
    } finally {
      setWithdrawingId(null);
    }
  };

  const activeCount = apps.filter(
    (application) => !CLOSED_STATUSES.has(application.status),
  ).length;

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={["top"]}>
      <ScreenHeader
        title="My applications"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View className="px-4">
          <Text className="text-2xl font-bold text-lantern-text">
            Track your progress
          </Text>
          <Text className="mt-1 text-sm text-lantern-text-secondary">
            See where every application stands.
          </Text>

          <View className="mt-4 flex-row gap-3">
            <Card className="flex-1">
              <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                Total
              </Text>
              <Text className="mt-2 text-2xl font-bold text-lantern-text">
                {apps.length}
              </Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                Active
              </Text>
              <Text className="mt-2 text-2xl font-bold text-lantern-text">
                {activeCount}
              </Text>
            </Card>
          </View>

          <Card className="mt-4 border border-lantern-border">
            <Text className="text-base font-semibold text-lantern-text">
              Your applicant profile
            </Text>
            <Text className="mt-1 text-sm text-lantern-text-secondary">
              Upload once and it is attached to every application you send.
            </Text>
            <View className="mt-3">
              <ResumeUploadField profile={profile} onUploaded={setProfile} />
            </View>
          </Card>

          <View className="mt-4 flex-row rounded-xl border border-lantern-border bg-lantern-surface p-1">
            {(["active", "closed"] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setView(option)}
                className={`flex-1 items-center rounded-lg py-2 ${
                  view === option ? "bg-lantern-primary" : ""
                }`}
              >
                <Text
                  className={`text-sm font-semibold capitalize ${
                    view === option
                      ? "text-white"
                      : "text-lantern-text-secondary"
                  }`}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>

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
            filteredApps.map((application) => {
              const posting = application.posting;
              const employer =
                posting?.company?.displayName ||
                posting?.poster?.name ||
                posting?.poster?.username ||
                "Independent poster";
              const canWithdraw = !CLOSED_STATUSES.has(application.status);
              const liveInterview = interviewsByApplication.get(application.id);
              const liveOffer = offersByApplication.get(application.id);

              return (
                <Card
                  key={application.id}
                  className="mt-3 border border-lantern-border"
                >
                  <Pressable
                    onPress={() =>
                      navigation.navigate("JobDetail", {
                        jobId: application.postingId,
                      })
                    }
                    accessibilityRole="button"
                  >
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="flex-shrink text-base font-semibold text-lantern-text">
                        {posting?.title || "Job"}
                      </Text>
                      <Text
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}
                      >
                        {JOB_APPLICATION_STATUS_LABELS[application.status]}
                      </Text>
                    </View>
                    <Text className="mt-1 text-sm text-lantern-text-secondary">
                      {employer}
                    </Text>
                    <Text className="mt-3 text-sm leading-5 text-lantern-text">
                      {JOB_APPLICATION_STATUS_DESCRIPTIONS[application.status]}
                    </Text>
                    <Text className="mt-2 text-xs text-lantern-text-tertiary">
                      Updated{" "}
                      {new Date(application.updatedAt).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        },
                      )}
                    </Text>
                  </Pressable>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {application.resumePath || application.resumeUrl ? (
                      <Pressable
                        disabled={openingResumeId === application.id}
                        onPress={() => void openResume(application.id)}
                        className="rounded-lg border border-lantern-border px-3 py-2"
                      >
                        <Text className="text-sm font-medium text-lantern-text">
                          {openingResumeId === application.id
                            ? "Opening…"
                            : "View resume"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {canWithdraw ? (
                      <Pressable
                        disabled={withdrawingId === application.id}
                        onPress={() => void withdraw(application.id)}
                        className="rounded-lg border border-lantern-border px-3 py-2"
                      >
                        <Text className="text-sm font-medium text-lantern-text-secondary">
                          {withdrawingId === application.id
                            ? "Withdrawing…"
                            : "Withdraw"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {liveOffer ? (
                    <JobOfferCard
                      offer={liveOffer}
                      onUpdated={applyOfferUpdate}
                    />
                  ) : null}
                  {liveInterview ? (
                    <JobInterviewInvite
                      interview={liveInterview}
                      onUpdated={applyInterviewUpdate}
                      jobTitle={posting?.title}
                    />
                  ) : null}
                </Card>
              );
            })}

          {!loading && filteredApps.length === 0 ? (
            <View className="mt-4 rounded-2xl border border-dashed border-lantern-border bg-lantern-surface p-8">
              <Text className="text-center text-base font-semibold text-lantern-text">
                {apps.length === 0
                  ? "No applications yet"
                  : `No ${view} applications`}
              </Text>
              <Text className="mt-2 text-center text-sm text-lantern-text-secondary">
                {apps.length === 0
                  ? "Browse open roles and submit your first application."
                  : "Applications will appear here as their status changes."}
              </Text>
              {apps.length === 0 ? (
                <Pressable
                  onPress={() => navigation.navigate("JobsHome")}
                  className="mt-4 items-center rounded-xl bg-lantern-primary py-3"
                >
                  <Text className="text-sm font-semibold text-white">
                    Browse jobs
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default MyJobApplicationsScreen;
