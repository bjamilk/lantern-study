/**
 * Candidate-facing trust signals for job and company surfaces.
 * Derived from existing company verification fields — no separate risk score.
 */
import type { JobCompany, JobCompanyVerificationStatus, JobPosting } from "./types";

export type JobEmployerTrustKind =
  | "verified_company"
  | "unverified_company"
  | "individual";

export type JobReportReason =
  | "scam"
  | "spam"
  | "inappropriate"
  | "discriminatory"
  | "other";

export const JOB_REPORT_REASONS: readonly JobReportReason[] = [
  "scam",
  "spam",
  "inappropriate",
  "discriminatory",
  "other",
] as const;

export const JOB_REPORT_REASON_LABELS: Record<JobReportReason, string> = {
  scam: "Scam or fraud",
  spam: "Spam or misleading",
  inappropriate: "Inappropriate content",
  discriminatory: "Discriminatory",
  other: "Other",
};

export const JOB_REPORT_DETAILS_MAX_LENGTH = 1000;

export function isJobReportReason(value: unknown): value is JobReportReason {
  return (
    typeof value === "string" &&
    (JOB_REPORT_REASONS as readonly string[]).includes(value)
  );
}

export function isJobCompanyVerified(
  company: Pick<JobCompany, "verificationStatus"> | null | undefined,
): boolean {
  return company?.verificationStatus === "verified";
}

export interface JobEmployerTrustPresentation {
  kind: JobEmployerTrustKind;
  /** Short badge label for list/detail chips. */
  label: string;
  /** One-line help under “About the poster”. */
  shortHelp: string;
  /** Tailwind-ish tone hint for clients that style by kind. */
  tone: "positive" | "caution" | "neutral";
}

export function getJobEmployerTrustPresentation(input: {
  company?: Pick<JobCompany, "verificationStatus"> | null;
  companyId?: string | null;
}): JobEmployerTrustPresentation {
  if (input.companyId || input.company) {
    if (isJobCompanyVerified(input.company)) {
      return {
        kind: "verified_company",
        label: "Verified company",
        shortHelp:
          "This company has completed Lantern’s company verification.",
        tone: "positive",
      };
    }
    return {
      kind: "unverified_company",
      label: "Unverified company",
      shortHelp:
        "This company has not completed Lantern’s company verification. Be cautious with personal or banking details.",
      tone: "caution",
    };
  }
  return {
    kind: "individual",
    label: "Individual poster",
    shortHelp:
      "This role was posted by an individual or organization without a verified company profile. Prefer public meetups and never pay a fee to apply.",
    tone: "neutral",
  };
}

export function getJobEmployerTrustFromPosting(
  job: Pick<JobPosting, "companyId" | "company">,
): JobEmployerTrustPresentation {
  return getJobEmployerTrustPresentation({
    companyId: job.companyId,
    company: job.company,
  });
}

/** Human label for employer hub / create-job company picker. */
export function formatJobCompanyVerificationLabel(
  status: JobCompanyVerificationStatus | string | null | undefined,
): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "pending":
      return "Pending review";
    case "rejected":
      return "Verification rejected";
    case "unverified":
      return "Unverified";
    default:
      return status ? String(status) : "Unknown";
  }
}
