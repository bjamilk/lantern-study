/**
 * Employer bulk tools: multi-status moves, applicant CSV export, and canned
 * copy for notes / interview invites / offers. Kept in shared so the API
 * exporter and the web/mobile action bars cannot drift on limits or columns.
 */
import { JOB_APPLICATION_STATUS_LABELS } from "./portal";
import type { JobApplication, JobApplicationStatus } from "./types";

/** Cap so a mis-click cannot fan out hundreds of notifications at once. */
export const JOB_BULK_STATUS_MAX = 50;

/**
 * Statuses an employer may set in bulk. `withdrawn` is applicant-only;
 * `interested` / `new` are applicant-initiated inbox states and are left off
 * the bulk picker so recruiters do not accidentally rewind triage.
 */
export const JOB_EMPLOYER_BULK_STATUSES: readonly JobApplicationStatus[] = [
  "chatting",
  "reviewing",
  "interview",
  "offer",
  "hired",
  "rejected",
];

export function isJobEmployerBulkStatus(
  value: unknown,
): value is JobApplicationStatus {
  return (
    typeof value === "string" &&
    (JOB_EMPLOYER_BULK_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Dedupes, drops empties, and enforces the bulk cap. Returns null when the
 * payload is unusable so the API can 400 with one message.
 */
export function normalizeBulkApplicationIds(
  ids: unknown,
  max = JOB_BULK_STATUS_MAX,
): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length > max) return null;
  }
  return unique.length ? unique : null;
}

export type JobMessageTemplateKind =
  | "note"
  | "interview"
  | "offer"
  | "rejection";

export interface JobMessageTemplate {
  id: string;
  kind: JobMessageTemplateKind;
  label: string;
  /** Body inserted into the note / details field. */
  body: string;
}

export const JOB_MESSAGE_TEMPLATE_KIND_LABELS: Record<
  JobMessageTemplateKind,
  string
> = {
  note: "Private note",
  interview: "Interview invite",
  offer: "Offer terms",
  rejection: "Rejection note",
};

/**
 * Starter copy. These are seeds, not locked workflows — recruiters edit before
 * saving. Kept short so they fit the note and details length limits.
 */
export const JOB_MESSAGE_TEMPLATES: readonly JobMessageTemplate[] = [
  {
    id: "note-strong-fit",
    kind: "note",
    label: "Strong fit",
    body: "Strong fit for the role. Relevant experience and clear communication. Move forward to interview.",
  },
  {
    id: "note-needs-portfolio",
    kind: "note",
    label: "Needs portfolio",
    body: "Interesting background but portfolio / work samples are thin. Ask for 1–2 examples before scheduling.",
  },
  {
    id: "note-follow-up",
    kind: "note",
    label: "Follow up later",
    body: "Promising candidate, not the right timing. Park for a future opening and keep the door open.",
  },
  {
    id: "interview-video-30",
    kind: "interview",
    label: "30-min video screen",
    body: "30-minute video conversation with the hiring team. Please join a few minutes early and have a quiet space ready.",
  },
  {
    id: "interview-onsite",
    kind: "interview",
    label: "On-site visit",
    body: "On-site interview. Bring a photo ID. We will cover role expectations and a short skills discussion.",
  },
  {
    id: "interview-phone",
    kind: "interview",
    label: "Phone screen",
    body: "Short phone screen to walk through your experience and answer questions about the role.",
  },
  {
    id: "offer-standard",
    kind: "offer",
    label: "Standard offer note",
    body: "We are pleased to offer you this role. Please review the compensation and start date, and reply by the deadline so we can finalize onboarding.",
  },
  {
    id: "offer-flexible-start",
    kind: "offer",
    label: "Flexible start",
    body: "Offer details are below. Start date is flexible within two weeks of acceptance — tell us what works for you.",
  },
  {
    id: "rejection-polite",
    kind: "rejection",
    label: "Polite pass",
    body: "Thank you for applying. We moved forward with candidates whose experience was a closer match for this opening. We appreciate your time and wish you the best.",
  },
  {
    id: "rejection-keep-warm",
    kind: "rejection",
    label: "Keep warm",
    body: "Not selected for this role, but we were impressed. We will keep your profile in mind for related openings.",
  },
];

export function filterJobMessageTemplates(
  kind?: JobMessageTemplateKind | null,
): JobMessageTemplate[] {
  if (!kind) return [...JOB_MESSAGE_TEMPLATES];
  return JOB_MESSAGE_TEMPLATES.filter((template) => template.kind === kind);
}

export function getJobMessageTemplate(
  id: string,
): JobMessageTemplate | undefined {
  return JOB_MESSAGE_TEMPLATES.find((template) => template.id === id);
}

export function escapeCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export type JobApplicantCsvRowInput = Pick<
  JobApplication,
  | "id"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "source"
  | "resumeFilename"
  | "resumeUrl"
  | "answers"
  | "notesCount"
  | "dmThreadId"
> & {
  applicant?: JobApplication["applicant"];
  postingTitle?: string | null;
};

export interface JobApplicantCsvOptions {
  /** Map screening question id → prompt for readable answer columns. */
  questionLabels?: Record<string, string>;
  postingTitle?: string | null;
}

const BASE_CSV_HEADERS = [
  "application_id",
  "posting_title",
  "applicant_name",
  "applicant_username",
  "applicant_id",
  "status",
  "status_label",
  "source",
  "applied_at",
  "updated_at",
  "resume_filename",
  "resume_url",
  "notes_count",
  "dm_thread_id",
] as const;

/**
 * Builds a CSV string for the selected (or all) applicants. Answer columns are
 * appended after the base headers, one per known screening question.
 */
export function buildJobApplicantsCsv(
  apps: readonly JobApplicantCsvRowInput[],
  opts: JobApplicantCsvOptions = {},
): string {
  const questionIds = new Set<string>();
  for (const app of apps) {
    for (const key of Object.keys(app.answers || {})) {
      questionIds.add(key);
    }
  }
  for (const key of Object.keys(opts.questionLabels || {})) {
    questionIds.add(key);
  }
  const orderedQuestions = [...questionIds].sort((a, b) => {
    const left = opts.questionLabels?.[a] || a;
    const right = opts.questionLabels?.[b] || b;
    return left.localeCompare(right, undefined, { sensitivity: "base" });
  });

  const headers = [
    ...BASE_CSV_HEADERS,
    ...orderedQuestions.map(
      (id) =>
        `answer_${(opts.questionLabels?.[id] || id).replace(/\s+/g, "_")}`,
    ),
  ];

  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const app of apps) {
    const row = [
      app.id,
      opts.postingTitle || app.postingTitle || "",
      app.applicant?.name || "",
      app.applicant?.username || "",
      app.applicant?.id || "",
      app.status,
      JOB_APPLICATION_STATUS_LABELS[app.status] || app.status,
      app.source || "",
      app.createdAt || "",
      app.updatedAt || "",
      app.resumeFilename || "",
      app.resumeUrl || "",
      app.notesCount ?? 0,
      app.dmThreadId || "",
      ...orderedQuestions.map((id) => app.answers?.[id] || ""),
    ];
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return lines.join("\n");
}

export function jobApplicantsCsvFilename(
  postingTitle?: string | null,
  now = new Date(),
): string {
  const slug = (postingTitle || "applicants")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = now.toISOString().slice(0, 10);
  return `${slug || "applicants"}-${stamp}.csv`;
}
