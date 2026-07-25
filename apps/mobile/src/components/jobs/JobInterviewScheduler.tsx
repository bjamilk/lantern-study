import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import {
  JOB_INTERVIEW_DETAILS_MAX_LENGTH,
  JOB_INTERVIEW_LOCATION_LABELS,
  JOB_INTERVIEW_LOCATION_MAX_LENGTH,
  JOB_INTERVIEW_MAX_SLOTS,
  JOB_INTERVIEW_MODES,
  JOB_INTERVIEW_MODE_LABELS,
  JOB_INTERVIEW_STATUS_LABELS,
  canEmployerCancelJobInterview,
  canEmployerCompleteJobInterview,
  canEmployerRescheduleJobInterview,
  describeJobInterviewSchedule,
  type JobInterview,
  type JobInterviewMode,
} from "@lantern/shared";
import {
  fetchJobInterviews,
  rescheduleJobInterview,
  scheduleJobInterview,
  setJobInterviewStatus,
} from "../../services/jobsBoard";
import { InterviewCalendarActions } from "./InterviewCalendarActions";

interface Props {
  applicationId: string;
  candidateName: string;
  jobTitle?: string | null;
}

const DURATIONS = [15, 30, 45, 60, 90];

function defaultSlot(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  date.setHours(10, 0, 0, 0);
  return date;
}

function formatSlot(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function JobInterviewScheduler({
  applicationId,
  candidateName,
  jobTitle,
}: Props) {
  const [interviews, setInterviews] = useState<JobInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);

  const [mode, setMode] = useState<JobInterviewMode>("video");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [locationText, setLocationText] = useState("");
  const [details, setDetails] = useState("");
  const [slots, setSlots] = useState<Date[]>([defaultSlot()]);
  // Two-step picker: choose the day, then the time for that same slot.
  const [picker, setPicker] = useState<{
    index: number;
    stage: "date" | "time";
  } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJobInterviews(applicationId)
      .then((res) => {
        if (active) setInterviews(res.data || []);
      })
      .catch((e) => {
        if (active) {
          setError(
            e instanceof Error ? e.message : "Could not load interviews",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId]);

  const resetForm = () => {
    setFormOpen(false);
    setRescheduleId(null);
    setMode("video");
    setDurationMinutes(30);
    setLocationText("");
    setDetails("");
    setSlots([defaultSlot()]);
    setPicker(null);
  };

  const openReschedule = (interview: JobInterview) => {
    setRescheduleId(interview.id);
    setFormOpen(true);
    setMode(interview.mode);
    setDurationMinutes(interview.durationMinutes);
    setLocationText(interview.locationText || "");
    setDetails(interview.details || "");
    const future = (interview.proposedSlots || [])
      .map((slot) => new Date(slot))
      .filter((date) => date.getTime() > Date.now());
    setSlots(future.length ? future : [defaultSlot()]);
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const active = picker;
    if (!active || event.type === "dismissed" || !selected) {
      setPicker(null);
      return;
    }
    setSlots((prev) =>
      prev.map((slot, index) => {
        if (index !== active.index) return slot;
        const next = new Date(slot);
        if (active.stage === "date") {
          next.setFullYear(
            selected.getFullYear(),
            selected.getMonth(),
            selected.getDate(),
          );
        } else {
          next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        }
        return next;
      }),
    );
    setPicker(
      active.stage === "date" ? { index: active.index, stage: "time" } : null,
    );
  };

  const submit = async () => {
    const proposedSlots = slots.map((slot) => slot.toISOString());
    setSaving(true);
    setError(null);
    try {
      const payload = {
        mode,
        durationMinutes,
        proposedSlots,
        locationText: locationText.trim() || undefined,
        details: details.trim() || undefined,
      };
      const res = rescheduleId
        ? await rescheduleJobInterview(rescheduleId, payload)
        : await scheduleJobInterview(applicationId, payload);
      setInterviews((prev) =>
        rescheduleId
          ? prev.map((item) => (item.id === rescheduleId ? res.data : item))
          : [res.data, ...prev],
      );
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the interview");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (
    interview: JobInterview,
    status: "cancelled" | "completed",
  ) => {
    setError(null);
    try {
      const res = await setJobInterviewStatus(interview.id, status);
      setInterviews((prev) =>
        prev.map((item) => (item.id === interview.id ? res.data : item)),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update the interview",
      );
    }
  };

  return (
    <View className="mt-3 border-t border-lantern-border pt-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-lantern-text">
          Interviews
        </Text>
        {!formOpen ? (
          <Pressable
            onPress={() => setFormOpen(true)}
            accessibilityRole="button"
          >
            <Text className="text-xs font-semibold text-lantern-primary">
              {interviews.length ? "Propose new times" : "Schedule interview"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-2 text-xs font-medium text-red-600"
        >
          {error}
        </Text>
      ) : null}

      {formOpen ? (
        <View className="mt-3 rounded-lg border border-lantern-border bg-lantern-background p-3">
          <Text className="text-xs font-medium text-lantern-text-secondary">
            Format
          </Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {JOB_INTERVIEW_MODES.map((value) => (
              <Pressable
                key={value}
                onPress={() => setMode(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === value }}
                className={`rounded-full border px-3 py-1.5 ${
                  mode === value
                    ? "border-lantern-primary bg-lantern-primary"
                    : "border-lantern-border"
                }`}
              >
                <Text
                  className={`text-xs ${
                    mode === value
                      ? "font-semibold text-white"
                      : "text-lantern-text"
                  }`}
                >
                  {JOB_INTERVIEW_MODE_LABELS[value]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text className="mt-3 text-xs font-medium text-lantern-text-secondary">
            Length
          </Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {DURATIONS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setDurationMinutes(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: durationMinutes === value }}
                className={`rounded-full border px-3 py-1.5 ${
                  durationMinutes === value
                    ? "border-lantern-primary bg-lantern-primary"
                    : "border-lantern-border"
                }`}
              >
                <Text
                  className={`text-xs ${
                    durationMinutes === value
                      ? "font-semibold text-white"
                      : "text-lantern-text"
                  }`}
                >
                  {value} min
                </Text>
              </Pressable>
            ))}
          </View>

          <Text className="mt-3 text-xs font-medium text-lantern-text-secondary">
            {JOB_INTERVIEW_LOCATION_LABELS[mode]}
          </Text>
          <TextInput
            value={locationText}
            onChangeText={setLocationText}
            maxLength={JOB_INTERVIEW_LOCATION_MAX_LENGTH}
            placeholder={
              mode === "video"
                ? "https://meet.example.com/abc-defg"
                : mode === "phone"
                  ? "+234 800 000 0000"
                  : "12 Campus Road, Room 4"
            }
            autoCapitalize="none"
            className="mt-1 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
          />

          <Text className="mt-3 text-xs font-medium text-lantern-text-secondary">
            Propose times ({slots.length}/{JOB_INTERVIEW_MAX_SLOTS}) —{" "}
            {candidateName} picks one
          </Text>
          {slots.map((slot, index) => (
            <View key={index} className="mt-2 flex-row items-center gap-2">
              <Pressable
                onPress={() => setPicker({ index, stage: "date" })}
                accessibilityRole="button"
                accessibilityLabel={`Change proposed time ${index + 1}`}
                className="flex-1 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2"
              >
                <Text className="text-sm text-lantern-text">
                  {formatSlot(slot)}
                </Text>
              </Pressable>
              {slots.length > 1 ? (
                <Pressable
                  onPress={() =>
                    setSlots((prev) => prev.filter((_, i) => i !== index))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove proposed time ${index + 1}`}
                >
                  <Text className="text-xs font-medium text-lantern-text-tertiary">
                    Remove
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {slots.length < JOB_INTERVIEW_MAX_SLOTS ? (
            <Pressable
              onPress={() => setSlots((prev) => [...prev, defaultSlot()])}
              accessibilityRole="button"
              className="mt-2"
            >
              <Text className="text-xs font-semibold text-lantern-primary">
                Add another time
              </Text>
            </Pressable>
          ) : null}

          <Text className="mt-3 text-xs font-medium text-lantern-text-secondary">
            What to expect (optional)
          </Text>
          <TextInput
            value={details}
            onChangeText={setDetails}
            maxLength={JOB_INTERVIEW_DETAILS_MAX_LENGTH}
            multiline
            placeholder="30 minutes with the team lead."
            className="mt-1 min-h-[64px] rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
          />

          <View className="mt-3 flex-row justify-end gap-2">
            <Pressable
              onPress={resetForm}
              accessibilityRole="button"
              className="rounded-lg border border-lantern-border px-3 py-2"
            >
              <Text className="text-sm font-medium text-lantern-text">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              disabled={saving}
              onPress={() => void submit()}
              accessibilityRole="button"
              className={`rounded-lg bg-lantern-primary px-3 py-2 ${
                saving ? "opacity-50" : ""
              }`}
            >
              <Text className="text-sm font-semibold text-white">
                {saving
                  ? "Sending…"
                  : rescheduleId
                    ? "Send new times"
                    : "Send invitation"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {picker ? (
        <DateTimePicker
          value={slots[picker.index] || defaultSlot()}
          mode={picker.stage}
          minimumDate={picker.stage === "date" ? new Date() : undefined}
          onChange={onPickerChange}
        />
      ) : null}

      {loading ? (
        <Text className="mt-2 text-xs text-lantern-text-tertiary">
          Loading interviews…
        </Text>
      ) : interviews.length === 0 && !formOpen ? (
        <Text className="mt-2 text-xs text-lantern-text-tertiary">
          No interview scheduled yet.
        </Text>
      ) : (
        interviews.map((interview) => (
          <View
            key={interview.id}
            className="mt-2 rounded-lg border border-lantern-border bg-lantern-background p-3"
          >
            <Text className="text-sm font-medium text-lantern-text">
              {describeJobInterviewSchedule(interview)}
            </Text>
            <Text className="mt-0.5 text-xs text-lantern-text-tertiary">
              {JOB_INTERVIEW_STATUS_LABELS[interview.status]}
            </Text>
            {interview.locationText ? (
              <Text className="mt-1 text-xs text-lantern-text-secondary">
                {JOB_INTERVIEW_LOCATION_LABELS[interview.mode]}:{" "}
                {interview.locationText}
              </Text>
            ) : null}
            <InterviewCalendarActions
              interview={interview}
              jobTitle={jobTitle}
            />
            <ScrollView
              horizontal
              className="mt-2"
              showsHorizontalScrollIndicator={false}
            >
              {canEmployerRescheduleJobInterview(interview.status) ? (
                <Pressable
                  onPress={() => openReschedule(interview)}
                  accessibilityRole="button"
                  className="mr-3"
                >
                  <Text className="text-xs font-semibold text-lantern-primary">
                    Reschedule
                  </Text>
                </Pressable>
              ) : null}
              {canEmployerCompleteJobInterview(interview.status) ? (
                <Pressable
                  onPress={() => void changeStatus(interview, "completed")}
                  accessibilityRole="button"
                  className="mr-3"
                >
                  <Text className="text-xs font-semibold text-lantern-text-secondary">
                    Mark completed
                  </Text>
                </Pressable>
              ) : null}
              {canEmployerCancelJobInterview(interview.status) ? (
                <Pressable
                  onPress={() => void changeStatus(interview, "cancelled")}
                  accessibilityRole="button"
                >
                  <Text className="text-xs font-semibold text-lantern-text-tertiary">
                    Cancel
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        ))
      )}
    </View>
  );
}

export default JobInterviewScheduler;
