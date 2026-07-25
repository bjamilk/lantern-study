/**
 * Resume upload rules shared by both clients and the API so a file is rejected
 * before it is uploaded rather than after. Kept in sync with the mime types and
 * size limit declared on the private `job-resumes` storage bucket.
 */

export const JOB_RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const JOB_RESUME_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type JobResumeMimeType = (typeof JOB_RESUME_ALLOWED_MIME_TYPES)[number];

const EXTENSION_TO_MIME: Record<string, JobResumeMimeType> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const JOB_RESUME_ALLOWED_EXTENSIONS = Object.keys(EXTENSION_TO_MIME);

/** Human-readable list for helper text, e.g. "PDF, DOC, or DOCX". */
export const JOB_RESUME_ACCEPT_LABEL = "PDF, DOC, or DOCX";

/** `accept` attribute value for web file inputs. */
export const JOB_RESUME_ACCEPT_ATTRIBUTE = [
  ...JOB_RESUME_ALLOWED_MIME_TYPES,
  ...JOB_RESUME_ALLOWED_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

export function jobResumeExtension(filename: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename.trim());
  if (!match?.[1]) return null;
  const ext = match[1].toLowerCase();
  return ext in EXTENSION_TO_MIME ? ext : null;
}

/**
 * Resolve the mime type to upload with. Pickers report inconsistent types
 * (and sometimes none at all), so the extension is the source of truth.
 */
export function jobResumeMimeType(
  filename: string,
  reportedType?: string | null,
): JobResumeMimeType | null {
  const ext = jobResumeExtension(filename);
  if (ext) return EXTENSION_TO_MIME[ext] ?? null;
  const reported = (reportedType || "").toLowerCase();
  return (JOB_RESUME_ALLOWED_MIME_TYPES as readonly string[]).includes(reported)
    ? (reported as JobResumeMimeType)
    : null;
}

export function formatJobResumeSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns an error message when the file is not an acceptable resume, else null. */
export function validateJobResume(file: {
  name: string;
  size?: number | null;
  type?: string | null;
}): string | null {
  if (!file.name?.trim()) return "Choose a file to upload";
  if (!jobResumeMimeType(file.name, file.type)) {
    return `Resumes must be a ${JOB_RESUME_ACCEPT_LABEL} file`;
  }
  if (file.size != null && file.size > JOB_RESUME_MAX_BYTES) {
    return `Resumes must be smaller than ${formatJobResumeSize(JOB_RESUME_MAX_BYTES)}`;
  }
  if (file.size != null && file.size <= 0) return "That file looks empty";
  return null;
}
