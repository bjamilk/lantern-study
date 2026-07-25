import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  JOB_INTERVIEW_LOCATION_LABELS,
  JOB_INTERVIEW_MODE_LABELS,
  JOB_INTERVIEW_STATUS_LABELS,
  canApplicantRespondToJobInterview,
  describeJobInterviewSchedule,
  type JobInterview,
} from "@lantern/shared";
import { respondToJobInterview } from "../../services/jobsBoard";
import { InterviewCalendarActions } from "./InterviewCalendarActions";

interface Props {
  interview: JobInterview;
  onUpdated: (interview: JobInterview) => void;
  jobTitle?: string | null;
}

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Candidate view of an interview: pick one of the offered times, or decline. */
export function JobInterviewInvite({ interview, onUpdated, jobTitle }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRespond = canApplicantRespondToJobInterview(interview.status);
  const upcomingSlots = (interview.proposedSlots || []).filter(
    (slot) => new Date(slot).getTime() > Date.now(),
  );

  const respond = async (action: "accept" | "decline", slot?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await respondToJobInterview(interview.id, action, slot);
      onUpdated(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your response");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-sm font-semibold text-lantern-text">
          {canRespond
            ? "Interview invitation"
            : `Interview · ${JOB_INTERVIEW_STATUS_LABELS[interview.status]}`}
        </Text>
        <Text className="text-xs text-lantern-text-secondary">
          {JOB_INTERVIEW_MODE_LABELS[interview.mode]} ·{" "}
          {interview.durationMinutes} min
        </Text>
      </View>

      {canRespond ? (
        upcomingSlots.length ? (
          <>
            <Text className="mt-1 text-xs text-lantern-text-secondary">
              Choose a time that works for you.
            </Text>
            {upcomingSlots.map((slot) => (
              <Pressable
                key={slot}
                disabled={busy}
                onPress={() => void respond("accept", slot)}
                accessibilityRole="button"
                className={`mt-2 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 ${
                  busy ? "opacity-50" : ""
                }`}
              >
                <Text className="text-sm font-medium text-lantern-text">
                  {formatSlot(slot)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              disabled={busy}
              onPress={() => void respond("decline")}
              accessibilityRole="button"
              className="mt-2"
            >
              <Text className="text-xs font-medium text-lantern-text-tertiary">
                None of these work for me
              </Text>
            </Pressable>
          </>
        ) : (
          <Text className="mt-1 text-xs text-lantern-text-secondary">
            The proposed times have passed. The employer needs to send new ones.
          </Text>
        )
      ) : (
        <Text className="mt-1 text-sm text-lantern-text">
          {describeJobInterviewSchedule(interview)}
        </Text>
      )}

      {interview.locationText && interview.status === "confirmed" ? (
        <Text className="mt-2 text-xs text-lantern-text-secondary">
          {JOB_INTERVIEW_LOCATION_LABELS[interview.mode]}:{" "}
          {interview.locationText}
        </Text>
      ) : null}
      {interview.details ? (
        <Text className="mt-1 text-xs text-lantern-text-secondary">
          {interview.details}
        </Text>
      ) : null}

      <InterviewCalendarActions interview={interview} jobTitle={jobTitle} />

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-2 text-xs font-medium text-red-600"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export default JobInterviewInvite;
