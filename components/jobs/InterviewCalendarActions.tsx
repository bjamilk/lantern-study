import React from "react";
import {
  JOB_INTERVIEW_LOCATION_LABELS,
  JOB_INTERVIEW_MODE_LABELS,
  buildJobInterviewIcs,
  jobInterviewGoogleCalendarUrl,
  jobInterviewIcsFilename,
  type JobInterview,
} from "@lantern/shared";

interface Props {
  interview: JobInterview;
  jobTitle?: string | null;
}

/**
 * Turns a confirmed interview into a calendar entry. A reminder inside the app
 * only helps someone who opens the app; the calendar is where people actually
 * look for what they are doing today.
 */
export function InterviewCalendarActions({ interview, jobTitle }: Props) {
  if (interview.status !== "confirmed" || !interview.scheduledAt) return null;

  const title = `Interview: ${jobTitle || "job"}`;
  const descriptionParts = [JOB_INTERVIEW_MODE_LABELS[interview.mode]];
  if (interview.locationText) {
    descriptionParts.push(
      `${JOB_INTERVIEW_LOCATION_LABELS[interview.mode]}: ${interview.locationText}`,
    );
  }
  if (interview.details) descriptionParts.push(interview.details);

  const event = {
    id: interview.id,
    title,
    startsAt: interview.scheduledAt,
    durationMinutes: interview.durationMinutes,
    location: interview.locationText || null,
    description: descriptionParts.join("\n"),
  };

  const download = () => {
    const blob = new Blob([buildJobInterviewIcs(event)], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = jobInterviewIcsFilename(jobTitle || "");
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <a
        href={jobInterviewGoogleCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-semibold text-lantern-primary underline"
      >
        Add to Google Calendar
      </a>
      <button
        type="button"
        onClick={download}
        className="text-xs font-semibold text-lantern-text-secondary underline"
      >
        Download .ics
      </button>
    </div>
  );
}

export default InterviewCalendarActions;
