/**
 * SEO / share metadata for public job and company pages.
 * Used by the SPA (usePageSeo) and mirrored by Cloudflare bot HTML.
 */
import { formatJobCompensation } from "./compensation";
import { JOB_EMPLOYMENT_TYPE_LABELS } from "./employmentTypes";
import { formatJobLocation } from "./portal";
import type { JobCompany, JobPosting } from "./types";
import { WEB_BASE_URL } from "../linking";

export const JOBS_BROWSE_SEO = {
  title: "Campus & student jobs in Nigeria | Lantern Study",
  description:
    "Browse gigs, tutoring, internships, and campus roles on Lantern Study Jobs. Hiring terms are between you and the poster — Lantern is not the employer.",
  canonicalUrl: `${WEB_BASE_URL}/marketplace/jobs`,
} as const;

const DEFAULT_OG_IMAGE = `${WEB_BASE_URL}/lantern-icon-v2.png`;
const META_DESCRIPTION_MAX = 160;

export interface JobPageSeo {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImage: string;
  ogType: string;
  jsonLd: Record<string, unknown>;
}

function clipDescription(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const source = cleaned || fallback;
  if (source.length <= META_DESCRIPTION_MAX) return source;
  return `${source.slice(0, META_DESCRIPTION_MAX - 1).trimEnd()}…`;
}

export function jobEmployerName(
  job: Pick<JobPosting, "company" | "poster">,
): string {
  return (
    job.company?.displayName ||
    job.poster?.name ||
    job.poster?.username ||
    "Independent poster"
  );
}

export function buildJobPostingSeo(
  job: Pick<
    JobPosting,
    | "id"
    | "title"
    | "description"
    | "employmentType"
    | "compensation"
    | "locationText"
    | "isRemote"
    | "campusName"
    | "company"
    | "poster"
    | "status"
    | "createdAt"
    | "updatedAt"
  >,
): JobPageSeo {
  const employer = jobEmployerName(job);
  const location = formatJobLocation(job);
  const typeLabel = JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType] || "Job";
  const pay = formatJobCompensation(job.compensation);
  const title = `${job.title} — ${employer} · ${location} | Lantern Study`;
  const description = clipDescription(
    job.description || "",
    `${typeLabel} · ${pay} · ${location}. Apply on Lantern Study Jobs.`,
  );
  const canonicalUrl = `${WEB_BASE_URL}/marketplace/jobs/${encodeURIComponent(job.id)}`;
  const ogImage = job.company?.logoUrl || DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    canonicalUrl,
    ogImage,
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: job.title,
      description: job.description || description,
      datePosted: job.createdAt,
      hiringOrganization: {
        "@type": job.company ? "Organization" : "Person",
        name: employer,
        ...(job.company?.logoUrl ? { logo: job.company.logoUrl } : {}),
        ...(job.company?.website ? { sameAs: job.company.website } : {}),
      },
      jobLocationType: job.isRemote ? "TELECOMMUTE" : undefined,
      employmentType: typeLabel,
      url: canonicalUrl,
      image: ogImage,
    },
  };
}

export function buildJobCompanySeo(
  company: Pick<
    JobCompany,
    | "id"
    | "displayName"
    | "tagline"
    | "about"
    | "industry"
    | "hqLocation"
    | "logoUrl"
    | "website"
    | "verificationStatus"
  >,
  openRoleCount?: number,
): JobPageSeo {
  const rolesHint =
    typeof openRoleCount === "number"
      ? openRoleCount === 1
        ? "1 open role"
        : `${openRoleCount} open roles`
      : "Open roles";
  const title = `${company.displayName} — jobs on Lantern Study`;
  const description = clipDescription(
    company.tagline || company.about || "",
    `${company.displayName}${company.industry ? ` · ${company.industry}` : ""}${
      company.hqLocation ? ` · ${company.hqLocation}` : ""
    }. ${rolesHint} on Lantern Study Jobs.`,
  );
  const canonicalUrl = `${WEB_BASE_URL}/marketplace/companies/${encodeURIComponent(company.id)}`;
  const ogImage = company.logoUrl || DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    canonicalUrl,
    ogImage,
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: company.displayName,
      description,
      url: canonicalUrl,
      logo: ogImage,
      ...(company.website ? { sameAs: company.website } : {}),
    },
  };
}
