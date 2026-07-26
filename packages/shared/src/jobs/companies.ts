/**
 * Company profile rules: field limits, member roles, and who may edit or invite.
 * Shared so the employer hub and the API cannot disagree on who can do what.
 */
import type { JobCompanyMemberRole } from "./types";

export const JOB_COMPANY_NAME_MAX_LENGTH = 200;
export const JOB_COMPANY_TAGLINE_MAX_LENGTH = 160;
export const JOB_COMPANY_ABOUT_MAX_LENGTH = 4000;
export const JOB_COMPANY_INDUSTRY_MAX_LENGTH = 120;
export const JOB_COMPANY_LOCATION_MAX_LENGTH = 200;
export const JOB_COMPANY_WEBSITE_MAX_LENGTH = 300;
export const JOB_COMPANY_DOMAIN_MAX_LENGTH = 200;
export const JOB_COMPANY_MEMBER_LIMIT = 25;
/** Logo upload cap — enough for a crisp mark, not a full-bleed hero. */
export const JOB_COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const JOB_COMPANY_VERIFICATION_LABELS: Record<
  "unverified" | "pending" | "verified" | "rejected",
  string
> = {
  unverified: "Unverified",
  pending: "Pending review",
  verified: "Verified",
  rejected: "Verification rejected",
};

export function canEditJobCompanyProfile(
  role: JobCompanyMemberRole | null | undefined,
): boolean {
  return role === "owner" || role === "recruiter";
}

/** Only owners invite and remove teammates — recruiters should not grow the team. */
export function canManageJobCompanyMembers(
  role: JobCompanyMemberRole | null | undefined,
): boolean {
  return role === "owner";
}

export function canRemoveJobCompanyMember(input: {
  actorRole: JobCompanyMemberRole | null | undefined;
  targetRole: JobCompanyMemberRole;
  actorUserId: string;
  targetUserId: string;
}): boolean {
  if (!canManageJobCompanyMembers(input.actorRole)) return false;
  // An owner must not demote themselves out of the only owner seat via this path.
  if (input.actorUserId === input.targetUserId) return false;
  if (input.targetRole === "owner") return false;
  return true;
}

export function normalizeJobCompanyWebsite(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, JOB_COMPANY_WEBSITE_MAX_LENGTH);
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function normalizeJobCompanyDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let domain = value.trim().toLowerCase().slice(0, JOB_COMPANY_DOMAIN_MAX_LENGTH);
  if (!domain) return null;
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  domain = domain.replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return domain;
}

export function clampJobCompanyText(
  value: unknown,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}
