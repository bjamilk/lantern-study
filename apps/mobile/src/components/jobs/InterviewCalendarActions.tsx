import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  JOB_INTERVIEW_LOCATION_LABELS,
  JOB_INTERVIEW_MODE_LABELS,
  jobInterviewGoogleCalendarUrl,
  type JobInterview,
} from "@lantern/shared";

interface Props {
  interview: JobInterview;
  jobTitle?: string | null;
}

/**
 * Turns a confirmed interview into a calendar entry. A prefilled link is used
 * rather than an .ics file because opening a URL is reliable on both platforms,
 * where handing a downloaded file to another app is not.
 */
export function InterviewCalendarActions({ interview, jobTitle }: Props) {
  if (interview.status !== "confirmed" || !interview.scheduledAt) return null;

  const descriptionParts = [JOB_INTERVIEW_MODE_LABELS[interview.mode]];
  if (interview.locationText) {
    descriptionParts.push(
      `${JOB_INTERVIEW_LOCATION_LABELS[interview.mode]}: ${interview.locationText}`,
    );
  }
  if (interview.details) descriptionParts.push(interview.details);

  const url = jobInterviewGoogleCalendarUrl({
    id: interview.id,
    title: `Interview: ${jobTitle || "job"}`,
    startsAt: interview.scheduledAt,
    durationMinutes: interview.durationMinutes,
    location: interview.locationText || null,
    description: descriptionParts.join("\n"),
  });

  return (
    <View className="mt-2">
      <Pressable
        onPress={() => void Linking.openURL(url)}
        accessibilityRole="link"
      >
        <Text className="text-xs font-semibold text-lantern-primary-text">
          Add to calendar
        </Text>
      </Pressable>
    </View>
  );
}

export default InterviewCalendarActions;
