/**
 * `JobDetail` route: one job posting — overview, description, the in-app apply
 * form (screening answers, message, resume), the external-apply path, safety
 * notes and a report sheet.
 *
 * Exports: JobDetailScreen (named and default).
 * Touches: fetchJobPosting, fetchJobApplicantProfile, applyToJob,
 * setJobPostingSaved, trackJobExternalApply and reportJobPosting in
 * ../../services/jobsBoard; ResumeUploadField; isJobPostingPubliclyVisible and
 * the job format helpers from @lantern/shared; Linking for the external URL.
 *
 * Gotchas: the apply form is gated on four conditions at once — not already
 * applied, deadline not passed, status publicly visible, and an applyMode of
 * in_app or both. Required screening answers are checked client-side before
 * applyToJob; the server may still answer `existing`, which is surfaced as
 * "You already applied" rather than an error. Save is optimistic and rolled
 * back on failure. `hasApplied` is set locally after an external-apply click
 * too, so the card reflects the click, not a confirmed application. The report
 * sheet preselects no reason and keeps Submit disabled until one is picked.
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_POSTING_STATUS_LABELS,
  JOB_REPORT_REASON_LABELS,
  JOB_REPORT_REASONS,
  JOBS_CANDIDATE_SAFETY_TIPS,
  getJobEmployerTrustFromPosting,
  isJobPostingPubliclyVisible,
  formatJobCompensation,
  formatJobEngagementDuration,
  formatJobLocation,
  formatJobPostedDate,
  type JobApplicantProfile,
  type JobPosting,
  type JobReportReason,
} from "@lantern/shared";
import { Button, Card, ScreenHeader } from "../../components/ui";
import { Screen } from "../../components/layout";
import {
  applyToJob,
  fetchJobApplicantProfile,
  fetchJobPosting,
  reportJobPosting,
  setJobPostingSaved,
  trackJobExternalApply,
} from "../../services/jobsBoard";
import { ResumeUploadField } from "../../components/jobs/ResumeUploadField";
import type { JobsStackParamList } from "../../navigation/types";
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { AppIcon } from '../../components/ui/AppIcon';

/** Days until the deadline (ceil), negative once it has passed; null when unset. */
function jobDeadlineDaysLeft(value?: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

// Mirrors the board's deadline copy in JobsHomeScreen so the two screens agree.
function formatJobDeadline(value?: string | null) {
  const daysLeft = jobDeadlineDaysLeft(value);
  if (daysLeft === null || daysLeft < 0) return null;
  if (daysLeft === 0) return "Closes today";
  if (daysLeft <= 7)
    return `Closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  return `Apply by ${new Date(value!).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })}`;
}

export function JobDetailScreen() {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const navigation =
    useNavigation<NativeStackNavigationProp<JobsStackParamList>>();
  const route = useRoute<RouteProp<JobsStackParamList, "JobDetail">>();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [message, setMessage] = useState("");
  const [applicantProfile, setApplicantProfile] =
    useState<JobApplicantProfile | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [savingSaved, setSavingSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // Nothing preselected: a report should not open already accusing the poster
  // of fraud, and Submit stays disabled until the reporter picks a reason.
  const [reportReason, setReportReason] = useState<JobReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const reportInsets = useSafeAreaInsets();

  const openReport = () => {
    setReportReason(null);
    setReportDetails("");
    setError(null);
    setReportOpen(true);
  };
  const closeReport = () => {
    if (reportBusy) return;
    setReportOpen(false);
  };
  const submitReport = () => {
    if (!job || !reportReason || reportBusy) return;
    void (async () => {
      setReportBusy(true);
      setError(null);
      try {
        await reportJobPosting(job.id, {
          reason: reportReason,
          details: reportDetails.trim() || undefined,
        });
        setSuccess("Report submitted. Thanks for flagging this.");
        setReportOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not submit report");
      } finally {
        setReportBusy(false);
      }
    })();
  };

  const toggleSaved = async (posting: JobPosting) => {
    const nextSaved = !posting.isSaved;
    setSavingSaved(true);
    setError(null);
    setJob({ ...posting, isSaved: nextSaved });
    try {
      await setJobPostingSaved(posting.id, nextSaved);
    } catch (e) {
      setJob({ ...posting, isSaved: posting.isSaved });
      setError(e instanceof Error ? e.message : "Could not update saved jobs");
    } finally {
      setSavingSaved(false);
    }
  };

  useEffect(() => {
    void fetchJobPosting(route.params.jobId)
      .then((res) => setJob(res.data))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [route.params.jobId]);

  useEffect(() => {
    // A missing profile is normal for first-time applicants.
    void fetchJobApplicantProfile()
      .then((res) => setApplicantProfile(res.data))
      .catch(() => setApplicantProfile(null));
  }, []);

  const deadlineDaysLeft = jobDeadlineDaysLeft(job?.deadline);
  const applicationsClosed = deadlineDaysLeft !== null && deadlineDaysLeft < 0;

  // Keep the loaded screen's shell while fetching: a bare spinner leaves the
  // user with no back affordance and no status-bar inset, then jumps when the
  // header appears.
  if (!job && !error) {
    return (
      <View className="flex-1 bg-lantern-background">
        <ScreenHeader safeTop title="Job" onBack={() => navigation.goBack()} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  return (
    /* The apply form lives at the END of the job's scroll — screener answers,
       then a multiline "Message to the poster", then upload and submit — so it
       is already low on screen before the keyboard opens. `keyboard` supplies
       the KeyboardAvoidingView the file never had; on SDK 36 Android the
       window does not resize, so without it there is no scroll range to reach
       the covered field. ScreenHeader safeTop keeps the top inset. */
    <Screen edges={[]} bottom="none" keyboard>
      <ScreenHeader safeTop title="Job" onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        keyboardShouldPersistTaps="handled"
      >
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
                    <Text className="text-xl font-bold text-lantern-primary-text">
                      {(
                        job.company?.displayName ||
                        job.poster?.name ||
                        job.poster?.username ||
                        "J"
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  </View>
                )}
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap gap-1">
                    {job.isSponsored ? (
                      <Text className="rounded-full bg-amber-100 px-2 py-0.5 text-label font-bold text-amber-800">
                        FEATURED
                      </Text>
                    ) : null}
                    {(() => {
                      const trust = getJobEmployerTrustFromPosting(job);
                      const toneClass =
                        trust.tone === "positive"
                          ? "bg-emerald-100 text-emerald-800"
                          : trust.tone === "caution"
                            ? "bg-amber-100 text-amber-900"
                            : "bg-slate-100 text-slate-700";
                      return (
                        <Text
                          className={`rounded-full px-2 py-0.5 text-label font-bold uppercase ${toneClass}`}
                        >
                          {trust.label}
                        </Text>
                      );
                    })()}
                  </View>
                  <Text className="mt-1 text-xl font-bold text-lantern-text">
                    {job.title}
                  </Text>
                  {job.companyId && job.company ? (
                    <Pressable
                      onPress={() =>
                        navigation.navigate("JobCompany", {
                          companyId: job.companyId!,
                        })
                      }
                    >
                      <Text className="mt-1 text-sm font-medium text-lantern-primary-text">
                        {job.company.displayName}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text className="mt-1 text-sm text-lantern-text-secondary">
                      {job.company?.displayName ||
                        job.poster?.name ||
                        job.poster?.username ||
                        "Independent poster"}
                    </Text>
                  )}
                </View>
                <Pressable
                  onPress={() => void toggleSaved(job)}
                  disabled={savingSaved}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !!job.isSaved }}
                  accessibilityLabel={
                    job.isSaved ? "Remove from saved jobs" : "Save job"
                  }
                  className="-mr-1 p-1"
                >
                  <AppIcon
                    name="bookmark"
                    filled={!!job.isSaved}
                    size={22}
                    color={job.isSaved ? "#0f766e" : "#94a3b8"}
                  />
                </Pressable>
              </View>
              <Text className="mt-3 text-xs text-lantern-text-tertiary">
                {formatJobLocation(job)} · {formatJobPostedDate(job.createdAt)}
              </Text>
            </Card>

            {!isJobPostingPubliclyVisible(job.status) ? (
              <View className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <Text className="text-sm text-amber-900">
                  <Text className="font-semibold">
                    {JOB_POSTING_STATUS_LABELS[job.status]}
                  </Text>{" "}
                  — this job is not accepting applications right now.
                </Text>
              </View>
            ) : null}

            <Card className="mb-3 border border-lantern-border">
              <Text className="text-base font-semibold text-lantern-text">
                Job overview
              </Text>
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
                <View className="rounded-xl bg-lantern-background p-3">
                  <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                    Location
                  </Text>
                  <Text className="mt-1 text-sm font-semibold text-lantern-text">
                    {formatJobLocation(job)}
                  </Text>
                </View>
                {job.deadline ? (
                  <View className="rounded-xl bg-lantern-background p-3">
                    <Text className="text-xs font-medium uppercase text-lantern-text-tertiary">
                      Application deadline
                    </Text>
                    <Text className="mt-1 text-sm font-semibold text-lantern-text">
                      {applicationsClosed
                        ? "Applications closed"
                        : formatJobDeadline(job.deadline)}
                    </Text>
                  </View>
                ) : null}
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
              <Text className="text-base font-semibold text-lantern-text">
                About this role
              </Text>
              <Text className="mt-3 text-sm leading-6 text-lantern-text">
                {job.description}
              </Text>
            </Card>
          </>
        ) : null}
        {job?.hasApplied ? (
          <Card className="mb-3 border border-emerald-200 bg-emerald-50">
            <Text className="text-base font-semibold text-emerald-800">
              Already applied
            </Text>
            <Text className="mt-1 text-sm text-emerald-700">
              You already sent an application for this role. Track it from My
              applications.
            </Text>
            <Pressable
              className="mt-4 items-center rounded-xl bg-lantern-primary-fill py-3"
              onPress={() => navigation.navigate("MyJobApplications")}
            >
              <Text className="font-semibold text-white">
                View my applications
              </Text>
            </Pressable>
          </Card>
        ) : null}
        {job && applicationsClosed && !job.hasApplied ? (
          <View className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <Text className="text-sm text-amber-900">
              <Text className="font-semibold">Applications closed</Text> — the
              deadline for this job has passed.
            </Text>
          </View>
        ) : null}
        {job &&
        !job.hasApplied &&
        !applicationsClosed &&
        isJobPostingPubliclyVisible(job.status) &&
        (job.applyMode === "in_app" || job.applyMode === "both") ? (
          <Card className="mb-3 border border-lantern-border">
            <Text className="text-base font-semibold text-lantern-text">
              Apply for this job
            </Text>
            <Text className="mt-1 text-sm text-lantern-text-secondary">
              Send your details directly to the poster.
            </Text>

            {(job.screeningQuestions || []).map((question) => (
              <View key={question.id} className="mt-4">
                <Text className="text-sm font-medium text-lantern-text">
                  {question.prompt}
                  {question.required ? " *" : ""}
                </Text>
                {question.questionType === "single_choice" ? (
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    {(question.options || []).map((option) => (
                      <Pressable
                        key={option}
                        onPress={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: option,
                          }))
                        }
                        className={`rounded-full border px-3 py-2 ${
                          answers[question.id] === option
                            ? "border-lantern-primary bg-lantern-primary-fill"
                            : "border-lantern-border bg-lantern-background"
                        }`}
                      >
                        <Text
                          className={`text-sm ${
                            answers[question.id] === option
                              ? "font-semibold text-white"
                              : "text-lantern-text"
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
                    value={answers[question.id] || ""}
                    onChangeText={(value) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: value,
                      }))
                    }
                  />
                )}
              </View>
            ))}

            <Text className="mb-2 mt-4 text-sm font-medium text-lantern-text">
              Message to the poster{" "}
              <Text className="text-lantern-text-tertiary">(optional)</Text>
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
            <View className="mt-4">
              <ResumeUploadField
                profile={applicantProfile}
                onUploaded={setApplicantProfile}
              />
            </View>
            <Pressable
              disabled={busy}
              className="mt-4 items-center rounded-xl bg-lantern-primary-fill py-3"
              onPress={() =>
                void (async () => {
                  setBusy(true);
                  setError(null);
                  setSuccess(null);
                  try {
                    const missingRequired = (job.screeningQuestions || []).find(
                      (question) =>
                        question.required && !answers[question.id]?.trim(),
                    );
                    if (missingRequired) {
                      throw new Error(
                        `Answer “${missingRequired.prompt}” before applying.`,
                      );
                    }
                    const res = await applyToJob(job.id, {
                      message: message.trim() || undefined,
                      answers,
                      resumePath: applicantProfile?.resumePath || null,
                      resumeFilename: applicantProfile?.resumeFilename || null,
                    });
                    setJob({ ...job, hasApplied: true });
                    // Mobile never opens the chat thread here, so don't
                    // promise one on the duplicate path.
                    setSuccess(
                      res.existing
                        ? "You already applied to this job."
                        : "Application sent. Track it from My applications.",
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Apply failed");
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              <Text className="font-semibold text-white">
                {busy ? "Submitting…" : "Submit application"}
              </Text>
            </Pressable>
          </Card>
        ) : null}
        {job?.externalUrl &&
        !job.hasApplied &&
        !applicationsClosed &&
        isJobPostingPubliclyVisible(job.status) &&
        (job.applyMode === "external" || job.applyMode === "both") ? (
          <Pressable
            className="mb-3 items-center rounded-xl border border-lantern-primary bg-lantern-surface py-3"
            onPress={() =>
              void trackJobExternalApply(job.id).then((res) => {
                setJob({ ...job, hasApplied: true });
                return Linking.openURL(res.data.url);
              })
            }
          >
            <Text className="font-semibold text-lantern-primary-text">
              Apply on company site
            </Text>
          </Pressable>
        ) : null}
        {success ? (
          <View className="mb-3 rounded-xl bg-emerald-50 p-3">
            <Text className="text-sm text-emerald-700">{success}</Text>
          </View>
        ) : null}
        {job ? (
          <Card className="mb-3">
            <Text className="text-sm font-semibold text-lantern-text mb-1">
              About the poster
            </Text>
            <Text className="text-sm text-lantern-text-secondary">
              {getJobEmployerTrustFromPosting(job).shortHelp}
            </Text>
            <Text className="text-xs font-semibold text-lantern-text mt-3 mb-1">
              Stay safe
            </Text>
            {JOBS_CANDIDATE_SAFETY_TIPS.map((tip) => (
              <Text
                key={tip}
                className="text-xs leading-5 text-lantern-text-tertiary mb-0.5"
              >
                • {tip}
              </Text>
            ))}
            <Pressable className="mt-3" onPress={openReport}>
              <Text className="text-xs text-lantern-text-tertiary underline">
                Report this job
              </Text>
            </Pressable>
          </Card>
        ) : null}
      </ScrollView>

      {/* Report sheet — mirrors the Shop's report sheet: nothing preselected,
          Submit disabled until a reason, an explicit Cancel and close, and the
          hardware BACK button dismisses it (Modal onRequestClose). */}
      <Modal
        visible={reportOpen}
        transparent
        animationType="slide"
        onRequestClose={closeReport}
      >
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={closeReport}>
          <Pressable
            accessibilityViewIsModal
            onPress={(e) => e.stopPropagation?.()}
            className="bg-lantern-surface rounded-t-3xl pt-4 max-h-[88%]"
            style={{ paddingBottom: reportInsets.bottom + 24 }}
          >
            <View className="flex-row items-center px-5 mb-1">
              <AppIcon name="flag" size={18} color="#f59e0b" />
              <Text
                className="text-heading font-bold text-lantern-text ml-2 flex-1"
                accessibilityRole="header"
              >
                Report this job
              </Text>
              <Pressable
                onPress={closeReport}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <AppIcon name="close" size={22} color="#94a3b8" />
              </Pressable>
            </View>
            <ScrollView
              className="px-5"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text className="text-label font-semibold uppercase tracking-wide text-lantern-text-tertiary mt-2 mb-2">
                Why are you reporting?
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-4">
                {JOB_REPORT_REASONS.map((r) => {
                  const selected = reportReason === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setReportReason(r)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className={`px-3 py-1.5 rounded-full border ${
                        selected ? "bg-red-600 border-red-600" : "border-lantern-border"
                      }`}
                    >
                      <Text
                        className={`text-label font-medium ${
                          selected ? "text-white" : "text-lantern-text-secondary"
                        }`}
                      >
                        {JOB_REPORT_REASON_LABELS[r]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className="text-label font-semibold uppercase tracking-wide text-lantern-text-tertiary mb-2">
                Details (optional)
              </Text>
              <TextInput
                className="min-h-[84px] p-3 rounded-xl border border-lantern-border text-lantern-text mb-3"
                placeholder="Anything that helps our team understand the problem"
                placeholderTextColor="#94a3b8"
                value={reportDetails}
                onChangeText={setReportDetails}
                multiline
                textAlignVertical="top"
              />
              {error ? (
                <Text className="text-caption text-red-500 mb-3">{error}</Text>
              ) : null}
              <View className="flex-row gap-3 mb-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onPress={closeReport}
                  disabled={reportBusy}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  loading={reportBusy}
                  disabled={!reportReason}
                  onPress={submitReport}
                >
                  Submit report
                </Button>
              </View>
              <Text className="text-label text-lantern-text-tertiary mb-2">
                Reports are confidential. False reports may count against your
                account.
              </Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

export default JobDetailScreen;
