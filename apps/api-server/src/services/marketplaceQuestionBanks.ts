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
import { logger } from '../utils/logger';

const MAX_QUESTIONS = 1000;
const MAX_CONTENT_BYTES = 2_000_000;

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
  content: QuestionBankContent;
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
        categorySpecificFields: {
          questionCount,
          digital: true,
        },
      },
      userId
    );

    const { data: bank, error } = await this.db
      .from('marketplace_question_banks')
      .insert({
        listing_id: listing.id,
        source_group_id: input.groupId || null,
        published_by: userId,
        question_count: questionCount,
        content: { config: input.content.config || {}, questions: input.content.questions },
      })
      .select('id, listing_id, version, question_count, source_group_id')
      .single();
    if (error || !bank) {
      // Don't leave a purchasable listing with no content behind it.
      await this.db.from('marketplace_listings').delete().eq('id', listing.id);
      throw error || new Error('Failed to store question bank content');
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

    const config = (bank.content?.config || {}) as Record<string, unknown>;
    await this.supabaseService.saveOfflineBundle(userId, {
      bundleId: this.bundleIdForListing(listingId),
      config: { ...config, groupName: config.groupName || title, source: 'marketplace' },
      questions: bank.content?.questions || [],
      groupName: title,
      downloadedAt: new Date().toISOString(),
    });
  }

  /** Free banks (and re-downloads by existing owners). */
  async downloadQuestionBank(listingId: string, userId: string) {
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

    return this.grantEntitlement(listingId, userId, null);
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
