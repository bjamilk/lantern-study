/**
 * Marketplace study packs — digital study products authored from a student's
 * notes/course (Phase 2 · G). A pack bundles a guide, summaries, flashcards and
 * questions.
 *
 * Delivery model mirrors question banks: ownership is an entitlement row (the
 * SAME table question banks use, marketplace_question_bank_entitlements), and
 * the product is delivered by copying its parts into the buyer's own data —
 *   questions   -> offline_bundles  (bundle id `pack-<listingId>`)
 *   flashcards  -> a deck            (created once, then replaced in place)
 *   guide+sums  -> a note            (created once, then its body rewritten)
 * so the existing offline/deck/note runtimes take over with no new client code.
 * `delivered_refs` on the entitlement row records where each part landed, which
 * makes re-delivery (update-pull, restore, re-download) idempotent instead of
 * minting duplicate decks/notes.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { isMissingTopicColumn } from './academicCourses';
import { isMarketplaceListingModerated } from '@lantern/shared/marketplace';
import { normalizePublishProvenance, runListingContentFilter, getModerationService, listingRightsFields } from './moderation';
import { logger } from '../utils/logger';
import { recordLearningEvent } from './learningEvents';
import type { LearningSurface } from '@lantern/shared/learning';

const MAX_QUESTIONS = 1000;
const MAX_FLASHCARDS = 1000;
const MAX_CONTENT_BYTES = 2_000_000;
const SUMMARY_PREVIEW_CHARS = 600;
const FLASHCARD_FRONT_PREVIEW_LIMIT = 5;
const STUDY_PACK_PREVIEW_QUESTIONS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST/Postgres "relation does not exist" — i.e. migration not applied yet. */
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /does not exist|could not find the table/i.test(error.message || '')
  );
}

export interface StudyPackTocEntry {
  title: string;
  anchor: string;
}
export interface StudyPackSummary {
  title: string;
  markdown: string;
}
export interface StudyPackFlashcard {
  front?: string;
  back?: string;
  type?: string;
  tags?: unknown;
}
export interface StudyPackWeakSection {
  title: string;
  reason: string;
}
export interface StudyPackContent {
  guide?: { markdown?: string; toc?: StudyPackTocEntry[] };
  summaries?: StudyPackSummary[];
  flashcards?: StudyPackFlashcard[];
  questions?: unknown[];
  weakSections?: StudyPackWeakSection[];
  examChecklist?: string[];
  cover?: { title: string; subtitle?: string };
}
export interface StudyPackCounts {
  guideWords: number;
  summaries: number;
  flashcards: number;
  questions: number;
}

/** What was materialised on a buyer's device for one pack. */
interface DeliveredRefs {
  bundleId?: string;
  deckId?: string;
  noteId?: string;
  version?: number;
}

export interface PublishStudyPackInput {
  title: string;
  description?: string;
  /** Naira. null/0 publishes a free pack. */
  price?: number | null;
  campusId: string;
  location?: string;
  courseId?: string | null;
  /**
   * Topic inside `courseId` (Phase 1 · A). Only the listing carries it —
   * marketplace_study_packs has no topic_id column — and
   * createMarketplaceListing validates it against the course.
   */
  topicId?: string | null;
  content?: StudyPackContent;
  /** When set, content/classification are copied from a ready study_pack_draft (Phase 2 · H). */
  draftId?: string | null;
  attestation?: unknown;
  aiAssisted?: unknown;
  sourcesCited?: unknown;
}

export interface UpdateStudyPackProvenance {
  attestation?: unknown;
  aiAssisted?: unknown;
  sourcesCited?: unknown;
}

function wordCount(markdown: string): number {
  const trimmed = String(markdown || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Per-key in-process mutex so two overlapping deliveries for the same
 * (listing,user) — a double-tapped download, or a paid-order webhook racing a
 * client restore — serialize. The second waits for the first to persist its
 * delivered_refs, then reuses the deck/note it made instead of minting a
 * duplicate (importDeck/createNote have no idempotency key). This guards a
 * single API instance; the post-upsert re-read of delivered_refs additionally
 * makes sequential re-deliveries idempotent.
 */
const deliveryChains = new Map<string, Promise<unknown>>();
function withDeliveryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = deliveryChains.get(key) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  deliveryChains.set(key, tail);
  void tail.then(() => {
    if (deliveryChains.get(key) === tail) deliveryChains.delete(key);
  });
  return result;
}

export class MarketplaceStudyPacksService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Deterministic per listing so re-grants and restores upsert, never duplicate. */
  bundleIdForListing(listingId: string): string {
    return `pack-${listingId}`;
  }

  /**
   * Validate + normalize a pack's content and derive its counts server-side
   * (never trust client counts). Requires at least one deliverable part.
   */
  private normalizeContent(raw: StudyPackContent | undefined | null): {
    content: StudyPackContent;
    counts: StudyPackCounts;
  } {
    const input = (raw && typeof raw === 'object' ? raw : {}) as StudyPackContent;

    const guideMarkdown =
      typeof input.guide?.markdown === 'string' ? input.guide.markdown : '';
    const toc = Array.isArray(input.guide?.toc)
      ? (input.guide!.toc as StudyPackTocEntry[]).filter(
          (t) => t && typeof t.title === 'string',
        )
      : [];
    const summaries = Array.isArray(input.summaries)
      ? input.summaries.filter((s) => s && typeof s.markdown === 'string')
      : [];
    const flashcards = Array.isArray(input.flashcards) ? input.flashcards : [];
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const weakSections = Array.isArray(input.weakSections)
      ? input.weakSections.filter((w) => w && typeof w.title === 'string')
      : [];
    const examChecklist = Array.isArray((input as StudyPackContent).examChecklist)
      ? (input as StudyPackContent).examChecklist!.filter((s) => typeof s === 'string' && s.trim())
          .map((s) => s.trim())
          .slice(0, 20)
      : [];
    const coverIn = (input as StudyPackContent).cover;
    const cover =
      coverIn && typeof coverIn.title === 'string' && coverIn.title.trim()
        ? {
            title: coverIn.title.trim().slice(0, 120),
            subtitle:
              typeof coverIn.subtitle === 'string' && coverIn.subtitle.trim()
                ? coverIn.subtitle.trim().slice(0, 160)
                : undefined,
          }
        : undefined;

    const hasGuide = guideMarkdown.trim().length > 0;
    if (!hasGuide && summaries.length === 0 && flashcards.length === 0 && questions.length === 0) {
      throw new PublicError(
        'A study pack needs at least one of: a guide, summaries, flashcards or questions',
      );
    }
    if (questions.length > MAX_QUESTIONS) {
      throw new PublicError(`A study pack can hold at most ${MAX_QUESTIONS} questions`);
    }
    if (flashcards.length > MAX_FLASHCARDS) {
      throw new PublicError(`A study pack can hold at most ${MAX_FLASHCARDS} flashcards`);
    }

    const content: StudyPackContent = {
      guide: { markdown: guideMarkdown, toc },
      summaries,
      flashcards,
      questions,
      weakSections,
      examChecklist,
      cover,
    };

    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
    } catch {
      throw new PublicError('content must be JSON-serializable');
    }
    if (bytes > MAX_CONTENT_BYTES) {
      throw new PublicError('Study pack content is too large (2MB max)');
    }

    const counts: StudyPackCounts = {
      guideWords: wordCount(guideMarkdown),
      summaries: summaries.length,
      flashcards: flashcards.length,
      questions: questions.length,
    };
    return { content, counts };
  }

  /**
   * Copy content + classification from a ready study_pack_draft the caller owns
   * (Phase 2 · H). The draft is marked 'published' once its listing exists.
   */
  private async loadDraft(userId: string, draftId: string) {
    if (!UUID_RE.test(String(draftId))) {
      throw new PublicError('draftId must be a valid draft id');
    }
    const { data, error } = await this.db
      .from('study_pack_drafts')
      .select('id, user_id, status, content, course_id')
      .eq('id', draftId)
      .maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) {
        throw new PublicError('Study product drafts are not available yet');
      }
      throw error;
    }
    if (!data || String(data.user_id) !== userId) {
      throw new PublicError('Draft not found');
    }
    if (data.status !== 'ready') {
      throw new PublicError('This draft is not ready to publish yet');
    }
    return data as { id: string; content: StudyPackContent; course_id: string | null };
  }

  async publishStudyPack(userId: string, input: PublishStudyPackInput) {
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

    let courseId = input.courseId ?? null;
    if (courseId != null && courseId !== '' && !UUID_RE.test(String(courseId))) {
      throw new PublicError('courseId must be a valid course id');
    }

    // Same content moderation as the listing routes: hard-block leaked-exam /
    // malpractice titles (throws a 400), collect advisory flags for later.
    const contentFlags = runListingContentFilter({
      title,
      description: input.description || '',
    });

    // Content comes either inline or from a ready draft (H). A draft's course
    // classification seeds courseId when the publisher didn't pick one.
    let draft: { id: string; content: StudyPackContent; course_id: string | null } | null = null;
    let rawContent = input.content;
    if (input.draftId) {
      draft = await this.loadDraft(userId, String(input.draftId));
      rawContent = draft.content;
      if (!courseId && draft.course_id) courseId = draft.course_id;
    }
    const { content, counts } = this.normalizeContent(rawContent);

    const price = input.price == null ? null : Number(input.price);
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      throw new PublicError('Invalid price');
    }

    // A paid pack fulfills instantly on payment, so the seller must already be
    // payable — otherwise every purchase would strand in payout limbo.
    if (price != null && price > 0) {
      const { marketplacePaystackEnabled, getMarketplacePaymentsService } = await import(
        './marketplacePayments'
      );
      if (!marketplacePaystackEnabled()) {
        throw new PublicError('Paid study packs require in-app payments, which are not enabled');
      }
      await getMarketplacePaymentsService(this.supabaseService).assertSellerCanReceivePayout(userId);
    }

    const listing = await this.supabaseService.createMarketplaceListing(
      {
        title,
        description: input.description || '',
        category: 'study_pack',
        price: price != null && price > 0 ? price : null,
        campus_id: input.campusId,
        location: input.location,
        listing_kind: 'study_pack',
        quantity: null,
        status: 'active',
        courseId: courseId || null,
        // Only meaningful when the publisher picked a course; a draft-seeded
        // course never carries a topic, because the picker had no course to
        // offer topics from.
        topicId: (courseId && input.topicId) || null,
        categorySpecificFields: {
          counts,
          digital: true,
        },
        ...listingRightsFields(true),
      },
      userId,
    );

    const { data: pack, error } = await this.db
      .from('marketplace_study_packs')
      .insert({
        listing_id: listing.id,
        published_by: userId,
        course_id: courseId || null,
        source_note_ids: [],
        content,
        counts,
        version: 1,
        rights_attested_at: provenance.rights_attested_at,
        rights_attestation_version: provenance.rights_attestation_version,
        ai_assisted: provenance.ai_assisted,
        sources_cited: provenance.sources_cited,
      })
      .select('id, listing_id, version, counts')
      .single();
    if (error || !pack) {
      // Don't leave a purchasable listing with no content behind it.
      await this.db.from('marketplace_listings').delete().eq('id', listing.id);
      throw error || new Error('Failed to store study pack content');
    }

    if (draft) {
      const { error: draftErr } = await this.db
        .from('study_pack_drafts')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', draft.id)
        .eq('user_id', userId);
      if (draftErr) {
        logger.warn('Failed to mark study pack draft published', { draftId: draft.id, draftErr });
      }
    }

    if (contentFlags.length > 0) {
      try {
        await getModerationService(this.supabaseService).recordListingFlags(
          listing.id,
          userId,
          contentFlags,
        );
      } catch (flagErr) {
        logger.warn('Failed to record study-pack content flags', { listingId: listing.id, flagErr });
      }
    }

    // Creator counters (Phase 2 · J) — never throws.
    const { getCreatorsService } = await import('./creators');
    await getCreatorsService(this.supabaseService).refreshStats(userId);

    // Academic feed (Phase 3 · M): announce the publish to the creator's
    // followers. Best-effort — the listing is already live.
    const { getActivityFeedService } = await import('./activityFeed');
    await getActivityFeedService(this.supabaseService).record({
      actorId: userId,
      verb: 'published_pack',
      objectType: 'listing',
      objectId: listing.id,
      audienceType: 'followers',
      courseId: (listing as { course_id?: string | null }).course_id ?? null,
      payload: {
        title: (listing as { title?: string }).title ?? null,
        priceKobo: (listing as { price_kobo?: number }).price_kobo ?? null,
      },
    });

    return { listing, pack: { listingId: pack.listing_id, packId: pack.id, version: pack.version } };
  }

  private async getPackForListing(listingId: string) {
    const { data, error } = await this.db
      .from('marketplace_study_packs')
      .select('id, listing_id, version, content, counts, course_id')
      .eq('listing_id', listingId)
      .maybeSingle();
    if (error) throw error;
    return data as
      | {
          id: string;
          listing_id: string;
          version: number;
          content: StudyPackContent;
          counts: StudyPackCounts;
          course_id: string | null;
        }
      | null;
  }

  private async getEntitlement(listingId: string, userId: string) {
    const { data } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('id, delivered_refs, version_at_download')
      .eq('listing_id', listingId)
      .eq('user_id', userId)
      .maybeSingle();
    return data as
      | { id: string; delivered_refs: DeliveredRefs | null; version_at_download: number }
      | null;
  }

  /**
   * Record ownership and materialise the pack into the buyer's data. Idempotent:
   * the entitlement is unique per (listing, user), the bundle id is
   * deterministic, and the deck/note ids are remembered in delivered_refs so a
   * re-delivery refreshes them in place instead of duplicating.
   */
  async grantEntitlement(
    listingId: string,
    userId: string,
    orderId: string | null,
  ): Promise<{ bundleId: string | null; deckId: string | null; noteId: string | null; version: number }> {
    return withDeliveryLock(`${listingId}:${userId}`, () =>
      this.grantEntitlementInner(listingId, userId, orderId),
    );
  }

  private async grantEntitlementInner(
    listingId: string,
    userId: string,
    orderId: string | null,
  ): Promise<{ bundleId: string | null; deckId: string | null; noteId: string | null; version: number }> {
    const pack = await this.getPackForListing(listingId);
    if (!pack) throw new PublicError('Study pack content not found for this listing');

    // Ensure the entitlement row exists first (ignoreDuplicates protects a
    // prior order_id from being nulled on re-download/self-heal).
    const { error: entitlementError } = await this.db
      .from('marketplace_question_bank_entitlements')
      .upsert(
        {
          listing_id: listingId,
          user_id: userId,
          order_id: orderId,
          version_at_download: pack.version,
        },
        { onConflict: 'listing_id,user_id', ignoreDuplicates: true },
      );
    if (entitlementError) throw entitlementError;

    // Re-read delivered_refs AFTER the upsert (and inside the delivery lock) so
    // an earlier delivery's deck/note ids are always seen — sequential and
    // in-process-concurrent re-deliveries reuse them instead of duplicating.
    // This read is the linchpin of idempotency: a swallowed error here would
    // read prior={} and re-mint a duplicate deck/note, so it must THROW (the
    // caller — download/webhook/restore — retries) rather than proceed blind.
    const { data: current, error: reReadError } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('delivered_refs')
      .eq('listing_id', listingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (reReadError) throw reReadError;
    const prior = (current?.delivered_refs as DeliveredRefs) || {};

    let refs: DeliveredRefs;
    try {
      refs = await this.deliverStudyPack(userId, listingId, pack, prior);
    } catch (err) {
      // A part-way delivery already put real rows in the buyer's library. Record
      // them before the error escapes so the caller's retry reuses them; the
      // version is deliberately left alone, since a half-delivered pack is not
      // the version the buyer holds.
      const partial = (err as { partialRefs?: DeliveredRefs }).partialRefs;
      if (partial && (partial.bundleId || partial.deckId || partial.noteId)) {
        const { error: partialError } = await this.db
          .from('marketplace_question_bank_entitlements')
          .update({ delivered_refs: partial })
          .eq('listing_id', listingId)
          .eq('user_id', userId);
        if (partialError) {
          logger.error('Could not record partial study pack delivery (may duplicate on retry)', {
            listingId,
            userId,
            error: partialError.message,
          });
        }
      }
      throw err;
    }

    // Persist where each part landed + the version now held. This write is
    // authoritative for idempotency (a lost write would re-duplicate on the
    // next restore), so retry once and log at error level on failure.
    const persistRefs = async () =>
      this.db
        .from('marketplace_question_bank_entitlements')
        .update({ version_at_download: pack.version, delivered_refs: refs })
        .eq('listing_id', listingId)
        .eq('user_id', userId);
    let { error: refsError } = await persistRefs();
    if (refsError) ({ error: refsError } = await persistRefs());
    if (refsError) {
      logger.error('Could not record study pack delivery refs (may re-duplicate on restore)', {
        listingId,
        userId,
        error: refsError.message,
      });
    }

    // Creator counters: a new owner changes the seller's learners-helped.
    try {
      const { data: listing } = await this.db
        .from('marketplace_listings')
        .select('user_id')
        .eq('id', listingId)
        .maybeSingle();
      const sellerId = (listing as { user_id?: string } | null)?.user_id;
      if (sellerId && sellerId !== userId) {
        const { getCreatorsService } = await import('./creators');
        await getCreatorsService(this.supabaseService).refreshStats(sellerId);

        // North-star metric (Phase 3 · O): a creator's pack reaching a new
        // student IS the learning connection. Actor = the creator who helped.
        const { getLearningConnectionsService } = await import('./learningConnections');
        await getLearningConnectionsService(this.supabaseService).record({
          actorId: sellerId,
          beneficiaryId: userId,
          kind: 'pack_entitled',
          objectType: 'listing',
          objectId: listingId,
        });
      }
    } catch {
      /* counters are best-effort; delivery already succeeded */
    }

    return {
      bundleId: refs.bundleId ?? null,
      deckId: refs.deckId ?? null,
      noteId: refs.noteId ?? null,
      version: pack.version,
    };
  }

  private assembleGuideNoteBody(content: StudyPackContent): string {
    const parts: string[] = [];
    const guide = content.guide?.markdown?.trim();
    if (guide) parts.push(guide);
    for (const summary of content.summaries || []) {
      const md = summary?.markdown?.trim();
      if (!md) continue;
      const heading = summary.title ? `## ${summary.title}\n\n` : '';
      parts.push(`${heading}${md}`);
    }
    return parts.join('\n\n');
  }

  /**
   * Copy the pack into the buyer's own data. Returns the refs to persist. Each
   * part is optional; a re-delivery reuses the deck/note it made last time.
   */
  private async deliverStudyPack(
    userId: string,
    listingId: string,
    pack: {
      content: StudyPackContent;
      counts: StudyPackCounts;
      version: number;
      course_id: string | null;
    },
    prior: DeliveredRefs,
  ): Promise<DeliveredRefs> {
    // topic_id rides on the listing, not the pack row (marketplace_study_packs
    // has no such column). Retried without it when the migration is unapplied,
    // so an undelivered purchase can never be the cost of a missing column.
    let listing: { title?: string; course_id?: string | null; topic_id?: string | null } | null = null;
    {
      const withTopic = await this.db
        .from('marketplace_listings')
        .select('title, course_id, topic_id')
        .eq('id', listingId)
        .maybeSingle();
      if (withTopic.error && isMissingTopicColumn(withTopic.error)) {
        const { data } = await this.db
          .from('marketplace_listings')
          .select('title, course_id')
          .eq('id', listingId)
          .maybeSingle();
        listing = data;
      } else {
        listing = withTopic.data;
      }
    }
    const title = listing?.title || 'Study pack';
    const courseId = pack.course_id || null;
    // A topic only means something inside its course, and the pack's course is
    // what the delivered artefacts are filed under. The listing's topic was
    // validated against the *listing's* course, and only that one: editing a
    // published listing onto another course moves course_id + topic_id together
    // and leaves marketplace_study_packs.course_id where it was. Pairing the two
    // blindly would file the buyer's deck under a topic from a different course
    // and make createNote reject the delivery outright, so the topic only counts
    // while the listing still sits in the course being delivered into.
    const topicId =
      courseId && (listing?.course_id ?? null) === courseId ? listing?.topic_id ?? null : null;
    const refs: DeliveredRefs = { version: pack.version };

    try {
      // 1. Questions -> offline bundle. Always overwrite the deterministic bundle
      // (upsert) — including with an empty set when a new version drops all
      // questions — so a buyer never keeps removed questions. The bundle id is
      // recorded whenever it exists so update-pulls stay honest.
      const questions = (pack.content?.questions || []) as Array<{ type?: string }>;
      if (questions.length > 0 || prior.bundleId) {
        const bundleId = this.bundleIdForListing(listingId);
        await this.supabaseService.saveOfflineBundle(userId, {
          bundleId,
          config: {
            numberOfQuestions: questions.length,
            allowedQuestionTypes: Array.from(
              new Set(questions.map((q) => q?.type).filter(Boolean)),
            ),
            groupName: title,
            source: 'marketplace',
            courseId,
          },
          questions,
          groupName: title,
          courseId,
          downloadedAt: new Date().toISOString(),
        });
        refs.bundleId = bundleId;
      }

      // 2. Flashcards -> a deck (created once, replaced in place thereafter).
      const flashcards = (pack.content?.flashcards || []) as StudyPackFlashcard[];
      if (flashcards.length > 0) {
        refs.deckId = await this.deliverDeck(userId, prior.deckId, title, courseId, topicId, flashcards);
      } else if (prior.deckId) {
        // A new version dropped its flashcards: clear the delivered deck's cards
        // (best-effort — the buyer may have deleted the deck).
        try {
          await this.supabaseService.replaceDeckCards(prior.deckId, []);
          refs.deckId = prior.deckId;
        } catch {
          // deck gone; nothing to clear
        }
      }

      // 3. Guide + summaries -> a note (created once, body rewritten thereafter).
      // A new version that drops the guide clears the delivered note's body rather
      // than leaving stale content behind.
      const noteBody = this.assembleGuideNoteBody(pack.content);
      if (noteBody.trim() || prior.noteId) {
        refs.noteId = await this.deliverNote(userId, listingId, prior.noteId, title, courseId, topicId, noteBody);
      }
    } catch (err) {
      // Every step above mints real rows in the buyer’s library and records
      // where each landed in `refs`. A failure part-way has to carry that record
      // out with it — the caller persists it before rethrowing — or the next
      // retry reads prior={} and mints a duplicate deck/note every single time.
      if (err && typeof err === 'object') {
        (err as { partialRefs?: DeliveredRefs }).partialRefs = refs;
      }
      throw err;
    }

    return refs;
  }

  /** Create-once / replace-in-place a delivered deck, recreating if the buyer deleted it. */
  private async deliverDeck(
    userId: string,
    priorDeckId: string | undefined,
    title: string,
    courseId: string | null,
    topicId: string | null,
    flashcards: StudyPackFlashcard[],
  ): Promise<string | undefined> {
    if (priorDeckId) {
      try {
        await this.supabaseService.replaceDeckCards(priorDeckId, flashcards);
        return priorDeckId;
      } catch (err) {
        // The buyer may have deleted the deck (FK gone); fall through to recreate.
        logger.warn('Study pack deck refresh failed; recreating', {
          deckId: priorDeckId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Validate the topic through the ONE resolver every other artefact write
    // funnels through (SupabaseService.resolveArtefactTopic →
    // CourseTopicsService.resolveForArtefact). The caller already drops a topic
    // whose listing has moved courses, but it trusts the listing's stored
    // topic_id blindly; the resolver additionally proves that id is genuinely a
    // topic OF this course, so a stale or cross-course id can never be filed
    // onto the buyer's deck.
    //
    // DELIVER UNFILED RATHER THAN FAIL. A rejected topic must NOT abort the
    // delivery: the buyer has paid, and which row of a syllabus their deck sits
    // under is cosmetic next to receiving the deck at all. Throwing here is how
    // the last round's blocker behaved — a seller edit that desynced the pair
    // permanently broke paid delivery. Same reasoning as the missing-column
    // retry below: a half-filed deck beats a failed delivery.
    let resolvedTopicId: string | null | undefined = null;
    try {
      resolvedTopicId = await this.supabaseService.resolveArtefactTopic({ topicId, courseId });
    } catch (err) {
      logger.warn('Study pack topic rejected; delivering the deck unfiled', {
        courseId,
        topicId,
        error: err instanceof Error ? err.message : String(err),
      });
      resolvedTopicId = null;
    }
    const created = await this.supabaseService.importDeck(
      { deck: { name: title, description: `Flashcards from “${title}”` }, flashcards },
      userId,
    );
    const deckId = created?.deck?.id as string | undefined;
    // importDeck does not set course_id; file the deck under the pack's course
    // (and its resolved topic). Retried without the topic when that column is
    // missing — a half-filed deck beats a failed delivery.
    if (deckId && courseId) {
      const patch: Record<string, unknown> = { course_id: courseId };
      if (resolvedTopicId) patch.topic_id = resolvedTopicId;
      const { error } = await this.db.from('decks').update(patch).eq('id', deckId);
      if (error && isMissingTopicColumn(error)) {
        await this.db.from('decks').update({ course_id: courseId }).eq('id', deckId);
      }
    }
    return deckId ?? priorDeckId;
  }

  /** Create-once / rewrite-body a delivered note, recreating if the buyer deleted it. */
  private async deliverNote(
    userId: string,
    listingId: string,
    priorNoteId: string | undefined,
    title: string,
    courseId: string | null,
    topicId: string | null,
    body: string,
  ): Promise<string | undefined> {
    if (priorNoteId) {
      try {
        await this.supabaseService.updateNote(userId, priorNoteId, { body });
        return priorNoteId;
      } catch (err) {
        // The buyer may have deleted the note; re-create it.
        logger.warn('Study pack note update failed; recreating', {
          listingId,
          noteId: priorNoteId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const note = await this.supabaseService.createNote(userId, {
      title,
      body,
      sourceType: 'import',
      courseId,
      // createNote resolves this against courseId and drops it when the
      // column is missing, so no fallback is needed here.
      topicId,
    });
    return (note?.id as string | undefined) ?? priorNoteId;
  }

  /** Free packs (and re-downloads by existing owners). */
  async downloadStudyPack(
    listingId: string,
    userId: string,
    options: { surface?: LearningSurface } = {},
  ) {
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing || listing.listing_kind !== 'study_pack') {
      throw new PublicError('Study pack not found');
    }

    const isOwnerSeller = listing.user_id === userId;
    if (!isOwnerSeller && listing.status !== 'active') {
      throw new PublicError('This study pack is not available');
    }

    const existing = await this.getEntitlement(listingId, userId);

    const isFree = listing.price == null || Number(listing.price) <= 0;
    if (!existing && !isFree && !isOwnerSeller) {
      throw new PublicError('Purchase this study pack to download it');
    }

    const granted = await this.grantEntitlement(listingId, userId, null);

    await recordLearningEvent(this.supabaseService, {
      userId,
      eventType: 'pack_downloaded',
      targetType: 'listing',
      targetId: listingId,
      listingId,
      courseId: (listing as { course_id?: string | null }).course_id ?? null,
      surface: options.surface ?? 'api',
    });

    return granted;
  }

  /**
   * Re-materialize a buyer's owned packs (new device, reinstall), and self-heal:
   * paid digital orders that somehow missed fulfillment get granted here.
   */
  async restoreEntitlements(userId: string): Promise<{ restored: number }> {
    // Bounded by the user's own rows: read their entitlements, then keep only
    // the ones that are study packs (question banks are handled by their own
    // restore). Never scan the whole packs table.
    const { data: entitlements, error } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('listing_id')
      .eq('user_id', userId);
    if (error) throw error;
    const entitledListingIds = Array.from(
      new Set((entitlements || []).map((e: any) => String(e.listing_id))),
    );

    // Candidate listing ids that are digital orders the user paid for.
    const { data: orders } = await this.db
      .from('marketplace_orders')
      .select('id, listing_id, status')
      .eq('buyer_id', userId)
      .in('status', ['paid', 'ready_for_pickup', 'buyer_confirmed', 'completed']);
    const orderListingIds = (orders || []).map((o: any) => String(o.listing_id));

    // Which of those listing ids are actually study packs.
    const candidateIds = Array.from(new Set([...entitledListingIds, ...orderListingIds]));
    if (candidateIds.length === 0) return { restored: 0 };
    const { data: packs } = await this.db
      .from('marketplace_study_packs')
      .select('listing_id')
      .in('listing_id', candidateIds);
    const packListingIds = new Set((packs || []).map((p: any) => String(p.listing_id)));
    if (packListingIds.size === 0) return { restored: 0 };

    const owned = new Set(entitledListingIds.filter((id) => packListingIds.has(id)));
    // Self-heal from completed/paid digital orders lacking an entitlement.
    const missedOrders = (orders || []).filter(
      (o: any) => packListingIds.has(String(o.listing_id)) && !owned.has(String(o.listing_id)),
    );

    let restored = 0;
    for (const listingId of owned) {
      try {
        await this.grantEntitlement(listingId, userId, null);
        restored += 1;
      } catch (err) {
        logger.warn('Study pack restore failed for listing', {
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
        logger.warn('Study pack self-heal failed for order', {
          orderId: order.id,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { restored };
  }

  /**
   * Replace a published pack's content and bump its version. Buyers keep the
   * snapshot they downloaded until they pull the update — nothing is pushed.
   */
  async updateStudyPackContent(
    listingId: string,
    userId: string,
    rawContent: StudyPackContent,
    provenanceInput: UpdateStudyPackProvenance = {},
  ): Promise<{ version: number; counts: StudyPackCounts }> {
    const provenance = normalizePublishProvenance(provenanceInput);
    const { content, counts } = this.normalizeContent(rawContent);

    const pack = await this.getPackForListing(listingId);
    if (!pack) throw new PublicError('Study pack not found');

    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing) throw new PublicError('Listing not found');
    if (listing.user_id !== userId) {
      throw new PublicError('Only the seller can update this study pack');
    }
    if (isMarketplaceListingModerated(listing.status)) {
      throw Object.assign(
        new PublicError(
          'This listing was taken down by Lantern moderation and its study pack cannot be updated.',
        ),
        { statusCode: 403 },
      );
    }

    const nextVersion = Number(pack.version) + 1;
    const { data: updatedRows, error } = await this.db
      .from('marketplace_study_packs')
      .update({
        content,
        counts,
        version: nextVersion,
        updated_at: new Date().toISOString(),
        rights_attested_at: provenance.rights_attested_at,
        rights_attestation_version: provenance.rights_attestation_version,
        ...(provenanceInput.aiAssisted !== undefined ? { ai_assisted: provenance.ai_assisted } : {}),
        ...(provenanceInput.sourcesCited !== undefined ? { sources_cited: provenance.sources_cited } : {}),
      })
      .eq('listing_id', listingId)
      .eq('version', pack.version) // optimistic lock against concurrent updates
      .select('listing_id');
    if (error) throw error;
    if (!updatedRows || updatedRows.length === 0) {
      throw new PublicError('This study pack was just updated elsewhere — reload and try again');
    }

    // Keep the browse-card counts honest.
    const fields = listing.category_specific_fields || {};
    await this.db
      .from('marketplace_listings')
      .update({
        category_specific_fields: { ...fields, counts, digital: true },
        updated_at: new Date().toISOString(),
      })
      .eq('id', listingId);

    // Refresh the seller's own delivered copy — but only if they had already
    // downloaded it. Never mint a fresh entitlement here, which would make the
    // seller "own" (and see in Purchases) their own listing.
    const sellerEntitlement = await this.getEntitlement(listingId, userId);
    if (sellerEntitlement) {
      try {
        await this.grantEntitlement(listingId, userId, null);
      } catch {
        // best-effort; the canonical snapshot is already stored
      }
    }

    return { version: nextVersion, counts };
  }

  /**
   * Public sample of a pack: TOC, the first summary (truncated), a few card
   * fronts and a few answer-stripped questions. Safe for guests.
   */
  async getStudyPackPreview(listingId: string, viewerId?: string) {
    const listing = await this.supabaseService.getMarketplaceListingById(listingId);
    if (!listing || listing.listing_kind !== 'study_pack') {
      throw new PublicError('Study pack not found');
    }

    const pack = await this.getPackForListing(listingId);
    if (!pack) throw new PublicError('Study pack not found');

    let owned = false;
    if (viewerId) {
      const entitlement = await this.getEntitlement(listingId, viewerId);
      owned = !!entitlement;
    }

    const { buildQuestionBankPreview } = await import('../utils/questionBankPreview');
    const content = pack.content || {};
    const firstSummary = (content.summaries || [])[0];
    const summaryPreview = firstSummary?.markdown
      ? String(firstSummary.markdown).slice(0, SUMMARY_PREVIEW_CHARS)
      : null;

    return {
      title: listing.title,
      counts: pack.counts,
      toc: content.guide?.toc || [],
      summaryPreview,
      flashcardFronts: (content.flashcards || [])
        .slice(0, FLASHCARD_FRONT_PREVIEW_LIMIT)
        .map((c) => c?.front)
        .filter((f): f is string => typeof f === 'string' && f.length > 0),
      questions: buildQuestionBankPreview(content.questions, STUDY_PACK_PREVIEW_QUESTIONS),
      owned,
      isSeller: listing.user_id === viewerId,
      version: pack.version,
    };
  }

  /** Packs published by this user (drives the republish-as-update UI). */
  async listMyStudyPacks(userId: string) {
    const { data, error } = await this.db
      .from('marketplace_study_packs')
      .select('listing_id, version, counts, course_id, updated_at')
      .eq('published_by', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const listingIds = (data || []).map((p: any) => String(p.listing_id));
    if (listingIds.length === 0) return [];
    const { data: listings } = await this.db
      .from('marketplace_listings')
      .select('id, title, price, status')
      .in('id', listingIds);
    const byId = new Map((listings || []).map((l: any) => [String(l.id), l]));
    return (data || []).map((p: any) => ({
      listingId: p.listing_id,
      version: p.version,
      counts: p.counts,
      courseId: p.course_id,
      title: byId.get(String(p.listing_id))?.title || 'Study pack',
      price: byId.get(String(p.listing_id))?.price ?? null,
      status: byId.get(String(p.listing_id))?.status || 'active',
    }));
  }

  /** Owned packs whose published version is newer than the copy the user holds. */
  async listAvailableUpdates(userId: string) {
    // Bounded by the user's entitlements (shared with question banks); the
    // packs query is filtered to those listing ids, so only pack rows return.
    const { data: entitlements, error } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('listing_id, version_at_download')
      .eq('user_id', userId);
    if (error) throw error;
    if (!entitlements || entitlements.length === 0) return [];

    const heldVersions = new Map(
      entitlements.map((e: any) => [String(e.listing_id), Number(e.version_at_download)]),
    );
    const { data: packs } = await this.db
      .from('marketplace_study_packs')
      .select('listing_id, version, counts')
      .in('listing_id', Array.from(heldVersions.keys()));

    return (packs || [])
      .filter((p: any) => Number(p.version) > (heldVersions.get(String(p.listing_id)) ?? 1))
      .map((p: any) => ({
        listingId: p.listing_id,
        bundleId: this.bundleIdForListing(String(p.listing_id)),
        version: p.version,
        counts: p.counts,
      }));
  }

  /**
   * Unified buyer library across every digital kind (question banks + study
   * packs), joined from the shared entitlements table. Drives the Purchases
   * screen and mobile update-pull (K).
   */
  async listPurchases(userId: string) {
    const { data: entitlements, error } = await this.db
      .from('marketplace_question_bank_entitlements')
      .select('listing_id, version_at_download, delivered_refs, created_at')
      .eq('user_id', userId);
    if (error) throw error;
    if (!entitlements || entitlements.length === 0) return [];

    const listingIds = Array.from(new Set(entitlements.map((e: any) => String(e.listing_id))));
    const { data: listings } = await this.db
      .from('marketplace_listings')
      .select('id, title, user_id, listing_kind, course_id, price, status')
      .in('id', listingIds);
    const listingById = new Map((listings || []).map((l: any) => [String(l.id), l]));

    const [{ data: banks }, { data: packs }, sellerNames] = await Promise.all([
      this.db.from('marketplace_question_banks').select('listing_id, version').in('listing_id', listingIds),
      this.db.from('marketplace_study_packs').select('listing_id, version').in('listing_id', listingIds),
      (async () => {
        const sellerIds = Array.from(
          new Set((listings || []).map((l: any) => String(l.user_id)).filter(Boolean)),
        );
        if (sellerIds.length === 0) return new Map<string, string>();
        const { data: profiles } = await this.db
          .from('profiles')
          .select('id, name')
          .in('id', sellerIds);
        return new Map((profiles || []).map((p: any) => [String(p.id), p.name as string]));
      })(),
    ]);
    const versionByListing = new Map<string, number>();
    for (const b of banks || []) versionByListing.set(String(b.listing_id), Number(b.version));
    for (const p of packs || []) versionByListing.set(String(p.listing_id), Number(p.version));

    return entitlements
      .map((e: any) => {
        const listing = listingById.get(String(e.listing_id));
        if (!listing) return null; // listing hard-deleted; skip
        const version = versionByListing.get(String(e.listing_id)) ?? Number(e.version_at_download);
        const versionAtDownload = Number(e.version_at_download);
        return {
          listingId: String(e.listing_id),
          kind: listing.listing_kind as 'question_bank' | 'study_pack',
          title: listing.title || 'Purchase',
          sellerId: listing.user_id,
          sellerName: sellerNames.get(String(listing.user_id)) || 'Seller',
          version,
          versionAtDownload,
          updateAvailable: version > versionAtDownload,
          deliveredRefs: (e.delivered_refs as DeliveredRefs) || {},
          courseId: listing.course_id ?? null,
          purchasedAt: e.created_at,
        };
      })
      .filter(Boolean);
  }

  /** True when this listing is a study pack (used by the payments path). */
  async isStudyPackListing(listingId: string): Promise<boolean> {
    const { data } = await this.db
      .from('marketplace_study_packs')
      .select('id')
      .eq('listing_id', listingId)
      .maybeSingle();
    return !!data;
  }
}

let service: MarketplaceStudyPacksService | null = null;

export function getMarketplaceStudyPacksService(
  supabaseService: SupabaseService,
): MarketplaceStudyPacksService {
  if (!service) service = new MarketplaceStudyPacksService(supabaseService);
  return service;
}
