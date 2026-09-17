/**
 * Moderation service (Phase 1 · E — docs/phase1-rights-moderation-contract.md §3):
 * generic content reports, the admin report actions (dismiss / under_review /
 * warn / remove_content / strike), strikes + automatic suspension, listing
 * takedown ↔ appeal, the rights attestation + content filter that guard
 * listing writes, and the owner/admin-only shaping of rights fields.
 *
 * Storage: content_reports + moderation_strikes + the rights/takedown/appeal
 * columns on marketplace_listings (migration 20260822140000). Suspension is
 * profiles.settings.suspended_until (a privileged settings key — see
 * utils/sanitizeSettings.ts), read by adminAudit.getUserBlockState.
 *
 * Every method that ends a moderation decision writes admin_audit_log via
 * logAdminAction; every seller/owner-facing consequence notifies with
 * force:true (createNotification otherwise honours mute settings).
 */
import type { DataLayer } from './data';

/**
 * FLIPPED (monolith lane M3, Phase B): the client, plus the one notification
 * it sends when a report is actioned.
 */
export type ModerationHost = Pick<DataLayer, 'getClient'> & {
  notifications: Pick<DataLayer['notifications'], 'createNotification'>;
};
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import { invalidateBanCache, logAdminAction, type AdminAuditAction } from './adminAudit';
import {
  APPEAL_NOTE_MAX_LENGTH,
  ATTESTATION_REQUIRED_MESSAGE,
  CONTENT_BLOCK_MESSAGE,
  CONTENT_REPORT_TARGET_LABELS,
  REMOVE_CONTENT_SUPPORTED_TARGETS,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASON_LABELS,
  RIGHTS_ATTESTATION_VERSION,
  STRIKE_SUSPENSION_DAYS,
  STRIKE_SUSPENSION_THRESHOLD,
  STRIKE_TTL_DAYS,
  contentFilterText,
  findContentMatches,
  isAcademicListing,
  isAdminReportAction,
  isContentReportTargetType,
  isListingAppealDecision,
  isReasonAllowedForTarget,
  isStrikeSeverity,
  isSuspensionActive,
  listingAppealRefusal,
  normalizeSourcesCited,
  type AdminReportAction,
  type ListingAppealDecision,
  type StrikeSeverity,
} from '@lantern/shared/moderation';
import type {
  ContentReport,
  ContentReportReason,
  ContentReportStatus,
  ContentReportTargetSummary,
  ContentReportTargetType,
  ModerationFlag,
  ModerationState,
  ModerationStrike,
} from '@lantern/shared/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/** PostgREST/Postgres "relation does not exist" — i.e. migration not applied yet. */
export function isMissingRelationError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /does not exist|could not find the table/i.test(error.message || '')
  );
}

/** 4xx error whose message is safe to return verbatim (clientErrorMessage honours PublicError). */
export function moderationError(message: string, statusCode: 400 | 403 | 404 | 409 | 503): Error {
  return Object.assign(new PublicError(message), { statusCode });
}

/** Listing columns only the owner and platform admins may see. */
export const LISTING_MODERATION_FIELDS = [
  'rights_status',
  'rights_attested_at',
  'rights_attestation_version',
  'moderation_flags',
  'takedown_reason',
  'takedown_at',
  'takedown_by',
  'appeal_status',
  'appeal_note',
  'appealed_at',
  'appeal_decided_at',
  'appeal_decided_by',
] as const;

/** Copy of a listing without the owner/admin-only moderation columns. */
export function stripListingModerationFields<T extends Record<string, unknown>>(listing: T): T {
  if (!listing || typeof listing !== 'object') return listing;
  const copy: Record<string, unknown> = { ...listing };
  for (const key of LISTING_MODERATION_FIELDS) delete copy[key];
  return copy as T;
}

/**
 * Rights attestation gate for listing writes. Academic listings (every
 * question_bank + the academic content categories) need `attestation === true`;
 * anything else is free to attest but not required to. Throws 400 otherwise.
 */
export function assertListingAttestation(input: {
  listingKind?: string | null;
  category?: string | null;
  attestation?: unknown;
}): boolean {
  const attested = input.attestation === true;
  if (!attested && isAcademicListing({ listingKind: input.listingKind, category: input.category })) {
    throw moderationError(ATTESTATION_REQUIRED_MESSAGE, 400);
  }
  return attested;
}

/** Columns written on marketplace_listings for the attestation state. */
export function listingRightsFields(attested: boolean, now: Date = new Date()) {
  return attested
    ? {
        rights_status: 'attested' as const,
        rights_attested_at: now.toISOString(),
        rights_attestation_version: RIGHTS_ATTESTATION_VERSION,
      }
    : {
        rights_status: 'unattested' as const,
        rights_attested_at: null,
        rights_attestation_version: null,
      };
}

/** Publish-time provenance for question banks (attestation + AI + sources). */
export function normalizePublishProvenance(input: {
  attestation?: unknown;
  aiAssisted?: unknown;
  sourcesCited?: unknown;
}): { rights_attested_at: string; rights_attestation_version: string; ai_assisted: boolean; sources_cited: string[] } {
  if (input.attestation !== true) throw moderationError(ATTESTATION_REQUIRED_MESSAGE, 400);
  const sources = normalizeSourcesCited(input.sourcesCited);
  if (!sources.ok) throw moderationError(sources.error, 400);
  return {
    rights_attested_at: new Date().toISOString(),
    rights_attestation_version: RIGHTS_ATTESTATION_VERSION,
    ai_assisted: input.aiAssisted === true,
    sources_cited: sources.value,
  };
}

/**
 * Content filter for listing writes. Block tier → 400 with the shared message;
 * flag tier → returned so the caller can store it + open an auto report.
 */
export function runListingContentFilter(input: {
  title?: unknown;
  description?: unknown;
  now?: Date;
}): ModerationFlag[] {
  const text = contentFilterText(
    typeof input.title === 'string' ? input.title : '',
    typeof input.description === 'string' ? input.description : '',
  );
  const matches = findContentMatches(text);
  if (matches.some((m) => m.severity === 'block')) {
    throw moderationError(CONTENT_BLOCK_MESSAGE, 400);
  }
  const at = (input.now ?? new Date()).toISOString();
  return matches
    .filter((m) => m.severity === 'flag')
    .map((m) => ({ pattern: m.pattern, reason: m.reason, at, field: 'title+description' }));
}

type ProfileName = { id: string; name?: string | null; username?: string | null };

export interface CreateReportInput {
  reporterId: string;
  targetType: unknown;
  targetId: unknown;
  reason: unknown;
  details?: unknown;
  /** Auto-flags open straight under review. */
  status?: ContentReportStatus;
}

export interface ReportActionInput {
  action: unknown;
  note?: unknown;
  severity?: unknown;
}

export class ModerationService {
  constructor(private host: ModerationHost) {}

  private get db() {
    return this.host.getClient();
  }

  // ─── Targets ─────────────────────────────────────────────────────────────

  private async profileNames(ids: string[]): Promise<Map<string, ProfileName>> {
    const unique = Array.from(new Set(ids.filter(isUuid)));
    const map = new Map<string, ProfileName>();
    if (unique.length === 0) return map;
    const { data } = await this.db.from('profiles').select('id, name, username').in('id', unique);
    for (const row of (data || []) as ProfileName[]) map.set(row.id, row);
    return map;
  }

  /**
   * Existence + ownership + a one-line summary for a reported thing. Missing
   * rows come back with exists:false (never throws for "not found").
   */
  async resolveTarget(targetType: ContentReportTargetType, targetId: string): Promise<ContentReportTargetSummary> {
    const base: ContentReportTargetSummary = { type: targetType, id: targetId, exists: false };
    if (!isUuid(targetId)) return base;
    const one = async (table: string, columns: string) => {
      const { data, error } = await this.db.from(table).select(columns).eq('id', targetId).maybeSingle();
      if (error) throw error;
      return data as Record<string, any> | null;
    };
    switch (targetType) {
      case 'listing':
      case 'question_bank': {
        const row = await one('marketplace_listings', 'id, title, status, user_id, listing_kind');
        if (!row) return base;
        return { ...base, exists: true, title: row.title, status: row.status, ownerId: row.user_id };
      }
      case 'note': {
        const row = await one('notes', 'id, title, user_id, removed_by_admin_at');
        if (!row) return base;
        return {
          ...base,
          exists: true,
          title: row.title,
          status: row.removed_by_admin_at ? 'removed' : 'active',
          ownerId: row.user_id,
        };
      }
      case 'deck': {
        const row = await one('decks', 'id, name, user_id, removed_by_admin_at');
        if (!row) return base;
        return {
          ...base,
          exists: true,
          title: row.name,
          status: row.removed_by_admin_at ? 'removed' : 'active',
          ownerId: row.user_id,
        };
      }
      case 'user': {
        const row = await one('profiles', 'id, name, username');
        if (!row) return base;
        return { ...base, exists: true, title: row.username || row.name, ownerId: row.id, ownerName: row.name };
      }
      case 'group': {
        const row = await one('groups', 'id, name, admin_ids, is_archived');
        if (!row) return base;
        const admins = Array.isArray(row.admin_ids) ? row.admin_ids : [];
        return {
          ...base,
          exists: true,
          title: row.name,
          status: row.is_archived ? 'archived' : 'active',
          ownerId: typeof admins[0] === 'string' ? admins[0] : null,
        };
      }
      case 'message': {
        const row = await one('messages', 'id, text, sender_id, group_id');
        if (!row) return base;
        return { ...base, exists: true, title: snippet(row.text), ownerId: row.sender_id };
      }
      case 'dm_message': {
        const row = await one('dm_messages', 'id, text, sender_id, thread_id');
        if (!row) return base;
        return { ...base, exists: true, title: snippet(row.text), ownerId: row.sender_id };
      }
      case 'job_posting': {
        const row = await one('job_postings', 'id, title, status, poster_user_id');
        if (!row) return base;
        return { ...base, exists: true, title: row.title, status: row.status, ownerId: row.poster_user_id };
      }
      // A board post is an ordinary `messages` row; the target type exists so
      // the queue can tell a community board apart from a group chat without
      // a second reports table.
      case 'community_post': {
        const row = await one('messages', 'id, text, subject, sender_id, group_id, removed_at');
        if (!row) return base;
        return {
          ...base,
          exists: true,
          title: row.subject || snippet(row.text),
          status: row.removed_at ? 'removed' : 'active',
          ownerId: row.sender_id,
        };
      }
      // The reported MEMBER is a profile; which community they were reported
      // in rides in the report's `details`, because content_reports.target_id
      // is one uuid and the person is the thing being acted on.
      case 'community_member': {
        const row = await one('profiles', 'id, name, username');
        if (!row) return base;
        return { ...base, exists: true, title: row.username || row.name, ownerId: row.id, ownerName: row.name };
      }
      default:
        return base;
    }
  }

  // ─── Reports ─────────────────────────────────────────────────────────────

  /**
   * File a report. Validates target type + reason (per target), checks the
   * target exists, refuses self-reports of a user profile, and maps the
   * UNIQUE(reporter, target) violation to 409.
   */
  async createReport(input: CreateReportInput): Promise<{ id: string; status: ContentReportStatus }> {
    if (!isContentReportTargetType(input.targetType)) {
      throw moderationError('Unknown report target type', 400);
    }
    const targetType = input.targetType;
    if (!isUuid(input.targetId)) throw moderationError('targetId must be a valid id', 400);
    const targetId = input.targetId;
    if (!isReasonAllowedForTarget(targetType, input.reason)) {
      throw moderationError(`That reason is not available for a ${CONTENT_REPORT_TARGET_LABELS[targetType].toLowerCase()}`, 400);
    }
    const reason = input.reason;
    let details: string | null = null;
    if (input.details !== undefined && input.details !== null) {
      if (typeof input.details !== 'string') throw moderationError('details must be text', 400);
      details = input.details.trim().slice(0, REPORT_DETAILS_MAX_LENGTH) || null;
    }

    const target = await this.resolveTarget(targetType, targetId);
    if (!target.exists) {
      throw moderationError(`${CONTENT_REPORT_TARGET_LABELS[targetType]} not found`, 404);
    }
    // Self-reports cost a moderator a queue item and achieve nothing. Both
    // person-shaped targets are covered: `community_member` is a profile too.
    if (
      (targetType === 'user' || targetType === 'community_member' || targetType === 'community_post') &&
      target.ownerId === input.reporterId
    ) {
      throw moderationError('You cannot report yourself', 400);
    }

    const { data, error } = await this.db
      .from('content_reports')
      .insert({
        reporter_id: input.reporterId,
        target_type: targetType,
        target_id: targetId,
        reason,
        details,
        status: input.status ?? 'pending',
      })
      .select('id, status')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw moderationError('You have already reported this. Our team will review it.', 409);
      }
      if (isMissingRelationError(error)) {
        logger.warn('content_reports missing — apply migration 20260822140000', { error: error.message });
        throw moderationError('Reporting is temporarily unavailable. Please try again later.', 503);
      }
      throw error;
    }
    return { id: data.id as string, status: data.status as ContentReportStatus };
  }

  async listReports(params: {
    status?: string;
    targetType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: ContentReport[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const offset = (page - 1) * limit;
    const rawStatus = params.status || 'pending';
    const status = rawStatus === 'open' ? 'pending' : rawStatus;
    if (!['pending', 'under_review', 'resolved', 'dismissed', 'all'].includes(status)) {
      throw moderationError('Unknown report status', 400);
    }
    if (params.targetType && !isContentReportTargetType(params.targetType)) {
      throw moderationError('Unknown report target type', 400);
    }

    let query = this.db
      .from('content_reports')
      .select(
        'id, reporter_id, target_type, target_id, reason, details, status, admin_note, resolved_by, resolved_at, legacy_source, legacy_id, created_at, reporter:profiles!content_reports_reporter_id_fkey(id, name, username)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: status === 'resolved' || status === 'dismissed' ? false : true })
      .range(offset, offset + limit - 1);
    if (status !== 'all') query = query.eq('status', status);
    if (params.targetType) query = query.eq('target_type', params.targetType);

    const { data, error, count } = await query;
    if (error) {
      if (isMissingRelationError(error)) {
        return { data: [], pagination: { page, limit, total: 0, pages: 0 } };
      }
      throw error;
    }

    const rows = (data || []) as unknown as Array<Record<string, any>>;
    const summaries = await this.summariseTargets(
      rows.map((r) => ({ type: r.target_type as ContentReportTargetType, id: String(r.target_id) })),
    );
    const shaped: ContentReport[] = rows.map((r) => {
      const target = summaries.get(`${r.target_type}:${r.target_id}`) ?? {
        type: r.target_type,
        id: r.target_id,
        exists: false,
      };
      const listingLegacy =
        r.target_type === 'listing' || r.target_type === 'question_bank'
          ? target.exists
            ? { id: target.id, title: target.title || '', status: target.status || '', user_id: target.ownerId || undefined }
            : null
          : undefined;
      return {
        ...(r as ContentReport),
        reporter: (r.reporter as ContentReport['reporter']) ?? null,
        target,
        ...(listingLegacy !== undefined
          ? { listing: listingLegacy, listing_id: r.target_id as string }
          : {}),
      };
    });

    return {
      data: shaped,
      pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  /** Batch target summaries keyed `${type}:${id}` (one query per table). */
  private async summariseTargets(
    targets: Array<{ type: ContentReportTargetType; id: string }>,
  ): Promise<Map<string, ContentReportTargetSummary>> {
    const out = new Map<string, ContentReportTargetSummary>();
    const byType = new Map<ContentReportTargetType, Set<string>>();
    for (const t of targets) {
      if (!isUuid(t.id)) continue;
      if (!byType.has(t.type)) byType.set(t.type, new Set());
      byType.get(t.type)!.add(t.id);
    }
    const ownerIds: string[] = [];
    const put = (s: ContentReportTargetSummary) => {
      out.set(`${s.type}:${s.id}`, s);
      if (s.ownerId) ownerIds.push(s.ownerId);
    };
    const fetchMany = async (table: string, columns: string, ids: Set<string>) => {
      const { data, error } = await this.db.from(table).select(columns).in('id', Array.from(ids));
      if (error) {
        logger.warn('moderation target summary failed', { table, error: error.message });
        return [] as Array<Record<string, any>>;
      }
      return (data || []) as unknown as Array<Record<string, any>>;
    };

    for (const [type, ids] of byType) {
      switch (type) {
        case 'listing':
        case 'question_bank':
          for (const row of await fetchMany('marketplace_listings', 'id, title, status, user_id', ids)) {
            put({ type, id: row.id, exists: true, title: row.title, status: row.status, ownerId: row.user_id });
          }
          break;
        case 'note':
          for (const row of await fetchMany('notes', 'id, title, user_id, removed_by_admin_at', ids)) {
            put({
              type,
              id: row.id,
              exists: true,
              title: row.title,
              status: row.removed_by_admin_at ? 'removed' : 'active',
              ownerId: row.user_id,
            });
          }
          break;
        case 'deck':
          for (const row of await fetchMany('decks', 'id, name, user_id, removed_by_admin_at', ids)) {
            put({
              type,
              id: row.id,
              exists: true,
              title: row.name,
              status: row.removed_by_admin_at ? 'removed' : 'active',
              ownerId: row.user_id,
            });
          }
          break;
        case 'user':
          for (const row of await fetchMany('profiles', 'id, name, username', ids)) {
            put({ type, id: row.id, exists: true, title: row.username || row.name, ownerId: row.id, ownerName: row.name });
          }
          break;
        case 'group':
          for (const row of await fetchMany('groups', 'id, name, admin_ids, is_archived', ids)) {
            const admins = Array.isArray(row.admin_ids) ? row.admin_ids : [];
            put({
              type,
              id: row.id,
              exists: true,
              title: row.name,
              status: row.is_archived ? 'archived' : 'active',
              ownerId: typeof admins[0] === 'string' ? admins[0] : null,
            });
          }
          break;
        case 'message':
          for (const row of await fetchMany('messages', 'id, text, sender_id', ids)) {
            put({ type, id: row.id, exists: true, title: snippet(row.text), ownerId: row.sender_id });
          }
          break;
        case 'dm_message':
          for (const row of await fetchMany('dm_messages', 'id, text, sender_id', ids)) {
            put({ type, id: row.id, exists: true, title: snippet(row.text), ownerId: row.sender_id });
          }
          break;
        case 'job_posting':
          for (const row of await fetchMany('job_postings', 'id, title, status, poster_user_id', ids)) {
            put({ type, id: row.id, exists: true, title: row.title, status: row.status, ownerId: row.poster_user_id });
          }
          break;
        case 'community_post':
          for (const row of await fetchMany('messages', 'id, text, subject, sender_id, removed_at', ids)) {
            put({
              type,
              id: row.id,
              exists: true,
              title: row.subject || snippet(row.text),
              status: row.removed_at ? 'removed' : 'active',
              ownerId: row.sender_id,
            });
          }
          break;
        case 'community_member':
          for (const row of await fetchMany('profiles', 'id, name, username', ids)) {
            put({ type, id: row.id, exists: true, title: row.username || row.name, ownerId: row.id, ownerName: row.name });
          }
          break;
      }
    }

    const names = await this.profileNames(ownerIds);
    for (const summary of out.values()) {
      if (summary.ownerId && !summary.ownerName) {
        const p = names.get(summary.ownerId);
        if (p) summary.ownerName = p.name || p.username || null;
      }
    }
    return out;
  }

  /**
   * Admin decision on a report. Returns what happened so the route can echo
   * it; throws 400 for remove_content on targets that need the dedicated tool
   * (after parking the report under_review).
   */
  async applyReportAction(
    reportId: string,
    input: ReportActionInput,
    actorId: string,
  ): Promise<{
    action: AdminReportAction;
    status: ContentReportStatus;
    strike?: ModerationStrike | null;
    suspendedUntil?: string | null;
  }> {
    if (!isAdminReportAction(input.action)) throw moderationError('Invalid action', 400);
    const action = input.action;
    const note =
      typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 1000) : null;
    let severity: StrikeSeverity = 1;
    if (input.severity !== undefined && input.severity !== null) {
      const parsed = typeof input.severity === 'string' ? Number(input.severity) : input.severity;
      if (!isStrikeSeverity(parsed)) throw moderationError('severity must be 1, 2 or 3', 400);
      severity = parsed;
    }

    const { data: report, error: fetchErr } = await this.db
      .from('content_reports')
      .select('id, reporter_id, target_type, target_id, reason, details, status')
      .eq('id', reportId)
      .maybeSingle();
    if (fetchErr) {
      if (isMissingRelationError(fetchErr)) throw moderationError('Report not found', 404);
      throw fetchErr;
    }
    if (!report) throw moderationError('Report not found', 404);

    const targetType = report.target_type as ContentReportTargetType;
    const targetId = String(report.target_id);
    const reasonLabel = REPORT_REASON_LABELS[report.reason as ContentReportReason] || String(report.reason);
    const nowIso = new Date().toISOString();
    const target = await this.resolveTarget(targetType, targetId);
    const targetLabel = CONTENT_REPORT_TARGET_LABELS[targetType].toLowerCase();
    const targetTitle = target.title ? `"${target.title}"` : `your ${targetLabel}`;

    const setStatus = async (status: ContentReportStatus, resolved: boolean) => {
      const { error } = await this.db
        .from('content_reports')
        .update({
          status,
          admin_note: note,
          ...(resolved ? { resolved_by: actorId, resolved_at: nowIso } : {}),
        })
        .eq('id', reportId);
      if (error) throw error;
    };
    const audit = (auditAction: AdminAuditAction, metadata: Record<string, unknown> = {}) =>
      logAdminAction(this.host, {
        actorId,
        action: auditAction,
        targetType: 'report',
        targetId: reportId,
        metadata: { target_type: targetType, target_id: targetId, ...metadata },
        reason: note ?? undefined,
      });

    switch (action) {
      case 'dismiss': {
        await setStatus('dismissed', true);
        await audit('report_dismiss');
        return { action, status: 'dismissed' };
      }
      case 'under_review': {
        await setStatus('under_review', false);
        await audit('report_under_review');
        return { action, status: 'under_review' };
      }
      case 'warn': {
        if (!target.ownerId) throw moderationError('This report has no owner to warn', 400);
        await this.notify(target.ownerId, {
          message: `Your ${targetLabel} ${targetTitle} received a warning from Lantern moderation (${reasonLabel}).${note ? ` Note: ${note}` : ''} Repeated violations lead to strikes and suspension.`,
          link: targetLink(targetType, targetId),
          data: { reportId, targetType, targetId, kind: 'moderation_warning' },
        });
        await setStatus('resolved', true);
        await audit('report_warn', { owner_id: target.ownerId });
        return { action, status: 'resolved' };
      }
      case 'remove_content': {
        if (!REMOVE_CONTENT_SUPPORTED_TARGETS.includes(targetType)) {
          await setStatus('under_review', false);
          await audit('report_under_review', { refused: 'remove_content_unsupported' });
          throw moderationError(
            `${CONTENT_REPORT_TARGET_LABELS[targetType]}s are not removed from the report queue — use the dedicated admin tool. The report stays under review.`,
            400,
          );
        }
        if (!target.exists) {
          await setStatus('resolved', true);
          await audit('report_remove_content', { already_gone: true });
          return { action, status: 'resolved' };
        }
        await this.removeTargetContent(targetType, targetId, target, {
          reason: note || reasonLabel,
          actorId,
          reportId,
        });
        await setStatus('resolved', true);
        await audit('report_remove_content', { owner_id: target.ownerId });
        return { action, status: 'resolved' };
      }
      case 'strike': {
        if (!target.ownerId) throw moderationError('This report has no owner to strike', 400);
        const result = await this.addStrike(target.ownerId, {
          reason: note || `${reasonLabel} — ${CONTENT_REPORT_TARGET_LABELS[targetType]}`,
          severity,
          reportId,
          createdBy: actorId,
        });
        await setStatus('resolved', true);
        await audit('report_strike', {
          owner_id: target.ownerId,
          strike_id: result.strike.id,
          active_strikes: result.activeStrikes,
          suspended_until: result.suspendedUntil,
        });
        return { action, status: 'resolved', strike: result.strike, suspendedUntil: result.suspendedUntil };
      }
      default:
        throw moderationError('Invalid action', 400);
    }
  }

  /** remove_content for the v1-supported targets; notifies the owner force:true. */
  private async removeTargetContent(
    targetType: ContentReportTargetType,
    targetId: string,
    target: ContentReportTargetSummary,
    ctx: { reason: string; actorId: string; reportId: string },
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    switch (targetType) {
      case 'listing':
      case 'question_bank': {
        await this.takedownListing(targetId, { reason: ctx.reason, actorId: ctx.actorId, reportId: ctx.reportId });
        return;
      }
      case 'note': {
        const { error } = await this.db.from('notes').update({ removed_by_admin_at: nowIso }).eq('id', targetId);
        if (error) throw error;
        break;
      }
      case 'deck': {
        const { error } = await this.db.from('decks').update({ removed_by_admin_at: nowIso }).eq('id', targetId);
        if (error) throw error;
        break;
      }
      case 'group': {
        const { error } = await this.db.from('groups').update({ is_archived: true }).eq('id', targetId);
        if (error) throw error;
        break;
      }
      case 'community_post': {
        // The SAME soft removal a community moderator applies, so the board
        // renders one tombstone whichever path removed the post. `pinned_at`
        // is cleared too: a tombstone at the top of a board is worse than no
        // pin at all. `removed_reason` may not exist yet (20260908120000 is
        // hand-applied), so it is retried without.
        const patch = { removed_at: nowIso, removed_by: ctx.actorId, pinned_at: null, pinned_by: null };
        let { error } = await this.db
          .from('messages')
          .update({ ...patch, removed_reason: ctx.reason.slice(0, 300) })
          .eq('id', targetId);
        if (error && (error.code === '42703' || error.code === 'PGRST204')) {
          ({ error } = await this.db.from('messages').update(patch).eq('id', targetId));
        }
        if (error) throw error;
        break;
      }
      default:
        throw moderationError('Use the dedicated admin tool for this content type', 400);
    }
    if (target.ownerId) {
      const label = CONTENT_REPORT_TARGET_LABELS[targetType].toLowerCase();
      await this.notify(target.ownerId, {
        message: `Your ${label} ${target.title ? `"${target.title}"` : ''} was removed by Lantern moderation. Reason: ${ctx.reason}. Contact support@lanternstudy.com if you believe this is a mistake.`,
        link: targetLink(targetType, targetId),
        data: { reportId: ctx.reportId, targetType, targetId, kind: 'moderation_takedown' },
      });
    }
  }

  // ─── Strikes + suspension ────────────────────────────────────────────────

  async countActiveStrikes(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from('moderation_strikes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString());
    if (error) {
      if (isMissingRelationError(error)) return 0;
      throw error;
    }
    return count ?? 0;
  }

  async listStrikes(userId: string): Promise<ModerationStrike[]> {
    const { data, error } = await this.db
      .from('moderation_strikes')
      .select('id, user_id, report_id, severity, reason, created_by, created_at, expires_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return (data || []) as ModerationStrike[];
  }

  /**
   * Insert a strike; when the user's active strikes reach the threshold,
   * suspend for STRIKE_SUSPENSION_DAYS (extending an existing suspension only
   * if the new end is later) and notify force:true.
   */
  async addStrike(
    userId: string,
    input: { reason: unknown; severity?: unknown; reportId?: string | null; createdBy: string },
  ): Promise<{ strike: ModerationStrike; activeStrikes: number; suspendedUntil: string | null }> {
    if (!isUuid(userId)) throw moderationError('userId must be a valid id', 400);
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
    if (!reason) throw moderationError('reason is required', 400);
    let severity: StrikeSeverity = 1;
    if (input.severity !== undefined && input.severity !== null) {
      const parsed = typeof input.severity === 'string' ? Number(input.severity) : input.severity;
      if (!isStrikeSeverity(parsed)) throw moderationError('severity must be 1, 2 or 3', 400);
      severity = parsed;
    }
    const reportId = input.reportId && isUuid(input.reportId) ? input.reportId : null;

    const now = new Date();
    const { data: strike, error } = await this.db
      .from('moderation_strikes')
      .insert({
        user_id: userId,
        report_id: reportId,
        severity,
        reason,
        created_by: input.createdBy,
        expires_at: new Date(now.getTime() + STRIKE_TTL_DAYS * 86_400_000).toISOString(),
      })
      .select('id, user_id, report_id, severity, reason, created_by, created_at, expires_at')
      .single();
    if (error) {
      if (error.code === '23503') throw moderationError('User not found', 404);
      if (isMissingRelationError(error)) {
        throw moderationError('Strikes are unavailable until migration 20260822140000 is applied', 503);
      }
      throw error;
    }

    const activeStrikes = await this.countActiveStrikes(userId);
    let suspendedUntil: string | null = null;
    const current = await this.getSuspendedUntil(userId);
    if (activeStrikes >= STRIKE_SUSPENSION_THRESHOLD) {
      const proposed = new Date(now.getTime() + STRIKE_SUSPENSION_DAYS * 86_400_000).toISOString();
      if (isSuspensionActive(current, now) && current! >= proposed) {
        suspendedUntil = current!;
      } else {
        await this.setSuspendedUntil(userId, proposed);
        suspendedUntil = proposed;
        await logAdminAction(this.host, {
          actorId: input.createdBy,
          action: 'user_suspend',
          targetType: 'user',
          targetId: userId,
          metadata: { until: proposed, active_strikes: activeStrikes, trigger: 'strike_threshold', strike_id: strike.id },
          reason,
        });
      }
    } else if (isSuspensionActive(current, now)) {
      suspendedUntil = current!;
    }

    await this.notify(userId, {
      message:
        activeStrikes >= STRIKE_SUSPENSION_THRESHOLD
          ? `You received a moderation strike (${reason}). You now have ${activeStrikes} active strikes, so your account is suspended until ${formatDate(suspendedUntil)}. Contact support@lanternstudy.com to appeal.`
          : `You received a moderation strike (${reason}). Active strikes: ${activeStrikes} of ${STRIKE_SUSPENSION_THRESHOLD} — at ${STRIKE_SUSPENSION_THRESHOLD} your account is suspended for ${STRIKE_SUSPENSION_DAYS} days. Strikes expire after ${STRIKE_TTL_DAYS} days.`,
      link: 'settings:account',
      data: { strikeId: strike.id, activeStrikes, suspendedUntil, kind: 'moderation_strike' },
    });

    return { strike: strike as ModerationStrike, activeStrikes, suspendedUntil };
  }

  async getSuspendedUntil(userId: string): Promise<string | null> {
    const { data, error } = await this.db.from('profiles').select('settings').eq('id', userId).maybeSingle();
    if (error || !data) return null;
    const settings = (data.settings || {}) as Record<string, unknown>;
    const until = settings.suspended_until;
    return typeof until === 'string' && until ? until : null;
  }

  /**
   * Write settings.suspended_until (null clears). Merges into the existing
   * settings JSONB without touching other keys; service role, so the
   * privileged-key guard in sanitizeSettings does not apply.
   */
  async setSuspendedUntil(userId: string, until: string | null): Promise<void> {
    const { data, error } = await this.db.from('profiles').select('settings').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw moderationError('User not found', 404);
    const settings = { ...((data.settings || {}) as Record<string, unknown>) };
    if (until) settings.suspended_until = until;
    else delete settings.suspended_until;
    const { error: updErr } = await this.db.from('profiles').update({ settings }).eq('id', userId);
    if (updErr) throw updErr;
    await invalidateBanCache(userId);
  }

  async getModerationState(userId: string): Promise<ModerationState> {
    const [activeStrikes, until] = await Promise.all([this.countActiveStrikes(userId), this.getSuspendedUntil(userId)]);
    return { activeStrikes, suspendedUntil: isSuspensionActive(until) ? until : null };
  }

  // ─── Listing takedown ↔ appeal ───────────────────────────────────────────

  /**
   * Moderation takedown: status removed_by_admin + rights_status 'takedown' +
   * the takedown columns, in one write, then a force:true seller notice.
   */
  async takedownListing(
    listingId: string,
    ctx: { reason: string; actorId: string; reportId?: string | null; notify?: boolean },
  ): Promise<Record<string, any> | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('marketplace_listings')
      .update({
        status: 'removed_by_admin',
        rights_status: 'takedown',
        takedown_reason: ctx.reason.slice(0, 1000),
        takedown_at: nowIso,
        takedown_by: ctx.actorId,
      })
      .eq('id', listingId)
      .select('id, user_id, title, status, rights_status, takedown_reason, takedown_at, appeal_status')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (ctx.notify !== false && data.user_id) {
      await this.notify(data.user_id, {
        message: `Your listing "${data.title}" was removed by Lantern moderation. Reason: ${ctx.reason}. You can appeal once from My Listings.`,
        link: `marketplace:listing:${listingId}`,
        data: { listingId, reportId: ctx.reportId ?? null, kind: 'listing_takedown' },
      });
    }
    return data;
  }

  /** Clears takedown state when an admin restores a listing outside the appeal flow. */
  async clearListingTakedown(listingId: string): Promise<void> {
    const { error } = await this.db
      .from('marketplace_listings')
      .update({
        rights_status: 'cleared',
        takedown_reason: null,
        takedown_at: null,
        takedown_by: null,
      })
      .eq('id', listingId);
    if (error) throw error;
  }

  /** Seller appeal: once, only while the listing is moderated. */
  async appealListing(listingId: string, ownerId: string, rawNote: unknown): Promise<Record<string, any>> {
    const note = typeof rawNote === 'string' ? rawNote.trim() : '';
    if (!note) throw moderationError('Tell us briefly why the takedown was a mistake', 400);
    if (note.length > APPEAL_NOTE_MAX_LENGTH) {
      throw moderationError(`Your note must be at most ${APPEAL_NOTE_MAX_LENGTH} characters`, 400);
    }
    const { data: listing, error } = await this.db
      .from('marketplace_listings')
      .select('id, user_id, title, status, appeal_status')
      .eq('id', listingId)
      .maybeSingle();
    if (error) throw error;
    if (!listing) throw moderationError('Listing not found', 404);
    if (listing.user_id !== ownerId) throw moderationError('Only the seller can appeal this listing', 403);
    const refusal = listingAppealRefusal(listing);
    if (refusal) throw moderationError(refusal, /already/i.test(refusal) ? 409 : 400);

    const nowIso = new Date().toISOString();
    const { data, error: updErr } = await this.db
      .from('marketplace_listings')
      .update({ appeal_status: 'requested', appeal_note: note, appealed_at: nowIso })
      .eq('id', listingId)
      .eq('appeal_status', listing.appeal_status ?? 'none')
      .select('id, status, appeal_status, appeal_note, appealed_at')
      .maybeSingle();
    if (updErr) throw updErr;
    if (!data) throw moderationError('An appeal is already under review for this listing.', 409);
    return data;
  }

  async listAppeals(): Promise<Array<Record<string, any>>> {
    const { data, error } = await this.db
      .from('marketplace_listings')
      .select(
        'id, title, status, user_id, rights_status, takedown_reason, takedown_at, appeal_status, appeal_note, appealed_at, seller:profiles!marketplace_listings_user_id_fkey(id, name, username)',
      )
      .eq('appeal_status', 'requested')
      .order('appealed_at', { ascending: true })
      .limit(200);
    if (error) {
      if (isMissingRelationError(error) || error.code === '42703') return [];
      throw error;
    }
    return (data || []) as Array<Record<string, any>>;
  }

  /** Admin decision: reversed restores the listing; upheld keeps the takedown. */
  /**
   * The status a moderated listing should return to when a takedown is lifted.
   * Takedown overwrites the prior status with 'removed_by_admin' without
   * recording it, so a plain restore to 'active' could re-list a unique item
   * that was 'reserved' by an open order (double-sell) or already 'sold'. Derive
   * it from live order/stock state instead.
   */
  async resolveRestoredListingStatus(listingId: string): Promise<string> {
    const { OPEN_ORDER_STATUSES } = await import('./marketplaceOrders');
    const { data: openOrders } = await this.db
      .from('marketplace_orders')
      .select('id')
      .eq('listing_id', listingId)
      .in('status', OPEN_ORDER_STATUSES)
      .limit(1);
    if (openOrders && openOrders.length > 0) return 'reserved';

    const { data: listing } = await this.db
      .from('marketplace_listings')
      .select('quantity, listing_kind')
      .eq('id', listingId)
      .maybeSingle();
    // Digital listings never sell out — they stay available for the next buyer.
    if (listing?.listing_kind === 'question_bank' || listing?.listing_kind === 'study_pack') {
      return 'active';
    }
    const quantity = (listing as { quantity?: number | null } | null)?.quantity;
    if (quantity != null && Number(quantity) <= 0) return 'sold';
    if (quantity == null) {
      // Unique item: sold if a completed order exists.
      const { data: completed } = await this.db
        .from('marketplace_orders')
        .select('id')
        .eq('listing_id', listingId)
        .eq('status', 'completed')
        .limit(1);
      if (completed && completed.length > 0) return 'sold';
    }
    return 'active';
  }

  async decideAppeal(
    listingId: string,
    rawDecision: unknown,
    rawNote: unknown,
    actorId: string,
  ): Promise<{ id: string; status: string; appeal_status: ListingAppealDecision }> {
    if (!isListingAppealDecision(rawDecision)) throw moderationError('decision must be upheld or reversed', 400);
    const decision = rawDecision;
    const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote.trim().slice(0, 1000) : null;

    const { data: listing, error } = await this.db
      .from('marketplace_listings')
      .select('id, user_id, title, status, appeal_status, appeal_note')
      .eq('id', listingId)
      .maybeSingle();
    if (error) throw error;
    if (!listing) throw moderationError('Listing not found', 404);
    if (listing.appeal_status !== 'requested') {
      throw moderationError('This listing has no appeal waiting for a decision', 409);
    }

    const nowIso = new Date().toISOString();
    const restoredStatus =
      decision === 'reversed' ? await this.resolveRestoredListingStatus(listingId) : null;
    const patch: Record<string, unknown> =
      decision === 'reversed'
        ? {
            status: restoredStatus,
            rights_status: 'cleared',
            takedown_reason: null,
            takedown_at: null,
            takedown_by: null,
            appeal_status: 'reversed',
            appeal_decided_at: nowIso,
            appeal_decided_by: actorId,
          }
        : { appeal_status: 'upheld', appeal_decided_at: nowIso, appeal_decided_by: actorId };
    const { data, error: updErr } = await this.db
      .from('marketplace_listings')
      .update(patch)
      .eq('id', listingId)
      .eq('appeal_status', 'requested')
      .select('id, status, appeal_status')
      .maybeSingle();
    if (updErr) throw updErr;
    if (!data) throw moderationError('This appeal was just decided elsewhere', 409);

    await this.notify(listing.user_id, {
      message:
        decision === 'reversed'
          ? `Good news — your appeal for "${listing.title}" was accepted. The listing is live again and its rights status is cleared.${note ? ` Note: ${note}` : ''}`
          : `Your appeal for "${listing.title}" was reviewed and the takedown stands.${note ? ` Note: ${note}` : ''} Contact support@lanternstudy.com with new evidence if you believe this is wrong.`,
      link: `marketplace:listing:${listingId}`,
      data: { listingId, decision, kind: 'listing_appeal_decision' },
    });
    await logAdminAction(this.host, {
      actorId,
      action: decision === 'reversed' ? 'listing_appeal_reversed' : 'listing_appeal_upheld',
      targetType: 'listing',
      targetId: listingId,
      metadata: { seller_id: listing.user_id, appeal_note: listing.appeal_note ?? null },
      reason: note ?? undefined,
    });
    return { id: data.id, status: data.status, appeal_status: data.appeal_status as ListingAppealDecision };
  }

  // ─── Content filter persistence ──────────────────────────────────────────

  /**
   * Store flag-tier hits on the listing and open an auto content_report (under
   * review, reporter = owner — the system has no profile row) so a human
   * looks. Duplicate auto-reports (UNIQUE) are ignored; nothing here throws
   * at the caller — the listing write already succeeded.
   */
  async recordListingFlags(listingId: string, ownerId: string, flags: ModerationFlag[]): Promise<void> {
    if (flags.length === 0) return;
    try {
      const { data: current } = await this.db
        .from('marketplace_listings')
        .select('moderation_flags')
        .eq('id', listingId)
        .maybeSingle();
      const existing = Array.isArray(current?.moderation_flags) ? (current!.moderation_flags as ModerationFlag[]) : [];
      const seen = new Set(existing.map((f) => f.pattern));
      const merged = [...existing, ...flags.filter((f) => !seen.has(f.pattern))].slice(-50);
      const { error } = await this.db.from('marketplace_listings').update({ moderation_flags: merged }).eq('id', listingId);
      if (error) throw error;
    } catch (err) {
      logger.warn('Failed to store listing moderation_flags', { listingId, err: (err as Error)?.message });
    }
    try {
      const reason: ContentReportReason = flags.some((f) => f.reason === 'leaked_exam') ? 'leaked_exam' : 'copyright';
      await this.createReport({
        reporterId: ownerId,
        targetType: 'listing',
        targetId: listingId,
        reason,
        details: `auto-flag: ${flags.map((f) => f.pattern).join(' | ')}`.slice(0, REPORT_DETAILS_MAX_LENGTH),
        status: 'under_review',
      });
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code !== 409) {
        logger.warn('Failed to open auto content report', { listingId, err: (err as Error)?.message });
      }
    }
  }

  /** Refresh the attestation columns on an existing listing (PUT path). */
  async markListingAttested(listingId: string): Promise<void> {
    const { error } = await this.db
      .from('marketplace_listings')
      .update(listingRightsFields(true))
      .eq('id', listingId);
    if (error) throw error;
  }

  // ─── Notifications ───────────────────────────────────────────────────────

  private async notify(
    userId: string,
    notification: { message: string; link?: string; data?: Record<string, unknown> },
  ): Promise<void> {
    try {
      await this.host.notifications.createNotification(userId, {
        type: 'warning',
        message: notification.message,
        link: notification.link,
        data: notification.data,
        force: true,
      });
    } catch (err) {
      logger.warn('Moderation notification failed', { userId, err: (err as Error)?.message });
    }
  }
}

function snippet(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

function targetLink(targetType: ContentReportTargetType, targetId: string): string | undefined {
  switch (targetType) {
    case 'listing':
    case 'question_bank':
      return `marketplace:listing:${targetId}`;
    case 'note':
      return `note:${targetId}`;
    case 'group':
    case 'message':
      return `group:${targetId}`;
    case 'job_posting':
      return `job:${targetId}`;
    case 'community_post':
      return `community_post:${targetId}`;
    case 'community_member':
      return `profile:${targetId}`;
    default:
      return undefined;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return 'further notice';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

let service: ModerationService | null = null;

export function getModerationService(host: ModerationHost): ModerationService {
  if (!service) service = new ModerationService(host);
  return service;
}
