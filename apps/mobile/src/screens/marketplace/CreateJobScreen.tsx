import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JOBS_CREATE_CONFIRMATION,
  JOBS_SCAM_PLAYBOOK_SUMMARY,
  JOB_COMPENSATION_PERIOD_LABELS,
  JOB_COMPENSATION_PERIODS,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_ENGAGEMENT_DURATION_UNIT_LABELS,
  JOB_ENGAGEMENT_DURATION_UNITS,
  JOB_INTENT_TEMPLATE_GROUPS,
  JOB_INTENT_TEMPLATES,
  JOB_PHASE1_EMPLOYMENT_TYPES,
  JOB_PHASE2_EMPLOYMENT_TYPES,
  JOB_POSTING_STATUS_LABELS,
  describeJobScamMatches,
  findJobScamMatches,
  formatJobCompanyVerificationLabel,
  isJobPostingEditable,
  jobIntentTemplatesByGroup,
  jobRequiresEngagementDuration,
  textFailsJobScamCheck,
  type JobCompensationPeriod,
  type JobEmploymentType,
  type JobEngagementDurationUnit,
  type JobPostingStatus,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import {
  createJobPosting,
  fetchJobPosting,
  fetchMyJobCompanies,
  updateJobPosting,
} from "../../services/jobsBoard";
import type { MarketStackParamList } from "../../navigation/types";

export function CreateJobScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const route = useRoute<RouteProp<MarketStackParamList, "CreateJob">>();
  const jobId = route.params?.jobId;
  const isEdit = !!jobId;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [employmentType, setEmploymentType] =
    useState<JobEmploymentType>("part_time");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<
    Array<{ id: string; displayName: string; verificationStatus: string }>
  >([]);
  const [compensationKind, setCompensationKind] = useState<
    "paid" | "unpaid" | "discuss"
  >("discuss");
  const [amountMin, setAmountMin] = useState("");
  const [payPeriod, setPayPeriod] = useState<JobCompensationPeriod>("month");
  const [durationKind, setDurationKind] = useState<"ongoing" | "fixed">(
    "fixed",
  );
  const [durationValue, setDurationValue] = useState("1");
  const [durationUnit, setDurationUnit] =
    useState<JobEngagementDurationUnit>("month");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingJob, setLoadingJob] = useState(isEdit);
  const [status, setStatus] = useState<JobPostingStatus>("active");
  const [screener1, setScreener1] = useState("");
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    void fetchMyJobCompanies()
      .then((res) =>
        setCompanies(
          (res.data || [])
            .map((row: any) => row.company)
            .filter(Boolean)
            .map((c: any) => ({
              id: c.id,
              displayName: c.displayName || c.display_name,
              verificationStatus: c.verificationStatus || c.verification_status,
            })),
        ),
      )
      .catch(() => setCompanies([]));
  }, []);

  // Prefill from the existing post when editing.
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    setLoadingJob(true);
    fetchJobPosting(jobId)
      .then((res) => {
        const job = res.data;
        if (!active || !job) return;
        setTitle(job.title || "");
        setDescription(job.description || "");
        setEmploymentType(job.employmentType);
        setStatus(job.status);
        setCompanyId(job.companyId || "");
        setScreener1(job.screeningQuestions?.[0]?.prompt || "");

        const compensation = job.compensation || { kind: "discuss" as const };
        setCompensationKind(compensation.kind);
        setAmountMin(
          compensation.amountMin != null ? String(compensation.amountMin) : "",
        );
        if (compensation.period) setPayPeriod(compensation.period);

        const duration = job.engagementDuration;
        if (duration?.kind === "fixed") {
          setDurationKind("fixed");
          setDurationValue(String(duration.value));
          setDurationUnit(duration.unit);
        } else if (duration?.kind === "ongoing") {
          setDurationKind("ongoing");
        }

        // The attestation was already accepted when the post was created.
        setConfirmed(true);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load this job",
        ),
      )
      .finally(() => {
        if (active) setLoadingJob(false);
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  const allowedTypes = useMemo(
    () =>
      companyId ? JOB_PHASE2_EMPLOYMENT_TYPES : JOB_PHASE1_EMPLOYMENT_TYPES,
    [companyId],
  );

  useEffect(() => {
    if (loadingJob) return;
    if (!allowedTypes.includes(employmentType)) {
      setEmploymentType("part_time");
    }
  }, [allowedTypes, employmentType, loadingJob]);

  const locked = isEdit && !isJobPostingEditable(status);

  /** Shared shape for both create and edit, so the two cannot drift. */
  const buildPayload = () => {
    if (!allowedTypes.includes(employmentType)) {
      throw new Error(
        "That employment type requires a verified company account.",
      );
    }
    if (compensationKind === "paid" && !amountMin.trim()) {
      throw new Error("Enter the compensated amount.");
    }
    if (
      jobRequiresEngagementDuration(employmentType) &&
      durationKind === "fixed" &&
      (!durationValue.trim() || Number(durationValue) < 1)
    ) {
      throw new Error("Enter how long this role lasts.");
    }
    return {
      title,
      description,
      employmentType,
      compensation: {
        kind: compensationKind,
        currency: "NGN",
        amountMin:
          compensationKind === "paid" && amountMin ? Number(amountMin) : null,
        period: compensationKind === "paid" ? payPeriod : null,
      },
      engagementDuration: jobRequiresEngagementDuration(employmentType)
        ? durationKind === "ongoing"
          ? { kind: "ongoing" as const }
          : {
              kind: "fixed" as const,
              value: Number(durationValue),
              unit: durationUnit,
            }
        : null,
      applyMode: "in_app" as const,
      screeningQuestions: screener1.trim()
        ? [
            {
              prompt: screener1.trim(),
              questionType: "text" as const,
              required: true,
            },
          ]
        : [],
    };
  };

  const scamWarning = describeJobScamMatches(
    findJobScamMatches(`${title}\n${description}`),
  );

  const submit = async (nextStatus: JobPostingStatus) => {
    if (textFailsJobScamCheck(`${title}\n${description}`)) {
      setError(
        scamWarning ||
          "This copy matches phrases Lantern blocks. Remove them before publishing.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload();
      if (isEdit && jobId) {
        await updateJobPosting(jobId, { ...payload, status: nextStatus });
        navigation.replace("JobDetail", { jobId });
      } else {
        const res = await createJobPosting({
          ...payload,
          status: nextStatus,
          companyId: companyId || null,
        });
        navigation.replace("JobDetail", { jobId: res.data.id });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save job",
      );
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    const t = JOB_INTENT_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (!allowedTypes.includes(t.employmentType) && !companyId) {
      setError(
        "That template’s type needs a company account. Select a company below, or pick another template.",
      );
    } else {
      setError(null);
    }
    setEmploymentType(t.employmentType);
    setTitle(t.title);
    setDescription(t.descriptionHint);
    setScreener1(t.suggestedScreeners[0] || "");
  };

  const chip = (active: boolean) =>
    `mr-2 mb-2 px-3 py-1.5 rounded-lg border ${
      active
        ? "bg-lantern-primary border-lantern-primary"
        : "border-lantern-border"
    }`;
  const chipText = (active: boolean) =>
    `text-xs ${active ? "text-white" : "text-lantern-text"}`;

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader
        title={isEdit ? "Edit job" : "Post a job"}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Card className="mb-3 space-y-3">
          {isEdit ? (
            <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
              Status: {JOB_POSTING_STATUS_LABELS[status]}
            </Text>
          ) : null}
          {loadingJob ? (
            <Text className="text-sm text-lantern-text-secondary">
              Loading job…
            </Text>
          ) : null}
          {locked ? (
            <View className="rounded-lg border border-red-200 bg-red-50 p-3">
              <Text className="text-sm text-red-700">
                This job was removed by moderation and can no longer be edited.
              </Text>
            </View>
          ) : null}

          {!isEdit
            ? JOB_INTENT_TEMPLATE_GROUPS.map((group) => (
                <View key={group.id} className="mb-2">
                  <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary mb-1.5">
                    {group.label}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {jobIntentTemplatesByGroup(group.id).map((t) => (
                      <Pressable
                        key={t.id}
                        onPress={() => applyTemplate(t.id)}
                        className="mr-2 px-3 py-1.5 rounded-lg border border-lantern-border"
                      >
                        <Text className="text-xs text-lantern-text">
                          {t.title.replace(/\s*\[.*?\]\s*/g, " ").trim()}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ))
            : null}

          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
            placeholder="Title"
            placeholderTextColor="#94a3b8"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text min-h-[100px]"
            placeholder="Description"
            placeholderTextColor="#94a3b8"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
            Type of job offer
          </Text>
          <View className="flex-row flex-wrap">
            {allowedTypes.map((t) => (
              <Pressable
                key={t}
                onPress={() => setEmploymentType(t)}
                className={chip(employmentType === t)}
              >
                <Text className={chipText(employmentType === t)}>
                  {JOB_EMPLOYMENT_TYPE_LABELS[t]}
                </Text>
              </Pressable>
            ))}
          </View>
          {!companyId ? (
            <Text className="text-[11px] text-lantern-text-tertiary mb-1">
              Internship, full-time, and contract unlock when you post as a
              company.
            </Text>
          ) : null}

          <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
            Compensation
          </Text>
          <View className="flex-row flex-wrap">
            {(["discuss", "paid", "unpaid"] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => setCompensationKind(k)}
                className={chip(compensationKind === k)}
              >
                <Text className={chipText(compensationKind === k)}>
                  {k === "discuss"
                    ? "Discuss"
                    : k === "paid"
                      ? "Paid"
                      : "Unpaid"}
                </Text>
              </Pressable>
            ))}
          </View>
          {compensationKind === "paid" ? (
            <>
              <TextInput
                className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
                placeholder="Amount (NGN)"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
                value={amountMin}
                onChangeText={setAmountMin}
              />
              <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
                Pay period
              </Text>
              <View className="flex-row flex-wrap">
                {JOB_COMPENSATION_PERIODS.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setPayPeriod(p)}
                    className={chip(payPeriod === p)}
                  >
                    <Text className={chipText(payPeriod === p)}>
                      {JOB_COMPENSATION_PERIOD_LABELS[p]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {jobRequiresEngagementDuration(employmentType) ? (
            <>
              <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
                How long does this role last?
              </Text>
              <View className="flex-row flex-wrap">
                <Pressable
                  onPress={() => setDurationKind("fixed")}
                  className={chip(durationKind === "fixed")}
                >
                  <Text className={chipText(durationKind === "fixed")}>
                    Fixed length
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setDurationKind("ongoing")}
                  className={chip(durationKind === "ongoing")}
                >
                  <Text className={chipText(durationKind === "ongoing")}>
                    Ongoing
                  </Text>
                </Pressable>
              </View>
              {durationKind === "fixed" ? (
                <>
                  <TextInput
                    className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
                    placeholder="Length"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    value={durationValue}
                    onChangeText={setDurationValue}
                  />
                  <View className="flex-row flex-wrap">
                    {JOB_ENGAGEMENT_DURATION_UNITS.map((u) => (
                      <Pressable
                        key={u}
                        onPress={() => setDurationUnit(u)}
                        className={chip(durationUnit === u)}
                      >
                        <Text className={chipText(durationUnit === u)}>
                          {JOB_ENGAGEMENT_DURATION_UNIT_LABELS[u]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
            Screening question (optional)
          </Text>
          <TextInput
            className="rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
            placeholder="e.g. Which shifts can you cover?"
            placeholderTextColor="#94a3b8"
            value={screener1}
            onChangeText={setScreener1}
          />

          {companies.length > 0 && !isEdit ? (
            <View className="mb-1">
              <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary mb-1.5">
                Post as
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Pressable
                  onPress={() => setCompanyId("")}
                  className={chip(!companyId)}
                >
                  <Text className={chipText(!companyId)}>
                    Individual / org (no company)
                  </Text>
                </Pressable>
                {companies.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setCompanyId(c.id)}
                    className={chip(companyId === c.id)}
                  >
                    <Text className={chipText(companyId === c.id)}>
                      {c.displayName} (
                      {formatJobCompanyVerificationLabel(c.verificationStatus)})
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {previewing ? (
            <View className="rounded-xl border border-lantern-primary/30 bg-lantern-background p-3">
              <Text className="text-xs font-semibold uppercase text-lantern-primary">
                How candidates will see it
              </Text>
              <Text className="mt-2 text-base font-bold text-lantern-text">
                {title.trim() || "Untitled job"}
              </Text>
              <Text className="mt-1 text-sm text-lantern-text-secondary">
                {JOB_EMPLOYMENT_TYPE_LABELS[employmentType]}
              </Text>
              <Text className="mt-2 text-sm text-lantern-text">
                {description.trim() || "No description yet."}
              </Text>
              {screener1.trim() ? (
                <Text className="mt-2 text-xs text-lantern-text-tertiary">
                  Applicants answer: {screener1.trim()}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View className="mb-2">
            {JOBS_SCAM_PLAYBOOK_SUMMARY.map((line) => (
              <Text
                key={line}
                className="text-xs text-lantern-text-tertiary mb-0.5"
              >
                • {line}
              </Text>
            ))}
          </View>
          {scamWarning ? (
            <Text
              className={`text-sm mb-2 ${
                textFailsJobScamCheck(`${title}\n${description}`)
                  ? "text-red-700"
                  : "text-amber-800"
              }`}
            >
              {scamWarning}
            </Text>
          ) : null}

          <Pressable
            onPress={() => setConfirmed((v) => !v)}
            className="flex-row items-start gap-2"
          >
            <Text className="text-lantern-primary">
              {confirmed ? "☑" : "☐"}
            </Text>
            <Text className="flex-1 text-xs text-lantern-text-secondary">
              {JOBS_CREATE_CONFIRMATION}
            </Text>
          </Pressable>
          {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
          <Pressable
            disabled={busy || locked || !title.trim() || !confirmed}
            className="rounded-lg bg-lantern-primary py-3 items-center"
            onPress={() =>
              void submit(isEdit && status !== "draft" ? status : "active")
            }
          >
            <Text className="text-white font-semibold">
              {busy
                ? "Saving…"
                : isEdit && status !== "draft"
                  ? "Save changes"
                  : "Publish job"}
            </Text>
          </Pressable>
          {!isEdit || status === "draft" ? (
            <Pressable
              disabled={busy || locked || !title.trim() || !confirmed}
              className="rounded-lg border border-lantern-border py-3 items-center"
              onPress={() => void submit("draft")}
            >
              <Text className="text-sm font-medium text-lantern-text">
                Save as draft
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            className="rounded-lg border border-lantern-border py-3 items-center"
            onPress={() => setPreviewing((current) => !current)}
          >
            <Text className="text-sm font-medium text-lantern-text">
              {previewing ? "Hide preview" : "Preview"}
            </Text>
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}

export default CreateJobScreen;
