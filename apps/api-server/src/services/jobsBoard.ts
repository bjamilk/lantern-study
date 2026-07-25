/**
 * Jobs board service — employment listings sibling of marketplace goods.
 * Mutations use the service-role Supabase client.
 */
import { randomUUID } from "crypto";
import {
  JOBS_DEFAULT_COUNTRY,
  JOBS_MAX_SCREENERS_PHASE1,
  JOBS_MAX_SCREENERS_PHASE2,
  JOB_RESUME_MAX_BYTES,
  isJobCompensationPeriod,
  jobResumeExtension,
  jobResumeMimeType,
  isValidJobEngagementDuration,
  jobRequiresEngagementDuration,
  textFailsJobScamCheck,
  type JobApplicationStatus,
  type JobCompensation,
  type JobEmploymentType,
  type JobEngagementDuration,
  type JobPostingStatus,
} from "@lantern/shared/jobs";
import { SupabaseService } from "./supabase";
import { logger } from "../utils/logger";

export type CreateJobPostingInput = {
  title: string;
  description: string;
  employmentType: JobEmploymentType;
  campusId?: string | null;
  campusIds?: string[];
  locationText?: string | null;
  isRemote?: boolean;
  compensation: JobCompensation;
  engagementDuration?: JobEngagementDuration | null;
  deadline?: string | null;
  applyMode?: "in_app" | "external" | "both";
  externalUrl?: string | null;
  companyId?: string | null;
  status?: JobPostingStatus;
  requiresSchoolApproval?: boolean;
  screeningQuestions?: Array<{
    prompt: string;
    questionType?: "text" | "single_choice";
    options?: string[];
    required?: boolean;
  }>;
  isSponsored?: boolean;
  sponsoredUntil?: string | null;
  atsProvider?: string | null;
  atsExternalId?: string | null;
  atsWebhookUrl?: string | null;
};

const RESUME_BUCKET = "job-resumes";
const RESUME_SIGNED_URL_TTL_SECONDS = 60 * 10;

function httpError(message: string, statusCode = 400): Error {
  const err = new Error(message);
  (err as Error & { statusCode?: number }).statusCode = statusCode;
  return err;
}

function normalizeCompensation(
  compensation: JobCompensation | null | undefined,
): JobCompensation {
  const c = compensation || { kind: "discuss" as const };
  if (c.kind !== "paid") {
    return {
      kind: c.kind,
      currency: c.currency || "NGN",
      notes: c.notes || null,
    };
  }
  if (c.amountMin != null && !isJobCompensationPeriod(c.period)) {
    throw httpError("Pay period is required when a paid amount is set");
  }
  if (c.amountMin == null && !c.period) {
    throw httpError("Paid jobs need an amount and pay period, or use Discuss");
  }
  if (!isJobCompensationPeriod(c.period)) {
    throw httpError("Pay period is required for paid jobs");
  }
  return {
    kind: "paid",
    currency: c.currency || "NGN",
    amountMin: c.amountMin ?? null,
    amountMax: c.amountMax ?? null,
    period: c.period,
    notes: c.notes || null,
  };
}

function normalizeEngagementDuration(
  employmentType: JobEmploymentType,
  duration: JobEngagementDuration | null | undefined,
): JobEngagementDuration | null {
  if (!jobRequiresEngagementDuration(employmentType)) {
    return null;
  }
  if (!isValidJobEngagementDuration(duration)) {
    throw httpError(
      "Role duration is required for non–full-time jobs (ongoing or a fixed length)",
    );
  }
  if (duration.kind === "ongoing") return { kind: "ongoing" };
  return {
    kind: "fixed",
    value: Number(duration.value),
    unit: duration.unit,
  };
}

function mapPosting(row: any, savedPostingIds?: ReadonlySet<string>) {
  if (!row) return null;
  const campus = Array.isArray(row.campus) ? row.campus[0] : row.campus;
  const company = Array.isArray(row.company) ? row.company[0] : row.company;
  const poster = Array.isArray(row.poster) ? row.poster[0] : row.poster;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    employmentType: row.employment_type,
    campusId: row.campus_id,
    campusIds: row.campus_ids || [],
    locationText: row.location_text,
    isRemote: !!row.is_remote,
    compensation: row.compensation || { kind: "discuss" },
    engagementDuration: row.engagement_duration || null,
    deadline: row.deadline,
    applyMode: row.apply_mode,
    externalUrl: row.external_url,
    posterUserId: row.poster_user_id,
    companyId: row.company_id,
    status: row.status,
    viewsCount: row.views_count ?? 0,
    isSponsored: !!row.is_sponsored,
    sponsoredUntil: row.sponsored_until,
    atsProvider: row.ats_provider,
    atsExternalId: row.ats_external_id,
    atsWebhookUrl: row.ats_webhook_url,
    requiresSchoolApproval: !!row.requires_school_approval,
    countryCode: row.country_code || JOBS_DEFAULT_COUNTRY,
    campusName: campus?.name || null,
    isSaved: savedPostingIds ? savedPostingIds.has(row.id) : undefined,
    company: company
      ? {
          id: company.id,
          legalName: company.legal_name,
          displayName: company.display_name,
          website: company.website,
          logoUrl: company.logo_url,
          industry: company.industry,
          countryCode: company.country_code,
          verificationStatus: company.verification_status,
          verificationDomain: company.verification_domain,
          createdBy: company.created_by,
          createdAt: company.created_at,
          updatedAt: company.updated_at,
        }
      : null,
    poster: poster
      ? {
          id: poster.id,
          name: poster.name,
          username: poster.username,
          avatarUrl: poster.avatar_url,
        }
      : null,
    screeningQuestions: Array.isArray(row.screening_questions)
      ? row.screening_questions
          .map((q: any) => ({
            id: q.id,
            postingId: q.posting_id,
            sortOrder: q.sort_order,
            prompt: q.prompt,
            questionType: q.question_type,
            options: q.options,
            required: !!q.required,
          }))
          .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplication(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    postingId: row.posting_id,
    applicantId: row.applicant_id,
    answers: row.answers || {},
    resumeUrl: row.resume_url,
    resumePath: row.resume_path || null,
    resumeFilename: row.resume_filename || null,
    status: row.status,
    dmThreadId: row.dm_thread_id,
    source: row.source,
    profileSnapshot: row.profile_snapshot,
    posting: row.posting ? mapPosting(row.posting) : undefined,
    applicant: row.applicant
      ? {
          id: row.applicant.id,
          name: row.applicant.name,
          username: row.applicant.username,
          avatarUrl: row.applicant.avatar_url,
        }
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplicantProfile(row: any) {
  if (!row) return null;
  return {
    userId: row.user_id,
    headline: row.headline,
    phone: row.phone,
    locationText: row.location_text,
    resumePath: row.resume_path,
    resumeFilename: row.resume_filename,
    resumeSizeBytes: row.resume_size_bytes,
    resumeUploadedAt: row.resume_uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCompany(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    legalName: row.legal_name,
    displayName: row.display_name,
    website: row.website,
    logoUrl: row.logo_url,
    industry: row.industry,
    countryCode: row.country_code,
    verificationStatus: row.verification_status,
    verificationDomain: row.verification_domain,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class JobsBoardService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    return this.supabase.getClient();
  }

  async listPostings(filters: {
    page?: number;
    limit?: number;
    search?: string;
    employmentType?: string;
    campusId?: string;
    companyOnly?: boolean;
    remote?: boolean;
    compensationKind?: "paid" | "unpaid" | "discuss";
    sort?: "newest" | "closing";
    sponsoredFirst?: boolean;
    viewerId?: string | null;
  }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.limit || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.client()
      .from("job_postings")
      .select(
        `
        *,
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*),
        poster:profiles!poster_user_id(id, name, username, avatar_url)
      `,
        { count: "exact" },
      )
      .eq("status", "active")
      .eq("country_code", JOBS_DEFAULT_COUNTRY);

    if (filters.employmentType)
      query = query.eq("employment_type", filters.employmentType);
    if (filters.campusId) query = query.eq("campus_id", filters.campusId);
    if (filters.companyOnly) query = query.not("company_id", "is", null);
    if (filters.remote !== undefined)
      query = query.eq("is_remote", filters.remote);
    if (filters.compensationKind) {
      query = query.contains("compensation", {
        kind: filters.compensationKind,
      });
    }
    if (filters.search?.trim()) {
      query = query.textSearch("search_vector", filters.search.trim(), {
        type: "websearch",
        config: "english",
      });
    }

    if (filters.sort === "closing") {
      query = query
        .not("deadline", "is", null)
        .gte("deadline", new Date().toISOString())
        .order("deadline", { ascending: true });
    } else if (filters.sponsoredFirst !== false) {
      query = query
        .order("is_sponsored", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    const savedIds = await this.savedPostingIds(
      filters.viewerId,
      (data || []).map((row: any) => row.id),
    );
    return {
      data: (data || []).map((row: any) => mapPosting(row, savedIds)),
      pagination: { page, limit, total: count ?? 0 },
    };
  }

  /**
   * Saved-posting ids for a viewer, limited to the supplied postings so the
   * lookup stays proportional to the page being rendered.
   */
  private async savedPostingIds(
    viewerId: string | null | undefined,
    postingIds: string[],
  ): Promise<ReadonlySet<string> | undefined> {
    if (!viewerId) return undefined;
    if (!postingIds.length) return new Set<string>();
    const { data, error } = await this.client()
      .from("job_favorites")
      .select("posting_id")
      .eq("user_id", viewerId)
      .in("posting_id", postingIds);
    if (error) {
      logger.warn("Failed to load saved jobs for viewer", { error });
      return undefined;
    }
    return new Set((data || []).map((row: any) => row.posting_id));
  }

  async savePosting(userId: string, postingId: string) {
    const posting = await this.getPosting(postingId);
    if (!posting) throw httpError("Job not found", 404);
    const { error } = await this.client()
      .from("job_favorites")
      .insert({ user_id: userId, posting_id: postingId });
    // 23505 = already saved, which is the desired end state.
    if (error && error.code !== "23505") throw error;
    return { postingId, isSaved: true };
  }

  async unsavePosting(userId: string, postingId: string) {
    const { error } = await this.client()
      .from("job_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("posting_id", postingId);
    if (error) throw error;
    return { postingId, isSaved: false };
  }

  async listSavedPostings(userId: string) {
    const { data, error } = await this.client()
      .from("job_favorites")
      .select(
        `
        posting_id,
        created_at,
        posting:job_postings(
          *,
          campus:marketplace_campuses!campus_id(id, name, slug),
          company:job_companies(*),
          poster:profiles!poster_user_id(id, name, username, avatar_url)
        )
      `,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const savedIds = new Set((data || []).map((row: any) => row.posting_id));
    return (data || [])
      .map((row: any) =>
        Array.isArray(row.posting) ? row.posting[0] : row.posting,
      )
      .filter(
        (posting: any) => posting && posting.status !== "removed_by_admin",
      )
      .map((posting: any) => mapPosting(posting, savedIds));
  }

  async getPosting(
    id: string,
    opts?: { incrementViews?: boolean; viewerId?: string | null },
  ) {
    const { data, error } = await this.client()
      .from("job_postings")
      .select(
        `
        *,
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*),
        poster:profiles!poster_user_id(id, name, username, avatar_url),
        screening_questions:job_screening_questions(*)
      `,
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    if (opts?.incrementViews && data.status === "active") {
      await this.client()
        .from("job_postings")
        .update({ views_count: (data.views_count || 0) + 1 })
        .eq("id", id);
      data.views_count = (data.views_count || 0) + 1;
    }

    return mapPosting(
      data,
      await this.savedPostingIds(opts?.viewerId, [data.id]),
    );
  }

  async createPosting(userId: string, input: CreateJobPostingInput) {
    const combined = `${input.title}\n${input.description}`;
    if (textFailsJobScamCheck(combined)) {
      throw httpError(
        "This job text matches banned scam patterns (fees to start, BVN/NIN, crypto, etc.).",
      );
    }

    const compensation = normalizeCompensation(input.compensation);
    const engagementDuration = normalizeEngagementDuration(
      input.employmentType,
      input.engagementDuration,
    );

    if (input.applyMode === "external" || input.applyMode === "both") {
      if (!input.externalUrl?.trim()) {
        throw httpError(
          "externalUrl is required when applyMode is external or both",
        );
      }
    }

    let companyId = input.companyId || null;
    if (companyId) {
      const member = await this.getCompanyMembership(companyId, userId);
      if (!member) {
        const err = new Error("You are not a member of this company");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      const company = await this.getCompany(companyId);
      if (
        company?.verificationStatus !== "verified" &&
        input.status === "active"
      ) {
        // Unverified companies can draft; active company posts require verification
        const err = new Error(
          "Company must be verified before publishing jobs",
        );
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
    }

    const maxScreeners = companyId
      ? JOBS_MAX_SCREENERS_PHASE2
      : JOBS_MAX_SCREENERS_PHASE1;
    const screeners = (input.screeningQuestions || []).slice(0, maxScreeners);

    let status = input.status || "active";
    if (input.requiresSchoolApproval) status = "pending_school_approval";

    const { data, error } = await this.client()
      .from("job_postings")
      .insert({
        title: input.title.trim().slice(0, 200),
        description: input.description.trim().slice(0, 10000),
        employment_type: input.employmentType,
        campus_id: input.campusId || null,
        campus_ids: input.campusIds?.length
          ? input.campusIds
          : input.campusId
            ? [input.campusId]
            : [],
        location_text: input.locationText?.trim() || null,
        is_remote: !!input.isRemote,
        compensation,
        engagement_duration: engagementDuration,
        deadline: input.deadline || null,
        apply_mode: input.applyMode || "in_app",
        external_url: input.externalUrl?.trim() || null,
        poster_user_id: userId,
        company_id: companyId,
        status,
        requires_school_approval: !!input.requiresSchoolApproval,
        is_sponsored: !!input.isSponsored,
        sponsored_until: input.sponsoredUntil || null,
        ats_provider: input.atsProvider || null,
        ats_external_id: input.atsExternalId || null,
        ats_webhook_url: input.atsWebhookUrl || null,
        country_code: JOBS_DEFAULT_COUNTRY,
      })
      .select("*")
      .single();

    if (error) throw error;

    if (screeners.length) {
      const { error: qErr } = await this.client()
        .from("job_screening_questions")
        .insert(
          screeners.map((q, i) => ({
            posting_id: data.id,
            sort_order: i,
            prompt: q.prompt.trim().slice(0, 500),
            question_type: q.questionType || "text",
            options: q.options || null,
            required: q.required !== false,
          })),
        );
      if (qErr)
        logger.warn("Failed to insert job screening questions", {
          error: qErr,
        });
    }

    return this.getPosting(data.id);
  }

  async updatePosting(
    postingId: string,
    userId: string,
    updates: Partial<CreateJobPostingInput> & { status?: string },
    opts?: { asAdmin?: boolean },
  ) {
    const existing = await this.getPosting(postingId);
    if (!existing) {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    if (!opts?.asAdmin) {
      const canEdit =
        existing.posterUserId === userId ||
        (existing.companyId &&
          (await this.getCompanyMembership(existing.companyId, userId)));
      if (!canEdit) {
        const err = new Error("Not allowed to edit this job");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title != null) patch.title = updates.title.trim().slice(0, 200);
    if (updates.description != null)
      patch.description = updates.description.trim().slice(0, 10000);
    if (updates.employmentType != null)
      patch.employment_type = updates.employmentType;
    if (updates.campusId !== undefined) patch.campus_id = updates.campusId;
    if (updates.locationText !== undefined)
      patch.location_text = updates.locationText;
    if (updates.isRemote != null) patch.is_remote = updates.isRemote;
    if (updates.compensation != null) {
      patch.compensation = normalizeCompensation(updates.compensation);
    }
    if (
      updates.engagementDuration !== undefined ||
      updates.employmentType != null
    ) {
      const nextType = updates.employmentType || existing.employmentType;
      const nextDuration =
        updates.engagementDuration !== undefined
          ? updates.engagementDuration
          : existing.engagementDuration;
      patch.engagement_duration = normalizeEngagementDuration(
        nextType,
        nextDuration,
      );
    }
    if (updates.deadline !== undefined) patch.deadline = updates.deadline;
    if (updates.applyMode != null) patch.apply_mode = updates.applyMode;
    if (updates.externalUrl !== undefined)
      patch.external_url = updates.externalUrl;
    if (updates.status != null) patch.status = updates.status;
    if (updates.isSponsored != null) patch.is_sponsored = updates.isSponsored;
    if (updates.sponsoredUntil !== undefined)
      patch.sponsored_until = updates.sponsoredUntil;
    if (updates.atsProvider !== undefined)
      patch.ats_provider = updates.atsProvider;
    if (updates.atsExternalId !== undefined)
      patch.ats_external_id = updates.atsExternalId;
    if (updates.atsWebhookUrl !== undefined)
      patch.ats_webhook_url = updates.atsWebhookUrl;
    if (updates.requiresSchoolApproval != null) {
      patch.requires_school_approval = updates.requiresSchoolApproval;
    }

    const checkText = `${(patch.title as string) || existing.title}\n${(patch.description as string) || existing.description}`;
    if (textFailsJobScamCheck(checkText)) {
      const err = new Error("Updated text matches banned scam patterns.");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    const { error } = await this.client()
      .from("job_postings")
      .update(patch)
      .eq("id", postingId);
    if (error) throw error;
    return this.getPosting(postingId);
  }

  async listMyPostings(userId: string) {
    const { data, error } = await this.client()
      .from("job_postings")
      .select(
        `
        *,
        campus:marketplace_campuses!campus_id(id, name, slug),
        company:job_companies(*)
      `,
      )
      .eq("poster_user_id", userId)
      .neq("status", "removed_by_admin")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => mapPosting(row));
  }

  async expressApply(
    postingId: string,
    applicantId: string,
    payload: {
      message?: string;
      answers?: Record<string, string>;
      resumeUrl?: string | null;
      resumePath?: string | null;
      resumeFilename?: string | null;
    },
  ) {
    const posting = await this.getPosting(postingId);
    if (!posting || posting.status !== "active") {
      const err = new Error("Job is not open for applications");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    if (posting.posterUserId === applicantId) {
      const err = new Error("You cannot apply to your own job");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
    if (posting.applyMode === "external") {
      const err = new Error(
        "This job only accepts applications on the company site",
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    const message = (payload.message || `I'm interested in "${posting.title}".`)
      .trim()
      .slice(0, 2000);
    if (textFailsJobScamCheck(message)) {
      const err = new Error("Application message contains banned content");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    // Company jobs: messaging unlocked only when verified
    if (
      posting.companyId &&
      posting.company?.verificationStatus !== "verified"
    ) {
      const err = new Error("This employer is not verified yet");
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    // Attach the resume the applicant chose, or fall back to the one saved on
    // their profile so they do not have to upload it again per application.
    let resumePath = payload.resumePath?.trim() || null;
    let resumeFilename = payload.resumeFilename?.trim() || null;
    if (resumePath) {
      this.assertOwnedResumePath(applicantId, resumePath);
    } else {
      const profile = await this.getApplicantProfile(applicantId);
      if (profile?.resumePath) {
        resumePath = profile.resumePath;
        resumeFilename = resumeFilename || profile.resumeFilename || null;
      }
    }

    const existing = await this.getApplicationByPostingAndApplicant(
      postingId,
      applicantId,
    );
    if (existing) {
      return {
        application: existing,
        existing: true,
        threadId: existing.dmThreadId,
      };
    }

    const posterId = posting.posterUserId;
    const threadId = [applicantId, posterId].sort().join("-");
    const sortedIds = [applicantId, posterId].sort();

    const { error: threadError } = await this.client()
      .from("dm_threads")
      .upsert(
        {
          id: threadId,
          participant_ids: sortedIds,
          participants: {},
          last_message: message,
          last_message_time: new Date().toISOString(),
          status: "open",
          requested_by: null,
        },
        { onConflict: "id" },
      );
    if (threadError)
      throw new Error(`Failed to create DM thread: ${threadError.message}`);

    const { data: profile } = await this.client()
      .from("profiles")
      .select("id, name, username, avatar_url")
      .eq("id", applicantId)
      .maybeSingle();

    const initialStatus: JobApplicationStatus = posting.companyId
      ? "new"
      : "interested";

    const { data, error } = await this.client()
      .from("job_applications")
      .insert({
        posting_id: postingId,
        applicant_id: applicantId,
        answers: payload.answers || {},
        resume_url: payload.resumeUrl || null,
        resume_path: resumePath,
        resume_filename: resumeFilename,
        status: initialStatus,
        dm_thread_id: threadId,
        source: "in_app",
        profile_snapshot: profile
          ? {
              name: profile.name,
              username: profile.username,
              avatarUrl: profile.avatar_url,
            }
          : null,
      })
      .select(
        `
        *,
        posting:job_postings(*),
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        const again = await this.getApplicationByPostingAndApplicant(
          postingId,
          applicantId,
        );
        return {
          application: again,
          existing: true,
          threadId: again?.dmThreadId,
        };
      }
      throw error;
    }

    const dmBody = `💼 Application for: "${posting.title}"\n\n${message}`;
    try {
      await this.supabase.sendDirectMessage(applicantId, posterId, dmBody, {
        bypassPrivacy: true,
      });
    } catch (dmErr) {
      logger.warn("Job apply DM failed", {
        error: dmErr,
        postingId,
        applicantId,
      });
    }

    const applicantName = profile?.name || profile?.username || "An applicant";
    await this.supabase.createNotification(posterId, {
      type: "job_application",
      message: `${applicantName} applied to "${posting.title}"`,
      link: `/marketplace/employer/jobs/${postingId}`,
    });

    // Phase 3: optional ATS webhook fire-and-forget
    if (posting.atsWebhookUrl) {
      void this.fireAtsWebhook(posting, mapApplication(data));
    }

    return { application: mapApplication(data), existing: false, threadId };
  }

  async trackExternalApply(postingId: string, userId?: string | null) {
    const posting = await this.getPosting(postingId);
    if (!posting || posting.status !== "active") {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    if (!posting.externalUrl) {
      const err = new Error("This job has no external apply URL");
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }

    await this.client()
      .from("job_external_apply_clicks")
      .insert({
        posting_id: postingId,
        user_id: userId || null,
      });

    if (userId) {
      const existing = await this.getApplicationByPostingAndApplicant(
        postingId,
        userId,
      );
      if (!existing) {
        await this.client().from("job_applications").insert({
          posting_id: postingId,
          applicant_id: userId,
          answers: {},
          status: "new",
          source: "external_click",
        });
      }
    }

    return { url: posting.externalUrl };
  }

  async getApplicationByPostingAndApplicant(
    postingId: string,
    applicantId: string,
  ) {
    const { data, error } = await this.client()
      .from("job_applications")
      .select(
        `
        *,
        posting:job_postings(*),
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .eq("posting_id", postingId)
      .eq("applicant_id", applicantId)
      .maybeSingle();
    if (error) throw error;
    return mapApplication(data);
  }

  async listMyApplications(userId: string) {
    const { data, error } = await this.client()
      .from("job_applications")
      .select(
        `
        *,
        posting:job_postings(*, company:job_companies(*), campus:marketplace_campuses!campus_id(id, name))
      `,
      )
      .eq("applicant_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapApplication);
  }

  async listApplicantsForPosting(
    postingId: string,
    userId: string,
    opts?: { asAdmin?: boolean },
  ) {
    const posting = await this.getPosting(postingId);
    if (!posting) {
      const err = new Error("Job not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    if (!opts?.asAdmin) {
      const allowed =
        posting.posterUserId === userId ||
        (posting.companyId &&
          (await this.getCompanyMembership(posting.companyId, userId)));
      if (!allowed) {
        const err = new Error("Not allowed");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
    }

    const { data, error } = await this.client()
      .from("job_applications")
      .select(
        `
        *,
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .eq("posting_id", postingId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapApplication);
  }

  async updateApplicationStatus(
    applicationId: string,
    userId: string,
    status: JobApplicationStatus,
    opts?: { asApplicant?: boolean; asAdmin?: boolean },
  ) {
    const { data: app, error } = await this.client()
      .from("job_applications")
      .select("*, posting:job_postings(id, title, poster_user_id, company_id)")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!app) {
      const err = new Error("Application not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    const posting = Array.isArray(app.posting) ? app.posting[0] : app.posting;
    if (opts?.asApplicant) {
      if (app.applicant_id !== userId) {
        const err = new Error("Not allowed");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      if (status !== "withdrawn") {
        const err = new Error("Applicants can only withdraw");
        (err as Error & { statusCode?: number }).statusCode = 400;
        throw err;
      }
    } else if (!opts?.asAdmin) {
      const allowed =
        posting?.poster_user_id === userId ||
        (posting?.company_id &&
          (await this.getCompanyMembership(posting.company_id, userId)));
      if (!allowed) {
        const err = new Error("Not allowed");
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
    }

    const { data, error: upErr } = await this.client()
      .from("job_applications")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", applicationId)
      .select(
        `
        *,
        posting:job_postings(*),
        applicant:profiles!applicant_id(id, name, username, avatar_url)
      `,
      )
      .single();
    if (upErr) throw upErr;

    if (!opts?.asApplicant && app.applicant_id) {
      await this.supabase.createNotification(app.applicant_id, {
        type: "job_application_status",
        message: `Your application for "${posting?.title || "a job"}" is now: ${status}`,
        link: `/marketplace/applications`,
      });
    }

    return mapApplication(data);
  }

  async reportPosting(
    postingId: string,
    reporterId: string,
    reason: string,
    details?: string,
  ) {
    const { data, error } = await this.client()
      .from("job_reports")
      .insert({
        posting_id: postingId,
        reporter_id: reporterId,
        reason,
        details: details?.slice(0, 1000) || null,
      })
      .select("*")
      .single();
    if (error && error.code !== "23505") throw error;
    return data;
  }

  // ─── Applicant profile + resumes ─────────────────────────────────────────

  private resumeBucket() {
    return this.client().storage.from(RESUME_BUCKET);
  }

  /** Storage paths are always `{userId}/{uuid}.{ext}` so ownership is provable. */
  private assertOwnedResumePath(userId: string, path: string) {
    if (
      !path ||
      path.includes("..") ||
      path.includes("\\") ||
      path.startsWith("/")
    ) {
      throw httpError("Invalid resume path");
    }
    if (!path.startsWith(`${userId}/`)) {
      throw httpError("Not allowed", 403);
    }
  }

  async getApplicantProfile(userId: string) {
    const { data, error } = await this.client()
      .from("job_applicant_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return mapApplicantProfile(data);
  }

  async saveApplicantProfile(
    userId: string,
    input: {
      headline?: string | null;
      phone?: string | null;
      locationText?: string | null;
    },
  ) {
    const patch: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (input.headline !== undefined) {
      patch.headline = input.headline?.trim().slice(0, 160) || null;
    }
    if (input.phone !== undefined) {
      patch.phone = input.phone?.trim().slice(0, 40) || null;
    }
    if (input.locationText !== undefined) {
      patch.location_text = input.locationText?.trim().slice(0, 120) || null;
    }
    if (
      typeof patch.headline === "string" &&
      textFailsJobScamCheck(patch.headline)
    ) {
      throw httpError("Your headline contains banned content");
    }

    const { data, error } = await this.client()
      .from("job_applicant_profiles")
      .upsert(patch, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw error;
    return mapApplicantProfile(data);
  }

  /**
   * Mint a short-lived signed upload URL so the file goes straight to Storage
   * rather than through the API process.
   */
  async createResumeUploadUrl(
    userId: string,
    input: { filename: string; sizeBytes?: number | null },
  ) {
    const filename = (input.filename || "").trim();
    const extension = jobResumeExtension(filename);
    const contentType = jobResumeMimeType(filename);
    if (!extension || !contentType) {
      throw httpError("Resumes must be a PDF, DOC, or DOCX file");
    }
    if (input.sizeBytes != null && input.sizeBytes > JOB_RESUME_MAX_BYTES) {
      throw httpError("Resumes must be smaller than 5.0 MB");
    }

    const path = `${userId}/${randomUUID()}.${extension}`;
    const { data, error } =
      await this.resumeBucket().createSignedUploadUrl(path);
    if (error || !data?.signedUrl || !data?.token) {
      logger.error("Failed to create resume upload URL", { error, userId });
      throw httpError(
        error?.message || "Could not start the resume upload",
        500,
      );
    }
    return {
      bucket: RESUME_BUCKET,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      contentType,
    };
  }

  /**
   * Point the applicant's profile at a freshly uploaded object, after confirming
   * it exists so a failed upload cannot leave a dangling reference.
   */
  async attachResumeToProfile(
    userId: string,
    input: { path: string; filename: string; sizeBytes?: number | null },
  ) {
    this.assertOwnedResumePath(userId, input.path);
    const objectName = input.path.slice(userId.length + 1);
    const { data: found, error: listError } = await this.resumeBucket().list(
      userId,
      {
        limit: 100,
        search: objectName,
      },
    );
    if (listError) throw listError;
    const uploaded = (found || []).find(
      (entry: any) => entry.name === objectName,
    );
    if (!uploaded) {
      throw httpError("That upload did not complete. Please try again.");
    }

    const previous = await this.getApplicantProfile(userId);
    const { data, error } = await this.client()
      .from("job_applicant_profiles")
      .upsert(
        {
          user_id: userId,
          resume_path: input.path,
          resume_filename: (input.filename || objectName).trim().slice(0, 200),
          resume_size_bytes: input.sizeBytes ?? uploaded.metadata?.size ?? null,
          resume_uploaded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();
    if (error) throw error;

    // Old files stay referenced by past applications, so only drop a replaced
    // resume when nothing else points at it.
    if (previous?.resumePath && previous.resumePath !== input.path) {
      await this.deleteResumeIfUnreferenced(previous.resumePath);
    }
    return mapApplicantProfile(data);
  }

  private async deleteResumeIfUnreferenced(path: string) {
    const { count, error } = await this.client()
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("resume_path", path);
    if (error) {
      logger.warn("Could not check resume references; keeping file", { error });
      return;
    }
    if ((count ?? 0) > 0) return;
    const { error: removeError } = await this.resumeBucket().remove([path]);
    if (removeError) {
      logger.warn("Failed to remove replaced resume", { error: removeError });
    }
  }

  /** Signed download URL for the applicant themselves or an authorized employer. */
  async getApplicationResumeUrl(applicationId: string, viewerId: string) {
    const { data: app, error } = await this.client()
      .from("job_applications")
      .select(
        "id, applicant_id, resume_path, resume_filename, resume_url, posting:job_postings(id, poster_user_id, company_id)",
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!app) throw httpError("Application not found", 404);

    const posting = Array.isArray(app.posting) ? app.posting[0] : app.posting;
    const allowed =
      app.applicant_id === viewerId ||
      posting?.poster_user_id === viewerId ||
      (posting?.company_id &&
        (await this.getCompanyMembership(posting.company_id, viewerId)));
    if (!allowed) throw httpError("Not allowed", 403);

    if (!app.resume_path) {
      // Legacy applications carry a pasted link instead of an uploaded file.
      if (app.resume_url) {
        return { url: app.resume_url, filename: null, external: true };
      }
      throw httpError("This application has no resume", 404);
    }

    const url = await this.supabase.createSignedStorageUrl(
      RESUME_BUCKET,
      app.resume_path,
      RESUME_SIGNED_URL_TTL_SECONDS,
    );
    return { url, filename: app.resume_filename || null, external: false };
  }

  // ─── Companies (Phase 2) ─────────────────────────────────────────────────

  async createCompany(
    userId: string,
    input: {
      legalName: string;
      displayName: string;
      website?: string;
      industry?: string;
      verificationDomain?: string;
    },
  ) {
    const { data, error } = await this.client()
      .from("job_companies")
      .insert({
        legal_name: input.legalName.trim().slice(0, 200),
        display_name: input.displayName.trim().slice(0, 200),
        website: input.website?.trim() || null,
        industry: input.industry?.trim() || null,
        verification_domain:
          input.verificationDomain?.trim()?.toLowerCase() || null,
        verification_status: "pending",
        created_by: userId,
        country_code: JOBS_DEFAULT_COUNTRY,
      })
      .select("*")
      .single();
    if (error) throw error;

    await this.client().from("job_company_members").insert({
      company_id: data.id,
      user_id: userId,
      role: "owner",
    });

    return mapCompany(data);
  }

  async getCompany(companyId: string) {
    const { data, error } = await this.client()
      .from("job_companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();
    if (error) throw error;
    return mapCompany(data);
  }

  async getCompanyMembership(companyId: string, userId: string) {
    const { data, error } = await this.client()
      .from("job_company_members")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listMyCompanies(userId: string) {
    const { data, error } = await this.client()
      .from("job_company_members")
      .select("role, company:job_companies(*)")
      .eq("user_id", userId);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      role: row.role,
      company: mapCompany(
        Array.isArray(row.company) ? row.company[0] : row.company,
      ),
    }));
  }

  async setCompanyVerification(
    companyId: string,
    status: "verified" | "rejected" | "pending" | "unverified",
    note?: string,
  ) {
    const { data, error } = await this.client()
      .from("job_companies")
      .update({
        verification_status: status,
        verification_note: note || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId)
      .select("*")
      .single();
    if (error) throw error;
    return mapCompany(data);
  }

  async adminListPostings(page = 1, limit = 20, status?: string) {
    const from = (Math.max(1, page) - 1) * Math.min(100, limit);
    const to = from + Math.min(100, limit) - 1;
    let query = this.client()
      .from("job_postings")
      .select(
        "id, title, employment_type, status, created_at, views_count, poster_user_id, company_id, is_sponsored",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], pagination: { page, limit, total: count ?? 0 } };
  }

  async adminListCompanies(page = 1, limit = 20, status?: string) {
    const from = (Math.max(1, page) - 1) * Math.min(100, limit);
    const to = from + Math.min(100, limit) - 1;
    let query = this.client()
      .from("job_companies")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (status) query = query.eq("verification_status", status);
    const { data, error, count } = await query;
    if (error) throw error;
    return {
      data: (data || []).map(mapCompany),
      pagination: { page, limit, total: count ?? 0 },
    };
  }

  async adminListReports(status = "pending") {
    const { data, error } = await this.client()
      .from("job_reports")
      .select("*, posting:job_postings(id, title, status)")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  async resolveReport(reportId: string, status: "resolved" | "dismissed") {
    const { error } = await this.client()
      .from("job_reports")
      .update({ status })
      .eq("id", reportId);
    if (error) throw error;
  }

  async schoolApprovePosting(postingId: string, approve: boolean) {
    const status = approve ? "active" : "closed";
    const { error } = await this.client()
      .from("job_postings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", postingId)
      .eq("status", "pending_school_approval");
    if (error) throw error;
    return this.getPosting(postingId);
  }

  private async fireAtsWebhook(posting: any, application: any) {
    try {
      if (!posting.atsWebhookUrl) return;
      await fetch(posting.atsWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "application.created",
          provider: posting.atsProvider || "custom",
          externalJobId: posting.atsExternalId,
          postingId: posting.id,
          application,
        }),
      });
    } catch (err) {
      logger.warn("ATS webhook failed", { error: err, postingId: posting.id });
    }
  }
}

let jobsBoardService: JobsBoardService | null = null;

export function getJobsBoardService(
  supabase: SupabaseService,
): JobsBoardService {
  if (!jobsBoardService) jobsBoardService = new JobsBoardService(supabase);
  return jobsBoardService;
}
