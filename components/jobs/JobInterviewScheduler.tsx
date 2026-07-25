import React, { useEffect, useMemo, useState } from "react";
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

interface Props {
  applicationId: string;
  candidateName: string;
}

/** `datetime-local` needs a local-time string with no timezone suffix. */
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultSlotValue(): string {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  date.setHours(10, 0, 0, 0);
  return toLocalInputValue(date);
}

export function JobInterviewScheduler({ applicationId, candidateName }: Props) {
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
  const [slots, setSlots] = useState<string[]>([defaultSlotValue()]);

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

  const minSlotValue = useMemo(() => toLocalInputValue(new Date()), []);

  const resetForm = () => {
    setFormOpen(false);
    setRescheduleId(null);
    setMode("video");
    setDurationMinutes(30);
    setLocationText("");
    setDetails("");
    setSlots([defaultSlotValue()]);
  };

  const openReschedule = (interview: JobInterview) => {
    setRescheduleId(interview.id);
    setFormOpen(true);
    setMode(interview.mode);
    setDurationMinutes(interview.durationMinutes);
    setLocationText(interview.locationText || "");
    setDetails(interview.details || "");
    const future = (interview.proposedSlots || [])
      .filter((slot) => new Date(slot).getTime() > Date.now())
      .map((slot) => toLocalInputValue(new Date(slot)));
    setSlots(future.length ? future : [defaultSlotValue()]);
  };

  const submit = async () => {
    const proposedSlots = slots
      .filter((value) => !!value)
      .map((value) => new Date(value).toISOString());
    if (!proposedSlots.length) {
      setError("Add at least one time");
      return;
    }
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
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-lantern-text">Interviews</h3>
        {!formOpen ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="text-xs font-semibold text-lantern-primary underline"
          >
            {interviews.length ? "Propose new times" : "Schedule interview"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}

      {formOpen ? (
        <div className="space-y-3 rounded-lg border border-lantern-border bg-lantern-background p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="job-interview-mode"
                className="text-xs font-medium text-lantern-text-secondary"
              >
                Format
              </label>
              <select
                id="job-interview-mode"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as JobInterviewMode)
                }
                className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
              >
                {JOB_INTERVIEW_MODES.map((value) => (
                  <option key={value} value={value}>
                    {JOB_INTERVIEW_MODE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="job-interview-duration"
                className="text-xs font-medium text-lantern-text-secondary"
              >
                Length (minutes)
              </label>
              <input
                id="job-interview-duration"
                type="number"
                min={15}
                max={480}
                step={15}
                value={durationMinutes}
                onChange={(event) =>
                  setDurationMinutes(Number(event.target.value) || 30)
                }
                className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="job-interview-location"
              className="text-xs font-medium text-lantern-text-secondary"
            >
              {JOB_INTERVIEW_LOCATION_LABELS[mode]}
            </label>
            <input
              id="job-interview-location"
              type="text"
              value={locationText}
              maxLength={JOB_INTERVIEW_LOCATION_MAX_LENGTH}
              onChange={(event) => setLocationText(event.target.value)}
              placeholder={
                mode === "video"
                  ? "https://meet.example.com/abc-defg"
                  : mode === "phone"
                    ? "+234 800 000 0000"
                    : "12 Campus Road, Room 4"
              }
              className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text placeholder:text-lantern-text-tertiary"
            />
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-lantern-text-secondary">
              Propose times ({slots.length}/{JOB_INTERVIEW_MAX_SLOTS}) —{" "}
              {candidateName} picks one
            </legend>
            <div className="mt-1 space-y-2">
              {slots.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={value}
                    min={minSlotValue}
                    aria-label={`Proposed time ${index + 1}`}
                    onChange={(event) =>
                      setSlots((prev) =>
                        prev.map((slot, i) =>
                          i === index ? event.target.value : slot,
                        ),
                      )
                    }
                    className="min-w-0 flex-1 rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
                  />
                  {slots.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove proposed time ${index + 1}`}
                      onClick={() =>
                        setSlots((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="shrink-0 text-xs font-medium text-lantern-text-tertiary underline hover:text-red-600"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {slots.length < JOB_INTERVIEW_MAX_SLOTS ? (
              <button
                type="button"
                onClick={() =>
                  setSlots((prev) => [...prev, defaultSlotValue()])
                }
                className="mt-2 text-xs font-semibold text-lantern-primary underline"
              >
                Add another time
              </button>
            ) : null}
          </fieldset>

          <div>
            <label
              htmlFor="job-interview-details"
              className="text-xs font-medium text-lantern-text-secondary"
            >
              What to expect (optional)
            </label>
            <textarea
              id="job-interview-details"
              rows={2}
              value={details}
              maxLength={JOB_INTERVIEW_DETAILS_MAX_LENGTH}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="30 minutes with the team lead. Bring a portfolio."
              className="mt-1 w-full resize-y rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text placeholder:text-lantern-text-tertiary"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-lantern-border px-3 py-1.5 text-sm font-medium text-lantern-text"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="rounded-lg bg-lantern-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving
                ? "Sending…"
                : rescheduleId
                  ? "Send new times"
                  : "Send invitation"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-lantern-text-tertiary">
          Loading interviews…
        </p>
      ) : interviews.length === 0 && !formOpen ? (
        <p className="text-xs text-lantern-text-tertiary">
          No interview scheduled. Propose a few times and {candidateName} picks
          one.
        </p>
      ) : (
        <ul className="space-y-2">
          {interviews.map((interview) => (
            <li
              key={interview.id}
              className="rounded-lg border border-lantern-border bg-lantern-background p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-lantern-text">
                  {describeJobInterviewSchedule(interview)}
                </p>
                <span className="shrink-0 text-xs font-semibold text-lantern-text-tertiary">
                  {JOB_INTERVIEW_STATUS_LABELS[interview.status]}
                </span>
              </div>
              {interview.locationText ? (
                <p className="mt-1 break-words text-xs text-lantern-text-secondary">
                  {JOB_INTERVIEW_LOCATION_LABELS[interview.mode]}:{" "}
                  {interview.locationText}
                </p>
              ) : null}
              {interview.details ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-lantern-text-secondary">
                  {interview.details}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-3">
                {canEmployerRescheduleJobInterview(interview.status) ? (
                  <button
                    type="button"
                    onClick={() => openReschedule(interview)}
                    className="text-xs font-semibold text-lantern-primary underline"
                  >
                    Reschedule
                  </button>
                ) : null}
                {canEmployerCompleteJobInterview(interview.status) ? (
                  <button
                    type="button"
                    onClick={() => void changeStatus(interview, "completed")}
                    className="text-xs font-semibold text-lantern-text-secondary underline"
                  >
                    Mark completed
                  </button>
                ) : null}
                {canEmployerCancelJobInterview(interview.status) ? (
                  <button
                    type="button"
                    onClick={() => void changeStatus(interview, "cancelled")}
                    className="text-xs font-semibold text-lantern-text-tertiary underline hover:text-red-600"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default JobInterviewScheduler;
