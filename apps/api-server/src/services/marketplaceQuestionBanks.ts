/**
 * Marketplace question banks — digital study bundles published from groups.
 *
 * Delivery model: ownership is an entitlement row; the product itself is
 * delivered by copying the frozen content snapshot into the buyer's
 * offline_bundles, where the existing offline runtime (web Offline Mode,
 * mobile offlineStore, cross-device sync) takes over. No new client runtime.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { isMarketplaceListingModerated } from '@lantern/shared/marketplace';
import {
  getModerationService,
  listingRightsFields,
  normalizePublishProvenance,
  runListingContentFilter,
} from './moderation';
import { logger } from '../utils/logger';
import { recordLearningEvent } from './learningEvents';
import type { LearningSurface } from '@lantern/shared/learning';

const MAX_QUESTIONS = 1000;
const MAX_CONTENT_BYTES = 2_000_000;

/** PostgREST/Postgres "relation does not exist" — i.e. migration not applied yet. */
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /does not exist|could not find the table/i.test(error.message || '')
  );
}

export interface QuestionBankContent {
  config?: Record<string, unknown>;
  questions: unknown[];
}

export interface PublishQuestionBankInput {
  title: string;
  description?: string;
  /** Naira. null/0 publishes a free bank. */
  price?: number | null;
  campusId: string;
  location?: string;
  groupId?: string | null;
  /** Academic archive reference; written on both the listing and the bank. */
  courseId?: string | null;
  content: QuestionBankContent;
  /**
   * Rights attestation (RIGHTS_ATTESTATION_TEXT) — required; publish refuses
   * with ATTESTATION_REQUIRED_MESSAGE otherwise. Recorded with its version on
   * both the bank and the listing.
   */
  attestation?: unknown;
  /** "This pack was AI-assisted" toggle. */
  aiAssisted?: unknown;
  /** Up to 20 short references (≤ 200 chars each); newline text is accepted. */
  sourcesCited?: unknown;
}

export interface UpdateQuestionBankProvenance {
  /** Re-required on every content update (400 without it). */
  attestation?: unknown;
  aiAssisted?: unknown;
  sourcesCited?: unknown;
}

export class MarketplaceQuestionBanksService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Deterministic per listing so re-grants and restores upsert, never duplicate. */
  bundleIdForListing(listingId: string): string {
    return `qbank-${listingId}`;
  }

  private validateContent(content: QuestionBankContent): number {
    if (!content || !Array.isArray(content.questions) || content.questions.length === 0) {
      throw new PublicError('content.questions must be a non-empty array');
    }
    if (content.questions.length > MAX_QUESTIONS) {
      throw new PublicError(`A question bank can hold at most ${MAX_QUESTIONS} questions`);
    }
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
    } catch {
      throw new PublicError('content must be JSON-serializable');
    }
    if (bytes > MAX_CONTENT_BYTES) {
      throw new PublicError('Question bank content is too large (2MB max)');
    }
    return content.questions.length;
  }

  async publishQuestionBank(userId: string, input: PublishQuestionBankInput) {
    const title = String(input.title || '').trim();
    if (!title) throw new PublicError('Title is required');
    if (!input.campusId) throw new PublicError('Campus is required');

    // Rights attestation is mandatory for every digital listing (400 without
    // it); AI-assisted flag + cited sources ride along as provenance.
    const provenance = normalizePublishProvenance({
      attestation: input.attestation,
      aiAssisted: input.aiAssisted,
      sourcesCited: input.sourcesCited,
    });

    // A non-UUID courseId would 500 at the DB write; reject it as a 400 the same
    // way every other courseId-accepting route does.
    if (
      input.courseId != null &&
      input.courseId !== '' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.courseId))
    ) {
      throw new PublicError('courseId must be a valid course id');
    }

    // Same content moderation as the listing routes: hard-block leaked-exam /
    // malpractice titles (throws a 400), collect advisory flags to record after
    // the listing exists. Without this, publish was a filter bypass.
    const contentFlags = runListingContentFilter({
      title,
      description: input.description || '',
    });

    const questionCount = this.validateContent(input.content);

    // Publishing from a group requires group admin rights: the bank carries the
    // group's name and collective work, so a rank-and-file member cannot list it.
    if (input.groupId) {
      const group = await this.supabaseService.getGroupById(input.groupId, userId);
      if (!group) throw new PublicError('Group not found or access denied');
      const g = group as unknown as {
        permissions?: Record<string, { admin?: boolean }>;
        adminIds?: string[];
      };
      const isAdmin =
        Boolean(g.permissions?.[userId]?.admin) || Boolean(g.adminIds?.includes(userId));
      if (!isAdmin) {
        throw new PublicError('Only group admins can publish a group question bank');
      }
    }

    const price = input.price == null ? null : Number(input.price);
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      throw new PublicError('Invalid price');
    }

    // A paid bank fulfills instantly on payment, so the seller must already be
    // payable — otherwise every purchase would strand in payout limbo.
    if (price != null && price > 0) {
      const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
        './marketplacePayments'
      );
      if (!marketplacePaystackEnabled()) {
        throw new PublicError('Paid question banks require in-app payments, which are not enabled');
      }
      await getMarketplacePaymentsService(this.supabaseService).assertSellerCanReceivePayout(userId);
    }

    const listing = await this.supabaseService.createMarketplaceListing(
      {
        title,
        description: input.description || '',
        category: 'pq_bank',
        price: price != null && price > 0 ? price : null,
        campus_id: input.campusId,
        location: input.location,
        listing_kind: 'question_bank',
        quantity: null,
        status: 'active',
        courseId: input.courseId || null,
        categorySpecificFields: {
          questionCount,
          digital: true,
        },
        // Server-set rights state (rights_status 'attested' + timestamp/version).
        ...listingRightsFields(true),
      },
      userId
    );

    const { data: bank, error } = await this.db
      .from('marketplace_question_banks')
      .insert({
        listing_id: listing.id,
        source_group_id: input.groupId || null,
        published_by: userId,
        course_id: input.courseId || null,
        question_count: questionCount,
        content: { config: input.content.config || {}, questions: input.content.questions },
        rights_attested_at: provenance.rights_attested_at,
        rights_attestation_version: provenance.rights_attestation_version,
        ai_assisted: provenance.ai_assisted,
        sources_cited: provenance.sources_cited,
      })
      .select('id, listing_id, version, question_count, source_group_id')
      .single();
    if (error || !bank) {
      // Don't leave a purchasable listing with no content behind it.
      await this.db.from('marketplace_listings').delete().eq('id', listing.id);
      throw error || new Error('Failed to store question bank content');
    }

    // Creator counters (Phase 2 · J) — question banks count as published
    // products too. Never throws.
    const { getCreatorsService } = await import('./creators');
    await getCreatorsService(this.supabaseService).refreshStats(userId);

    // Academic feed (Phase 3 · M) — best-effort; the listing is already live.
    const { getActivityFeedService } = await import('./activityFeed');
    await getActivityFeedService(this.supabaseService).record({
      actorId: userId,
      verb: 'published_bank',
      objectType: 'listing',
      objectId: listing.id,
      audienceType: 'followers',
      courseId: (listing as { course_id?: string | null }).course_id ?? null,
      payload: { title: (listing as { title?: string }).title ?? null },
    });

    // Advisory content flags (lecturer slides / copyrighted material wording)
    // become an under-review content_report on the listing; never blocks publish.
    if (contentFlags.length > 0) {
      try {
        await getModerationService(this.supabaseService).recordListingFlags(
          listing.id,
          userId,
          contentFlags,
        );
      } catch (flagErr) {
        logger.warn('Failed to record question-bank content flags', { listingId: listing.id, flagErr });
      }
    }

    return { listing, bank };
  }

  private async getBankForListing(listingId: string) {
    const { data, error } = await this.db
      .from('marketplace_question_banks')
      .select('id, listing_id, version, question_count, content')
      .eq('listing_id', listingId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Record ownership and deliver the content into the user's offline bundles.
   * Idempotent: entitlements are unique per (listing, user) and the bundle id
   * is deterministic, so repeat calls refresh rather than duplicate.
   */
  async grantEntitlement(
    listingId: string,
    userId: string,
    orderId: string | null
  ): Promise<{ bundleId: string; questionCount: number }> {
    const bank = await this.getBankForListing(listingId);
    if (!bank) throw new PublicError('Question bank content not found for this listing');

    const { error: entitlementError } = await this.db
      .from('marketplace_question_bank_entitlements')
      .upsert(
        {
          listing_id: listingId,
          user_id: userId,
          order_id: orderId,
          version_at_download: bank.version,
        },
        { onConflict: 'listing_id,user_id', ignoreDuplicates: true }
      );
    if (entitlementError) throw entitlementError;

    await this.deliverBundle(userId, listingId, bank);

    // Existing owners re-downloading get the current snapshot, so record the
    // version they now hold (the insert above is ignored on conflict, which
    // deliberately protects order_id — this touches only the version).
    const { error: versionError } = await this.db
      .from('marketplace_question_bank_entitlements')
      .update({ version_at_download: bank.version })
      .eq('listing_id', listingId)
      .eq('user_id', userId);
    if (versionError) {
      logger.warn('Could not record question bank version on re-download', {
        listingId,
        userId,
        error: versionError.message,
      });
    }

    return { bundleId: this.bundleIdForListing(listingId), questionCount: bank.question_count };
  }

  private async deliverBundle(
    userId: string,
    listingId: string,
    bank: { content: QuestionBankContent; question_count: number }
  ): Promise<void> {
    const { data: listing } = await this.db
      .from('marketplace_listings')
      .select('title')
      .eq('id', listingId)
      .maybeSingle();
    const title = listing?.title || 'Question bank';

    const questions = (bank.content?.questions || []) as Array<{ type?: string }>;
    const config = { ...((bank.content?.config || {}) as Record<string, unknown>) };
    // Normalize the fields the offline runtime renders, so a sparse publish
    // config can never produce a broken bundle on the buyer's device.
    if (config.numberOfQuestions == null) config.numberOfQuestions = questions.length;
    if (!Array.isArray(config.allowedQuestionTypes)) {
      config.allowedQuestionTypes = Array.from(
        new Set(questions.map((q) => q?.type).filter(Boolean))
      );
    }
    await this.supabaseService.saveOfflineBundle(userId, {
      bundleId: this.bundleIdForListing(listingId),
      config: { ...config, groupName: config.groupName || title, source: 'marketplace' },
      questions,
      groupName: title,
      downloadedAt: new Date().toISOString(),
    });
  }

  /** Free banks (and re-downloads by existing owners). */
  async downloadQuestionBank(
    listingId: string,
    userId: string,
    options: {
      /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
      surface?: LearningSurface;
    } = {}
  ) {
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing || listing.listing_kind !== 'question_bank') {
      throw new PublicError('Question bank not found');
    }

    const isOwnerSeller = listing.user_id === userId;
    if (!isOwnerSeller && listing.status !== 'active') {
      throw new PublicError('This question bank is not available');
    }

    const { data: existing } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('id')
      .eq('listing_id', listingId)
      .eq('user_id', userId)
      .maybeSingle();

    const isFree = listing.price == null || Number(listing.price) <= 0;
    if (!existing && !isFree && !isOwnerSeller) {
      throw new PublicError('Purchase this question bank to download it');
    }

    const granted = await this.grantEntitlement(listingId, userId, null);

    // learning_events: bank_downloaded (after the entitlement + bundle landed;
    // restore/self-heal re-grants do not go through here). Never throws.
    await recordLearningEvent(this.supabaseService, {
      userId,
      eventType: 'bank_downloaded',
      targetType: 'listing',
      targetId: listingId,
      listingId,
      courseId: (listing as { course_id?: string | null }).course_id ?? null,
      surface: options.surface ?? 'api',
    });

    return granted;
  }

  /**
   * Re-materialize offline bundles from entitlements (new device, reinstall),
   * and self-heal: paid digital orders that somehow missed fulfillment get
   * their entitlement granted here.
   */
  async restoreEntitlements(userId: string): Promise<{ restored: number }> {
    const { data: entitlements, error } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('listing_id')
      .eq('user_id', userId);
    if (error) throw error;

    const owned = new Set((entitlements || []).map((e: any) => String(e.listing_id)));

    // Self-heal from completed/paid digital orders lacking an entitlement.
    const { data: orders } = await this.db
      .from('marketplace_orders')
      .select('id, listing_id, status')
      .eq('buyer_id', userId)
      .in('status', ['paid', 'ready_for_pickup', 'buyer_confirmed', 'completed']);
    const candidateListingIds = Array.from(
      new Set(
        (orders || [])
          .map((o: any) => String(o.listing_id))
          .filter((id: string) => !owned.has(id))
      )
    );
    let missedOrders: Array<{ id: string; listing_id: string }> = [];
    if (candidateListingIds.length > 0) {
      const { data: banks } = await this.db
        .from('marketplace_question_banks')
        .select('listing_id')
        .in('listing_id', candidateListingIds);
      const bankListingIds = new Set((banks || []).map((b: any) => String(b.listing_id)));
      missedOrders = (orders || []).filter(
        (o: any) => bankListingIds.has(String(o.listing_id)) && !owned.has(String(o.listing_id))
      );
    }

    let restored = 0;
    for (const listingId of owned) {
      try {
        await this.grantEntitlement(listingId, userId, null);
        restored += 1;
      } catch (err) {
        logger.warn('Question bank restore failed for listing', {
          listingId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    for (const order of missedOrders) {
      try {
        await this.grantEntitlement(String(order.listing_id), userId, String(order.id));
        restored += 1;
      } catch (err) {
        logger.warn('Question bank self-heal failed for order', {
          orderId: order.id,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { restored };
  }

  /**
   * Replace a published bank's content and bump its version. Buyers keep the
   * snapshot they downloaded until they pull the update — nothing is pushed.
   */
  async updateQuestionBankContent(
    listingId: string,
    userId: string,
    content: QuestionBankContent,
    provenanceInput: UpdateQuestionBankProvenance = {}
  ): Promise<{ version: number; questionCount: number }> {
    // Every republish re-requires the rights attestation (400 without it).
    const provenance = normalizePublishProvenance(provenanceInput);
    const questionCount = this.validateContent(content);

    const bank = await this.getBankForListing(listingId);
    if (!bank) throw new PublicError('Question bank not found');

    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) throw new PublicError('Listing not found');
    if (listing.user_id !== userId) {
      throw new PublicError('Only the seller can update this question bank');
    }
    if (isMarketplaceListingModerated(listing.status)) {
      // Moderated listings are read-only for the seller (see lifecycle.ts).
      throw Object.assign(
        new PublicError(
          'This listing was taken down by Lantern moderation and its question bank cannot be updated.'
        ),
        { statusCode: 403 }
      );
    }

    const nextVersion = Number(bank.version) + 1;
    const { data: updatedRows, error } = await this.db
      .from('marketplace_question_banks')
      .update({
        content: { config: content.config || {}, questions: content.questions },
        question_count: questionCount,
        version: nextVersion,
        updated_at: new Date().toISOString(),
        rights_attested_at: provenance.rights_attested_at,
        rights_attestation_version: provenance.rights_attestation_version,
        ...(provenanceInput.aiAssisted !== undefined ? { ai_assisted: provenance.ai_assisted } : {}),
        ...(provenanceInput.sourcesCited !== undefined ? { sources_cited: provenance.sources_cited } : {}),
      })
      .eq('listing_id', listingId)
      .eq('version', bank.version) // optimistic lock against concurrent updates
      .select('listing_id');
    if (error) throw error;
    if (!updatedRows || updatedRows.length === 0) {
      throw new PublicError('This question bank was just updated elsewhere — reload and try again');
    }

    // Keep the browse-card question count honest.
    const fields = listing.category_specific_fields || {};
    await this.db
      .from('marketplace_listings')
      .update({
        category_specific_fields: { ...fields, questionCount, digital: true },
        updated_at: new Date().toISOString(),
      })
      .eq('id', listingId);

    // The seller's own offline copy should reflect what buyers now get.
    try {
      await this.deliverBundle(userId, listingId, {
        content: { config: content.config || {}, questions: content.questions },
        question_count: questionCount,
      });
    } catch {
      // best-effort; the canonical snapshot is already stored
    }

    return { version: nextVersion, questionCount };
  }

  /**
   * Public sample of a bank: the first few questions with every answer key
   * stripped. Safe for guests — it never reveals correct answers.
   */
  async getQuestionBankPreview(listingId: string, viewerId?: string) {
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing || listing.listing_kind !== 'question_bank') {
      throw new PublicError('Question bank not found');
    }

    const bank = await this.getBankForListing(listingId);
    if (!bank) throw new PublicError('Question bank not found');

    // Ownership rides along so clients that don't call /full (mobile) can
    // render the owned state from this one request.
    let owned = false;
    if (viewerId) {
      const { data: entitlement } = await this.db
        .from('marketplace_question_bank_entitlements')
        .select('id')
        .eq('listing_id', listingId)
        .eq('user_id', viewerId)
        .maybeSingle();
      owned = !!entitlement;
    }

    const { buildQuestionBankPreview, QUESTION_BANK_PREVIEW_LIMIT } = await import(
      '../utils/questionBankPreview'
    );
    const questions = (bank.content?.questions || []) as unknown[];
    return {
      questionCount: bank.question_count,
      version: bank.version,
      owned,
      isSeller: listing.user_id === viewerId,
      previewCount: Math.min(questions.length, QUESTION_BANK_PREVIEW_LIMIT),
      questions: buildQuestionBankPreview(questions),
    };
  }

  /** Question banks published by this user (drives the republish-as-update UI). */
  async listMyQuestionBanks(userId: string) {
    const { data, error } = await this.db
      .from('marketplace_question_banks')
      .select('listing_id, source_group_id, version, question_count, updated_at')
      .eq('published_by', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const listingIds = (data || []).map((b: any) => String(b.listing_id));
    if (listingIds.length === 0) return [];
    const { data: listings } = await this.db
      .from('marketplace_listings')
      .select('id, title, price, status')
      .in('id', listingIds);
    const byId = new Map((listings || []).map((l: any) => [String(l.id), l]));
    return (data || []).map((b: any) => ({
      listingId: b.listing_id,
      sourceGroupId: b.source_group_id,
      version: b.version,
      questionCount: b.question_count,
      title: byId.get(String(b.listing_id))?.title || 'Question bank',
      price: byId.get(String(b.listing_id))?.price ?? null,
      status: byId.get(String(b.listing_id))?.status || 'active',
    }));
  }

  /** Owned banks whose published version is newer than the copy the user holds. */
  async listAvailableUpdates(userId: string) {
    const { data: entitlements, error } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('listing_id, version_at_download')
      .eq('user_id', userId);
    if (error) throw error;
    if (!entitlements || entitlements.length === 0) return [];

    const heldVersions = new Map(
      entitlements.map((e: any) => [String(e.listing_id), Number(e.version_at_download)])
    );
    const { data: banks } = await this.db
      .from('marketplace_question_banks')
      .select('listing_id, version, question_count')
      .in('listing_id', Array.from(heldVersions.keys()));

    return (banks || [])
      .filter((b: any) => Number(b.version) > (heldVersions.get(String(b.listing_id)) ?? 1))
      .map((b: any) => ({
        listingId: b.listing_id,
        bundleId: this.bundleIdForListing(String(b.listing_id)),
        version: b.version,
        questionCount: b.question_count,
      }));
  }

  /**
   * Record an attempt on a bank the user owns. Ownership is required so the
   * board can't be stuffed by someone who never downloaded the bank.
   */
  async recordScore(
    listingId: string,
    userId: string,
    correct: number,
    total: number,
    options: {
      /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
      surface?: LearningSurface;
    } = {}
  ): Promise<{
    bestScorePct: number;
    bestCorrect: number;
    bestTotal: number;
    attempts: number;
    improved: boolean;
  }> {
    const correctCount = Math.floor(Number(correct));
    const totalCount = Math.floor(Number(total));
    if (!Number.isFinite(totalCount) || totalCount <= 0) {
      throw new PublicError('Invalid question total');
    }
    if (!Number.isFinite(correctCount) || correctCount < 0 || correctCount > totalCount) {
      throw new PublicError('Invalid correct count');
    }

    const { data: entitlement } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('id')
      .eq('listing_id', listingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!entitlement) {
      throw new PublicError('You do not own this question bank');
    }

    const { data, error } = await this.db.rpc('marketplace_record_question_bank_score', {
      p_listing_id: listingId,
      p_user_id: userId,
      p_correct: correctCount,
      p_total: totalCount,
    });
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    const result = {
      bestScorePct: Number(row?.best_score_pct ?? 0),
      bestCorrect: Number(row?.best_correct ?? 0),
      bestTotal: Number(row?.best_total ?? totalCount),
      attempts: Number(row?.attempts ?? 1),
      improved: !!row?.improved,
    };

    // learning_events: bank_score_recorded — an engagement marker. count =
    // questions in the attempt, attempt_no = the student's attempt number;
    // the score itself lives in marketplace_question_bank_scores (join on
    // listing_id + user_id) and per-question correctness in the session's
    // question_answered rows (listing_id set from config.bundleId). Never throws.
    await recordLearningEvent(this.supabaseService, {
      userId,
      eventType: 'bank_score_recorded',
      targetType: 'listing',
      targetId: listingId,
      listingId,
      count: totalCount,
      attemptNo: Number.isFinite(result.attempts) ? result.attempts : null,
      surface: options.surface ?? 'api',
    });

    return result;
  }

  /** Top scores for a bank, plus the caller's own standing. */
  async getLeaderboard(listingId: string, viewerId?: string, limit = 20) {
    const capped = Math.min(Math.max(1, Math.floor(Number(limit) || 20)), 50);
    const { data: rows, error } = await this.db
      .from('marketplace_question_bank_scores')
      .select('user_id, best_score_pct, best_correct, best_total, attempts, best_at')
      .eq('listing_id', listingId)
      .order('best_score_pct', { ascending: false })
      .order('best_at', { ascending: true })
      .limit(capped);
    if (error) {
      // Before the leaderboard migration is applied the table is absent.
      // An unprovisioned feature is an empty board, not a 500 on every
      // question-bank listing view.
      if (isMissingRelationError(error)) {
        logger.warn('Question bank leaderboard table is missing; run migration 20260819120000');
        return { entries: [], viewerEntry: null };
      }
      throw error;
    }

    const userIds = (rows || []).map((r: any) => String(r.user_id));
    let profiles = new Map<string, { name?: string; avatar_url?: string }>();
    if (userIds.length > 0) {
      const { data: profileRows } = await this.db
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', userIds);
      profiles = new Map(
        (profileRows || []).map((p: any) => [String(p.id), { name: p.name, avatar_url: p.avatar_url }])
      );
    }

    const entries = (rows || []).map((row: any, index: number) => ({
      rank: index + 1,
      userId: String(row.user_id),
      name: profiles.get(String(row.user_id))?.name || 'Student',
      avatarUrl: profiles.get(String(row.user_id))?.avatar_url || null,
      scorePct: Number(row.best_score_pct),
      correct: Number(row.best_correct),
      total: Number(row.best_total),
      attempts: Number(row.attempts),
      isViewer: !!viewerId && String(row.user_id) === viewerId,
    }));

    // A viewer outside the top N still gets their own row (with a true rank).
    let viewerEntry: (typeof entries)[number] | null =
      entries.find((e) => e.isViewer) || null;
    if (viewerId && !viewerEntry) {
      const { data: own } = await this.db
        .from('marketplace_question_bank_scores')
        .select('best_score_pct, best_correct, best_total, attempts, best_at')
        .eq('listing_id', listingId)
        .eq('user_id', viewerId)
        .maybeSingle();
      if (own) {
        const { count } = await this.db
          .from('marketplace_question_bank_scores')
          .select('id', { count: 'exact', head: true })
          .eq('listing_id', listingId)
          .gt('best_score_pct', own.best_score_pct);
        viewerEntry = {
          rank: Number(count ?? 0) + 1,
          userId: viewerId,
          name: 'You',
          avatarUrl: null,
          scorePct: Number(own.best_score_pct),
          correct: Number(own.best_correct),
          total: Number(own.best_total),
          attempts: Number(own.attempts),
          isViewer: true,
        };
      }
    }

    return { entries, viewerEntry };
  }

  /** True when this listing is a question bank (used by the payments path). */
  async isQuestionBankListing(listingId: string): Promise<boolean> {
    const bank = await this.db
      .from('marketplace_question_banks')
      .select('id')
      .eq('listing_id', listingId)
      .maybeSingle();
    return !!bank.data;
  }
}

let service: MarketplaceQuestionBanksService | null = null;

export function getMarketplaceQuestionBanksService(
  supabaseService: SupabaseService
): MarketplaceQuestionBanksService {
  if (!service) service = new MarketplaceQuestionBanksService(supabaseService);
  return service;
}
