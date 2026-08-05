import { createClient } from "@supabase/supabase-js";
import {
  DatabaseConfig,
  User,
  Group,
  Message,
  TestResult,
  Notification,
} from "../types";
import { cacheService } from "./cache";
import { logger } from "../utils/logger";
import { buildFlashcardUpdateData } from "../utils/flashcardUpdate";
import {
  buildMarketplaceBudgetTxIds,
  buildManualSaleBudgetTxId,
  buildMarketplacePurchaseDescription,
  buildMarketplaceSaleDescription,
  MARKETPLACE_BUDGET_CATEGORIES,
  MARKETPLACE_BUDGET_TYPES,
} from "@lantern/shared/utils/server";
import {
  checkAndAwardBadges,
  initialUserStats,
  resolveQuestionStatusAfterVote,
} from "@lantern/shared/utils/testHelpers";
import { mapUserStatsFromApi } from "@lantern/shared/utils/apiMappers";
import { computeStudyStreak } from "@lantern/shared/utils/activity";
import { calculateFsrsData } from "@lantern/shared/utils/fsrs";
import {
  getSrsMaxInterval,
  normalizeUserSettings,
} from "@lantern/shared/settings";
import {
  MARKETPLACE_DEFAULT_COUNTRY,
  MARKETPLACE_DEFAULT_CURRENCY,
} from "@lantern/shared/marketplace";
import {
  isPrivateStorageBucket,
  parseStorageObjectUrl,
  storageThumbPath,
} from "@lantern/shared/utils/storageUrl";
import {
  resolveThreadRootId,
  computeDmReceiptStatus,
  computeGroupReceipt,
} from "@lantern/shared/utils/chatMedia";
import {
  clearDmHistoryClearedAtForUser,
  effectiveDmUnreadFloor,
  filterMessagesAfterDmHistoryCutoff,
  readDmHistoryClearedAt,
  withDmHistoryClearedAt,
} from "@lantern/shared/utils/dmHistoryCutoff";

function extractMentionUsernames(text?: string | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(/@([a-zA-Z0-9_]{2,32})\b/g)) {
    const username = match[1];
    if (username) found.add(username.toLowerCase());
  }
  return [...found];
}
import {
  assertImageMagicBytes,
  clampSignedUrlTtl,
  detectImageMime,
} from "../utils/fileValidation";
import { VersionConflictError } from "../utils/versionConflict";
import { buildNoteStoragePath } from "./noteFiles";
import { mapNoteCommentRow, NOTE_COMMENT_SELECT } from "./noteCommentMapping";
import {
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  processImageForUpload,
} from "./imageProcessing";

type UserStats = typeof initialUserStats;

type GamificationSyncResult = {
  points: number;
  badges: User["badges"];
  stats: UserStats;
  awardedBadges: User["badges"];
};

type ProfileSenderRow = {
  id?: string;
  name?: string;
  username?: string;
  avatar_url?: string;
};

export type ChatMessageMutationStatus =
  | "ok"
  | "invalid_content"
  | "invalid_kind"
  | "not_found"
  | "forbidden"
  | "not_editable"
  | "not_removable"
  | "removed"
  | "expired";

export type ChatMessageMutationResult = {
  status: ChatMessageMutationStatus;
  message?: Record<string, unknown>;
};

function mapProfileSender(
  profile: ProfileSenderRow | null | undefined,
  senderId: string,
) {
  return {
    id: profile?.id || senderId,
    name: profile?.name || "Unknown",
    username: profile?.username || undefined,
    avatarUrl: profile?.avatar_url,
    points: 0,
    badges: [],
    stats: {},
  };
}

function resolveNestedProfile(profiles: unknown): ProfileSenderRow | null {
  if (Array.isArray(profiles)) return (profiles[0] as ProfileSenderRow) ?? null;
  return (profiles as ProfileSenderRow) ?? null;
}

/** Map a profiles table row (snake_case) to the API User shape (with snake_case aliases). */
function mapProfileRowToUser(
  row: Record<string, unknown> | null | undefined,
): User | null {
  if (!row || typeof row !== "object") return null;
  const avatarUrl = (row.avatar_url as string | undefined) || undefined;
  const mapped = {
    id: String(row.id),
    name: String(row.name || ""),
    username: (row.username as string | undefined) || undefined,
    firstName: (row.first_name as string | undefined) || undefined,
    lastName: (row.last_name as string | undefined) || undefined,
    email: (row.email as string | undefined) || undefined,
    phoneNumber: (row.phone as string | undefined) || undefined,
    avatarUrl,
    points: typeof row.points === "number" ? row.points : 0,
    badges: Array.isArray(row.badges) ? row.badges : [],
    stats: row.stats ?? {},
    settings: row.settings ?? {},
    settingsVersion:
      typeof row.settings_version === "number"
        ? row.settings_version
        : Number(row.settings_version) || 1,
    testPresets: Array.isArray(row.test_presets) ? row.test_presets : [],
    test_presets: Array.isArray(row.test_presets) ? row.test_presets : [],
    // Aliases for clients that still read snake_case from GET /users/:id
    avatar_url: avatarUrl,
    phone: (row.phone as string | undefined) || undefined,
    first_name: (row.first_name as string | undefined) || undefined,
    last_name: (row.last_name as string | undefined) || undefined,
  };
  return mapped as User;
}

function buildProfileUpsertRow(
  profile: Partial<User> & {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    avatar_url?: string;
  },
  options?: { allowGamificationFields?: boolean },
): Record<string, unknown> {
  const allowGamification = options?.allowGamificationFields === true;
  const row: Record<string, unknown> = {
    id: profile.id,
    name: profile.name,
    avatar_url: profile.avatarUrl ?? profile.avatar_url,
    phone: profile.phoneNumber ?? profile.phone,
    points: allowGamification ? (profile.points ?? 0) : 0,
    stats: allowGamification ? (profile.stats ?? {}) : {},
    badges: allowGamification ? (profile.badges ?? []) : [],
    settings: profile.settings ?? {},
    username: profile.username ?? undefined,
    first_name: profile.firstName ?? profile.first_name ?? undefined,
    last_name: profile.lastName ?? profile.last_name ?? undefined,
  };
  if (profile.email) {
    row.email = profile.email;
  }
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  );
}

export class SupabaseService {
  private supabase;
  private supabaseUrl: string;
  private static readonly DEFAULT_GROUP_PAGE_SIZE = 20;
  private static readonly MAX_GROUP_PAGE_SIZE = 50;
  private static readonly DEFAULT_DECK_PAGE_SIZE = 20;
  private static readonly MAX_DECK_PAGE_SIZE = 50;
  private static readonly DEFAULT_FLASHCARD_PAGE_SIZE = 50;
  private static readonly MAX_FLASHCARD_PAGE_SIZE = 100;
  private static readonly DEFAULT_MESSAGE_PAGE_SIZE = 50;
  private static readonly MAX_MESSAGE_PAGE_SIZE = 100;

  private getResponseProfile(profile?: string): "compact" | "full" {
    return profile === "compact" ? "compact" : "full";
  }

  /** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
  private normalizeStorageUrl(url: string): string {
    if (!url) return url;
    const base = this.supabaseUrl.replace(/\/$/, "");
    return url.replace(/https?:\/\/(localhost|127\.0\.0\.1):54321/gi, base);
  }

  resolveStorageReference(
    bucket?: string,
    path?: string,
    url?: string,
  ): { bucket: string; path: string } | null {
    if (bucket && path) return { bucket, path };
    if (!url) return null;
    const parsed = parseStorageObjectUrl(this.normalizeStorageUrl(url));
    return parsed;
  }

  async createSignedStorageUrl(
    bucket: string,
    path: string,
    expiresInSeconds = 60 * 60 * 24,
  ): Promise<string> {
    if (!isPrivateStorageBucket(bucket)) {
      throw new Error(
        "Signing is only allowed for known private storage buckets",
      );
    }
    if (
      !path ||
      path.includes("..") ||
      path.startsWith("/") ||
      path.includes("\\")
    ) {
      throw new Error("Invalid storage path");
    }
    const ttl = clampSignedUrlTtl(expiresInSeconds);
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, ttl);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Failed to create signed URL");
    }
    return this.normalizeStorageUrl(data.signedUrl);
  }

  /**
   * Sign a storage object for display. When variant is `thumb`, prefer the
   * sibling `<path>.thumb.webp` and fall back to the original if missing.
   * ACL checks must always use the original path.
   */
  async createSignedStorageUrlWithVariant(
    bucket: string,
    path: string,
    expiresInSeconds = 60 * 60 * 24,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    if (variant !== "thumb") {
      return this.createSignedStorageUrl(bucket, path, expiresInSeconds);
    }
    const ttl = clampSignedUrlTtl(expiresInSeconds);
    const thumbPath = storageThumbPath(path);
    try {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .createSignedUrls([thumbPath, path], ttl);
      if (!error && data) {
        const thumbResult = data[0];
        const originalResult = data[1];
        const signedUrl =
          (thumbResult && !thumbResult.error && thumbResult.signedUrl) ||
          (originalResult && !originalResult.error && originalResult.signedUrl) ||
          null;
        if (signedUrl) return this.normalizeStorageUrl(signedUrl);
      }
    } catch {
      // Fall through to original-only sign.
    }
    return this.createSignedStorageUrl(bucket, path, expiresInSeconds);
  }

  /**
   * Batch sign display URLs. When variant is `thumb`, prefers sibling thumbs
   * with original fallback (same pattern as marketplace compact cards).
   */
  async signStorageDisplayUrls(
    refs: Array<{ bucket: string; path: string; index: number }>,
    options?: {
      expiresInSeconds?: number;
      variant?: "thumb" | "original";
    },
  ): Promise<Map<number, string>> {
    const ttl = clampSignedUrlTtl(options?.expiresInSeconds);
    const variant = options?.variant || "original";
    const signedByIndex = new Map<number, string>();
    const byBucket = new Map<string, Array<{ index: number; path: string }>>();
    for (const ref of refs) {
      if (!ref.bucket || !ref.path || !isPrivateStorageBucket(ref.bucket)) continue;
      const group = byBucket.get(ref.bucket) || [];
      group.push({ index: ref.index, path: ref.path });
      byBucket.set(ref.bucket, group);
    }

    for (const [bucket, items] of byBucket) {
      try {
        const paths =
          variant === "thumb"
            ? items.flatMap((item) => [storageThumbPath(item.path), item.path])
            : items.map((item) => item.path);
        const { data, error } = await this.supabase.storage
          .from(bucket)
          .createSignedUrls(paths, ttl);
        if (error || !data) continue;
        if (variant === "thumb") {
          items.forEach((item, i) => {
            const thumbResult = data[i * 2];
            const originalResult = data[i * 2 + 1];
            const signedUrl =
              (thumbResult && !thumbResult.error && thumbResult.signedUrl) ||
              (originalResult &&
                !originalResult.error &&
                originalResult.signedUrl) ||
              null;
            if (signedUrl) {
              signedByIndex.set(item.index, this.normalizeStorageUrl(signedUrl));
            }
          });
        } else {
          items.forEach((item, i) => {
            const result = data[i];
            if (result && !result.error && result.signedUrl) {
              signedByIndex.set(
                item.index,
                this.normalizeStorageUrl(result.signedUrl),
              );
            }
          });
        }
      } catch {
        // Bucket publicly readable or transient error; callers fall back to unsigned URLs.
      }
    }
    return signedByIndex;
  }

  async signStorageDisplayUrl(
    url: string,
    expiresInSeconds = 60 * 60 * 24,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    if (!url || url.startsWith("data:")) return url;
    const parsed = parseStorageObjectUrl(this.normalizeStorageUrl(url));
    // Unknown / non-private buckets: never mint service-role signed URLs for them.
    if (!parsed || !isPrivateStorageBucket(parsed.bucket)) {
      return this.normalizeStorageUrl(url);
    }
    return this.createSignedStorageUrlWithVariant(
      parsed.bucket,
      parsed.path,
      expiresInSeconds,
      variant,
    );
  }

  async canAccessStorageObject(
    userId: string | null,
    bucket: string,
    path: string,
  ): Promise<boolean> {
    // SEC-05: deny-by-default — never grant access to unknown / non-allowlisted buckets.
    if (!isPrivateStorageBucket(bucket)) return false;
    if (
      !path ||
      path.includes("..") ||
      path.startsWith("/") ||
      path.includes("\\")
    ) {
      return false;
    }

    const parts = path.split("/").filter(Boolean);
    const ownerId = parts[0];
    if (!ownerId) return false;
    if (userId && ownerId === userId) return true;

    if (bucket === "marketplace-images") {
      if (parts[1] === "listings" && parts[2]) {
        const listingId = parts[2];
        const { data } = await this.supabase
          .from("marketplace_listings")
          .select("id, status, user_id")
          .eq("id", listingId)
          .maybeSingle();
        if (data?.status === "active") return true;
        if (userId && data?.user_id === userId) return true;
      }
      return false;
    }

    if (bucket === "flashcard-images") {
      if (!userId) return false;
      return this.canAccessFlashcardImage(userId, path);
    }

    if (bucket === "question-images") {
      if (!userId) return false;
      return this.canAccessQuestionImage(userId, path);
    }

    if (bucket === "note-files") {
      // Chat attachments: {ownerId}/chat/{groupId}/... or {ownerId}/chat/dm/{threadId}/...
      if (userId && parts[1] === "chat" && parts[2]) {
        if (parts[2] === "dm" && parts[3]) {
          return this.isDmThreadParticipant(parts[3], userId);
        }
        return this.isGroupMember(parts[2], userId);
      }
      return false;
    }

    if (bucket === "profile-avatars") {
      if (!userId) return false;
      // Public/friends visibility, or conversation peers (DM / shared group) for chat bubbles.
      if (await this.isProfileVisibleToViewer(userId, ownerId)) return true;
      return this.canViewPeerChatAvatar(userId, ownerId);
    }

    if (bucket === "job-resumes") {
      // Owner-only here (handled above). Employers reach an applicant's resume
      // through the jobs-board application endpoint, which authorizes against
      // the posting rather than the storage path.
      return false;
    }

    if (bucket === "group-avatars") {
      if (!userId) return false;
      // Paths are {groupId}/avatar-...
      const groupId = parts[0];
      if (!groupId) return false;
      return this.isGroupMember(groupId, userId);
    }

    return false;
  }

  private escapeIlikePattern(value: string): string {
    return value.replace(/[%_\\]/g, "\\$&");
  }

  /** True when stored image_url refers to exactly this storage object (not a substring plant). */
  private storageUrlMatchesObject(
    imageUrl: string | null | undefined,
    bucket: string,
    path: string,
  ): boolean {
    if (!imageUrl) return false;
    if (imageUrl === path || imageUrl === `${bucket}/${path}`) return true;
    const parsed = parseStorageObjectUrl(imageUrl);
    return !!parsed && parsed.bucket === bucket && parsed.path === path;
  }

  /**
   * True when the user may read a flashcard image.
   * Requires an exact object reference on a deck the user can read, and that the
   * storage path owner is authorized to edit that deck (blocks confused-deputy URL planting).
   */
  private async canAccessFlashcardImage(
    userId: string,
    path: string,
  ): Promise<boolean> {
    const pathOwner = path.split("/")[0];
    if (!pathOwner) return false;

    const escapedPath = this.escapeIlikePattern(path);
    const { data: cards, error } = await this.supabase
      .from("flashcards")
      .select("deck_id, image_url")
      .not("image_url", "is", null)
      .ilike("image_url", `%${escapedPath}%`)
      .limit(50);

    if (error) throw error;
    if (!cards?.length) return false;

    const deckIds = [
      ...new Set(
        cards
          .filter((c) =>
            this.storageUrlMatchesObject(c.image_url, "flashcard-images", path),
          )
          .map((c) => c.deck_id)
          .filter(Boolean),
      ),
    ];

    for (const deckId of deckIds) {
      const canRead = await this.verifyDeckAccess(userId, deckId, "read");
      if (!canRead) continue;
      // Path owner must be an editor/owner of the referencing deck — not merely mentioned in image_url.
      if (await this.verifyDeckAccess(pathOwner, deckId, "edit")) return true;
    }
    return false;
  }

  /**
   * True when the image is on a group message the user can see, and the uploader
   * (path owner) is also a member of that group (blocks URL planting).
   */
  private async canAccessQuestionImage(
    userId: string,
    path: string,
  ): Promise<boolean> {
    const pathOwner = path.split("/")[0];
    if (!pathOwner) return false;

    const escapedPath = this.escapeIlikePattern(path);
    const { data: rows, error } = await this.supabase
      .from("messages")
      .select("group_id, image_url")
      .not("image_url", "is", null)
      .ilike("image_url", `%${escapedPath}%`)
      .limit(50);

    if (error) throw error;
    if (!rows?.length) return false;

    const groupIds = [
      ...new Set(
        rows
          .filter((r) =>
            this.storageUrlMatchesObject(r.image_url, "question-images", path),
          )
          .map((r) => r.group_id)
          .filter(Boolean),
      ),
    ];

    for (const groupId of groupIds) {
      if (!(await this.isGroupMember(groupId, userId))) continue;
      if (await this.isGroupMember(groupId, pathOwner)) return true;
    }
    return false;
  }

  private async normalizeListingRecordAsync(listing: any): Promise<any> {
    const base = this.normalizeListingRecord(listing);
    if (!base || !Array.isArray(base.images)) return base;
    return {
      ...base,
      images: await Promise.all(
        base.images.map((imageUrl: string) =>
          this.signStorageDisplayUrl(imageUrl),
        ),
      ),
    };
  }

  private normalizeListingRecord(listing: any): any {
    if (!listing) return listing;
    const salePrice =
      listing.sale_price != null ? Number(listing.sale_price) : null;
    const onSale =
      salePrice != null &&
      !!listing.sale_ends_at &&
      new Date(listing.sale_ends_at) > new Date();
    const base = !Array.isArray(listing.images)
      ? listing
      : {
          ...listing,
          images: listing.images.map((url: string) =>
            this.normalizeStorageUrl(url),
          ),
        };
    return {
      ...base,
      effective_price: onSale ? salePrice : Number(listing.price) || 0,
      is_on_sale: onSale,
    };
  }

  private normalizeInquiryRecord(inquiry: any): any {
    if (!inquiry) return inquiry;
    return {
      ...inquiry,
      listing: inquiry.listing
        ? this.normalizeListingRecord(inquiry.listing)
        : inquiry.listing,
    };
  }

  private normalizeFavoriteRecord(favorite: any): any {
    if (!favorite) return favorite;
    return {
      ...favorite,
      listing: favorite.listing
        ? this.normalizeListingRecord(favorite.listing)
        : favorite.listing,
    };
  }

  private normalizeOfferRecord(offer: any): any {
    if (!offer) return offer;
    return {
      ...offer,
      listing: offer.listing
        ? this.normalizeListingRecord(offer.listing)
        : offer.listing,
    };
  }

  private normalizeMessageRecord(
    msg: any,
  ): Partial<Message> & { type: "TEXT" | "QUESTION" } {
    const removedAt = msg.removed_at || msg.removedAt || null;
    const isRemoved = !!removedAt;
    const presentationRecord = isRemoved
      ? { ...msg, text: null, question_data: null, image_url: null }
      : msg;
    const parsed = this.parseMessageContent(presentationRecord);
    const imageUrl = presentationRecord.image_url || parsed.imageUrl;
    const type = (parsed.type || msg.type || "TEXT") as "TEXT" | "QUESTION";
    return {
      ...parsed,
      type,
      ...(imageUrl ? { imageUrl: this.normalizeStorageUrl(imageUrl) } : {}),
      editedAt: msg.edited_at || msg.editedAt || undefined,
      removedAt: removedAt || undefined,
      isRemoved,
      replyToMessageId:
        msg.reply_to_message_id || msg.replyToMessageId || undefined,
      mentionedUserIds:
        msg.mentioned_user_ids || msg.mentionedUserIds || undefined,
      replyTo: msg.replyTo || undefined,
      threadRootId: msg.thread_root_id || msg.threadRootId || undefined,
      replyCount:
        typeof msg.replyCount === "number" ? msg.replyCount : undefined,
      receiptStatus: msg.receiptStatus || undefined,
      seenByCount:
        typeof msg.seenByCount === "number" ? msg.seenByCount : undefined,
      seenByTotal:
        typeof msg.seenByTotal === "number" ? msg.seenByTotal : undefined,
    };
  }

  constructor(config: DatabaseConfig) {
    this.supabaseUrl = config.url;
    this.supabase = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  // Get the raw Supabase client for direct operations (RPC calls, etc.)
  getClient() {
    return this.supabase;
  }

  // User/Profile Functions
  async fetchUserProfile(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}:profile`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (error) throw error;
        return data;
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async updateUserProfile(
    userId: string,
    updates: Partial<User>,
  ): Promise<User> {
    const { data, error } = await this.supabase
      .from("profiles")
      .update({
        name: updates.name,
        avatar_url: updates.avatarUrl,
        phone: updates.phoneNumber,
        points: updates.points,
        stats: updates.stats,
        badges: updates.badges,
        settings: updates.settings,
        username: updates.username,
        first_name: updates.firstName,
        last_name: updates.lastName,
      })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate cache
    await cacheService.invalidateUserCache(userId);

    return data;
  }

  async updateExpoPushToken(userId: string, token: string): Promise<void> {
    const { error } = await this.supabase
      .from("profiles")
      .update({ expo_push_token: token })
      .eq("id", userId);

    if (error) throw error;
    await cacheService.invalidateUserCache(userId);
  }

  async clearExpoPushToken(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from("profiles")
      .update({ expo_push_token: null })
      .eq("id", userId);

    if (error) throw error;
    await cacheService.invalidateUserCache(userId);
  }

  private async sendExpoPushForNotification(
    userId: string,
    notification: {
      message: string;
      type?: string;
      link?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<void> {
    const pushTypes = new Set([
      "challenge_invite",
      "challenge_accepted",
      "challenge_result",
      "challenge_opponent_finished",
      "marketplace_inquiry",
      "marketplace_purchase",
      "marketplace_order_update",
      "marketplace_review_prompt",
      "saved_search_match",
      "job_alert",
      "job_application",
      "job_application_status",
      "job_interview",
      "job_interview_response",
      "job_offer",
      "job_offer_response",
      "job_interview_reminder",
      "job_offer_reminder",
      "group_invite",
      "group_message",
      "badge_unlock",
      "test_result",
      "srs_reminder",
      "dm_message",
    ]);
    if (notification.type && !pushTypes.has(notification.type)) return;

    try {
      const { data: profile, error } = await this.supabase
        .from("profiles")
        .select("expo_push_token, settings")
        .eq("id", userId)
        .single();

      if (error || !profile?.expo_push_token) return;

      const { shouldSendExpoPush } =
        await import("../utils/userSettingsPolicy");
      if (!shouldSendExpoPush(profile.settings, notification.type)) return;

      const token = profile.expo_push_token as string;
      if (!token.startsWith("ExponentPushToken")) return;

      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: token,
          title: "Lantern Study",
          body: notification.message,
          data: {
            type: notification.type,
            link: notification.link,
            ...(notification.data || {}),
          },
          sound: "default",
        }),
      });
    } catch (err) {
      logger.warn("Expo push notification failed", { userId, err });
    }
  }

  async createUserProfile(
    profile: Partial<User> & {
      first_name?: string;
      last_name?: string;
      username?: string;
      phone?: string;
      avatar_url?: string;
    },
  ): Promise<User> {
    const row = buildProfileUpsertRow(profile);
    const { data, error } = await this.supabase
      .from("profiles")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // New User Methods for API Routes
  async getUsers(
    options: { page?: number; limit?: number; search?: string } = {},
  ): Promise<User[]> {
    const { page = 1, limit = 20, search } = options;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from("profiles")
      .select("*")
      .range(offset, offset + limit - 1);

    if (search) {
      // Search by name, email, or username
      const escaped = search.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      query = query.or(
        `name.ilike.${pattern},email.ilike.${pattern},username.ilike.${pattern}`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return data || [];
  }

  async getUserById(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        return mapProfileRowToUser(data as Record<string, unknown>);
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async isProfileVisibleToViewer(
    viewerId: string,
    targetId: string,
  ): Promise<boolean> {
    if (viewerId === targetId) return true;
    const { data, error } = await this.supabase.rpc(
      "profile_visible_to_viewer",
      {
        viewer_id: viewerId,
        target_id: targetId,
      },
    );
    if (error) throw error;
    return data === true;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    return mapProfileRowToUser(data as Record<string, unknown>);
  }

  /**
   * Resolve a UUID, @username, email, or display name to a profile id.
   * SEC-06: resolution failures use one generic message (no email/ID existence leak).
   */
  async resolveCollaboratorUserId(identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    const notFound = () => {
      const err = new Error(
        "Unable to add that collaborator. Check the @username and try again.",
      ) as Error & { code?: string };
      err.code = "collaborator_not_found";
      throw err;
    };

    if (!trimmed) {
      const err = new Error(
        "Enter a @username to add a collaborator.",
      ) as Error & { code?: string };
      err.code = "collaborator_invalid";
      throw err;
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(trimmed)) {
      const user = await this.getUserById(trimmed);
      if (!user) notFound();
      return user!.id;
    }

    // Email lookups must not reveal whether the address is registered (SEC-06).
    if (trimmed.includes("@") && trimmed.includes(".")) {
      const user = await this.getUserByEmail(trimmed);
      if (!user) notFound();
      return user!.id;
    }

    const username = trimmed.replace(/^@/, "").toLowerCase();
    const { data: byUsername, error: usernameError } = await this.supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (usernameError) throw usernameError;
    if (byUsername?.id) return byUsername.id;

    const matches = await this.getUsers({ search: trimmed, limit: 5 });
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const err = new Error(
        "Multiple users match that name. Use an exact @username instead.",
      ) as Error & { code?: string };
      err.code = "collaborator_ambiguous";
      throw err;
    }

    notFound();
    return ""; // unreachable
  }

  async createUser(
    userData: Partial<User> & {
      first_name?: string;
      last_name?: string;
      username?: string;
      phone?: string;
      avatar_url?: string;
    },
  ): Promise<User> {
    const row = buildProfileUpsertRow(userData);
    const { data, error } = await this.supabase
      .from("profiles")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  private async invalidateProfilePresentationCaches(
    userId: string,
  ): Promise<void> {
    const { data: memberships, error } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .eq("pending", false);

    if (error) {
      logger.warn(
        "Could not resolve profile group caches; invalidating globally",
        {
          userId,
          error,
        },
      );
      await Promise.all([
        cacheService.deletePattern("group:members:*"),
        cacheService.deletePattern("messages:group:*"),
        cacheService.deletePattern("group:*:messages"),
      ]);
      return;
    }

    const groupIds = [
      ...new Set(
        (memberships || [])
          .map(
            (membership: { group_id?: string | null }) => membership.group_id,
          )
          .filter((groupId): groupId is string => Boolean(groupId)),
      ),
    ];
    await Promise.all(
      groupIds.map((groupId) => cacheService.invalidateGroupCache(groupId)),
    );
  }

  async updateUser(
    userId: string,
    updates: Partial<User> & {
      avatar_url?: string;
      phone?: string;
      first_name?: string;
      last_name?: string;
      test_presets?: any[];
    },
    options: { expectedSettingsVersion?: number } = {},
  ): Promise<User | null> {
    // Build update object, handling both camelCase and snake_case keys
    const updateData: any = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.avatarUrl !== undefined)
      updateData.avatar_url = updates.avatarUrl;
    if (updates.avatar_url !== undefined)
      updateData.avatar_url = updates.avatar_url;
    if (updates.phoneNumber !== undefined)
      updateData.phone = updates.phoneNumber;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.username !== undefined) updateData.username = updates.username;
    if (updates.firstName !== undefined)
      updateData.first_name = updates.firstName;
    if (updates.first_name !== undefined)
      updateData.first_name = updates.first_name;
    if (updates.lastName !== undefined) updateData.last_name = updates.lastName;
    if (updates.last_name !== undefined)
      updateData.last_name = updates.last_name;
    if (updates.points !== undefined) updateData.points = updates.points;
    if (updates.stats !== undefined) updateData.stats = updates.stats;
    if (updates.badges !== undefined) updateData.badges = updates.badges;
    if (updates.settings !== undefined) {
      // Never nest test_presets into the settings JSONB blob.
      const settingsPayload =
        updates.settings &&
        typeof updates.settings === "object" &&
        !Array.isArray(updates.settings)
          ? { ...(updates.settings as Record<string, unknown>) }
          : updates.settings;
      if (
        settingsPayload &&
        typeof settingsPayload === "object" &&
        !Array.isArray(settingsPayload)
      ) {
        delete (settingsPayload as { test_presets?: unknown }).test_presets;
      }
      updateData.settings = settingsPayload;
    }
    // Dedicated column — do not merge into settings JSONB (would wipe other categories).
    if (updates.test_presets !== undefined) {
      updateData.test_presets = Array.isArray(updates.test_presets)
        ? updates.test_presets
        : [];
    }

    let expectedSettingsVersion = options.expectedSettingsVersion;
    if (updateData.settings !== undefined && expectedSettingsVersion == null) {
      const { data: current, error: currentError } = await this.supabase
        .from("profiles")
        .select("settings_version")
        .eq("id", userId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) return null;
      expectedSettingsVersion = Number(current.settings_version) || 1;
    }

    let query = this.supabase
      .from("profiles")
      .update(updateData)
      .eq("id", userId);
    if (updateData.settings !== undefined && expectedSettingsVersion != null) {
      query = query.eq("settings_version", expectedSettingsVersion);
    }

    const { data, error } = await query.select().maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    if (!data) {
      if (updateData.settings !== undefined) {
        const current = await this.getUserById(userId);
        throw new VersionConflictError(
          "Settings were updated on another device. Refresh and try again.",
          current,
        );
      }
      return null;
    }

    // Invalidate cache (exact user key + pattern)
    await cacheService.invalidateUserCache(userId);
    if (
      Object.prototype.hasOwnProperty.call(updateData, "avatar_url") ||
      Object.prototype.hasOwnProperty.call(updateData, "name") ||
      Object.prototype.hasOwnProperty.call(updateData, "username")
    ) {
      // Group member lists and message responses embed profile presentation fields.
      await this.invalidateProfilePresentationCaches(userId);
    }

    return mapProfileRowToUser(data as Record<string, unknown>);
  }

  async deleteUser(userId: string): Promise<boolean> {
    const { deleteUserAccountFully } = await import("./userDataLifecycle");
    return deleteUserAccountFully(this, userId);
  }

  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const { exportUserDataArchive } = await import("./userDataLifecycle");
    const { wrapSignedExport } = await import("./accountExportSign");
    const archive = await exportUserDataArchive(this, userId);
    let sourceEmail: string | null = null;
    try {
      const { data: authUser } =
        await this.supabase.auth.admin.getUserById(userId);
      sourceEmail = authUser?.user?.email ?? null;
    } catch {
      sourceEmail = null;
    }
    return wrapSignedExport({
      sourceUserId: userId,
      sourceEmail,
      data: archive,
    }) as unknown as Record<string, unknown>;
  }

  /** @deprecated use deleteUser — kept for internal reference */
  async deleteUserProfileOnly(userId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (error) throw error;

    // Invalidate cache
    await cacheService.invalidateUserCache(userId);

    return true;
  }

  async getUserStats(userId: string): Promise<any> {
    const cacheKey = `user:stats:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get user profile for basic stats
        const user = await this.getUserById(userId);
        if (!user) return null;

        // Get additional stats from related tables
        const { data: groupCount, error: groupError } = await this.supabase
          .from("group_members")
          .select("group_id", { count: "exact" })
          .eq("user_id", userId);

        const { data: messageCount, error: messageError } = await this.supabase
          .from("messages")
          .select("id", { count: "exact" })
          .eq("sender_id", userId);

        const { data: testResults, error: testError } = await this.supabase
          .from("test_sessions")
          .select("score")
          .eq("user_id", userId);

        if (groupError || messageError || testError) {
          throw groupError || messageError || testError;
        }

        const avgScore =
          testResults && testResults.length > 0
            ? testResults.reduce(
                (sum, result) => sum + (result.score || 0),
                0,
              ) / testResults.length
            : 0;

        return {
          userId,
          points: user.points || 0,
          groupsCount: groupCount?.length || 0,
          messagesCount: messageCount?.length || 0,
          testsTaken: testResults?.length || 0,
          averageScore: Math.round(avgScore * 100) / 100,
          badges: user.badges || [],
          stats: user.stats || {},
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getUserGroups(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<Group[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `user:groups:${userId}:${page}:${limit}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("group_members")
          .select(
            `
          groups (
            id,
            name,
            avatar_url,
            description,
            last_message,
            last_message_time,
            admin_ids,
            permissions,
            parent_id,
            is_archived,
            invite_id,
            created_at
          )
        `,
          )
          .eq("user_id", userId)
          .range(offset, offset + limit - 1);

        if (error) throw error;
        return data?.map((item: any) => item.groups).filter(Boolean) || [];
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Group Methods for API Routes
  async getGroups(
    options: {
      page?: number;
      limit?: number;
      search?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      userId?: string;
      responseProfile?: "compact" | "full";
    } = {},
  ): Promise<Group[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_GROUP_PAGE_SIZE,
      search,
      sortBy = "created_at",
      sortOrder = "desc",
      userId,
      responseProfile = "full",
    } = options;
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(
      SupabaseService.MAX_GROUP_PAGE_SIZE,
      Math.max(1, limit),
    );
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const cacheKey = `groups:list:${safePage}:${safeLimit}:${search || ""}:${sortBy}:${sortOrder}:${userId || ""}:profile:${profile}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const selectClause =
          profile === "compact"
            ? "id, name, avatar_url, last_message_time, is_archived"
            : "id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, created_at";
        let query = this.supabase
          .from("groups")
          .select(selectClause)
          .range(offset, offset + safeLimit - 1);

        if (search) {
          query = query.ilike("name", `%${search}%`);
        }

        if (userId) {
          // Only return groups where the user is an active (non-pending) member
          const { data: memberGroups, error: memberError } = await this.supabase
            .from("group_members")
            .select("group_id")
            .eq("user_id", userId)
            .eq("pending", false);

          if (memberError) throw memberError;

          const groupIds = memberGroups?.map((mg) => mg.group_id) || [];
          if (groupIds.length === 0) return [];

          query = query.in("id", groupIds);
        }

        // Apply sorting
        query = query.order(sortBy, { ascending: sortOrder === "asc" });

        const { data, error } = await query;
        if (error) throw error;

        const groupIds = (data || []).map((item: any) => item.id);
        const memberCounts: Record<string, number> = {};

        if (groupIds.length > 0) {
          const { data: memberRows, error: memberCountError } =
            await this.supabase
              .from("group_members")
              .select("group_id")
              .in("group_id", groupIds);

          if (!memberCountError && memberRows) {
            memberRows.forEach((row: { group_id: string }) => {
              memberCounts[row.group_id] =
                (memberCounts[row.group_id] || 0) + 1;
            });
          }
        }

        // Transform snake_case to camelCase
        return (data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          avatarUrl: item.avatar_url,
          lastMessage: item.last_message,
          lastMessageTime: item.last_message_time,
          adminIds: item.admin_ids || [],
          permissions: item.permissions || {},
          parentId: item.parent_id,
          isArchived: item.is_archived,
          inviteId: item.invite_id,
          createdAt: item.created_at,
          memberCount: memberCounts[item.id] || 0,
        })) as Group[];
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getGroupById(groupId: string, userId?: string): Promise<Group | null> {
    if (!userId) {
      const { data, error } = await this.supabase
        .from("groups")
        .select(
          "id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, created_at",
        )
        .eq("id", groupId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        description: data.description,
        avatarUrl: data.avatar_url,
        lastMessage: data.last_message,
        lastMessageTime: data.last_message_time,
        adminIds: data.admin_ids || [],
        permissions: data.permissions || {},
        parentId: data.parent_id,
        isArchived: data.is_archived,
        inviteId: data.invite_id,
        createdAt: data.created_at,
      } as Group;
    }

    const cacheKey = `group:${groupId}:user:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("groups")
          .select(
            "id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, created_at",
          )
          .eq("id", groupId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check if user has active (non-pending) membership
        if (userId) {
          const { data: membership, error: memberError } = await this.supabase
            .from("group_members")
            .select("user_id, pending")
            .eq("group_id", groupId)
            .eq("user_id", userId)
            .single();

          if (memberError && memberError.code !== "PGRST116") throw memberError;
          if (!membership || membership.pending === true) return null;
        }

        // Transform snake_case to camelCase
        return {
          id: data.id,
          name: data.name,
          description: data.description,
          avatarUrl: data.avatar_url,
          lastMessage: data.last_message,
          lastMessageTime: data.last_message_time,
          adminIds: data.admin_ids || [],
          permissions: data.permissions || {},
          parentId: data.parent_id,
          isArchived: data.is_archived,
          inviteId: data.invite_id,
          createdAt: data.created_at,
        } as Group;
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async createGroup(
    groupData: Partial<Group>,
    userId: string,
    memberIds: string[] = [],
  ): Promise<Group> {
    const { data, error } = await this.supabase
      .from("groups")
      .insert({
        name: groupData.name,
        description: groupData.description,
        avatar_url: groupData.avatarUrl,
        admin_ids: [userId],
        permissions: groupData.permissions || {},
        invite_id: groupData.inviteId,
        parent_id: groupData.parentId,
        is_archived: false,
      })
      .select()
      .single();

    if (error) throw error;

    // If this is a subgroup, add all parent group members to the subgroup
    const allMemberIds = [userId, ...memberIds];

    if (groupData.parentId) {
      // Fetch parent group members
      const { data: parentMembers, error: parentError } = await this.supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupData.parentId);

      if (!parentError && parentMembers) {
        const parentMemberIds = parentMembers.map((m) => m.user_id);
        // Add parent members that aren't already in the list
        for (const parentMemberId of parentMemberIds) {
          if (!allMemberIds.includes(parentMemberId)) {
            allMemberIds.push(parentMemberId);
          }
        }
      }
    }

    // Creator + inherited parent members join immediately; explicitly invited users stay pending until they accept.
    const explicitInviteSet = new Set(memberIds.filter((id) => id !== userId));
    const membersToInsert = allMemberIds.map((id) => ({
      group_id: data.id,
      user_id: id,
      pending: explicitInviteSet.has(id),
    }));

    const { error: memberError } = await this.supabase
      .from("group_members")
      .insert(membersToInsert);

    if (memberError) throw memberError;

    // Invalidate caches
    await cacheService.invalidateUserCache(userId);
    for (const memberId of memberIds) {
      await cacheService.invalidateUserCache(memberId);
    }
    await cacheService.deletePattern("groups:list:*");

    await this.incrementUserStatsAndAwardBadges(userId, {
      groupsCreated: 1,
    }).catch((err) => {
      logger.warn("Failed to increment groupsCreated gamification", {
        userId,
        err,
      });
    });

    // Transform snake_case to camelCase
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      createdAt: data.created_at,
      pendingInviteUserIds: Array.from(explicitInviteSet),
    } as Group & { pendingInviteUserIds?: string[] };
  }

  async updateGroup(
    groupId: string,
    updates: Partial<Group>,
  ): Promise<Group | null> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.avatarUrl !== undefined) dbUpdates.avatar_url = updates.avatarUrl;
    if (updates.permissions !== undefined) dbUpdates.permissions = updates.permissions;
    if (updates.inviteId !== undefined) dbUpdates.invite_id = updates.inviteId;
    if (updates.parentId !== undefined) dbUpdates.parent_id = updates.parentId;
    if (updates.isArchived !== undefined) dbUpdates.is_archived = updates.isArchived;
    if (updates.adminIds !== undefined) dbUpdates.admin_ids = updates.adminIds;

    if (Object.keys(dbUpdates).length === 0) {
      return this.getGroupById(groupId);
    }

    const { data, error } = await this.supabase
      .from("groups")
      .update(dbUpdates)
      .eq("id", groupId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.deletePattern("groups:list:*");

    // Transform snake_case to camelCase
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      createdAt: data.created_at,
    } as Group;
  }

  async getGroupByInviteId(inviteId: string): Promise<Group | null> {
    const { data, error } = await this.supabase
      .from("groups")
      .select("*")
      .eq("invite_id", inviteId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      createdAt: data.created_at,
    } as Group;
  }

  /**
   * Invite a user into a group. By default creates a pending membership that the
   * invitee must accept. Pass `pending: false` only for invitee-initiated joins
   * (e.g. invite-link Accept) or the group creator.
   */
  async addGroupMember(
    groupId: string,
    userId: string,
    options: { pending?: boolean } = {},
  ): Promise<Group | null> {
    const pending = options.pending !== false;

    const { error: memberError } = await this.supabase
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: userId,
        pending,
      });

    if (memberError) {
      if (memberError.code === "23505") {
        // Already a row — invite again leaves pending as-is; self-join accepts a pending invite.
        if (!pending) {
          const accepted = await this.acceptGroupInvite(groupId, userId);
          if (accepted) return await this.getGroupById(groupId, userId);
          return await this.getGroupById(groupId, userId);
        }
        return null;
      }
      throw memberError;
    }

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");

    return pending ? null : await this.getGroupById(groupId, userId);
  }

  /** Bulk invite members as pending (invitee must accept). */
  async addGroupMembersBatch(
    groupId: string,
    userIds: string[],
  ): Promise<{
    invited: string[];
    alreadyMembers: string[];
    alreadyPending: string[];
  }> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueIds.length) {
      return { invited: [], alreadyMembers: [], alreadyPending: [] };
    }

    const { data: existing, error: checkError } = await this.supabase
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", groupId)
      .in("user_id", uniqueIds);

    if (checkError) throw checkError;

    const alreadyMembers: string[] = [];
    const alreadyPending: string[] = [];
    const existingSet = new Set<string>();
    for (const row of existing || []) {
      existingSet.add(row.user_id);
      if (row.pending === true) alreadyPending.push(row.user_id);
      else alreadyMembers.push(row.user_id);
    }
    const toInvite = uniqueIds.filter((id) => !existingSet.has(id));

    if (toInvite.length) {
      const { error: insertError } = await this.supabase
        .from("group_members")
        .upsert(
          toInvite.map((user_id) => ({
            group_id: groupId,
            user_id,
            pending: true,
          })),
          { onConflict: "group_id,user_id", ignoreDuplicates: true },
        );
      if (insertError) throw insertError;

      await cacheService.invalidateGroupCache(groupId);
      await cacheService.invalidateGlobalCache("groups:list:*");
      for (const memberId of toInvite) {
        await cacheService.invalidateUserCache(memberId);
      }
    }

    return { invited: toInvite, alreadyMembers, alreadyPending };
  }

  async acceptGroupInvite(groupId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("group_members")
      .update({ pending: false, joined_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("pending", true)
      .select("user_id");

    if (error) throw error;
    if (!data?.length) return false;

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");
    return true;
  }

  async declineGroupInvite(groupId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("pending", true)
      .select("user_id");

    if (error) throw error;
    if (!data?.length) return false;

    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");
    return true;
  }

  async getPendingGroupInvitesForUser(userId: string): Promise<
    Array<{
      groupId: string;
      groupName: string;
      avatarUrl?: string;
      invitedAt?: string;
    }>
  > {
    const { data, error } = await this.supabase
      .from("group_members")
      .select("group_id, joined_at, groups(id, name, avatar_url)")
      .eq("user_id", userId)
      .eq("pending", true);

    if (error) throw error;

    return (data || []).map((row: any) => ({
      groupId: row.group_id,
      groupName: row.groups?.name || "Group",
      avatarUrl: row.groups?.avatar_url,
      invitedAt: row.joined_at,
    }));
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;
    return !!data && data.pending !== true;
  }

  async isDmThreadParticipant(
    threadId: string,
    userId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("dm_threads")
      .select("participant_ids")
      .eq("id", threadId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    const ids = Array.isArray(data?.participant_ids)
      ? data!.participant_ids
      : [];
    return ids.includes(userId);
  }

  /**
   * True when viewer may see peer's profile avatar in chat (DM partner or shared active group),
   * even if the peer's profile visibility is private.
   */
  async canViewPeerChatAvatar(
    viewerId: string,
    peerId: string,
  ): Promise<boolean> {
    if (!viewerId || !peerId || viewerId === peerId) return viewerId === peerId;
    const threadId = [viewerId, peerId].sort().join("-");
    const { data: dm, error: dmError } = await this.supabase
      .from("dm_threads")
      .select("id")
      .eq("id", threadId)
      .maybeSingle();
    if (dmError && dmError.code !== "PGRST116") throw dmError;
    if (dm) return true;

    const { data: shared, error: sharedError } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", viewerId)
      .eq("pending", false);
    if (sharedError) throw sharedError;
    const groupIds = (shared || []).map(
      (row: { group_id: string }) => row.group_id,
    );
    if (groupIds.length === 0) return false;

    const { data: peerMembership, error: peerError } = await this.supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", peerId)
      .eq("pending", false)
      .in("group_id", groupIds)
      .limit(1)
      .maybeSingle();
    if (peerError && peerError.code !== "PGRST116") throw peerError;
    return !!peerMembership;
  }

  /**
   * Authorize mutation of a group message. Returns the message row when the user
   * is an active (non-pending) member of its group; otherwise null (treat as not
   * found to avoid IDOR leaks).
   */
  async getAuthorizedGroupMessage(
    messageId: string,
    userId: string,
  ): Promise<{
    id: string;
    group_id: string;
    sender_id: string;
    type: string;
  } | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .select("id, group_id, sender_id, type")
      .eq("id", messageId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;
    if (!data?.group_id) return null;

    const { data: membership, error: memberError } = await this.supabase
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", data.group_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberError && memberError.code !== "PGRST116") throw memberError;
    if (!membership || membership.pending === true) return null;

    return data;
  }

  async isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;
    return (
      (group.adminIds || []).includes(userId) ||
      !!(group.permissions && group.permissions[userId]?.admin)
    );
  }

  /** Whether an authenticated user may deliver a notification to another user. */
  async canNotifyUser(
    requestingUserId: string,
    targetUserId: string,
    link?: string,
  ): Promise<boolean> {
    if (!link) return false;

    const groupMatch = link.match(/^\/chat\/([0-9a-f-]{36})$/i);
    if (groupMatch) {
      const groupId = groupMatch[1];
      const group = await this.getGroupById(groupId);
      if (!group) return false;

      const isAdmin =
        (group.adminIds || []).includes(requestingUserId) ||
        !!(group.permissions && group.permissions[requestingUserId]?.admin);

      const requesterIsMember = await this.isGroupMember(
        groupId,
        requestingUserId,
      );
      if (!requesterIsMember && !isAdmin) return false;

      if (isAdmin) return true;

      return this.isGroupMember(groupId, targetUserId);
    }

    if (link === "/dashboard" || link.startsWith("/dashboard")) {
      const { data, error } = await this.supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", targetUserId);

      if (error) throw error;
      for (const row of data || []) {
        const group = await this.getGroupById(row.group_id);
        if ((group?.adminIds || []).includes(requestingUserId)) return true;
      }
      return false;
    }

    return false;
  }

  async removeGroupMember(
    groupId: string,
    userId: string,
  ): Promise<Group | null> {
    const group = await this.getGroupById(groupId);

    const { error } = await this.supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId);

    if (error) throw error;

    // Keep admin_ids in sync when an admin leaves or is removed.
    if (group?.adminIds?.includes(userId)) {
      const nextAdminIds = group.adminIds.filter((id) => id !== userId);
      const { error: adminError } = await this.supabase
        .from("groups")
        .update({ admin_ids: nextAdminIds })
        .eq("id", groupId);
      if (adminError) throw adminError;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern("groups:list:*");

    return await this.getGroupById(groupId);
  }

  async deleteGroup(groupId: string): Promise<void> {
    // Cascade removes members/messages. Intentionally do NOT purge test_sessions:
    // group id lives in config JSONB with no FK, and product keeps orphan history
    // for the user's Recent Tests (Group performance simply drops missing groups).
    const { error } = await this.supabase
      .from("groups")
      .delete()
      .eq("id", groupId);

    if (error) {
      logger.error(`Error deleting group ${groupId}:`, error);
      throw error;
    }

    logger.info(
      `Group ${groupId} deleted. Members/messages cascaded; test history retained.`,
    );

    // Invalidate relevant caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.deletePattern("groups:list:*");
  }

  async getGroupMembers(
    groupId: string,
    options: { page?: number; limit?: number; requestingUserId?: string } = {},
  ): Promise<User[]> {
    const { page = 1, limit = 50, requestingUserId } = options;
    const offset = (page - 1) * limit;

    // SEC-04: partition by viewer; payload stays public-only (phone/settings attached after).
    const cacheKey = `group:members:${groupId}:${page}:${limit}:${requestingUserId || "anon"}`;

    const publicMembers = await cacheService.cached(
      cacheKey,
      async () => {
        const { data: memberData, error: memberError } = await this.supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("pending", false)
          .range(offset, offset + limit - 1);

        if (memberError) {
          logger.error("Error fetching group members:", memberError);
          throw memberError;
        }

        if (!memberData || memberData.length === 0) {
          return [];
        }

        const userIds = memberData.map((m) => m.user_id);
        const { data: profileData, error: profileError } = await this.supabase
          .from("profiles")
          .select("id, name, username, avatar_url, points, stats, badges")
          .in("id", userIds);

        if (profileError) {
          logger.error("Error fetching member profiles:", profileError);
          throw profileError;
        }

        return (profileData || []).map((profile: any) => ({
          id: profile.id,
          name: profile.name,
          username: profile.username,
          avatarUrl: profile.avatar_url,
          points: profile.points || 0,
          stats: profile.stats || {},
          badges: profile.badges || [],
        }));
      },
      { ttl: 300 },
    );

    if (!requestingUserId) return publicMembers as User[];

    const selfInPage = publicMembers.some(
      (m: any) => m.id === requestingUserId,
    );
    if (!selfInPage) return publicMembers as User[];

    const { data: selfProfile, error: selfError } = await this.supabase
      .from("profiles")
      .select("phone, settings")
      .eq("id", requestingUserId)
      .maybeSingle();

    if (selfError) {
      logger.error("Error fetching self member profile:", selfError);
      throw selfError;
    }

    return (publicMembers as User[]).map((member: any) => {
      if (member.id !== requestingUserId) return member;
      return {
        ...member,
        phoneNumber: selfProfile?.phone,
        settings: selfProfile?.settings,
      };
    });
  }

  async getGroupStats(groupId: string): Promise<any> {
    const cacheKey = `group:stats:${groupId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get member count
        const { count: memberCount, error: memberError } = await this.supabase
          .from("group_members")
          .select("user_id", { count: "exact", head: true })
          .eq("group_id", groupId);

        // Get message count
        const { count: messageCount, error: messageError } = await this.supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("group_id", groupId);

        // Get recent activity
        const { data: recentMessages, error: recentError } = await this.supabase
          .from("messages")
          .select("timestamp")
          .eq("group_id", groupId)
          .is("removed_at", null)
          .eq("is_archived", false)
          .order("timestamp", { ascending: false })
          .limit(10);

        if (memberError || messageError || recentError) {
          throw memberError || messageError || recentError;
        }

        const lastActivity =
          recentMessages && recentMessages.length > 0
            ? new Date(recentMessages[0].timestamp)
            : null;

        return {
          groupId,
          memberCount: memberCount || 0,
          messageCount: messageCount || 0,
          lastActivity,
          isActive:
            lastActivity &&
            Date.now() - lastActivity.getTime() < 7 * 24 * 60 * 60 * 1000, // Active if activity in last 7 days
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Message Methods for API Routes
  async getGroupMessages(
    groupId: string,
    options: {
      page?: number;
      limit?: number;
      before?: string;
      after?: string;
      responseProfile?: "compact" | "full";
      viewerUserId?: string;
    } = {},
  ): Promise<Message[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_MESSAGE_PAGE_SIZE,
      before,
      after,
      responseProfile = "full",
      viewerUserId,
    } = options;
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(
      SupabaseService.MAX_MESSAGE_PAGE_SIZE,
      Math.max(1, limit),
    );
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const cacheKey = `messages:group:${groupId}:${safePage}:${safeLimit}:${before || ""}:${after || ""}:profile:${profile}`;

    logger.debug("getGroupMessages: Fetching messages", {
      groupId,
      page: safePage,
      limit: safeLimit,
      cacheKey,
    });

    const messages = await cacheService.cached(
      cacheKey,
      async () => {
        logger.debug("getGroupMessages: Cache miss, querying database");
        const selectClause =
          profile === "compact"
            ? `
          id,
          group_id,
          sender_id,
          type,
          text,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          reply_to_message_id,
          mentioned_user_ids,
          thread_root_id,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `
            : `
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          reply_to_message_id,
          mentioned_user_ids,
          thread_root_id,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `;

        // Supabase's generated select type becomes intractable for the two
        // profile-dependent projection strings above. The response is normalized
        // immediately below, so keep this dynamic query explicitly untyped.
        let query = (this.supabase as any)
          .from("messages")
          .select(selectClause)
          .eq("group_id", groupId);

        if (before) {
          query = query.lt("timestamp", before);
        }
        if (after) {
          query = query.gt("timestamp", after);
        }

        const { data, error } = await query
          .order("timestamp", { ascending: false })
          .range(offset, offset + safeLimit - 1);

        if (error) {
          logger.error("getGroupMessages: Database error", { error });
          throw error;
        }

        logger.info("getGroupMessages: Retrieved messages from DB", {
          groupId,
          count: (data || []).length,
          questionCount: (data || []).filter((m: any) => m.type === "QUESTION")
            .length,
        });

        const withReplies = await this.attachReplyPreviewsBatch(
          data || [],
          "messages",
        );
        const withCounts = await this.attachThreadReplyCounts(
          withReplies,
          "messages",
          "group_id",
          groupId,
        );

        return withCounts.reverse().map((msg: any) => ({
          id: msg.id,
          groupId: msg.group_id,
          sender: mapProfileSender(
            resolveNestedProfile(msg.profiles),
            msg.sender_id,
          ),
          senderId: msg.sender_id,
          timestamp: msg.timestamp
            ? new Date(msg.timestamp).toISOString()
            : new Date().toISOString(),
          flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
          upvotes: msg.upvotes || 0,
          downvotes: msg.downvotes || 0,
          isArchived: msg.is_archived || false,
          ...this.normalizeMessageRecord(msg),
        }));
      },
      { ttl: 120 },
    ); // Cache for 2 minutes

    if (viewerUserId) {
      return this.enrichGroupMessageReceipts(messages, groupId, viewerUserId);
    }
    return messages;
  }

  async getMessageById(
    messageId: string,
    userId?: string,
  ): Promise<Message | null> {
    const rawCacheKey = `message:raw:${messageId}`;

    const data = await cacheService.cached(
      rawCacheKey,
      async () => {
        const { data: row, error } = await this.supabase
          .from("messages")
          .select(
            `
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `,
          )
          .eq("id", messageId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null;
          throw error;
        }
        return row;
      },
      { ttl: 600 },
    );

    if (!data) return null;

    if (userId) {
      const { data: membership, error: memberError } = await this.supabase
        .from("group_members")
        .select("user_id, pending")
        .eq("group_id", data.group_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (memberError && memberError.code !== "PGRST116") throw memberError;
      if (!membership || membership.pending === true) return null;
    }

    return {
      id: data.id,
      groupId: data.group_id,
      sender: mapProfileSender(
        resolveNestedProfile((data as any).profiles),
        data.sender_id,
      ),
      senderId: data.sender_id,
      timestamp: data.timestamp
        ? new Date(data.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || [],
      upvotes: data.upvotes || 0,
      downvotes: data.downvotes || 0,
      ...this.normalizeMessageRecord(data),
    };
  }

  private mapChatMutationRow(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Record<string, unknown> {
    const removedAt = row.removed_at || null;
    return {
      id: row.id,
      ...(kind === "group"
        ? { groupId: row.group_id, type: row.type || "TEXT" }
        : { threadId: row.thread_id, type: "TEXT" }),
      senderId: row.sender_id,
      timestamp: row.timestamp,
      editedAt: row.edited_at || undefined,
      removedAt: removedAt || undefined,
      isRemoved: !!removedAt,
      ...(!removedAt ? { text: row.text } : {}),
    };
  }

  private async refreshChatPreview(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Promise<void> {
    if (kind === "group") {
      const groupId = row.group_id as string;
      const { data: latest, error: latestError } = await this.supabase
        .from("messages")
        .select("text, type, question_data, timestamp")
        .eq("group_id", groupId)
        .is("removed_at", null)
        .eq("is_archived", false)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw latestError;
      const questionData =
        latest?.question_data && typeof latest.question_data === "object"
          ? latest.question_data
          : {};
      const preview =
        String(latest?.type || "").toUpperCase() === "QUESTION"
          ? `New question: ${String(questionData.questionStem || "").substring(0, 50)}`
          : latest?.text || null;

      const previewCutoff = latest?.timestamp || row.timestamp;
      let updateQuery = this.supabase
        .from("groups")
        .update({
          last_message: preview,
          last_message_time: latest?.timestamp || null,
        })
        .eq("id", groupId);
      if (previewCutoff) {
        updateQuery = updateQuery.or(
          `last_message_time.is.null,last_message_time.lte.${previewCutoff}`,
        );
      }
      const { error: updateError } = await updateQuery;
      if (updateError) throw updateError;
      return;
    }

    const threadId = row.thread_id as string;
    const { data: latest, error: latestError } = await this.supabase
      .from("dm_messages")
      .select("text, timestamp")
      .eq("thread_id", threadId)
      .is("removed_at", null)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) throw latestError;
    const previewCutoff = latest?.timestamp || row.timestamp;
    let updateQuery = this.supabase
      .from("dm_threads")
      .update({
        last_message: latest?.text || null,
        last_message_time: latest?.timestamp || null,
      })
      .eq("id", threadId);
    if (previewCutoff) {
      updateQuery = updateQuery.or(
        `last_message_time.is.null,last_message_time.lte.${previewCutoff}`,
      );
    }
    const { error: updateError } = await updateQuery;
    if (updateError) throw updateError;
  }

  private async invalidateChatMessageMutation(
    kind: "group" | "dm",
    row: Record<string, any>,
  ): Promise<void> {
    await cacheService.delete(`message:raw:${row.id}`);
    await cacheService.deletePattern(`message:*:${row.id}`);

    if (kind === "group") {
      await cacheService.invalidateGroupCache(row.group_id);
      await cacheService.deletePattern(`messages:group:${row.group_id}:*`);
      await cacheService.delete(`group:stats:${row.group_id}`);
      return;
    }

    await cacheService.deletePattern("messages:direct:*");
  }

  private async refreshChatMessageNotifications(
    kind: "group" | "dm",
    messageId: string,
    action: "edited" | "removed",
    preview?: string,
  ): Promise<void> {
    const { data: notifications, error } = await this.supabase
      .from("notifications")
      .select("id, data")
      .contains("data", { messageId });
    if (error) throw error;
    if (!notifications?.length) return;

    await Promise.all(
      notifications.map(async (notification) => {
        const notificationData =
          notification.data && typeof notification.data === "object"
            ? notification.data
            : {};
        const { error: updateError } = await this.supabase
          .from("notifications")
          .update({
            message:
              kind === "group"
                ? `A message in a group was ${action}`
                : `A direct message was ${action}`,
            data: {
              ...notificationData,
              preview:
                action === "removed"
                  ? "Message removed"
                  : String(preview || "").slice(0, 80),
              edited: action === "edited",
              removed: action === "removed",
            },
          })
          .eq("id", notification.id);
        if (updateError) throw updateError;
      }),
    );
    await cacheService.deletePattern("notifications:*");
  }

  async editChatMessage(
    kind: "group" | "dm",
    messageId: string,
    actorId: string,
    content: string,
  ): Promise<ChatMessageMutationResult> {
    const { data, error } = await this.supabase.rpc("edit_chat_message", {
      p_message_kind: kind,
      p_message_id: messageId,
      p_actor_id: actorId,
      p_new_text: content,
    });
    if (error) throw error;

    const result = (data || {
      status: "not_found",
    }) as ChatMessageMutationResult & {
      message?: Record<string, any>;
    };
    if (result.status !== "ok" || !result.message) return result;

    await this.invalidateChatMessageMutation(kind, result.message);
    try {
      await this.refreshChatPreview(kind, result.message);
    } catch (previewError) {
      logger.warn("Failed to refresh chat preview after message edit", {
        kind,
        messageId,
        previewError,
      });
    }
    try {
      await this.refreshChatMessageNotifications(
        kind,
        String(result.message.id),
        "edited",
        content,
      );
    } catch (notificationError) {
      logger.warn("Failed to refresh notifications after message edit", {
        kind,
        messageId,
        notificationError,
      });
    }
    return {
      status: "ok",
      message: this.mapChatMutationRow(kind, result.message),
    };
  }

  async removeChatMessage(
    kind: "group" | "dm",
    messageId: string,
    actorId: string,
  ): Promise<ChatMessageMutationResult> {
    const { data, error } = await this.supabase.rpc("remove_chat_message", {
      p_message_kind: kind,
      p_message_id: messageId,
      p_actor_id: actorId,
    });
    if (error) throw error;

    const result = (data || {
      status: "not_found",
    }) as ChatMessageMutationResult & {
      message?: Record<string, any>;
    };
    if (result.status !== "ok" || !result.message) return result;

    await this.invalidateChatMessageMutation(kind, result.message);
    try {
      await this.refreshChatPreview(kind, result.message);
    } catch (previewError) {
      logger.warn("Failed to refresh chat preview after message removal", {
        kind,
        messageId,
        previewError,
      });
    }
    try {
      await this.refreshChatMessageNotifications(
        kind,
        String(result.message.id),
        "removed",
      );
    } catch (notificationError) {
      logger.warn("Failed to scrub notifications after message removal", {
        kind,
        messageId,
        notificationError,
      });
    }

    return {
      status: "ok",
      message: this.mapChatMutationRow(kind, result.message),
    };
  }

  /**
   * After votes change, recompute PENDING/VERIFIED/REJECTED from group vote counts
   * and persist into question_data so every member sees the same testable status.
   * (Clients previously called PUT /status, which only author/admin could write.)
   */
  private async syncQuestionStatusAfterVote(messageId: string): Promise<{
    upvotes: number;
    downvotes: number;
    groupId: string | null;
    questionStatus?: string;
  }> {
    const { data: msg, error } = await this.supabase
      .from("messages")
      .select("group_id, upvotes, downvotes, type, question_data")
      .eq("id", messageId)
      .single();

    if (error) throw error;
    if (!msg) {
      return { upvotes: 0, downvotes: 0, groupId: null };
    }

    const questionData =
      msg.question_data && typeof msg.question_data === "object"
        ? msg.question_data
        : {};
    let questionStatus =
      typeof questionData.questionStatus === "string"
        ? questionData.questionStatus
        : undefined;

    const isQuestion =
      String(msg.type || "").toUpperCase() === "QUESTION" ||
      !!(questionData.questionStem || questionData.questionType);

    if (isQuestion && msg.group_id) {
      const { count, error: countError } = await this.supabase
        .from("group_members")
        .select("*", { count: "exact", head: true })
        .eq("group_id", msg.group_id);
      if (countError) {
        logger.warn("syncQuestionStatusAfterVote: member count failed", {
          messageId,
          groupId: msg.group_id,
          error: countError,
        });
      }
      const memberCount = count ?? 0;
      const resolved = resolveQuestionStatusAfterVote({
        upvotes: msg.upvotes ?? 0,
        downvotes: msg.downvotes ?? 0,
        memberCount,
      });
      if (resolved !== questionStatus) {
        const { error: updateError } = await this.supabase
          .from("messages")
          .update({
            question_data: {
              ...questionData,
              questionStatus: resolved,
            },
          })
          .eq("id", messageId);
        if (updateError) {
          logger.error(
            "syncQuestionStatusAfterVote: failed to persist status",
            {
              messageId,
              resolved,
              error: updateError,
            },
          );
        } else {
          questionStatus = resolved;
        }
      }
    }

    await cacheService.delete(`message:${messageId}`);
    if (msg.group_id) {
      await cacheService.invalidateGroupCache(msg.group_id);
      await cacheService.deletePattern(`messages:group:${msg.group_id}:*`);
    }

    return {
      upvotes: msg.upvotes ?? 0,
      downvotes: msg.downvotes ?? 0,
      groupId: msg.group_id ?? null,
      questionStatus,
    };
  }

  async voteQuestion(
    messageId: string,
    userId: string,
    voteType: "up" | "down",
  ): Promise<any> {
    const { data: existingVote, error: checkError } = await this.supabase
      .from("question_votes")
      .select("vote_type")
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingVote?.vote_type === voteType) {
      const synced = await this.syncQuestionStatusAfterVote(messageId);
      return {
        success: true,
        voteType,
        upvotes: synced.upvotes,
        downvotes: synced.downvotes,
        questionStatus: synced.questionStatus,
      };
    }

    const { error } = await this.supabase.from("question_votes").upsert(
      {
        message_id: messageId,
        user_id: userId,
        vote_type: voteType,
      },
      { onConflict: "message_id,user_id" },
    );

    if (error) throw error;

    const synced = await this.syncQuestionStatusAfterVote(messageId);
    return {
      success: true,
      voteType,
      upvotes: synced.upvotes,
      downvotes: synced.downvotes,
      questionStatus: synced.questionStatus,
    };
  }

  async removeVote(messageId: string, userId: string): Promise<any> {
    const { error } = await this.supabase
      .from("question_votes")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId);

    if (error) throw error;

    const synced = await this.syncQuestionStatusAfterVote(messageId);
    return {
      success: true,
      upvotes: synced.upvotes,
      downvotes: synced.downvotes,
      questionStatus: synced.questionStatus,
    };
  }

  async getUserVotesForGroup(
    groupId: string,
    userId: string,
  ): Promise<Record<string, "up" | "down">> {
    // Get all message IDs in the group
    const { data: messages, error: msgError } = await this.supabase
      .from("messages")
      .select("id")
      .eq("group_id", groupId);

    if (msgError) throw msgError;
    if (!messages || messages.length === 0) return {};

    const messageIds = messages.map((m) => m.id);

    // Get user's votes for those messages
    const { data: votes, error: votesError } = await this.supabase
      .from("question_votes")
      .select("message_id, vote_type")
      .eq("user_id", userId)
      .in("message_id", messageIds);

    if (votesError) throw votesError;

    // Convert to a map
    const voteMap: Record<string, "up" | "down"> = {};
    for (const vote of votes || []) {
      voteMap[vote.message_id] = vote.vote_type;
    }

    return voteMap;
  }

  async updateQuestionStatus(
    messageId: string,
    questionStatus: string,
  ): Promise<any> {
    // First get the current message to get the question_data
    const { data: currentMessage, error: fetchError } = await this.supabase
      .from("messages")
      .select("question_data, group_id")
      .eq("id", messageId)
      .single();

    if (fetchError) throw fetchError;
    if (!currentMessage) throw new Error("Message not found");

    // Update the questionStatus in the question_data JSONB
    const updatedQuestionData = {
      ...currentMessage.question_data,
      questionStatus,
    };

    const { data, error } = await this.supabase
      .from("messages")
      .update({ question_data: updatedQuestionData })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches (list GET uses messages:group:* keys)
    await cacheService.delete(`message:${messageId}`);
    await cacheService.delete(`group:${currentMessage.group_id}:messages`);
    if (currentMessage.group_id) {
      await cacheService.invalidateGroupCache(currentMessage.group_id);
      await cacheService.deletePattern(
        `messages:group:${currentMessage.group_id}:*`,
      );
    }

    return data;
  }

  async updateMessageFlagged(
    messageId: string,
    flaggedUserIds: string[],
  ): Promise<Message | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .update({
        flagged_as_similar_user_ids: flaggedUserIds,
      })
      .eq("id", messageId)
      .select(
        `
        id,
        group_id,
        sender_id,
        type,
        text,
        question_data,
        flagged_as_similar_user_ids,
        timestamp,
        edited_at,
        removed_at,
        profiles!sender_id (
          id,
          name,
          username,
          avatar_url
        )
      `,
      )
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(data.group_id);
    await cacheService.delete(`message:${messageId}`);
    await cacheService.deletePattern(`messages:group:${data.group_id}:*`);

    return {
      id: data.id,
      groupId: data.group_id,
      sender: mapProfileSender(
        resolveNestedProfile(data.profiles),
        data.sender_id,
      ),
      senderId: data.sender_id,
      timestamp: data.timestamp
        ? new Date(data.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || [],
      upvotes: 0,
      downvotes: 0,
      type: data.type || "TEXT",
      text: data.text,
    };
  }

  async createDeck(
    deckData: { name: string; description?: string; isShared?: boolean },
    userId: string,
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("decks")
      .insert({
        name: deckData.name,
        description: deckData.description || "",
        user_id: userId,
        is_shared: deckData.isShared ?? false,
      })
      .select()
      .single();

    if (error) {
      logger.error("Error creating deck:", { error, deckData, userId });
      throw new Error(error.message || "Failed to create deck");
    }

    // Cache the new deck
    await cacheService.set(`deck:${data.id}`, data, 1800); // 30 minutes

    return data;
  }

  async getDecks(
    userId: string,
    includeShared: boolean = false,
    options: {
      page?: number;
      limit?: number;
      responseProfile?: "compact" | "full";
    } = {},
  ): Promise<any[]> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(
      SupabaseService.MAX_DECK_PAGE_SIZE,
      Math.max(1, options.limit || SupabaseService.DEFAULT_DECK_PAGE_SIZE),
    );
    const profile = this.getResponseProfile(options.responseProfile);
    const offset = (page - 1) * limit;
    // v2: includeShared means owned + collaborator decks — never every globally shared deck.
    const cacheKey = `decks:user:${userId}:scope:${includeShared ? "owned_collab" : "owned"}:p${page}:l${limit}:profile:${profile}:v2`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const selectClause =
      profile === "compact"
        ? "id, name, user_id, is_shared, created_at"
        : "id, name, description, user_id, is_shared, created_at";

    let query = this.supabase
      .from("decks")
      .select(selectClause)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (includeShared) {
      // Owned decks + decks where the user is an explicit collaborator.
      // Do NOT list every is_shared=true deck in the product (that leaked other users' libraries).
      const accessibleIds = await this.getAccessibleDeckIds(userId);
      if (accessibleIds.length === 0) {
        await cacheService.set(cacheKey, [], 1800);
        return [];
      }
      query = query.in("id", accessibleIds);
    } else {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const decks = (
      (data || []) as unknown as Array<{ id: string; [key: string]: unknown }>
    ).filter((d) => d && typeof d.id === "string" && d.id);
    const deckIds = decks.map((d) => d.id);
    const cardCountByDeck: Record<string, number> = {};

    if (deckIds.length > 0) {
      const { data: cardRows, error: countError } = await this.supabase
        .from("flashcards")
        .select("deck_id")
        .in("deck_id", deckIds);

      if (!countError && cardRows) {
        for (const row of cardRows) {
          const deckId = row.deck_id as string;
          cardCountByDeck[deckId] = (cardCountByDeck[deckId] || 0) + 1;
        }
      }
    }

    const decksWithCounts = decks.map((d) => ({
      ...d,
      card_count: cardCountByDeck[d.id] || 0,
    }));

    await cacheService.set(cacheKey, decksWithCounts, 1800); // 30 minutes
    return decksWithCounts;
  }

  async getSharedDecks(): Promise<any[]> {
    const cacheKey = `decks:shared`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("decks")
      .select("*")
      .eq("is_shared", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async getDeckCollaborators(deckId: string, userId: string): Promise<any[]> {
    const hasAccess = await this.verifyDeckAccess(userId, deckId, "read");
    if (!hasAccess) return [];

    const cacheKey = `deck_collaborators:${deckId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("deck_collaborators")
      .select(
        "user_id, role, added_at, profiles!deck_collaborators_user_id_fkey(id, name, avatar_url)",
      )
      .eq("deck_id", deckId);

    if (error) throw error;

    await cacheService.set(cacheKey, data, 300);
    return data;
  }

  async addDeckCollaborator(
    deckId: string,
    userId: string,
    role: string = "editor",
    requesterId?: string,
  ): Promise<any> {
    const actorId = requesterId || userId;
    const canManage = await this.verifyDeckAccess(actorId, deckId, "owner");
    if (!canManage) throw new Error("Access denied");

    const { data, error } = await this.supabase
      .from("deck_collaborators")
      .insert({ deck_id: deckId, user_id: userId, role })
      .select()
      .single();

    if (error) throw error;

    await cacheService.delete(`deck_collaborators:${deckId}`);
    return data;
  }

  async removeDeckCollaborator(
    deckId: string,
    userId: string,
    requesterId?: string,
  ): Promise<boolean> {
    const actorId = requesterId || userId;
    const isOwner = await this.verifyDeckAccess(actorId, deckId, "owner");
    if (!isOwner && actorId !== userId) throw new Error("Access denied");

    const { error } = await this.supabase
      .from("deck_collaborators")
      .delete()
      .eq("deck_id", deckId)
      .eq("user_id", userId);

    if (error) throw error;

    await cacheService.delete(`deck_collaborators:${deckId}`);
    return true;
  }

  async getDeck(deckId: string): Promise<any | null> {
    const cacheKey = `deck:${deckId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("decks")
      .select("id, name, description, user_id, is_shared, created_at")
      .eq("id", deckId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async updateDeck(
    deckId: string,
    updates: {
      name?: string;
      description?: string;
      isPublic?: boolean;
      isShared?: boolean;
    },
    userId: string,
  ): Promise<any | null> {
    const canEdit = await this.verifyDeckAccess(userId, deckId, "edit");
    if (!canEdit) return null;

    const { data, error } = await this.supabase
      .from("decks")
      .update({
        name: updates.name,
        description: updates.description,
        is_public: updates.isPublic,
        is_shared: updates.isShared,
      })
      .eq("id", deckId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    // Update cache
    await cacheService.set(`deck:${deckId}`, data, 1800);
    await cacheService.deletePattern(`deck:${deckId}:user:*`);

    return data;
  }

  async deleteDeck(deckId: string, userId: string): Promise<boolean> {
    const isOwner = await this.verifyDeckAccess(userId, deckId, "owner");
    if (!isOwner) return false;

    const { error } = await this.supabase
      .from("decks")
      .delete()
      .eq("id", deckId);

    if (error) throw error;

    // Clear cache
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`deck:${deckId}:user:*`);
    await cacheService.deletePattern(`decks:user:*`);

    return true;
  }

  async exportDeck(deckId: string, userId: string): Promise<any | null> {
    const deck = await this.getDeckForUser(deckId, userId);
    if (!deck) return null;

    const { data: flashcards, error } = await this.supabase
      .from("flashcards")
      .select("*")
      .eq("deck_id", deckId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return {
      deck,
      flashcards: flashcards || [],
    };
  }

  async importDeck(importData: any, userId: string): Promise<any> {
    // Always create exactly one new deck owned by the authenticated user.
    // Never honor foreign user_id / deck id / is_shared from the payload.
    const deckName =
      typeof importData?.deck?.name === "string" && importData.deck.name.trim()
        ? importData.deck.name.trim().slice(0, 200)
        : "Imported Deck";
    const deckDescription =
      typeof importData?.deck?.description === "string"
        ? importData.deck.description.slice(0, 2000)
        : "";

    const { data: newDeck, error: deckError } = await this.supabase
      .from("decks")
      .insert({
        name: deckName,
        description: deckDescription,
        user_id: userId,
        is_shared: false,
      })
      .select()
      .single();

    if (deckError) {
      logger.error("Error creating deck during import:", deckError);
      throw deckError;
    }

    // Import flashcards (removed user_id as it doesn't exist in flashcards schema)
    if (importData.flashcards && importData.flashcards.length > 0) {
      const flashcardsToInsert = importData.flashcards.map((card: any) => {
        const cardType = card.type || "BASIC";
        const insertData: any = {
          deck_id: newDeck.id,
          type: cardType,
        };

        if (cardType === "CLOZE") {
          insertData.cloze_text = card.clozeText || card.cloze_text;
        } else if (cardType === "IMAGE_OCCLUSION") {
          insertData.front = card.front;
          insertData.back = card.back;
          const occlusionData = card.occlusion_data || card.occlusionData;
          if (occlusionData) {
            insertData.occlusion_data = occlusionData;
          }
        } else {
          insertData.front = card.front;
          insertData.back = card.back;
        }

        const imageUrl = card.image_url || card.imageUrl;
        if (imageUrl) {
          insertData.image_url = imageUrl;
        }

        if (card.tags && card.tags.length > 0) {
          insertData.tags = card.tags;
        }

        return insertData;
      });

      const { error: cardsError } = await this.supabase
        .from("flashcards")
        .insert(flashcardsToInsert);

      if (cardsError) {
        logger.error("Error importing flashcards:", cardsError);
        throw cardsError;
      }
    }

    // Invalidate user's deck cache so the new deck shows up
    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    await cacheService.deletePattern(`decks:${userId}*`);

    // Invalidate flashcard caches so newly imported cards show up
    await cacheService.deletePattern("flashcards:*");

    // Cache the new deck
    await cacheService.set(`deck:${newDeck.id}`, newDeck, 1800);

    // fetch back the inserted cards so callers can update state immediately
    let insertedFlashcards: any[] = [];
    if (importData.flashcards && importData.flashcards.length > 0) {
      const { data: cards } = await this.supabase
        .from("flashcards")
        .select("*")
        .eq("deck_id", newDeck.id);
      insertedFlashcards = cards || [];
    }

    return { deck: newDeck, flashcards: insertedFlashcards };
  }

  async createFlashcard(flashcardData: {
    deckId: string;
    type?: string;
    front?: string;
    back?: string;
    clozeText?: string;
    imageUrl?: string;
    occlusionData?: any;
    tags?: string[];
    userId?: string;
  }): Promise<any> {
    const cardType = flashcardData.type || "BASIC";

    if (!flashcardData.userId) {
      throw new Error("Authentication required");
    }
    const canEdit = await this.verifyDeckAccess(
      flashcardData.userId,
      flashcardData.deckId,
      "edit",
    );
    if (!canEdit) {
      throw new Error("Deck not found or access denied");
    }

    const insertData: any = {
      deck_id: flashcardData.deckId,
      type: cardType,
    };

    if (cardType === "CLOZE") {
      // CLOZE cards must have cloze_text and front/back must be NULL per DB constraint
      insertData.cloze_text = flashcardData.clozeText;
      // front and back are left as NULL for CLOZE cards
    } else {
      // For BASIC and IMAGE_OCCLUSION, allow an optional image URL.
      insertData.front = flashcardData.front;
      insertData.back =
        cardType === "IMAGE_OCCLUSION" ? null : flashcardData.back;
      insertData.image_url = flashcardData.imageUrl;
    }

    if (cardType === "IMAGE_OCCLUSION") {
      insertData.occlusion_data = flashcardData.occlusionData;
    }

    if (flashcardData.tags && flashcardData.tags.length > 0) {
      insertData.tags = flashcardData.tags;
    }

    const { data, error } = await this.supabase
      .from("flashcards")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error("Error creating flashcard:", { error, flashcardData });
      throw new Error(error.message || "Failed to create flashcard");
    }

    // Invalidate deck cache
    await cacheService.deletePattern(`flashcards:*`);

    return data;
  }

  /** Best-effort sibling thumb upload; failures never fail the parent upload. */
  private async uploadSiblingThumb(
    bucket: string,
    filePath: string,
    thumb: Buffer | null,
  ): Promise<void> {
    if (!thumb) return;
    try {
      const { error: thumbError } = await this.supabase.storage
        .from(bucket)
        .upload(storageThumbPath(filePath), thumb, {
          contentType: "image/webp",
          cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
          upsert: true,
        });
      if (thumbError) {
        logger.warn("Thumbnail upload failed", {
          bucket,
          filePath,
          error: thumbError.message,
        });
      }
    } catch (thumbErr: any) {
      logger.warn("Thumbnail generation/upload failed", {
        bucket,
        filePath,
        error: thumbErr?.message,
      });
    }
  }

  async uploadFlashcardImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    folder?: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "flashcard-images";
    const timestamp = Date.now();
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const folderSegment = params.folder
      ? `${params.folder.replace(/\.\./g, "").replace(/^\/+|\/+$/g, "")}/`
      : "";

    const buffer = Buffer.from(params.base64Data, "base64");
    assertImageMagicBytes(buffer, params.contentType);
    const { normalized, thumb } = await processImageForUpload(
      buffer,
      "flashcard",
      { detectedMime: detectImageMime(buffer) || params.contentType },
    );
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "flashcard";
    const filePath = `${ownerPrefix}${folderSegment}${timestamp}-${baseName}.${normalized.ext}`;

    const attemptUpload = async () => {
      return this.supabase.storage.from(bucket).upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    };

    let uploadResult = await attemptUpload();

    // If bucket doesn't exist, create it and retry once.
    if (
      uploadResult.error &&
      typeof uploadResult.error.message === "string" &&
      uploadResult.error.message.toLowerCase().includes("bucket") &&
      uploadResult.error.message.toLowerCase().includes("not found")
    ) {
      await this.supabase.storage.createBucket(bucket, { public: false });
      uploadResult = await attemptUpload();
    }

    const { error } = uploadResult;
    if (error) {
      logger.error("Error uploading flashcard image:", { error, filePath });
      throw new Error(error.message);
    }

    await this.uploadSiblingThumb(bucket, filePath, thumb);
    const signedUrl = await this.createSignedStorageUrl(bucket, filePath);

    return {
      url: signedUrl,
      path: filePath,
    };
  }

  /** SEC-07: marketplace images — magic-byte validated server upload. */
  async uploadMarketplaceImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    listingId?: string;
  }): Promise<{ url: string; path: string; storageUrl: string }> {
    const bucket = "marketplace-images";
    const timestamp = Date.now();
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image exceeds 10 MB limit");
    }
    // Prefer magic bytes — clients often send the wrong MIME after compression / camera export.
    const detected = detectImageMime(buffer);
    if (!detected) {
      throw new Error(
        "File content is not a supported image (JPEG, PNG, GIF, or WebP). HEIC/HEIF photos must be converted first.",
      );
    }
    const { normalized, thumb } = await processImageForUpload(
      buffer,
      "marketplace",
      { detectedMime: detected },
    );
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "photo";
    const safeName = `${baseName}.${normalized.ext}`;
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const listingSegment = params.listingId
      ? `listings/${params.listingId.replace(/[^a-zA-Z0-9_-]/g, "")}/`
      : "temp/";
    const filePath = `${ownerPrefix}${listingSegment}${timestamp}-${safeName}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading marketplace image:", { error, filePath });
      throw new Error(error.message);
    }

    // Grid thumbnail at a deterministic sibling path (<path>.thumb.webp).
    await this.uploadSiblingThumb(bucket, filePath, thumb);

    const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
    const storageUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

    return {
      url: await this.createSignedStorageUrl(bucket, filePath),
      path: filePath,
      storageUrl,
    };
  }

  /** SEC-07: chat images stored under note-files/{userId}/chat/{groupId}/... */
  async uploadChatImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    groupId?: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "note-files";
    const timestamp = Date.now();
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const chatId = (params.groupId || "general").replace(/[^a-zA-Z0-9_-]/g, "");
    if (params.groupId) {
      const member = await this.isGroupMember(params.groupId, params.userId);
      if (!member) throw new Error("Not a member of this group");
    }
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image exceeds 10 MB limit");
    }
    assertImageMagicBytes(buffer, params.contentType);
    const { normalized, thumb } = await processImageForUpload(buffer, "chat", {
      detectedMime: detectImageMime(buffer) || params.contentType,
    });
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "chat";
    const filePath = `${ownerPrefix}chat/${chatId}/${timestamp}-${baseName}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading chat image:", { error, filePath });
      throw new Error(error.message);
    }

    await this.uploadSiblingThumb(bucket, filePath, thumb);

    return {
      url: await this.createSignedStorageUrl(
        bucket,
        filePath,
        60 * 60 * 24 * 7,
      ),
      path: filePath,
    };
  }

  /** Chat voice notes under note-files/{userId}/chat/{groupId|dm/threadId}/... */
  async uploadChatAudio(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    groupId?: string;
    threadId?: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "note-files";
    const timestamp = Date.now();
    const safeName = params.fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const allowed = [
      "audio/webm",
      "audio/mp4",
      "audio/m4a",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "audio/x-m4a",
    ];
    const contentType =
      params.contentType === "audio/x-m4a" ? "audio/mp4" : params.contentType;
    if (
      !allowed.includes(params.contentType) &&
      !allowed.includes(contentType)
    ) {
      throw new Error(
        "Unsupported audio type. Use webm, mp4/m4a, ogg, or wav.",
      );
    }
    let chatSegment: string;
    if (params.groupId) {
      const member = await this.isGroupMember(params.groupId, params.userId);
      if (!member) throw new Error("Not a member of this group");
      chatSegment = params.groupId.replace(/[^a-zA-Z0-9_-]/g, "");
    } else if (params.threadId) {
      const participant = await this.isDmThreadParticipant(
        params.threadId,
        params.userId,
      );
      if (!participant)
        throw new Error("Not a participant of this conversation");
      chatSegment = `dm/${params.threadId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    } else {
      chatSegment = "general";
    }
    const filePath = `${ownerPrefix}chat/${chatSegment}/${timestamp}-${safeName}`;
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 8 * 1024 * 1024) {
      throw new Error("Audio exceeds 8 MB limit");
    }
    if (buffer.length < 256) {
      throw new Error("Audio recording is empty or too short");
    }

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading chat audio:", { error, filePath });
      throw new Error(error.message);
    }

    return {
      url: await this.createSignedStorageUrl(
        bucket,
        filePath,
        60 * 60 * 24 * 7,
      ),
      path: filePath,
    };
  }

  /** SEC-07: question/message images — magic-byte validated server upload. */
  async uploadQuestionImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = "question-images";
    const timestamp = Date.now();
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
    const buffer = Buffer.from(params.base64Data, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image exceeds 10 MB limit");
    }
    assertImageMagicBytes(buffer, params.contentType);
    const { normalized, thumb } = await processImageForUpload(
      buffer,
      "question",
      { detectedMime: detectImageMime(buffer) || params.contentType },
    );
    const baseName =
      params.fileName
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_") || "question";
    const filePath = `${ownerPrefix}questions/${timestamp}-${baseName}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: false,
      });
    if (error) {
      logger.error("Error uploading question image:", { error, filePath });
      throw new Error(error.message);
    }

    await this.uploadSiblingThumb(bucket, filePath, thumb);

    return {
      url: await this.createSignedStorageUrl(bucket, filePath),
      path: filePath,
    };
  }

  async uploadProfileAvatar(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  }): Promise<{ url: string; path: string; avatarUrl: string }> {
    const bucket = "profile-avatars";
    const safeUserId = params.userId.replace(/[^a-zA-Z0-9_-]/g, "");
    const buffer = Buffer.from(params.base64Data, "base64");
    // Prefer magic-byte detection — web clients compress to WebP but often send the original file MIME.
    const detected = detectImageMime(buffer);
    if (!detected) {
      throw new Error(
        "File content is not a supported image (JPEG, PNG, GIF, or WebP).",
      );
    }
    const { normalized } = await processImageForUpload(buffer, "avatar", {
      detectedMime: detected,
    });
    // Versioned path so clients and CDNs do not keep serving a stale avatar after replace.
    const version = Date.now();
    const filePath = `${safeUserId}/avatar-${version}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: true,
      });

    if (error) {
      logger.error("Error uploading profile avatar:", { error, filePath });
      throw new Error(error.message);
    }

    // Best-effort cleanup of older avatar objects for this user.
    try {
      const { data: existing } = await this.supabase.storage
        .from(bucket)
        .list(safeUserId, { limit: 50 });
      const stale = (existing || [])
        .map((obj) => obj.name)
        .filter(
          (name) =>
            name.startsWith("avatar") &&
            name !== `avatar-${version}.${normalized.ext}`,
        )
        .map((name) => `${safeUserId}/${name}`);
      if (stale.length > 0) {
        await this.supabase.storage.from(bucket).remove(stale);
      }
    } catch (cleanupError) {
      logger.warn("Failed to clean up old profile avatars", {
        cleanupError,
        userId: safeUserId,
      });
    }

    const signedUrl = await this.createSignedStorageUrl(bucket, filePath);
    const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
    const avatarUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

    return { url: signedUrl, path: filePath, avatarUrl };
  }

  async uploadGroupAvatar(params: {
    groupId: string;
    fileName: string;
    base64Data: string;
    contentType: string;
  }): Promise<{ url: string; path: string; avatarUrl: string }> {
    const bucket = "group-avatars";
    const safeGroupId = params.groupId.replace(/[^a-zA-Z0-9_-]/g, "");
    const buffer = Buffer.from(params.base64Data, "base64");
    const detected = detectImageMime(buffer);
    if (!detected) {
      throw new Error(
        "File content is not a supported image (JPEG, PNG, GIF, or WebP).",
      );
    }
    const { normalized } = await processImageForUpload(buffer, "avatar", {
      detectedMime: detected,
    });
    const version = Date.now();
    const filePath = `${safeGroupId}/avatar-${version}.${normalized.ext}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, normalized.buffer, {
        contentType: normalized.contentType,
        cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
        upsert: true,
      });

    if (error) {
      logger.error("Error uploading group avatar:", { error, filePath });
      throw new Error(error.message);
    }

    try {
      const { data: existing } = await this.supabase.storage
        .from(bucket)
        .list(safeGroupId, { limit: 50 });
      const stale = (existing || [])
        .map((obj) => obj.name)
        .filter(
          (name) =>
            name.startsWith("avatar") &&
            name !== `avatar-${version}.${normalized.ext}`,
        )
        .map((name) => `${safeGroupId}/${name}`);
      if (stale.length > 0) {
        await this.supabase.storage.from(bucket).remove(stale);
      }
    } catch (cleanupError) {
      logger.warn("Failed to clean up old group avatars", {
        cleanupError,
        groupId: safeGroupId,
      });
    }

    const signedUrl = await this.createSignedStorageUrl(bucket, filePath);
    const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
    const avatarUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

    return { url: signedUrl, path: filePath, avatarUrl };
  }

  // Offline bundle persistence
  async getOfflineBundles(userId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("offline_bundles")
      .select("*")
      .eq("user_id", userId)
      .order("downloaded_at", { ascending: false });

    if (error) {
      logger.error("Error fetching offline bundles:", { error, userId });
      throw error;
    }

    return data || [];
  }

  async saveOfflineBundle(userId: string, bundle: any): Promise<void> {
    const insert = {
      user_id: userId,
      bundle_id: bundle.bundleId,
      config: bundle.config || {},
      questions: bundle.questions || [],
      group_name: bundle.groupName || null,
      display_name: bundle.displayName ?? null,
      downloaded_at: bundle.downloadedAt || new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from("offline_bundles")
      .upsert(insert, { onConflict: "user_id,bundle_id" });

    if (error) {
      logger.error("Error saving offline bundle:", {
        error,
        userId,
        bundleId: bundle.bundleId,
      });
      throw error;
    }

    return;
  }

  async deleteOfflineBundle(userId: string, bundleId: string): Promise<void> {
    const { error } = await this.supabase
      .from("offline_bundles")
      .delete()
      .eq("user_id", userId)
      .eq("bundle_id", bundleId);

    if (error) {
      logger.error("Error deleting offline bundle:", {
        error,
        userId,
        bundleId,
      });
      throw error;
    }

    return;
  }

  async getAccessibleDeckIds(userId: string): Promise<string[]> {
    const [
      { data: ownedDecks, error: ownedError },
      { data: collaboratorRows, error: collabError },
    ] = await Promise.all([
      this.supabase.from("decks").select("id").eq("user_id", userId),
      this.supabase
        .from("deck_collaborators")
        .select("deck_id")
        .eq("user_id", userId),
    ]);

    if (ownedError) throw ownedError;
    if (collabError) throw collabError;

    const ids = new Set<string>();
    for (const deck of ownedDecks || []) ids.add(deck.id);
    for (const row of collaboratorRows || []) {
      if (row.deck_id) ids.add(row.deck_id);
    }
    return Array.from(ids);
  }

  /** Internal fetch — no access check. */
  private async fetchDeckRecord(deckId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("decks")
      .select("id, name, description, user_id, is_shared, created_at")
      .eq("id", deckId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async verifyDeckAccess(
    userId: string,
    deckId: string,
    level: "read" | "edit" | "owner" = "read",
  ): Promise<boolean> {
    const deck = await this.fetchDeckRecord(deckId);
    if (!deck) return false;

    const isOwner = deck.user_id === userId;
    if (level === "owner") return isOwner;
    if (isOwner) return true;

    const { data: collab, error: collabError } = await this.supabase
      .from("deck_collaborators")
      .select("role")
      .eq("deck_id", deckId)
      .eq("user_id", userId)
      .maybeSingle();

    if (collabError) throw collabError;

    if (collab) {
      if (level === "read") return true;
      if (level === "edit")
        return collab.role === "editor" || collab.role === "owner";
    }

    if (level === "read" && deck.is_shared) return true;
    return false;
  }

  async getDeckForUser(deckId: string, userId: string): Promise<any | null> {
    const cacheKey = `deck:${deckId}:user:${userId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached;

    const hasAccess = await this.verifyDeckAccess(userId, deckId, "read");
    if (!hasAccess) return null;

    const deck = await this.fetchDeckRecord(deckId);
    if (deck) await cacheService.set(cacheKey, deck, 1800);
    return deck;
  }

  async getFlashcardForUser(
    flashcardId: string,
    userId: string,
  ): Promise<any | null> {
    const cacheKey = `flashcard:${flashcardId}:user:${userId}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("flashcards")
      .select("*")
      .eq("id", flashcardId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const hasAccess = await this.verifyDeckAccess(userId, data.deck_id, "read");
    if (!hasAccess) return null;

    await cacheService.set(cacheKey, data, 1800);
    return data;
  }

  async getFlashcards(
    userId: string,
    deckId?: string,
    options?: {
      page?: number;
      limit?: number;
      responseProfile?: "compact" | "full";
    },
  ): Promise<any[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_FLASHCARD_PAGE_SIZE,
      responseProfile = "full",
    } = options || {};
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(
      SupabaseService.MAX_FLASHCARD_PAGE_SIZE,
      Math.max(1, limit),
    );
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const selectClause =
      profile === "compact"
        ? "id, deck_id, type, front, image_url, tags, created_at, version, updated_at"
        : "id, deck_id, type, front, back, cloze_text, image_url, occlusion_data, srs_data, tags, created_at, version, updated_at";

    const accessibleDeckIds = await this.getAccessibleDeckIds(userId);

    if (accessibleDeckIds.length === 0) {
      return [];
    }

    let query = this.supabase
      .from("flashcards")
      .select(selectClause)
      .in("deck_id", accessibleDeckIds)
      .order("created_at", { ascending: false });

    if (deckId) {
      if (!accessibleDeckIds.includes(deckId)) {
        return [];
      }
      query = query.eq("deck_id", deckId);
    }

    const { data, error } = await query.range(offset, offset + safeLimit - 1);

    if (error) throw error;

    return data || [];
  }

  async getFlashcard(flashcardId: string): Promise<any | null> {
    const cacheKey = `flashcard:${flashcardId}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("flashcards")
      .select("*")
      .eq("id", flashcardId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async getFlashcardComments(flashcardId: string): Promise<any[]> {
    const cacheKey = `flashcard_comments:${flashcardId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from("flashcard_comments")
      .select("*")
      .eq("flashcard_id", flashcardId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    await cacheService.set(cacheKey, data, 300);
    return data;
  }

  async addFlashcardComment(
    flashcardId: string,
    userId: string,
    comment: string,
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("flashcard_comments")
      .insert({ flashcard_id: flashcardId, user_id: userId, comment })
      .select()
      .single();

    if (error) throw error;

    await cacheService.delete(`flashcard_comments:${flashcardId}`);
    return data;
  }

  async reviewFlashcard(
    flashcardId: string,
    userId: string,
    rating: "again" | "hard" | "good" | "easy",
    options: { expectedVersion?: number } = {},
  ): Promise<any | null> {
    const existing = await this.getFlashcardForUser(flashcardId, userId);
    if (!existing) return null;

    const canEdit = await this.verifyDeckAccess(
      userId,
      existing.deck_id,
      "edit",
    );
    if (!canEdit) return null;

    const prefs = await this.getUserPreferences(userId);
    const settings = normalizeUserSettings(
      prefs?.preferences ?? prefs?.settings ?? {},
    );
    const newSrsData = calculateFsrsData(existing.srs_data, rating, {
      maxInterval: getSrsMaxInterval(settings.study),
    });

    const expectedVersion =
      options.expectedVersion != null &&
      Number.isFinite(Number(options.expectedVersion))
        ? Number(options.expectedVersion)
        : Number(existing.version) || 1;
    return this.updateFlashcard(flashcardId, { srsData: newSrsData }, userId, {
      expectedVersion,
    });
  }

  async updateFlashcard(
    flashcardId: string,
    updates: {
      front?: string;
      back?: string;
      clozeText?: string;
      imageUrl?: string;
      occlusionData?: any;
      srsData?: any;
      tags?: string[];
    },
    userId?: string,
    options: { expectedVersion?: number } = {},
  ): Promise<any | null> {
    const existing = userId
      ? await this.getFlashcardForUser(flashcardId, userId)
      : await this.getFlashcard(flashcardId);
    if (!existing) return null;
    if (userId) {
      const canEdit = await this.verifyDeckAccess(
        userId,
        existing.deck_id,
        "edit",
      );
      if (!canEdit) return null;
    }

    // Build update object with only defined fields.
    // CLOZE rows require front/back NULL (check_flashcard_fields); clients often
    // send front:'' which must not be written as an empty string.
    const updateData: any = buildFlashcardUpdateData(existing.type, updates);

    // If no fields to update, just return the current flashcard
    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    const expectedVersion =
      options.expectedVersion != null
        ? Number(options.expectedVersion)
        : Number(existing.version) || 1;

    const { data, error } = await this.supabase
      .from("flashcards")
      .update(updateData)
      .eq("id", flashcardId)
      .eq("version", expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null;
      logger.error("Error updating flashcard:", {
        error,
        flashcardId,
        updates,
      });
      throw new Error(error.message || "Failed to update flashcard");
    }

    if (!data) {
      const current = userId
        ? await this.getFlashcardForUser(flashcardId, userId)
        : await this.getFlashcard(flashcardId);
      throw new VersionConflictError(
        "Flashcard was updated by another request. Retry the review.",
        current,
      );
    }

    // Update cache and invalidate deck cache
    await cacheService.set(`flashcard:${flashcardId}`, data, 1800);
    if (userId)
      await cacheService.delete(`flashcard:${flashcardId}:user:${userId}`);
    await cacheService.deletePattern(`flashcards:*`);

    return data;
  }

  async deleteFlashcard(
    flashcardId: string,
    userId?: string,
  ): Promise<boolean> {
    const flashcard = userId
      ? await this.getFlashcardForUser(flashcardId, userId)
      : await this.getFlashcard(flashcardId);
    if (!flashcard) return false;
    if (userId) {
      const canEdit = await this.verifyDeckAccess(
        userId,
        flashcard.deck_id,
        "edit",
      );
      if (!canEdit) return false;
    }

    const { error } = await this.supabase
      .from("flashcards")
      .delete()
      .eq("id", flashcardId);

    if (error) throw error;

    // Clear caches
    await cacheService.delete(`flashcard:${flashcardId}`);
    await cacheService.deletePattern(`flashcards:*`);

    return true;
  }

  /**
   * Attach question stems / group names from chat messages so dashboards can
   * render "Questions to review" even when lean test history omits questions.
   */
  private async attachQuestionStatStems(rows: any[]): Promise<any[]> {
    if (!rows.length) return rows;
    const questionIds = [
      ...new Set(
        rows
          .map((row) => row?.question_id || row?.questionId)
          .filter((id): id is string => typeof id === "string" && !!id),
      ),
    ];
    if (!questionIds.length) return rows;

    const { data: messages, error } = await this.supabase
      .from("messages")
      .select("id, group_id, text, question_data, groups:group_id(name)")
      .in("id", questionIds);

    if (error) {
      logger.warn("Failed to attach question stems for user stats", { error });
      return rows;
    }

    const byId = new Map<string, any>();
    (messages || []).forEach((msg: any) => {
      if (msg?.id) byId.set(msg.id, msg);
    });

    return rows.map((row) => {
      const questionId = row?.question_id || row?.questionId;
      const msg = questionId ? byId.get(questionId) : null;
      if (!msg) return row;
      const qd =
        msg.question_data && typeof msg.question_data === "object"
          ? msg.question_data
          : {};
      const stem =
        (typeof qd.questionStem === "string" && qd.questionStem) ||
        (typeof qd.question === "string" && qd.question) ||
        (typeof qd.text === "string" && qd.text) ||
        (typeof msg.text === "string" && msg.text) ||
        null;
      const groupProfile = Array.isArray(msg.groups)
        ? msg.groups[0]
        : msg.groups;
      const groupName =
        (typeof groupProfile?.name === "string" && groupProfile.name) || null;
      return {
        ...row,
        question_stem: stem,
        group_id: msg.group_id || row.group_id || null,
        group_name: groupName,
      };
    });
  }

  async getUserQuestionStats(userId: string): Promise<any[]> {
    const cacheKey = `user-stats:${userId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    let rows: any[];
    if (cached !== null && cached !== undefined) {
      rows = Array.isArray(cached) ? cached : [];
    } else {
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .select("*")
        .eq("user_id", userId)
        .order("last_attempted", { ascending: false });

      if (error) throw error;

      rows = Array.isArray(data) ? data : [];
      await cacheService.set(cacheKey, rows, 1800); // 30 minutes
    }

    return this.attachQuestionStatStems(rows);
  }

  async updateUserQuestionStats(
    userId: string,
    questionId: string,
    stats: {
      correct_attempts?: number;
      incorrect_attempts?: number;
      last_attempted?: Date;
    },
  ): Promise<any> {
    // Check if stats exist
    const { data: existing, error: checkError } = await this.supabase
      .from("user_question_stats")
      .select("*")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .single();

    if (checkError && checkError.code !== "PGRST116") throw checkError;

    let result;
    if (existing) {
      // Update existing stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .update({
          correct_attempts:
            stats.correct_attempts !== undefined
              ? stats.correct_attempts
              : existing.correct_attempts,
          incorrect_attempts:
            stats.incorrect_attempts !== undefined
              ? stats.incorrect_attempts
              : existing.incorrect_attempts,
          last_attempted: stats.last_attempted || existing.last_attempted,
        })
        .eq("user_id", userId)
        .eq("question_id", questionId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .insert({
          user_id: userId,
          question_id: questionId,
          correct_attempts: stats.correct_attempts || 0,
          incorrect_attempts: stats.incorrect_attempts || 0,
          last_attempted: stats.last_attempted || new Date(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Invalidate both cache key shapes used by summary + dedicated routes.
    await cacheService.delete(`user-stats:${userId}`);
    await cacheService.delete(`user:question-stats:${userId}`);

    return result;
  }

  async getUserQuestionStat(
    userId: string,
    questionId: string,
  ): Promise<any | null> {
    const cacheKey = `user-stat:${userId}:${questionId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached as any;

    const { data, error } = await this.supabase
      .from("user_question_stats")
      .select("*")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async upsertUserQuestionStat(
    userId: string,
    questionId: string,
    stats: {
      correctAttempts?: number;
      incorrectAttempts?: number;
      lastAttempted?: Date;
    },
  ): Promise<any> {
    // Check if stats exist
    const { data: existing, error: checkError } = await this.supabase
      .from("user_question_stats")
      .select("*")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .single();

    if (checkError && checkError.code !== "PGRST116") throw checkError;

    let result;
    if (existing) {
      // Update existing stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .update({
          correct_attempts:
            stats.correctAttempts !== undefined
              ? stats.correctAttempts
              : existing.correct_attempts,
          incorrect_attempts:
            stats.incorrectAttempts !== undefined
              ? stats.incorrectAttempts
              : existing.incorrect_attempts,
          last_attempted: stats.lastAttempted || existing.last_attempted,
        })
        .eq("user_id", userId)
        .eq("question_id", questionId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new stats
      const { data, error } = await this.supabase
        .from("user_question_stats")
        .insert({
          user_id: userId,
          question_id: questionId,
          correct_attempts: stats.correctAttempts || 0,
          incorrect_attempts: stats.incorrectAttempts || 0,
          last_attempted: stats.lastAttempted || new Date(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Invalidate both cache key shapes used by summary + dedicated routes.
    await cacheService.delete(`user-stats:${userId}`);
    await cacheService.delete(`user:question-stats:${userId}`);

    return result;
  }

  async resetDeckStatistics(deckId: string, userId: string): Promise<any> {
    const canEdit = await this.verifyDeckAccess(userId, deckId, "edit");
    if (!canEdit) throw new Error("Deck not found or access denied");

    // clear srs_data on all cards in deck so they appear new again
    const { error: cardError } = await this.supabase
      .from("flashcards")
      .update({ srs_data: {} })
      .eq("deck_id", deckId);

    if (cardError) throw cardError;

    // also invalidate any related cache entries
    await cacheService.deletePattern(`flashcards:*`);
    await cacheService.delete(`deck:${deckId}`);

    return { success: true };
  }

  async getDirectMessages(
    userId: string,
    otherUserId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<Message[]> {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    // Create thread ID from sorted user IDs
    const sortedIds = [userId, otherUserId].sort();
    const threadId = sortedIds.join("-");

    try {
      const { data: threadMeta } = await this.supabase
        .from("dm_threads")
        .select("history_cleared_at")
        .eq("id", threadId)
        .maybeSingle();
      const historyClearedAt = readDmHistoryClearedAt(
        threadMeta?.history_cleared_at,
        userId,
      );

      let query = this.supabase
        .from("dm_messages")
        .select(
          `
          id,
          thread_id,
          sender_id,
          text,
          timestamp,
          edited_at,
          removed_at,
          client_message_id,
          reply_to_message_id,
          thread_root_id,
          profiles:sender_id (
            id,
            name,
            avatar_url
          )
        `,
        )
        .eq("thread_id", threadId)
        .order("timestamp", { ascending: false })
        .range(offset, offset + limit - 1);

      // Delete-for-me: never return pre-cutoff history to the deleter.
      if (historyClearedAt) {
        query = query.gt("timestamp", historyClearedAt);
      }

      const { data, error } = await query;

      if (error) {
        logger.error("Error fetching DM messages from database", {
          error,
          threadId,
        });
        return [];
      }

      const withReplies = await this.attachReplyPreviewsBatch(
        data || [],
        "dm_messages",
      );
      const withCounts = await this.attachThreadReplyCounts(
        withReplies,
        "dm_messages",
        "thread_id",
        threadId,
      );

      const mapped = withCounts.reverse().map((msg: any) => ({
        id: msg.id,
        threadId: msg.thread_id,
        sender: mapProfileSender(
          resolveNestedProfile(msg.profiles),
          msg.sender_id,
        ),
        senderId: msg.sender_id,
        timestamp: new Date(msg.timestamp),
        type: "TEXT" as const,
        ...(!msg.removed_at ? { text: msg.text } : {}),
        editedAt: msg.edited_at || undefined,
        removedAt: msg.removed_at || undefined,
        isRemoved: !!msg.removed_at,
        upvotes: 0,
        downvotes: 0,
        flaggedAsSimilarUserIds: [],
        clientMessageId: msg.client_message_id || undefined,
        replyToMessageId: msg.reply_to_message_id || undefined,
        replyTo: msg.replyTo || undefined,
        threadRootId: msg.thread_root_id || undefined,
        replyCount: typeof msg.replyCount === "number" ? msg.replyCount : 0,
      })) as Message[];

      return this.enrichDmMessageReceipts(
        mapped,
        threadId,
        userId,
        otherUserId,
      );
    } catch (error) {
      logger.error("Exception fetching DM messages", {
        error,
        userId,
        otherUserId,
      });
      return [];
    }
  }

  async sendDirectMessage(
    senderId: string,
    recipientId: string,
    content: string,
    options?: {
      bypassPrivacy?: boolean;
      clientMessageId?: string;
      replyToMessageId?: string;
    },
  ): Promise<Message> {
    let asMessageRequest = false;

    const { usersAreBlocked, resolveDirectMessageAccess } =
      await import("../utils/userSettingsPolicy");
    // Blocks always apply — even marketplace / bypassPrivacy paths.
    if (await usersAreBlocked(this.supabase, senderId, recipientId)) {
      throw new Error("You cannot message this user");
    }

    if (!options?.bypassPrivacy) {
      const { data: recipientProfile, error: recipientError } =
        await this.supabase
          .from("profiles")
          .select("settings")
          .eq("id", recipientId)
          .single();

      if (recipientError || !recipientProfile) {
        throw new Error("Recipient not found");
      }

      const access = await resolveDirectMessageAccess(
        this.supabase,
        senderId,
        recipientId,
        recipientProfile.settings,
      );
      if (access.mode === "deny") {
        throw new Error(access.reason || "Direct messages are not allowed");
      }
      asMessageRequest = access.mode === "request";
    }

    // Create thread ID from sorted user IDs
    const sortedIds = [senderId, recipientId].sort();
    const threadId = sortedIds.join("-");

    try {
      const { data: existingThread } = await this.supabase
        .from("dm_threads")
        .select("id, status, requested_by, archived_by, history_cleared_at")
        .eq("id", threadId)
        .maybeSingle();

      // Marketplace / bypass and recipient replies open the thread; cold outreach stays pending.
      let nextStatus: "open" | "pending" | "declined" = "open";
      let nextRequestedBy: string | null = null;
      if (options?.bypassPrivacy) {
        nextStatus = "open";
        nextRequestedBy = null;
      } else if (asMessageRequest) {
        nextStatus = "pending";
        nextRequestedBy =
          (typeof existingThread?.requested_by === "string" &&
            existingThread.requested_by) ||
          senderId;
      } else if (
        existingThread?.status === "pending" &&
        existingThread.requested_by !== senderId
      ) {
        // Recipient replied → accept.
        nextStatus = "open";
        nextRequestedBy = null;
      } else if (existingThread?.status === "open") {
        nextStatus = "open";
        nextRequestedBy = null;
      } else {
        nextStatus = "open";
        nextRequestedBy = null;
      }

      const { error: threadError } = await this.supabase
        .from("dm_threads")
        .upsert(
          {
            id: threadId,
            participant_ids: sortedIds,
            participants: {},
            last_message: content,
            last_message_time: new Date().toISOString(),
            status: nextStatus,
            requested_by: nextRequestedBy,
          },
          { onConflict: "id" },
        );

      if (threadError) {
        logger.error("Error creating/updating DM thread", {
          error: threadError,
        });
        throw new Error(`Failed to create DM thread: ${threadError.message}`);
      }

      // Insert the message
      const insertPayload: Record<string, unknown> = {
        thread_id: threadId,
        sender_id: senderId,
        text: content,
      };
      if (options?.clientMessageId) {
        insertPayload.client_message_id = options.clientMessageId;
      }
      if (options?.replyToMessageId) {
        insertPayload.reply_to_message_id = options.replyToMessageId;
        insertPayload.thread_root_id = await this.resolveThreadRootForReply(
          "dm_messages",
          options.replyToMessageId,
          { threadId },
        );
      }

      const dmSelect = `
          id,
          thread_id,
          sender_id,
          text,
          timestamp,
          edited_at,
          removed_at,
          client_message_id,
          reply_to_message_id,
          thread_root_id,
          profiles:sender_id (
            id,
            name,
            avatar_url
          )
        `;

      const { data, error } = await this.supabase
        .from("dm_messages")
        .insert(insertPayload)
        .select(dmSelect)
        .single();

      if (error) {
        if (error.code === "23505" && options?.clientMessageId) {
          const { data: existing } = await this.supabase
            .from("dm_messages")
            .select(dmSelect)
            .eq("thread_id", threadId)
            .eq("sender_id", senderId)
            .eq("client_message_id", options.clientMessageId)
            .maybeSingle();
          if (existing) {
            const withReply = await this.attachReplyPreview(
              existing,
              "dm_messages",
            );
            return {
              id: withReply.id,
              sender: mapProfileSender(
                resolveNestedProfile(withReply.profiles),
                withReply.sender_id,
              ),
              senderId: withReply.sender_id,
              recipientId,
              timestamp: new Date(withReply.timestamp),
              type: "TEXT" as const,
              ...(!withReply.removed_at ? { text: withReply.text } : {}),
              editedAt: withReply.edited_at || undefined,
              removedAt: withReply.removed_at || undefined,
              isRemoved: !!withReply.removed_at,
              upvotes: 0,
              downvotes: 0,
              flaggedAsSimilarUserIds: [],
              clientMessageId:
                withReply.client_message_id || options?.clientMessageId || undefined,
              replyToMessageId: withReply.reply_to_message_id || undefined,
              replyTo: withReply.replyTo || undefined,
              threadRootId: withReply.thread_root_id || undefined,
              replyCount: 0,
              receiptStatus: "sent" as const,
            } as unknown as Message;
          }
        }
        logger.error("Error inserting DM message", { error });
        throw new Error(`Failed to send DM: ${error.message}`);
      }

      // Un-archive for recipient, un-hide for inbox resurrection, and update
      // last message. Clearing hidden_by resurfaces the thread. Clear the *sender's*
      // history_cleared_at so their first message after delete-for-me is visible;
      // the recipient's cutoff is preserved.
      const archivedBy: string[] = Array.isArray(existingThread?.archived_by)
        ? existingThread.archived_by
        : [];
      const updatedArchivedBy = archivedBy.filter(
        (id: string) => id !== recipientId,
      );
      const nextHistoryClearedAt = clearDmHistoryClearedAtForUser(
        existingThread?.history_cleared_at,
        senderId,
      );

      await this.supabase
        .from("dm_threads")
        .update({
          last_message: content,
          last_message_time: new Date().toISOString(),
          archived_by: updatedArchivedBy,
          hidden_by: [],
          status: nextStatus,
          requested_by: nextRequestedBy,
          history_cleared_at: nextHistoryClearedAt,
        })
        .eq("id", threadId);

      const senderProfile = Array.isArray(data.profiles)
        ? (data.profiles as unknown as any[])[0]
        : (data.profiles as unknown as any);
      const senderName = senderProfile?.name || "Someone";
      const preview =
        content.length > 80 ? `${content.slice(0, 80)}…` : content;
      const isRequestNotify = nextStatus === "pending";

      void this.createNotification(recipientId, {
        message: isRequestNotify
          ? `${senderName} sent a message request: "${preview}"`
          : `${senderName} sent you a message`,
        link: `dm:${threadId}:${senderId}`,
        type: isRequestNotify ? "dm_message_request" : "dm_message",
        data: {
          threadId,
          senderId,
          messageId: data.id,
          preview,
          status: nextStatus,
        },
      }).catch((err) => {
        logger.error("Failed to create DM notification", {
          error: err,
          recipientId,
          threadId,
        });
      });

      const withReply = await this.attachReplyPreview(data, "dm_messages");
      return {
        id: withReply.id,
        sender: mapProfileSender(
          resolveNestedProfile(withReply.profiles),
          withReply.sender_id,
        ),
        senderId: withReply.sender_id,
        recipientId,
        timestamp: new Date(withReply.timestamp),
        type: "TEXT" as const,
        text: withReply.text,
        editedAt: withReply.edited_at || undefined,
        removedAt: withReply.removed_at || undefined,
        isRemoved: !!withReply.removed_at,
        upvotes: 0,
        downvotes: 0,
        flaggedAsSimilarUserIds: [],
        clientMessageId:
          withReply.client_message_id || options?.clientMessageId || undefined,
        replyToMessageId: withReply.reply_to_message_id || undefined,
        replyTo: withReply.replyTo || undefined,
        threadRootId: withReply.thread_root_id || undefined,
        replyCount: 0,
        receiptStatus: "sent" as const,
        threadStatus: nextStatus,
        isMessageRequest: nextStatus === "pending",
      } as unknown as Message;
    } catch (error: any) {
      logger.error("Exception sending DM", {
        error: error.message,
        senderId,
        recipientId,
      });
      throw error;
    }
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (!blockerId || !blockedId || blockerId === blockedId) {
      throw new Error("Invalid block request");
    }
    const { error } = await this.supabase
      .from("user_blocks")
      .upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: "blocker_id,blocked_id" },
      );
    if (error) throw error;
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);
    if (error) throw error;
  }

  async listBlockedUserIds(blockerId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("user_blocks")
      .select("blocked_id")
      .eq("blocker_id", blockerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || [])
      .map((row: { blocked_id?: string }) => row.blocked_id)
      .filter((id: string | undefined): id is string => typeof id === "string");
  }

  async isDmBlockedBetween(userIdA: string, userIdB: string): Promise<boolean> {
    const { usersAreBlocked } = await import("../utils/userSettingsPolicy");
    return usersAreBlocked(this.supabase, userIdA, userIdB);
  }

  async didUserBlock(blockerId: string, blockedId: string): Promise<boolean> {
    if (!blockerId || !blockedId || blockerId === blockedId) return false;
    const { data, error } = await this.supabase
      .from("user_blocks")
      .select("blocker_id")
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    return !!data?.blocker_id;
  }

  async acceptDmMessageRequest(
    threadId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: "open";
    requestedBy: null;
  }> {
    const { data: thread, error } = await this.supabase
      .from("dm_threads")
      .select("id, participant_ids, status, requested_by")
      .eq("id", threadId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!thread) throw new Error("Thread not found");

    const pids = Array.isArray(thread.participant_ids)
      ? thread.participant_ids
      : [];
    if (!pids.includes(userId)) throw new Error("Access denied");
    if (thread.status === "open") {
      return { id: thread.id, status: "open", requestedBy: null };
    }
    if (thread.status !== "pending") {
      throw new Error("This message request cannot be accepted");
    }
    if (thread.requested_by === userId) {
      throw new Error("Only the recipient can accept this message request");
    }

    const otherId = pids.find((id: string) => id !== userId);
    if (otherId && (await this.isDmBlockedBetween(userId, otherId))) {
      throw new Error("You cannot message this user");
    }

    const { error: updateError } = await this.supabase
      .from("dm_threads")
      .update({ status: "open", requested_by: null })
      .eq("id", threadId);
    if (updateError) throw updateError;

    if (typeof thread.requested_by === "string") {
      void this.createNotification(thread.requested_by, {
        message: "Your message request was accepted",
        link: `dm:${threadId}:${userId}`,
        type: "dm_message",
        data: { threadId, senderId: userId, status: "open" },
      }).catch((err) => {
        logger.warn("Failed to notify requester of accepted DM request", {
          err,
          threadId,
        });
      });
    }

    return { id: threadId, status: "open", requestedBy: null };
  }

  async declineDmMessageRequest(
    threadId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: "declined";
    requestedBy: string | null;
  }> {
    const { data: thread, error } = await this.supabase
      .from("dm_threads")
      .select("id, participant_ids, status, requested_by")
      .eq("id", threadId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    if (!thread) throw new Error("Thread not found");

    const pids = Array.isArray(thread.participant_ids)
      ? thread.participant_ids
      : [];
    if (!pids.includes(userId)) throw new Error("Access denied");
    if (thread.status === "declined") {
      return {
        id: thread.id,
        status: "declined",
        requestedBy:
          typeof thread.requested_by === "string" ? thread.requested_by : null,
      };
    }
    if (thread.status !== "pending") {
      throw new Error("This message request cannot be declined");
    }
    if (thread.requested_by === userId) {
      throw new Error("Only the recipient can decline this message request");
    }

    const { error: updateError } = await this.supabase
      .from("dm_threads")
      .update({ status: "declined" })
      .eq("id", threadId);
    if (updateError) throw updateError;

    return {
      id: threadId,
      status: "declined",
      requestedBy:
        typeof thread.requested_by === "string" ? thread.requested_by : null,
    };
  }

  async searchMessages(
    query: string,
    options: {
      groupId?: string;
      userId?: string;
      limit?: number;
      requestingUserId?: string;
    } = {},
  ): Promise<Message[]> {
    const { groupId, userId, limit = 50, requestingUserId } = options;

    // Build search query
    let searchQuery = this.supabase
      .from("messages")
      .select(
        `
        id,
        group_id,
        sender_id,
        type,
        text,
        question_data,
        flagged_as_similar_user_ids,
        timestamp,
        profiles!sender_id (
          id,
          name,
          username,
          avatar_url
        )
      `,
      )
      .ilike("text", `%${query}%`)
      .is("removed_at", null)
      .eq("is_archived", false)
      .limit(limit);

    if (groupId) {
      searchQuery = searchQuery.eq("group_id", groupId);
    }

    if (userId) {
      searchQuery = searchQuery.eq("sender_id", userId);
    }

    // If requesting user is specified, only search in groups they're members of
    if (requestingUserId && !groupId) {
      const { data: memberGroups, error: memberError } = await this.supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", requestingUserId);

      if (memberError) throw memberError;

      const groupIds = memberGroups?.map((mg) => mg.group_id) || [];
      if (groupIds.length === 0) return [];

      searchQuery = searchQuery.in("group_id", groupIds);
    }

    const { data, error } = await searchQuery.order("timestamp", {
      ascending: false,
    });

    if (error) throw error;

    return (data || []).map((msg: any) => ({
      id: msg.id,
      groupId: msg.group_id,
      sender: mapProfileSender(msg.profiles, msg.sender_id),
      senderId: msg.sender_id,
      timestamp: msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
      upvotes: 0,
      downvotes: 0,
      ...this.normalizeMessageRecord(msg),
    }));
  }

  // Notification Methods for API Routes
  async getUserNotifications(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      unreadOnly?: boolean;
    } = {},
  ): Promise<Notification[]> {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `notifications:${userId}:${page}:${limit}:${unreadOnly}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId);

        if (unreadOnly) {
          query = query.eq("read", false);
        }

        const { data, error } = await query
          .order("date", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return data || [];
      },
      { ttl: 120 },
    ); // Cache for 2 minutes
  }

  async getNotificationById(
    notificationId: string,
    userId?: string,
  ): Promise<Notification | null> {
    const cacheKey = `notification:${notificationId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("notifications")
          .select("*")
          .eq("id", notificationId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check if notification belongs to user
        if (userId && data.user_id !== userId) {
          return null; // Access denied
        }

        return data;
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async createNotification(
    userId: string,
    notificationData: {
      message: string;
      link?: string;
      type?: string;
      data?: Record<string, unknown>;
      force?: boolean;
    },
  ): Promise<Notification | null> {
    if (!notificationData.force) {
      const { data: profile, error: profileError } = await this.supabase
        .from("profiles")
        .select("settings")
        .eq("id", userId)
        .single();

      if (!profileError && profile) {
        const { shouldCreateInAppNotification } =
          await import("../utils/userSettingsPolicy");
        if (
          !shouldCreateInAppNotification(
            profile.settings,
            notificationData.type,
          )
        ) {
          return null;
        }
      }

      const type = notificationData.type || "info";
      const { CHAT_MUTEABLE_NOTIFICATION_TYPES } =
        await import("@lantern/shared/utils/chatMute");
      if (CHAT_MUTEABLE_NOTIFICATION_TYPES.has(type)) {
        const data = notificationData.data || {};
        const groupId = typeof data.groupId === "string" ? data.groupId : null;
        const threadId =
          typeof data.threadId === "string" ? data.threadId : null;
        if (groupId && (await this.isChatMuted(userId, "group", groupId))) {
          return null;
        }
        if (threadId && (await this.isChatMuted(userId, "dm", threadId))) {
          return null;
        }
      }
    }

    const { data, error } = await this.supabase
      .from("notifications")
      .insert({
        user_id: userId,
        message: notificationData.message,
        link: notificationData.link,
        type: notificationData.type || "info",
        data: notificationData.data || {},
        read: false,
      })
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    void this.sendExpoPushForNotification(userId, notificationData);

    return data;
  }

  async markNotificationAsRead(
    notificationId: string,
  ): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${data.user_id}:*`);
    await cacheService.delete(`notifications:stats:${data.user_id}`);

    return data;
  }

  async markAllNotificationsAsRead(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false)
      .select("id");

    if (error) throw error;

    const updatedCount = data?.length || 0;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    return updatedCount;
  }

  async deleteNotification(notificationId: string): Promise<boolean> {
    // Get notification first to know which user to invalidate
    const { data: notification, error: fetchError } = await this.supabase
      .from("notifications")
      .select("user_id")
      .eq("id", notificationId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") return false; // Not found
      throw fetchError;
    }

    const { error } = await this.supabase
      .from("notifications")
      .delete()
      .eq("id", notificationId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${notification.user_id}:*`);
    await cacheService.delete(`notifications:stats:${notification.user_id}`);

    return true;
  }

  async deleteAllNotifications(userId: string): Promise<number> {
    // Count notifications first
    const { count, error: countError } = await this.supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) throw countError;

    // Delete all notifications for user
    const { error } = await this.supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.deletePattern(`notification:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    return count || 0;
  }

  async getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    read: number;
  }> {
    const cacheKey = `notifications:stats:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("notifications")
          .select("read")
          .eq("user_id", userId);

        if (error) throw error;

        const total = data?.length || 0;
        const unread = data?.filter((n) => !n.read).length || 0;
        const read = total - unread;

        return { total, unread, read };
      },
      { ttl: 60 },
    ); // Cache for 1 minute
  }

  async createBulkNotifications(
    notifications: Array<{
      userId: string;
      message: string;
      link?: string;
      type?: string;
    }>,
  ): Promise<Notification[]> {
    const notificationsToInsert = notifications.map((n) => ({
      user_id: n.userId,
      message: n.message,
      link: n.link,
      type: n.type || "info",
      read: false,
    }));

    const { data, error } = await this.supabase
      .from("notifications")
      .insert(notificationsToInsert)
      .select();

    if (error) throw error;

    // Invalidate caches for affected users
    const affectedUserIds = [...new Set(notifications.map((n) => n.userId))];
    for (const userId of affectedUserIds) {
      await cacheService.deletePattern(`notifications:${userId}:*`);
    }

    return data || [];
  }

  // Test Methods for API Routes
  async getUserTests(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      status?: string;
      subject?: string;
      lean?: boolean;
      sort?: "newest" | "oldest" | "highestScore";
      from?: string;
      to?: string;
    } = {},
  ): Promise<{ tests: any[]; total: number }> {
    const {
      page = 1,
      limit = 20,
      status,
      subject,
      lean = false,
      sort = "newest",
      from,
      to,
    } = options;
    const offset = (page - 1) * limit;
    const sortKey = sort || "newest";
    const fromKey = from || "";
    const toKey = to || "";

    const cacheKey = `tests:${userId}:${page}:${limit}:${status || ""}:${subject || ""}:${lean ? "lean" : "full"}:${sortKey}:${fromKey}:${toKey}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Completed lean history only needs scores + config for charts, so omit
        // the questions so all-time pagination stays payload-light. user_answers
        // IS read, because the dashboard's "Avg / question" and total study time
        // are derived from per-answer timings — but it is folded into two numbers
        // below and never sent to the client, so the response stays lean.
        const completedLean = lean && status === "completed";
        const selectCols = lean
          ? `
          id,
          start_time,
          end_time,
          is_offline,
          config,
          status,
          session_kind,
          current_question_index,
          remaining_time_seconds,
          paused_at,
          updated_at,
          title,
          ${completedLean ? "" : "questions,"}
          user_answers,
          test_results (
            score,
            correct_answers_count,
            total_questions
          )
        `
          : `
          *,
          test_results (
            score,
            correct_answers_count,
            total_questions
          )
        `;

        let query = this.supabase
          .from("test_sessions")
          .select(selectCols, { count: "exact" })
          .eq("user_id", userId);

        if (status === "completed") {
          query = query.eq("status", "completed");
        } else if (status === "paused") {
          query = query.eq("status", "paused");
        } else if (status === "in_progress") {
          query = query.in("status", ["in_progress", "paused"]);
        } else if (status === "not_started") {
          query = query.is("start_time", null);
        } else if (status === "abandoned") {
          query = query.eq("status", "abandoned");
        }

        if (subject) {
          query = query.eq("config->>subject", subject);
        }

        if (from) {
          query = query.gte("start_time", from);
        }
        if (to) {
          query = query.lte("start_time", to);
        }

        const orderByUpdated =
          status === "paused" || status === "in_progress";
        if (sortKey === "oldest") {
          query = query.order(
            orderByUpdated ? "updated_at" : "start_time",
            { ascending: true },
          );
        } else if (sortKey === "highestScore") {
          // Prefer score from joined test_results; fall back below if PostgREST rejects the order.
          query = query
            .order("score", {
              referencedTable: "test_results",
              ascending: false,
              nullsFirst: false,
            })
            .order("start_time", { ascending: false });
        } else {
          query = query.order(
            orderByUpdated ? "updated_at" : "start_time",
            { ascending: false },
          );
        }

        let { data, error, count } = await query.range(
          offset,
          offset + limit - 1,
        );

        if (error && sortKey === "highestScore") {
          logger.warn("highestScore order failed; falling back to newest", {
            error: error.message,
          });
          let fallback = this.supabase
            .from("test_sessions")
            .select(selectCols, { count: "exact" })
            .eq("user_id", userId);
          if (status === "completed") fallback = fallback.eq("status", "completed");
          else if (status === "paused") fallback = fallback.eq("status", "paused");
          else if (status === "in_progress") {
            fallback = fallback.in("status", ["in_progress", "paused"]);
          } else if (status === "not_started")
            fallback = fallback.is("start_time", null);
          else if (status === "abandoned")
            fallback = fallback.eq("status", "abandoned");
          if (subject) fallback = fallback.eq("config->>subject", subject);
          if (from) fallback = fallback.gte("start_time", from);
          if (to) fallback = fallback.lte("start_time", to);
          const retry = await fallback
            .order("start_time", { ascending: false })
            .range(offset, offset + limit - 1);
          data = retry.data;
          error = retry.error;
          count = retry.count;
          if (!error && Array.isArray(data)) {
            data = [...data].sort((a: any, b: any) => {
              const aScore = Array.isArray(a.test_results)
                ? a.test_results[0]?.score
                : a.test_results?.score;
              const bScore = Array.isArray(b.test_results)
                ? b.test_results[0]?.score
                : b.test_results?.score;
              return (bScore || 0) - (aScore || 0);
            });
          }
        }

        if (error) throw error;

        const tests = (data || []).map((session: any) => {
          const result = Array.isArray(session.test_results)
            ? session.test_results[0]
            : session.test_results;
          const questions = Array.isArray(session.questions)
            ? session.questions
            : [];
          const answers =
            session.user_answers && typeof session.user_answers === "object"
              ? session.user_answers
              : {};
          const answeredCount = Array.isArray(answers)
            ? answers.length
            : Object.keys(answers).length;
          const sessionStatus = session.status ||
            (session.end_time ? "completed" : "in_progress");

          // Fold per-answer timings into a sum and a count. Lean responses drop
          // user_answers, so without these the dashboards cannot compute
          // "Avg / question" or total study time and render a dash. Answers with
          // no recorded time are excluded from both, so the client can divide
          // them directly. Kept as sum+count rather than a pre-divided average so
          // the client can weight correctly when it aggregates across tests.
          let timeSpentSeconds = 0;
          let questionsWithTime = 0;
          for (const answer of Object.values(answers) as any[]) {
            const spent = answer?.timeSpentSeconds ?? answer?.time_spent_seconds;
            if (typeof spent === "number" && Number.isFinite(spent)) {
              timeSpentSeconds += spent;
              questionsWithTime++;
            }
          }

          if (
            lean &&
            (sessionStatus === "paused" || sessionStatus === "in_progress")
          ) {
            return {
              id: session.id,
              sessionKind: session.session_kind || "test",
              status: sessionStatus,
              title:
                session.title ||
                session.config?.groupName ||
                (session.session_kind === "study" ? "Study session" : "Test"),
              answeredCount,
              totalQuestions: questions.length,
              currentQuestionIndex: session.current_question_index || 0,
              remainingTimeSeconds: session.remaining_time_seconds ?? null,
              startTime: session.start_time || new Date().toISOString(),
              updatedAt: session.updated_at || session.start_time || new Date().toISOString(),
              pausedAt: session.paused_at ?? null,
              groupId: session.config?.groupId,
            };
          }

          return {
            id: session.id,
            session: {
              id: session.id,
              config: session.config || {},
              questions: lean ? [] : questions,
              userAnswers: lean ? {} : answers,
              currentQuestionIndex: session.current_question_index || 0,
              startTime: session.start_time
                ? new Date(session.start_time)
                : new Date(),
              endTime: session.end_time
                ? new Date(session.end_time)
                : undefined,
              isOffline: session.is_offline || false,
              sessionKind: session.session_kind || "test",
              status: sessionStatus,
              title: session.title || undefined,
              updatedAt: session.updated_at || undefined,
              pausedAt: session.paused_at || undefined,
              remainingTime: session.remaining_time_seconds ?? undefined,
            },
            score: result?.score || 0,
            totalQuestions:
              result?.total_questions ||
              questions.length ||
              0,
            correctAnswersCount: result?.correct_answers_count || 0,
            timeSpentSeconds,
            questionsWithTime,
          };
        });

        return {
          tests,
          total: typeof count === "number" ? count : tests.length,
        };
      },
      { ttl: 300 },
    );
  }

  async getTestById(testId: string, userId?: string): Promise<any | null> {
    const cacheKey = userId
      ? `test:${testId}:user:${userId}`
      : `test:${testId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_sessions")
          .select("*")
          .eq("id", testId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check if test belongs to user
        if (userId && data.user_id !== userId) {
          return null; // Access denied
        }

        return data;
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async createTest(testConfig: any, userId: string): Promise<any> {
    // Check if this is a completed test session (has questions and user_answers)
    const isCompletedSession =
      testConfig.questions && testConfig.questions.length > 0;

    const insertData: any = {
      user_id: userId,
    };

    if (isCompletedSession) {
      // This is a completed test being saved
      insertData.config = testConfig.config || testConfig;
      insertData.questions = testConfig.questions || [];
      insertData.user_answers = testConfig.user_answers || {};
      insertData.start_time = testConfig.start_time;
      insertData.end_time = testConfig.end_time;
      insertData.is_offline = testConfig.is_offline || false;
      insertData.status = "completed";
      insertData.session_kind = testConfig.session_kind || testConfig.sessionKind || "test";
      insertData.title = testConfig.title || null;
      insertData.current_question_index =
        typeof testConfig.current_question_index === "number"
          ? testConfig.current_question_index
          : 0;
      insertData.updated_at = new Date().toISOString();
    } else {
      // This is a new test configuration
      insertData.config = testConfig;
      insertData.questions = [];
      insertData.user_answers = {};
      insertData.status = "in_progress";
      insertData.session_kind = "test";
      insertData.updated_at = new Date().toISOString();
    }

    const { data, error } = await this.supabase
      .from("test_sessions")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`tests:${userId}:*`);

    return data;
  }

  mapTestSessionRowToClient(session: any) {
    const answers =
      session.user_answers && typeof session.user_answers === "object" && !Array.isArray(session.user_answers)
        ? session.user_answers
        : {};
    return {
      id: session.id,
      config: session.config || {},
      questions: Array.isArray(session.questions) ? session.questions : [],
      userAnswers: answers,
      currentQuestionIndex: session.current_question_index || 0,
      startTime: session.start_time ? new Date(session.start_time) : new Date(),
      endTime: session.end_time ? new Date(session.end_time) : undefined,
      remainingTime:
        typeof session.remaining_time_seconds === "number"
          ? session.remaining_time_seconds
          : undefined,
      isOffline: session.is_offline || false,
      sessionKind: session.session_kind || "test",
      status: session.status || "in_progress",
      title: session.title || undefined,
      updatedAt: session.updated_at || undefined,
      pausedAt: session.paused_at || undefined,
      userId: session.user_id,
    };
  }

  async createTestDraft(
    payload: {
      config: any;
      questions: any[];
      user_answers?: Record<string, any>;
      start_time?: string;
      session_kind?: "test" | "study";
      title?: string;
      current_question_index?: number;
      remaining_time_seconds?: number | null;
      is_offline?: boolean;
      client_id?: string;
    },
    userId: string,
  ): Promise<any> {
    const now = new Date().toISOString();
    const insertData: any = {
      user_id: userId,
      config: payload.config || {},
      questions: Array.isArray(payload.questions) ? payload.questions : [],
      user_answers: payload.user_answers || {},
      start_time: payload.start_time || now,
      end_time: null,
      is_offline: payload.is_offline || false,
      status: "in_progress",
      session_kind: payload.session_kind === "study" ? "study" : "test",
      current_question_index: Math.max(0, payload.current_question_index || 0),
      remaining_time_seconds:
        typeof payload.remaining_time_seconds === "number"
          ? payload.remaining_time_seconds
          : null,
      title: payload.title || null,
      updated_at: now,
      paused_at: null,
    };

    const { data, error } = await this.supabase
      .from("test_sessions")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    await cacheService.deletePattern(`tests:${userId}:*`);
    return this.mapTestSessionRowToClient(data);
  }

  async updateTestDraft(
    draftId: string,
    userId: string,
    updates: {
      user_answers?: Record<string, any>;
      current_question_index?: number;
      remaining_time_seconds?: number | null;
      status?: "in_progress" | "paused";
      title?: string;
    },
  ): Promise<any | null> {
    const existing = await this.getTestById(draftId, userId);
    if (!existing) return null;
    if (existing.status === "completed" || existing.status === "abandoned") {
      throw new Error("Cannot update a finished session");
    }
    if (existing.end_time) {
      throw new Error("Cannot update a finished session");
    }

    const now = new Date().toISOString();
    const patch: any = { updated_at: now };
    if (updates.user_answers !== undefined) patch.user_answers = updates.user_answers;
    if (typeof updates.current_question_index === "number") {
      patch.current_question_index = Math.max(0, updates.current_question_index);
    }
    if (updates.remaining_time_seconds !== undefined) {
      patch.remaining_time_seconds = updates.remaining_time_seconds;
    }
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.status === "paused") {
      patch.status = "paused";
      patch.paused_at = now;
    } else if (updates.status === "in_progress") {
      patch.status = "in_progress";
      patch.paused_at = null;
    }

    const { data, error } = await this.supabase
      .from("test_sessions")
      .update(patch)
      .eq("id", draftId)
      .eq("user_id", userId)
      .in("status", ["in_progress", "paused"])
      .is("end_time", null)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    await cacheService.delete(`test:${draftId}`);
    await cacheService.delete(`test:${draftId}:user:${userId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);
    return this.mapTestSessionRowToClient(data);
  }

  async completeTestDraft(
    draftId: string,
    userId: string,
    options?: {
      user_answers?: Record<string, any>;
      activityDate?: string;
      score?: number;
      correctAnswersCount?: number;
      totalQuestions?: number;
    },
  ): Promise<any> {
    const existing = await this.getTestById(draftId, userId);
    if (!existing) throw new Error("Session not found");
    if (existing.status === "completed") {
      throw new Error("Session already completed");
    }
    if (existing.status === "abandoned") {
      throw new Error("Session was abandoned");
    }

    const now = new Date().toISOString();
    const answers = options?.user_answers ?? existing.user_answers ?? {};
    const sessionKind = existing.session_kind === "study" ? "study" : "test";

    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        user_answers: answers,
        end_time: now,
        status: "completed",
        updated_at: now,
        remaining_time_seconds: null,
        paused_at: null,
      })
      .eq("id", draftId)
      .eq("user_id", userId)
      .in("status", ["in_progress", "paused"])
      .is("end_time", null)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Session already completed");

    await cacheService.delete(`test:${draftId}`);
    await cacheService.delete(`test:${draftId}:user:${userId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);

    if (sessionKind === "study") {
      return {
        session: this.mapTestSessionRowToClient(data),
        sessionKind: "study",
        score: null,
        totalQuestions: Array.isArray(data.questions) ? data.questions.length : 0,
        correctAnswersCount: null,
      };
    }

    const result = await this.createTestResult(
      draftId,
      {
        score: options?.score ?? 0,
        correctAnswersCount: options?.correctAnswersCount ?? 0,
        totalQuestions:
          options?.totalQuestions ??
          (Array.isArray(data.questions) ? data.questions.length : 0),
        activityDate: options?.activityDate,
      },
      userId,
    );

    return {
      session: this.mapTestSessionRowToClient(data),
      sessionKind: "test",
      ...result,
    };
  }

  async abandonTestDraft(draftId: string, userId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        status: "abandoned",
        updated_at: now,
        remaining_time_seconds: null,
      })
      .eq("id", draftId)
      .eq("user_id", userId)
      .in("status", ["in_progress", "paused"])
      .is("end_time", null)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    await cacheService.delete(`test:${draftId}`);
    await cacheService.delete(`test:${draftId}:user:${userId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);
    return !!data;
  }

  async startTest(testId: string, userId: string): Promise<any | null> {
    // Get test first
    const test = await this.getTestById(testId, userId);
    if (!test) return null;

    // Check if test has already been started (has questions)
    if (test.questions && test.questions.length > 0) {
      throw new Error("Test has already been started");
    }

    // Generate questions based on config (simplified - in real app this would be more complex)
    const questions = this.generateTestQuestions(test.config);

    // RC-04: only the first start wins; empty questions array is the CAS precondition.
    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        start_time: new Date().toISOString(),
        questions,
      })
      .eq("id", testId)
      .eq("user_id", userId)
      .eq("questions", [])
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // Bypass stale pre-start cache from the concurrent loser path.
      await cacheService.delete(`test:${testId}`);
      await cacheService.delete(`test:${testId}:user:${userId}`);
      const existing = await this.getTestById(testId, userId);
      if (existing?.questions && existing.questions.length > 0) {
        return existing;
      }
      throw new Error("Test has already been started");
    }

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.delete(`test:${testId}:user:${userId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);

    return data;
  }

  async submitTest(
    testId: string,
    userId: string,
    answers: any[],
  ): Promise<any> {
    // Get test first
    const test = await this.getTestById(testId, userId);
    if (!test) throw new Error("Test not found");

    // Calculate score
    const score = this.calculateTestScore(test.questions, answers);
    const correctAnswers = Math.round((score / 100) * test.questions.length);

    // Atomic complete: only the first concurrent submit wins (CONC-02).
    const { data, error } = await this.supabase
      .from("test_sessions")
      .update({
        end_time: new Date().toISOString(),
        user_answers: answers,
        status: "completed",
        updated_at: new Date().toISOString(),
        remaining_time_seconds: null,
        paused_at: null,
      })
      .eq("id", testId)
      .eq("user_id", userId)
      .is("end_time", null)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error("Test has already been completed");
    }

    // Upsert result — UNIQUE(session_id) prevents duplicates under races.
    const { error: resultError } = await this.supabase
      .from("test_results")
      .upsert(
        {
          session_id: testId,
          score,
          total_questions: test.questions.length,
          correct_answers_count: correctAnswers,
        },
        { onConflict: "session_id", ignoreDuplicates: true },
      );

    if (resultError) throw resultError;

    // Update user stats
    await this.updateUserStats(userId, score);

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);
    await cacheService.delete(`user:stats:${userId}`);

    return {
      test: data,
      score,
      totalQuestions: test.questions.length,
      correctAnswers,
    };
  }

  async createTestResult(
    testId: string,
    resultData: {
      score: number;
      correctAnswersCount: number;
      totalQuestions: number;
      activityDate?: string;
    },
    userId?: string,
  ): Promise<any> {
    let score = resultData.score;
    let correctAnswersCount = resultData.correctAnswersCount;
    let totalQuestions = resultData.totalQuestions;

    const test = userId
      ? await this.getTestById(testId, userId)
      : await this.getTestById(testId);
    if (test?.questions?.length && test.user_answers?.length) {
      score = this.calculateTestScore(test.questions, test.user_answers);
      totalQuestions = test.questions.length;
      correctAnswersCount = Math.round((score / 100) * totalQuestions);
    }

    const { data, error } = await this.supabase
      .from("test_results")
      .upsert(
        {
          session_id: testId,
          score,
          correct_answers_count: correctAnswersCount,
          total_questions: totalQuestions,
        },
        { onConflict: "session_id" },
      )
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`test:results:${testId}`);

    let gamification:
      | {
          points: number;
          badges: User["badges"];
          stats: UserStats;
          awardedBadges: User["badges"];
        }
      | undefined;
    if (userId) {
      try {
        gamification = await this.applyTestCompletionGamification(
          userId,
          resultData.activityDate,
        );
        await cacheService.invalidateUserCache(userId);
      } catch (err) {
        logger.warn("Test result gamification sync failed", {
          userId,
          testId,
          err,
        });
      }
    }

    return gamification ? { ...data, gamification } : data;
  }

  async getTestResults(testId: string, userId?: string): Promise<any | null> {
    const cacheKey = `test:results:${testId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_results")
          .select("*")
          .eq("session_id", testId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null; // Not found
          throw error;
        }

        // Check access if userId provided
        if (userId) {
          const test = await this.getTestById(testId, userId);
          if (!test) return null;
        }

        return data;
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  async getTestQuestions(testId: string, userId?: string): Promise<any[]> {
    const cacheKey = `test:questions:${testId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const test = await this.getTestById(testId, userId);
        if (!test) return [];

        return test.questions || [];
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  async deleteTest(testId: string): Promise<boolean> {
    // Delete test results first
    const { error: resultsError } = await this.supabase
      .from("test_results")
      .delete()
      .eq("session_id", testId);

    if (resultsError) throw resultsError;

    // Delete the test session
    const { error } = await this.supabase
      .from("test_sessions")
      .delete()
      .eq("id", testId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.delete(`test:results:${testId}`);
    await cacheService.delete(`test:questions:${testId}`);
    await cacheService.deletePattern(`tests:*`);

    return true;
  }

  async deleteCompletedTestSession(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const { data: session, error: fetchError } = await this.supabase
      .from("test_sessions")
      .select("id, user_id, end_time")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!session || session.user_id !== userId) return false;
    if (!session.end_time) {
      throw new Error("Cannot delete an in-progress test session");
    }

    return this.deleteTest(sessionId);
  }

  async clearCompletedTestHistory(userId: string): Promise<number> {
    const { data: sessions, error } = await this.supabase
      .from("test_sessions")
      .select("id")
      .eq("user_id", userId)
      .not("end_time", "is", null);

    if (error) throw error;
    if (!sessions?.length) return 0;

    const sessionIds = sessions.map((row: { id: string }) => row.id);

    const { error: resultsError } = await this.supabase
      .from("test_results")
      .delete()
      .in("session_id", sessionIds);

    if (resultsError) throw resultsError;

    const { error: sessionsError } = await this.supabase
      .from("test_sessions")
      .delete()
      .in("id", sessionIds);

    if (sessionsError) throw sessionsError;

    for (const sessionId of sessionIds) {
      await cacheService.delete(`test:${sessionId}`);
      await cacheService.delete(`test:results:${sessionId}`);
      await cacheService.delete(`test:questions:${sessionId}`);
    }
    await cacheService.deletePattern(`tests:${userId}:*`);
    await cacheService.delete(`user:${userId}:test-results`);
    await cacheService.delete(`tests:stats:subject:${userId}`);
    await cacheService.deletePattern(`tests:stats:performance:${userId}:*`);
    await cacheService.delete(`user:stats:${userId}`);

    return sessionIds.length;
  }

  async getSubjectStats(userId: string): Promise<any> {
    const cacheKey = `tests:stats:subject:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_sessions")
          .select(
            `
          config,
          test_results (score)
        `,
          )
          .eq("user_id", userId)
          .not("end_time", "is", null); // Only completed tests

        if (error) throw error;

        // Group by subject (extract from config)
        const subjectStats: { [key: string]: any } = {};
        data?.forEach((test: any) => {
          const subject = test.config?.subject || "General";
          const score = test.test_results?.[0]?.score;
          if (score !== undefined) {
            if (!subjectStats[subject]) {
              subjectStats[subject] = {
                subject,
                testsTaken: 0,
                averageScore: 0,
                scores: [],
              };
            }
            subjectStats[subject].testsTaken++;
            subjectStats[subject].scores.push(score);
          }
        });

        // Calculate averages
        Object.values(subjectStats).forEach((stats: any) => {
          stats.averageScore =
            stats.scores.reduce(
              (sum: number, score: number) => sum + score,
              0,
            ) / stats.scores.length;
          delete stats.scores;
        });

        return Object.values(subjectStats);
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async getPerformanceStats(
    userId: string,
    period: string = "month",
  ): Promise<any> {
    const cacheKey = `tests:stats:performance:${userId}:${period}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Calculate date range based on period
        const now = new Date();
        let startDate: Date;

        switch (period) {
          case "week":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "month":
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case "year":
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
          default:
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        const { data, error } = await this.supabase
          .from("test_sessions")
          .select(
            `
          start_time,
          test_results (score)
        `,
          )
          .eq("user_id", userId)
          .not("end_time", "is", null) // Only completed tests
          .gte("start_time", startDate.toISOString());

        if (error) throw error;

        const scores =
          data
            ?.map((test: any) => test.test_results?.[0]?.score)
            .filter((score) => score !== undefined) || [];
        const averageScore =
          scores.length > 0
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : 0;

        return {
          period,
          testsTaken: scores.length,
          averageScore: Math.round(averageScore * 100) / 100,
          highestScore: scores.length > 0 ? Math.max(...scores) : 0,
          lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getTestTemplates(
    options: {
      page?: number;
      limit?: number;
      subject?: string;
      difficulty?: string;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20, subject, difficulty } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `tests:templates:${page}:${limit}:${subject || ""}:${difficulty || ""}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase.from("test_templates").select("*");

        if (subject) {
          query = query.eq("subject", subject);
        }

        if (difficulty) {
          query = query.eq("difficulty", difficulty);
        }

        const { data, error } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return data || [];
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  // Gamification Methods for API Routes
  async getLeaderboard(
    options: {
      page?: number;
      limit?: number;
      timeframe?: string;
      metric?: string;
    } = {},
  ): Promise<any[]> {
    const {
      page = 1,
      limit = 50,
      timeframe = "all",
      metric = "points",
    } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:leaderboard:${page}:${limit}:${timeframe}:${metric}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const query = this.supabase
          .from("profiles")
          .select("id, name, avatar_url, points, stats")
          .order("points", { ascending: false });

        // Apply timeframe filtering if needed (simplified)
        if (timeframe !== "all") {
          // In a real implementation, you'd filter based on recent activity
          // For now, just return all users
        }

        const { data, error } = await query.range(offset, offset + limit - 1);

        if (error) throw error;

        return (data || []).map((user: any, index: number) => ({
          rank: offset + index + 1,
          user: {
            id: user.id,
            name: user.name,
            avatarUrl: user.avatar_url,
            points: user.points || 0,
            stats: user.stats || {},
          },
        }));
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getAchievements(
    options: {
      page?: number;
      limit?: number;
      category?: string;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20, category } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:achievements:${page}:${limit}:${category || ""}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase.from("achievements").select("*");

        if (category) {
          query = query.eq("category", category);
        }

        const { data, error } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return data || [];
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  async getUserAchievements(
    userId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:user:achievements:${userId}:${page}:${limit}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("user_achievements")
          .select(
            `
          *,
          achievements (*)
        `,
          )
          .eq("user_id", userId)
          .order("unlocked_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return (
          data?.map((ua: any) => ({
            ...ua.achievements,
            unlockedAt: ua.unlocked_at,
            progress: ua.progress,
          })) || []
        );
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async awardPoints(
    userId: string,
    points: number,
    reason: string,
    source?: string,
  ): Promise<any> {
    // Get current points
    const { data: user, error: userError } = await this.supabase
      .from("profiles")
      .select("points")
      .eq("id", userId)
      .single();

    if (userError) throw userError;

    const currentPoints = user?.points || 0;
    const newPoints = currentPoints + points;

    // Update user points
    const { data, error } = await this.supabase
      .from("profiles")
      .update({ points: newPoints })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    // Optional audit log — table may not exist on older deployments
    const { error: logError } = await this.supabase
      .from("points_transactions")
      .insert({
        user_id: userId,
        points,
        reason,
        source: source || "manual",
      });

    if (logError) {
      logger.warn("points_transactions insert skipped", {
        userId,
        code: logError.code,
        message: logError.message,
      });
    }

    // Invalidate caches
    await cacheService.deletePattern(`gamification:leaderboard:*`);
    await cacheService.delete(`user:stats:${userId}`);
    await cacheService.deletePattern(
      `gamification:user:achievements:${userId}:*`,
    );

    return {
      userId,
      pointsAwarded: points,
      newTotal: newPoints,
      reason,
      source,
    };
  }

  async awardAchievement(userId: string, achievementId: string): Promise<any> {
    // Check if user already has this achievement
    const { data: existing, error: checkError } = await this.supabase
      .from("user_achievements")
      .select("id")
      .eq("user_id", userId)
      .eq("achievement_id", achievementId)
      .single();

    if (checkError && checkError.code !== "PGRST116") throw checkError;

    if (existing) {
      throw new Error("User already has this achievement");
    }

    // Award the achievement
    const { data, error } = await this.supabase
      .from("user_achievements")
      .insert({
        user_id: userId,
        achievement_id: achievementId,
        unlocked_at: new Date().toISOString(),
        progress: 100,
      })
      .select(
        `
        *,
        achievements (*)
      `,
      )
      .single();

    if (error) throw error;

    // Award points for achievement if configured
    const achievement = data.achievements;
    if (achievement.points_reward) {
      await this.awardPoints(
        userId,
        achievement.points_reward,
        `Achievement unlocked: ${achievement.name}`,
        "achievement",
      );
    }

    // Invalidate caches
    await cacheService.deletePattern(
      `gamification:user:achievements:${userId}:*`,
    );

    return {
      ...achievement,
      unlockedAt: data.unlocked_at,
      progress: data.progress,
    };
  }

  async getUserProgress(userId: string): Promise<any> {
    const cacheKey = `gamification:user:progress:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get user stats
        const user = await this.getUserById(userId);
        if (!user) throw new Error("User not found");

        // Get achievements progress
        const { data: achievements, error: achError } = await this.supabase
          .from("user_achievements")
          .select("achievement_id, progress")
          .eq("user_id", userId);

        if (achError) throw achError;

        // Get level info
        const level = await this.getUserLevel(userId);

        return {
          userId,
          points: user.points || 0,
          level: level.currentLevel,
          achievementsUnlocked: achievements?.length || 0,
          nextLevelPoints: level.nextLevelPoints,
          progressToNextLevel: level.progressToNextLevel,
          stats: user.stats || {},
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async getGamificationStats(): Promise<any> {
    const cacheKey = "gamification:stats";

    return cacheService.cached(
      cacheKey,
      async () => {
        // Get total users
        const { count: totalUsers, error: usersError } = await this.supabase
          .from("profiles")
          .select("id", { count: "exact", head: true });

        // Get total achievements unlocked
        const { count: totalAchievements, error: achError } =
          await this.supabase
            .from("user_achievements")
            .select("id", { count: "exact", head: true });

        // Get total points awarded
        const { data: pointsData, error: pointsError } = await this.supabase
          .from("profiles")
          .select("points");

        if (usersError || achError || pointsError) {
          throw usersError || achError || pointsError;
        }

        const totalPoints =
          pointsData?.reduce((sum, user) => sum + (user.points || 0), 0) || 0;

        return {
          totalUsers: totalUsers || 0,
          totalAchievements: totalAchievements || 0,
          totalPoints,
          averagePointsPerUser: totalUsers ? totalPoints / totalUsers : 0,
        };
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async getBadges(
    options: {
      page?: number;
      limit?: number;
      category?: string;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20, category } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:badges:${page}:${limit}:${category || ""}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        let query = this.supabase.from("badges").select("*");

        if (category) {
          query = query.eq("category", category);
        }

        const { data, error } = await query
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return data || [];
      },
      { ttl: 1800 },
    ); // Cache for 30 minutes
  }

  async getUserBadges(
    userId: string,
    options: {
      page?: number;
      limit?: number;
    } = {},
  ): Promise<any[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:user:badges:${userId}:${page}:${limit}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("user_badges")
          .select(
            `
          *,
          badges (*)
        `,
          )
          .eq("user_id", userId)
          .order("awarded_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return (
          data?.map((ub: any) => ({
            ...ub.badges,
            awardedAt: ub.awarded_at,
          })) || []
        );
      },
      { ttl: 600 },
    ); // Cache for 10 minutes
  }

  async awardBadge(userId: string, badgeId: string): Promise<any> {
    // Check if user already has this badge
    const { data: existing, error: checkError } = await this.supabase
      .from("user_badges")
      .select("id")
      .eq("user_id", userId)
      .eq("badge_id", badgeId)
      .single();

    if (checkError && checkError.code !== "PGRST116") throw checkError;

    if (existing) {
      throw new Error("User already has this badge");
    }

    // Award the badge
    const { data, error } = await this.supabase
      .from("user_badges")
      .insert({
        user_id: userId,
        badge_id: badgeId,
        awarded_at: new Date().toISOString(),
      })
      .select(
        `
        *,
        badges (*)
      `,
      )
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`gamification:user:badges:${userId}:*`);

    return {
      ...data.badges,
      awardedAt: data.awarded_at,
    };
  }

  async getLevels(): Promise<any[]> {
    const cacheKey = "gamification:levels";

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("levels")
          .select("*")
          .order("level_number", { ascending: true });

        if (error) throw error;

        return data || [];
      },
      { ttl: 3600 },
    ); // Cache for 1 hour
  }

  async getUserLevel(userId: string): Promise<any> {
    const cacheKey = `gamification:user:level:${userId}`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const user = await this.getUserById(userId);
        if (!user) throw new Error("User not found");

        const points = user.points || 0;
        const levels = await this.getLevels();

        // Find current level
        let currentLevel = levels[0]; // Default to first level
        let nextLevel = null;

        for (let i = 0; i < levels.length; i++) {
          if (points >= levels[i].points_required) {
            currentLevel = levels[i];
            nextLevel = levels[i + 1] || null;
          } else {
            break;
          }
        }

        const progressToNextLevel = nextLevel
          ? ((points - currentLevel.points_required) /
              (nextLevel.points_required - currentLevel.points_required)) *
            100
          : 100;

        return {
          currentLevel: currentLevel.level_number,
          levelName: currentLevel.name,
          currentPoints: points,
          pointsRequired: currentLevel.points_required,
          nextLevelPoints:
            nextLevel?.points_required || currentLevel.points_required,
          progressToNextLevel: Math.min(100, Math.max(0, progressToNextLevel)),
          rewards: currentLevel.rewards || [],
        };
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  async recordStudyActivity(
    userId: string,
    type: string,
    amount = 1,
    activityDate?: string,
  ): Promise<any> {
    const vAmount = Math.max(Math.floor(Number(amount) || 1), 0);
    const activityDateStr =
      activityDate && /^\d{4}-\d{2}-\d{2}$/.test(activityDate)
        ? activityDate
        : new Date().toISOString().slice(0, 10);

    const { data, error } = await this.supabase.rpc("record_study_activity", {
      p_user_id: userId,
      p_type: type,
      p_amount: vAmount,
      p_activity_date: activityDateStr,
    });

    if (error) throw error;
    return data;
  }

  private profileToGamificationUser(
    profile: Record<string, unknown>,
    statsOverride?: Partial<UserStats>,
  ): User {
    const normalizedStats = mapUserStatsFromApi(profile.stats || {});
    return {
      id: String(profile.id),
      name: String(profile.name || ""),
      email: String(profile.email || ""),
      password: "",
      phoneNumber: String(profile.phone || ""),
      avatarUrl: String(profile.avatar_url || profile.avatarUrl || ""),
      points: Number(profile.points) || 0,
      badges: (profile.badges as User["badges"]) || [],
      stats: {
        ...initialUserStats,
        ...normalizedStats,
        ...(statsOverride || {}),
      },
    } as User;
  }

  async incrementUserStatsAndAwardBadges(
    userId: string,
    increments: Partial<UserStats>,
  ): Promise<GamificationSyncResult> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error("User not found");
    }

    const base = this.profileToGamificationUser(
      profile as unknown as Record<string, unknown>,
    );
    const stats = { ...base.stats };
    for (const key of Object.keys(increments) as (keyof UserStats)[]) {
      const delta = increments[key];
      if (typeof delta === "number" && delta !== 0) {
        stats[key] = (stats[key] || 0) + delta;
      }
    }

    const { updatedUser, awardedBadges } = checkAndAwardBadges({
      ...base,
      stats,
    });
    await this.updateUser(userId, {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
    });
    await cacheService.delete(`user:${userId}`);

    return {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
      awardedBadges,
    };
  }

  /**
   * Recount the badge stats that can be derived from source tables.
   *
   * These were previously only ever incremented on events, so they drifted in
   * both directions and no client agreed with the dashboard: a failed increment
   * is swallowed and silently undercounts, while re-submitting a result re-ran
   * the increment and overcounted. Counting from the rows themselves is
   * self-healing — whatever the history, the answer converges on the truth.
   *
   * Only derivable metrics are returned. gamesWon and the marketplace counters
   * have no reliable source query yet, so they are deliberately absent and the
   * caller must preserve the stored values rather than treat them as zero.
   */
  async recomputeDerivedUserStats(userId: string): Promise<Partial<UserStats>> {
    const [sessions, questionCount, topQuestion, groupCount] = await Promise.all(
      [
        this.supabase
          .from("test_sessions")
          .select("start_time, test_results (score)")
          .eq("user_id", userId)
          .eq("status", "completed"),
        this.supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("sender_id", userId)
          .eq("type", "QUESTION"),
        this.supabase
          .from("messages")
          .select("upvotes")
          .eq("sender_id", userId)
          .eq("type", "QUESTION")
          .order("upvotes", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // createGroup writes `admin_ids: [userId]`, so element 0 is the creator;
        // later admins are appended, leaving that entry intact. Filtering on
        // `admin_ids->>0` directly would be neater, but supabase-js URL-encodes
        // column names and PostgREST then fails to read it as a JSON path — so
        // match on containment, which encodes safely, and check position here.
        this.supabase
          .from("groups")
          .select("admin_ids")
          .contains("admin_ids", [userId]),
      ],
    );

    // Deduplicate by start-time, matching how the dashboard counts. A genuine
    // double-submit can leave two session rows for one sitting, and the badge
    // count has to agree with the number the user is shown.
    const seenStartTimes = new Set<string>();
    let testsCompleted = 0;
    let highScoreTests = 0;
    let perfectScoreTests = 0;

    for (const row of (sessions.data || []) as any[]) {
      const startTime = String(row.start_time ?? "");
      if (startTime && seenStartTimes.has(startTime)) continue;
      if (startTime) seenStartTimes.add(startTime);

      testsCompleted++;
      const result = Array.isArray(row.test_results)
        ? row.test_results[0]
        : row.test_results;
      const score = Number(result?.score);
      if (!Number.isFinite(score)) continue;
      if (score >= 80) highScoreTests++;
      if (score >= 100) perfectScoreTests++;
    }

    const derived: Partial<UserStats> = {
      testsCompleted,
      highScoreTests,
      perfectScoreTests,
    };

    // A failed count must not be mistaken for "zero of them" — leaving the key
    // out preserves whatever is already stored.
    if (!questionCount.error && typeof questionCount.count === "number") {
      derived.questionsCreated = questionCount.count;
    }
    if (!groupCount.error && Array.isArray(groupCount.data)) {
      derived.groupsCreated = (groupCount.data as any[]).filter((row) => {
        const admins = row?.admin_ids;
        const first = Array.isArray(admins) ? admins[0] : undefined;
        return String(first ?? "") === userId;
      }).length;
    }
    if (!topQuestion.error) {
      derived.questionUpvotesMax = Number(topQuestion.data?.upvotes) || 0;
    }
    if (sessions.error) {
      delete derived.testsCompleted;
      delete derived.highScoreTests;
      delete derived.perfectScoreTests;
      logger.warn("Could not recount test stats; keeping stored values", {
        userId,
        error: sessions.error.message,
      });
    }

    return derived;
  }

  async syncGamificationProgress(
    userId: string,
  ): Promise<GamificationSyncResult> {
    // Reconcile against source data before re-evaluating. checkAndAwardBadges
    // only ever looks for currentLevel + 1, so a corrected-downwards count can
    // never revoke a badge the user already holds.
    const derived = await this.recomputeDerivedUserStats(userId).catch((err) => {
      logger.warn("Stat recompute failed; evaluating against stored stats", {
        userId,
        err,
      });
      return {} as Partial<UserStats>;
    });
    return this.syncGamificationProgressWithStats(userId, { stats: derived });
  }

  /** Server-only: apply trusted stats before badge evaluation (e.g. after test completion). */
  async syncGamificationProgressWithStats(
    userId: string,
    options: {
      stats?: Partial<UserStats>;
      activityDate?: string;
    } = {},
  ): Promise<GamificationSyncResult> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error("User not found");
    }

    // What the profile holds now, before any recomputed stats are layered on —
    // the baseline for deciding whether this sync actually changed anything.
    const stored = this.profileToGamificationUser(
      profile as unknown as Record<string, unknown>,
    );
    const user = this.profileToGamificationUser(
      profile as unknown as Record<string, unknown>,
      options.stats,
    );
    const { updatedUser, awardedBadges } = checkAndAwardBadges(user);

    // Both clients call this on every dashboard load, so writing unconditionally
    // would mean a profile UPDATE per screen open for no reason. Only persist
    // when the reconciliation or an award genuinely moved something.
    const changed =
      updatedUser.points !== stored.points ||
      JSON.stringify(updatedUser.stats) !== JSON.stringify(stored.stats) ||
      JSON.stringify(updatedUser.badges) !== JSON.stringify(stored.badges);

    if (changed) {
      await this.updateUser(userId, {
        points: updatedUser.points,
        badges: updatedUser.badges,
        stats: updatedUser.stats,
      });
      await cacheService.delete(`user:${userId}`);
    }

    return {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
      awardedBadges,
    };
  }

  // No `score` parameter: the score of the test that triggered this is read back
  // from the saved rows along with every other test, rather than trusted from
  // the caller and added to a running total.
  async applyTestCompletionGamification(
    userId: string,
    activityDate?: string,
  ): Promise<{
    points: number;
    badges: User["badges"];
    stats: UserStats;
    awardedBadges: User["badges"];
  }> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error("User not found");
    }

    // Recount from the saved rows instead of incrementing. The result row is
    // upserted on session_id, so it is idempotent — but the old increment was
    // not, and re-submitting a test inflated these counters permanently. The
    // session is marked completed before its result is written, so the test that
    // triggered this is already included; if that ever changes, the count is one
    // low until the next sync rather than wrong forever.
    const stats = {
      ...this.profileToGamificationUser(
        profile as unknown as Record<string, unknown>,
      ).stats,
      ...(await this.recomputeDerivedUserStats(userId).catch((err) => {
        logger.warn("Stat recompute failed after test completion", {
          userId,
          err,
        });
        return {} as Partial<UserStats>;
      })),
    };

    const result = await this.syncGamificationProgressWithStats(userId, {
      stats,
    });
    await this.recordStudyActivity(userId, "test", 1, activityDate).catch(
      (err) => {
        logger.warn("Failed to record study activity after test", {
          userId,
          err,
        });
      },
    );
    await this.recomputeUserStreak(userId, activityDate).catch((err) => {
      logger.warn("Failed to recompute streak after test", { userId, err });
    });
    return result;
  }

  async touchLastSeen(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
  }

  async getStudyActivity(
    userId: string,
    days = 112,
  ): Promise<
    Array<{
      date: string;
      count: number;
      breakdown: Partial<Record<string, number>>;
    }>
  > {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, days) + 1);
    const sinceDate = since.toISOString().slice(0, 10);

    const { data, error } = await this.supabase
      .from("study_activity")
      .select(
        "activity_date, count, test_count, flashcard_count, new_flashcard_count, question_count, game_count, daily_quiz_count",
      )
      .eq("user_id", userId)
      .gte("activity_date", sinceDate)
      .order("activity_date", { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      date: row.activity_date,
      count: row.count ?? 0,
      breakdown: {
        test: row.test_count ?? 0,
        flashcard: row.flashcard_count ?? 0,
        flashcard_new: row.new_flashcard_count ?? 0,
        study_question: row.question_count ?? 0,
        game: row.game_count ?? 0,
        daily_quiz: row.daily_quiz_count ?? 0,
      },
    }));
  }

  private parseStreakReferenceDate(referenceDate?: string): Date {
    if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      const [y, m, d] = referenceDate.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }

  /** Recompute streak from study_activity (heatmap-aligned, client-local dates). */
  async recomputeUserStreak(
    userId: string,
    referenceDate?: string,
  ): Promise<{
    user_id: string;
    current_streak: number;
    longest_streak: number;
    last_login_date: string | null;
    streak_freezes: number;
    updated_at: string;
  }> {
    const STREAK_LOOKBACK_DAYS = 400;
    const activityDays = await this.getStudyActivity(
      userId,
      STREAK_LOOKBACK_DAYS,
    );
    const ref = this.parseStreakReferenceDate(referenceDate);
    const { current, longest, lastActiveDate } = computeStudyStreak(
      activityDays,
      ref,
    );

    const { data: existing } = await this.supabase
      .from("user_streaks")
      .select("streak_freezes, longest_streak")
      .eq("user_id", userId)
      .maybeSingle();

    const streakFreezes = existing?.streak_freezes ?? 0;
    const longestStreak = Math.max(existing?.longest_streak ?? 0, longest);

    const { data, error } = await this.supabase
      .from("user_streaks")
      .upsert(
        {
          user_id: userId,
          current_streak: current,
          longest_streak: longestStreak,
          last_login_date: lastActiveDate,
          streak_freezes: streakFreezes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Helper methods
  private generateTestQuestions(config: any): any[] {
    // Simplified question generation - in a real app this would be more sophisticated
    const questions = [];
    const numQuestions = config.numQuestions || 10;

    for (let i = 0; i < numQuestions; i++) {
      questions.push({
        id: `q${i + 1}`,
        question: `Sample question ${i + 1}?`,
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        subject: config.subject || "General",
        difficulty: config.difficulty || "medium",
      });
    }

    return questions;
  }

  private calculateTestScore(questions: any[], answers: any[]): number {
    let correct = 0;
    questions.forEach((question, index) => {
      if (answers[index] === question.correctAnswer) {
        correct++;
      }
    });
    return (correct / questions.length) * 100;
  }

  private async updateUserStats(userId: string, score: number): Promise<void> {
    // Update user stats (simplified)
    const { data: user, error: userError } = await this.supabase
      .from("profiles")
      .select("stats")
      .eq("id", userId)
      .single();

    if (userError) throw userError;

    const currentStats = user?.stats || {};
    const testsTaken = (currentStats.testsTaken || 0) + 1;
    const totalScore = (currentStats.totalScore || 0) + score;
    const averageScore = totalScore / testsTaken;

    const { error } = await this.supabase
      .from("profiles")
      .update({
        stats: {
          ...currentStats,
          testsTaken,
          totalScore,
          averageScore,
        },
      })
      .eq("id", userId);

    if (error) throw error;
  }

  // Group Functions
  async fetchGroups(userId: string): Promise<Group[]> {
    const cacheKey = `user:${userId}:groups`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("group_members")
          .select(
            `
          groups (
            id,
            name,
            avatar_url,
            description,
            last_message,
            last_message_time,
            admin_ids,
            permissions,
            parent_id,
            is_archived,
            invite_id,
            created_at
          )
        `,
          )
          .eq("user_id", userId);

        if (error) throw error;
        return data.map((item: any) => item.groups);
      },
      { ttl: 60 },
    ); // Cache for 1 minute
  }

  async fetchGroupMembers(groupId: string): Promise<User[]> {
    const cacheKey = `group:${groupId}:members`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("group_members")
          .select(
            `
          user_id,
          profiles!user_id (
            id,
            name,
            username,
            avatar_url,
            phone
          )
        `,
          )
          .eq("group_id", groupId)
          .eq("pending", false);

        if (error) throw error;
        const members: User[] = [];
        for (const item of data || []) {
          const profile = Array.isArray(item.profiles)
            ? item.profiles[0]
            : item.profiles;
          if (!profile) continue;
          members.push({
            id: profile.id || item.user_id,
            name: profile.name,
            username: profile.username,
            avatarUrl: profile.avatar_url,
            phoneNumber: profile.phone,
            points: 0,
            badges: [],
            stats: {},
          } as User);
        }
        return members;
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Message Functions
  private async findGroupMessageByClientId(
    groupId: string,
    userId: string,
    clientMessageId: string,
  ): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .select("*")
      .eq("group_id", groupId)
      .eq("sender_id", userId)
      .eq("client_message_id", clientMessageId)
      .maybeSingle();

    if (error) {
      logger.error("findGroupMessageByClientId failed", {
        error,
        groupId,
        userId,
        clientMessageId,
      });
      return null;
    }
    return data;
  }

  private async resolveGroupMentionUserIds(
    groupId: string,
    senderId: string,
    content: string,
    explicitIds?: string[],
  ): Promise<string[]> {
    const usernames = extractMentionUsernames(content);
    const members = await this.fetchGroupMembers(groupId);
    const byUsername = new Map<string, string>();
    const usernameById = new Map<string, string>();
    const memberIds: string[] = [];
    for (const m of members || []) {
      const username = (m as any)?.username;
      const id = (m as any)?.id;
      if (typeof id === "string") memberIds.push(id);
      if (username && id) {
        const key = String(username).toLowerCase();
        byUsername.set(key, id);
        usernameById.set(id, key);
      }
    }
    const memberIdSet = new Set(memberIds);
    const fromText = usernames
      .filter((u) => u !== "all")
      .map((u: string) => byUsername.get(u))
      .filter(
        (id: string | undefined): id is string => !!id && id !== senderId,
      );

    // Admins may @all to notify every active member except themselves.
    if (
      usernames.includes("all") &&
      (await this.isGroupAdmin(groupId, senderId))
    ) {
      for (const id of memberIds) {
        if (id !== senderId) fromText.push(id);
      }
    }

    // Only accept client-provided IDs that match @usernames actually in the text
    // (prevents non-admins from mass-notifying via a forged mentionedUserIds list).
    const mentionedUsernameSet = new Set(usernames.filter((u) => u !== "all"));
    const fromExplicit = (explicitIds || []).filter((id) => {
      if (!memberIdSet.has(id) || id === senderId || id === "__all__")
        return false;
      const username = usernameById.get(id);
      return !!username && mentionedUsernameSet.has(username);
    });
    return [...new Set([...fromText, ...fromExplicit])];
  }

  private buildReplyToFromParent(
    parent: any,
    table: "messages" | "dm_messages",
  ): Record<string, unknown> {
    const profile = Array.isArray(parent.profiles)
      ? parent.profiles[0]
      : parent.profiles;
    const isRemoved = !!parent.removed_at;
    if (table === "dm_messages") {
      return {
        id: parent.id,
        senderId: parent.sender_id,
        senderName:
          profile?.name ||
          (profile?.username ? `@${profile.username}` : "Member"),
        type: "TEXT",
        text: isRemoved ? undefined : parent.text,
        isRemoved,
      };
    }
    const qd =
      parent.question_data && typeof parent.question_data === "object"
        ? parent.question_data
        : {};
    return {
      id: parent.id,
      senderId: parent.sender_id,
      senderName:
        profile?.name ||
        (profile?.username ? `@${profile.username}` : "Member"),
      type: parent.type,
      text: isRemoved ? undefined : parent.text,
      questionStem: isRemoved ? undefined : qd.questionStem,
      isRemoved,
    };
  }

  private async attachReplyPreview(
    message: any,
    table: "messages" | "dm_messages" = "messages",
  ): Promise<any> {
    const replyId = message?.reply_to_message_id || message?.replyToMessageId;
    if (!replyId) return message;
    const select =
      table === "dm_messages"
        ? "id, sender_id, text, removed_at, profiles:sender_id(id, name, username)"
        : "id, sender_id, type, text, question_data, removed_at, profiles:sender_id(id, name, username)";
    const { data: parent } = await this.supabase
      .from(table)
      .select(select)
      .eq("id", replyId)
      .maybeSingle();
    if (!parent) return { ...message, replyTo: null };
    return { ...message, replyTo: this.buildReplyToFromParent(parent, table) };
  }

  private async attachReplyPreviewsBatch(
    messages: any[],
    table: "messages" | "dm_messages",
  ): Promise<any[]> {
    if (!messages.length) return messages;
    const replyIds = [
      ...new Set(
        messages
          .map((m) => m?.reply_to_message_id || m?.replyToMessageId)
          .filter((id): id is string => typeof id === "string" && !!id),
      ),
    ];
    if (!replyIds.length) return messages;
    const select =
      table === "dm_messages"
        ? "id, sender_id, text, removed_at, profiles:sender_id(id, name, username)"
        : "id, sender_id, type, text, question_data, removed_at, profiles:sender_id(id, name, username)";
    const { data: parents } = await this.supabase
      .from(table)
      .select(select)
      .in("id", replyIds);
    const byId = new Map((parents || []).map((p: any) => [p.id, p]));
    return messages.map((message) => {
      const replyId = message?.reply_to_message_id || message?.replyToMessageId;
      if (!replyId) return message;
      const parent = byId.get(replyId);
      if (!parent) return { ...message, replyTo: null };
      return {
        ...message,
        replyTo: this.buildReplyToFromParent(parent, table),
      };
    });
  }

  /** Count replies per thread_root_id for messages in a conversation scope. */
  private async attachThreadReplyCounts(
    messages: any[],
    table: "messages" | "dm_messages",
    scopeColumn: "group_id" | "thread_id",
    scopeId: string,
  ): Promise<any[]> {
    if (!messages.length) return messages;
    const candidateRootIds = [
      ...new Set(
        messages.flatMap((m) => {
          const id = m?.id;
          const root = m?.thread_root_id || m?.threadRootId;
          return [id, root].filter(
            (x): x is string => typeof x === "string" && !!x,
          );
        }),
      ),
    ];
    if (!candidateRootIds.length) return messages;

    const { data, error } = await this.supabase
      .from(table)
      .select("thread_root_id")
      .eq(scopeColumn, scopeId)
      .is("removed_at", null)
      .in("thread_root_id", candidateRootIds);

    if (error) {
      logger.warn("attachThreadReplyCounts failed", { error, table, scopeId });
      return messages.map((m) => ({ ...m, replyCount: m.replyCount ?? 0 }));
    }

    const counts = new Map<string, number>();
    for (const row of data || []) {
      const rootId = (row as { thread_root_id?: string }).thread_root_id;
      if (!rootId) continue;
      counts.set(rootId, (counts.get(rootId) || 0) + 1);
    }

    return messages.map((m) => {
      // Only a thread root carries a reply count. Falling back to the root id
      // for replies gave every message in the thread the root's count, so each
      // reply rendered its own "N replies" chip.
      const isThreadRoot = !(m.thread_root_id || m.threadRootId);
      return { ...m, replyCount: isThreadRoot ? counts.get(m.id) || 0 : 0 };
    });
  }

  private async enrichGroupMessageReceipts(
    messages: Message[],
    groupId: string,
    viewerUserId: string,
  ): Promise<Message[]> {
    const hasOwn = messages.some(
      (m) =>
        (m as any).senderId === viewerUserId || m.sender?.id === viewerUserId,
    );
    if (!hasOwn) return messages;

    const { data: members, error } = await this.supabase
      .from("group_members")
      .select("user_id, last_read_at")
      .eq("group_id", groupId)
      .eq("pending", false);

    if (error) {
      logger.warn("enrichGroupMessageReceipts failed", { error, groupId });
      return messages;
    }

    const watermarks = (members || [])
      .filter((m: { user_id: string }) => m.user_id !== viewerUserId)
      .map((m: { last_read_at?: string | null }) => m.last_read_at);

    return messages.map((msg) => {
      const senderId = (msg as any).senderId || msg.sender?.id;
      if (senderId !== viewerUserId) return msg;
      const receipt = computeGroupReceipt(msg.timestamp, watermarks);
      return { ...msg, ...receipt };
    });
  }

  private async enrichDmMessageReceipts(
    messages: Message[],
    threadId: string,
    viewerUserId: string,
    peerUserId: string,
  ): Promise<Message[]> {
    const hasOwn = messages.some(
      (m) =>
        (m as any).senderId === viewerUserId || m.sender?.id === viewerUserId,
    );
    if (!hasOwn) return messages;

    const { data: readStatus, error } = await this.supabase
      .from("dm_read_status")
      .select("last_read_at")
      .eq("thread_id", threadId)
      .eq("user_id", peerUserId)
      .maybeSingle();

    if (error) {
      logger.warn("enrichDmMessageReceipts failed", { error, threadId });
      return messages;
    }

    const peerLastReadAt = readStatus?.last_read_at;
    return messages.map((msg) => {
      const senderId = (msg as any).senderId || msg.sender?.id;
      if (senderId !== viewerUserId) return msg;
      return {
        ...msg,
        receiptStatus: computeDmReceiptStatus(msg.timestamp, peerLastReadAt),
      };
    });
  }

  /** Resolve thread_root_id for a reply; validates parent is in the same conversation. */
  private async resolveThreadRootForReply(
    table: "messages" | "dm_messages",
    replyToMessageId: string,
    scope: { groupId?: string; threadId?: string },
  ): Promise<string> {
    const select =
      table === "messages"
        ? "id, group_id, thread_root_id, removed_at"
        : "id, thread_id, thread_root_id, removed_at";
    const { data: parent, error } = await this.supabase
      .from(table)
      .select(select)
      .eq("id", replyToMessageId)
      .maybeSingle();

    if (error || !parent) {
      throw new Error("Reply target message not found");
    }
    if ((parent as any).removed_at) {
      throw new Error("Cannot reply to a removed message");
    }
    if (table === "messages" && (parent as any).group_id !== scope.groupId) {
      throw new Error("Reply target is not in this group");
    }
    if (
      table === "dm_messages" &&
      (parent as any).thread_id !== scope.threadId
    ) {
      throw new Error("Reply target is not in this conversation");
    }
    const rootId = resolveThreadRootId(
      parent as { id: string; thread_root_id?: string | null },
    );
    if (!rootId) {
      throw new Error("Reply target message not found");
    }
    return rootId;
  }

  /** Lightweight realtime broadcast so open senders can refresh blue ticks. */
  private async broadcastChatRead(
    chatId: string,
    payload: { userId: string; lastReadAt: string },
  ): Promise<void> {
    try {
      const channel = this.supabase.channel(`chat-read:${chatId}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          void this.supabase.removeChannel(channel);
          reject(new Error("broadcast timeout"));
        }, 2500);
        channel.subscribe(async (status) => {
          if (status !== "SUBSCRIBED") return;
          try {
            await channel.send({
              type: "broadcast",
              event: "read",
              payload,
            });
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            clearTimeout(timer);
            void this.supabase.removeChannel(channel);
          }
        });
      });
    } catch (err) {
      logger.warn("broadcastChatRead failed", { chatId, err });
    }
  }

  async getGroupThread(
    groupId: string,
    rootId: string,
    viewerUserId?: string,
  ): Promise<Message[]> {
    const selectClause = `
      id,
      group_id,
      sender_id,
      type,
      text,
      question_data,
      flagged_as_similar_user_ids,
      timestamp,
      edited_at,
      removed_at,
      upvotes,
      downvotes,
      is_archived,
      image_url,
      reply_to_message_id,
      mentioned_user_ids,
      thread_root_id,
      profiles!sender_id (
        id,
        name,
        username,
        avatar_url
      )
    `;

    const [
      { data: root, error: rootError },
      { data: replies, error: repliesError },
    ] = await Promise.all([
      this.supabase
        .from("messages")
        .select(selectClause)
        .eq("id", rootId)
        .eq("group_id", groupId)
        .maybeSingle(),
      this.supabase
        .from("messages")
        .select(selectClause)
        .eq("group_id", groupId)
        .eq("thread_root_id", rootId)
        .order("timestamp", { ascending: true }),
    ]);

    if (rootError) throw rootError;
    if (repliesError) throw repliesError;
    if (!root) return [];

    const combined = [root, ...(replies || [])];
    const withReplies = await this.attachReplyPreviewsBatch(
      combined,
      "messages",
    );
    const withCounts = await this.attachThreadReplyCounts(
      withReplies,
      "messages",
      "group_id",
      groupId,
    );

    const mapped = withCounts.map((msg: any) => ({
      id: msg.id,
      groupId: msg.group_id,
      sender: mapProfileSender(
        resolveNestedProfile(msg.profiles),
        msg.sender_id,
      ),
      senderId: msg.sender_id,
      timestamp: msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
      flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
      upvotes: msg.upvotes || 0,
      downvotes: msg.downvotes || 0,
      isArchived: msg.is_archived || false,
      ...this.normalizeMessageRecord(msg),
    })) as Message[];

    if (viewerUserId) {
      return this.enrichGroupMessageReceipts(mapped, groupId, viewerUserId);
    }
    return mapped;
  }

  async getDmThread(
    threadId: string,
    rootId: string,
    viewerUserId: string,
  ): Promise<Message[]> {
    const { data: thread, error: threadError } = await this.supabase
      .from("dm_threads")
      .select("participant_ids, history_cleared_at")
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    const participantIds = Array.isArray(thread?.participant_ids)
      ? thread!.participant_ids
      : [];
    if (!participantIds.includes(viewerUserId)) {
      throw new Error("Access denied");
    }
    const peerUserId = participantIds.find((id: string) => id !== viewerUserId);
    if (!peerUserId) {
      throw new Error("Invalid DM thread");
    }
    const historyClearedAt = readDmHistoryClearedAt(
      thread?.history_cleared_at,
      viewerUserId,
    );

    const selectClause = `
      id,
      thread_id,
      sender_id,
      text,
      timestamp,
      edited_at,
      removed_at,
      reply_to_message_id,
      thread_root_id,
      profiles:sender_id (
        id,
        name,
        avatar_url
      )
    `;

    const [
      { data: root, error: rootError },
      { data: replies, error: repliesError },
    ] = await Promise.all([
      this.supabase
        .from("dm_messages")
        .select(selectClause)
        .eq("id", rootId)
        .eq("thread_id", threadId)
        .maybeSingle(),
      this.supabase
        .from("dm_messages")
        .select(selectClause)
        .eq("thread_id", threadId)
        .eq("thread_root_id", rootId)
        .order("timestamp", { ascending: true }),
    ]);

    if (rootError) throw rootError;
    if (repliesError) throw repliesError;
    if (!root) return [];

    const combined = filterMessagesAfterDmHistoryCutoff(
      [root, ...(replies || [])],
      historyClearedAt,
    );
    if (!combined.length) return [];
    const withReplies = await this.attachReplyPreviewsBatch(
      combined,
      "dm_messages",
    );
    const withCounts = await this.attachThreadReplyCounts(
      withReplies,
      "dm_messages",
      "thread_id",
      threadId,
    );

    const mapped = withCounts.map((msg: any) => ({
      id: msg.id,
      threadId: msg.thread_id,
      sender: mapProfileSender(
        resolveNestedProfile(msg.profiles),
        msg.sender_id,
      ),
      senderId: msg.sender_id,
      timestamp: new Date(msg.timestamp),
      type: "TEXT" as const,
      ...(!msg.removed_at ? { text: msg.text } : {}),
      editedAt: msg.edited_at || undefined,
      removedAt: msg.removed_at || undefined,
      isRemoved: !!msg.removed_at,
      upvotes: 0,
      downvotes: 0,
      flaggedAsSimilarUserIds: [],
      replyToMessageId: msg.reply_to_message_id || undefined,
      replyTo: msg.replyTo || undefined,
      threadRootId: msg.thread_root_id || undefined,
      replyCount: typeof msg.replyCount === "number" ? msg.replyCount : 0,
    })) as Message[];

    return this.enrichDmMessageReceipts(
      mapped,
      threadId,
      viewerUserId,
      peerUserId,
    );
  }

  private async notifyMentionedUsers(params: {
    groupId: string;
    senderId: string;
    messageId: string;
    mentionedUserIds: string[];
    preview: string;
    mentionedEveryone?: boolean;
  }): Promise<void> {
    const {
      groupId,
      senderId,
      messageId,
      mentionedUserIds,
      preview,
      mentionedEveryone,
    } = params;
    if (!mentionedUserIds.length) return;
    const [groupMeta, sender] = await Promise.all([
      this.getGroupById(groupId),
      this.getUserById(senderId),
    ]);
    const groupName = (groupMeta as any)?.name || "a group";
    const actor =
      sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
    const snippet = preview.slice(0, 80);
    const message = mentionedEveryone
      ? `${actor} mentioned everyone in ${groupName}: ${snippet}`
      : `${actor} mentioned you in ${groupName}: ${snippet}`;
    await Promise.all(
      mentionedUserIds.map((recipientId) =>
        this.createNotification(recipientId, {
          message,
          link: `/chat/${groupId}?messageId=${messageId}`,
          type: "mention",
          data: {
            groupId,
            messageId,
            senderId,
            preview: snippet,
            mentionedEveryone: !!mentionedEveryone,
          },
        }).catch((err) => {
          logger.warn("Failed to notify mentioned user", {
            err,
            recipientId,
            messageId,
          });
        }),
      ),
    );
  }

  private async notifyReplyRecipient(params: {
    groupId: string;
    senderId: string;
    messageId: string;
    replyToMessageId: string;
    preview: string;
    skipUserIds?: string[];
  }): Promise<void> {
    const {
      groupId,
      senderId,
      messageId,
      replyToMessageId,
      preview,
      skipUserIds,
    } = params;
    const { data: parent, error } = await this.supabase
      .from("messages")
      .select("id, sender_id")
      .eq("id", replyToMessageId)
      .eq("group_id", groupId)
      .maybeSingle();
    if (error || !parent?.sender_id || parent.sender_id === senderId) return;
    if (skipUserIds?.includes(parent.sender_id)) return;

    const [groupMeta, sender] = await Promise.all([
      this.getGroupById(groupId),
      this.getUserById(senderId),
    ]);
    const groupName = (groupMeta as any)?.name || "a group";
    const actor =
      sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
    await this.createNotification(parent.sender_id, {
      message: `${actor} replied to you in ${groupName}: ${preview.slice(0, 80)}`,
      link: `/chat/${groupId}?messageId=${messageId}`,
      type: "reply",
      data: {
        groupId,
        messageId,
        senderId,
        replyToMessageId,
        preview: preview.slice(0, 80),
      },
    }).catch((err) => {
      logger.warn("Failed to notify reply recipient", {
        err,
        messageId,
        replyToMessageId,
      });
    });
  }

  async sendMessage(
    groupId: string,
    userId: string,
    content: string,
    clientMessageId?: string,
    options?: { replyToMessageId?: string; mentionedUserIds?: string[] },
  ): Promise<any> {
    let messageData: any;
    let isQuestion = false;
    const replyToMessageId =
      typeof options?.replyToMessageId === "string" && options.replyToMessageId
        ? options.replyToMessageId
        : undefined;

    // First, try to parse as JSON to check if it's a question
    try {
      messageData = JSON.parse(content);
      isQuestion = messageData.type === "QUESTION" || messageData.questionStem;
      logger.info("sendMessage: Parsed content as JSON", {
        isQuestion,
        type: messageData.type,
        hasQuestionStem: !!messageData.questionStem,
      });
    } catch (parseError) {
      // Not JSON, treat as text message
      logger.info("sendMessage: Content is plain text");
      isQuestion = false;
    }

    const mentionSource = isQuestion
      ? String(messageData?.questionStem || content)
      : content;
    const mentionedUserIds = await this.resolveGroupMentionUserIds(
      groupId,
      userId,
      mentionSource,
      options?.mentionedUserIds,
    );

    let threadRootId: string | undefined;
    if (replyToMessageId) {
      threadRootId = await this.resolveThreadRootForReply(
        "messages",
        replyToMessageId,
        {
          groupId,
        },
      );
    }

    if (isQuestion) {
      // Question message
      logger.info("sendMessage: Inserting QUESTION message", {
        groupId,
        userId,
        questionStem: messageData.questionStem?.substring(0, 50),
        questionType: messageData.questionType,
      });

      const insertBase: Record<string, unknown> = {
        group_id: groupId,
        sender_id: userId,
        mentioned_user_ids: mentionedUserIds,
      };
      if (clientMessageId) {
        insertBase.client_message_id = clientMessageId;
      }
      if (replyToMessageId) {
        insertBase.reply_to_message_id = replyToMessageId;
      }
      if (threadRootId) {
        insertBase.thread_root_id = threadRootId;
      }

      const { data, error } = await this.supabase
        .from("messages")
        .insert({
          ...insertBase,
          type: "QUESTION",
          question_data: messageData,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505" && clientMessageId) {
          const existing = await this.findGroupMessageByClientId(
            groupId,
            userId,
            clientMessageId,
          );
          if (existing) return existing;
        }
        logger.error("sendMessage: Failed to insert QUESTION message", {
          error,
        });
        throw error;
      }

      logger.info("sendMessage: QUESTION message inserted successfully", {
        messageId: data.id,
        timestamp: data.timestamp,
      });

      // Invalidate cache
      await cacheService.invalidateGroupCache(groupId);

      await this.incrementUserStatsAndAwardBadges(userId, {
        questionsCreated: 1,
      }).catch((err) => {
        logger.warn("Failed to increment questionsCreated gamification", {
          userId,
          err,
        });
      });

      const questionPreview = messageData.questionStem
        ? `New question: ${String(messageData.questionStem).substring(0, 50)}`
        : "posted a new question";
      void this.supabase
        .from("groups")
        .update({
          last_message: questionPreview,
          last_message_time: data.timestamp || new Date().toISOString(),
        })
        .eq("id", groupId);
      const mentionedEveryone =
        extractMentionUsernames(mentionSource).includes("all");
      void this.notifyGroupMessageRecipients({
        groupId,
        senderId: userId,
        content: questionPreview,
        messageId: data.id,
        excludeUserIds: mentionedUserIds,
      }).catch((err) => {
        logger.error("Failed to notify group message recipients", {
          err,
          groupId,
          messageId: data.id,
        });
      });
      void this.notifyMentionedUsers({
        groupId,
        senderId: userId,
        messageId: data.id,
        mentionedUserIds,
        preview: questionPreview,
        mentionedEveryone,
      });
      if (replyToMessageId) {
        void this.notifyReplyRecipient({
          groupId,
          senderId: userId,
          messageId: data.id,
          replyToMessageId,
          preview: questionPreview,
          skipUserIds: mentionedUserIds,
        });
      }

      const withReply = await this.attachReplyPreview(data);
      return {
        ...withReply,
        threadRootId: withReply.thread_root_id || undefined,
        replyCount: 0,
        receiptStatus: "sent" as const,
        seenByCount: 0,
        seenByTotal: 0,
      };
    } else {
      // Text message
      logger.info("sendMessage: Inserting TEXT message", { groupId, userId });

      const insertBase: Record<string, unknown> = {
        group_id: groupId,
        sender_id: userId,
        mentioned_user_ids: mentionedUserIds,
      };
      if (clientMessageId) {
        insertBase.client_message_id = clientMessageId;
      }
      if (replyToMessageId) {
        insertBase.reply_to_message_id = replyToMessageId;
      }
      if (threadRootId) {
        insertBase.thread_root_id = threadRootId;
      }

      const { data, error } = await this.supabase
        .from("messages")
        .insert({
          ...insertBase,
          type: "TEXT",
          text: content,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505" && clientMessageId) {
          const existing = await this.findGroupMessageByClientId(
            groupId,
            userId,
            clientMessageId,
          );
          if (existing) return existing;
        }
        logger.error("sendMessage: Failed to insert TEXT message", { error });
        throw error;
      }

      logger.info("sendMessage: TEXT message inserted successfully", {
        messageId: data.id,
      });

      // Keep group list preview in sync for recipients who have not opened the chat yet.
      void this.supabase
        .from("groups")
        .update({
          last_message: content,
          last_message_time: data.timestamp || new Date().toISOString(),
        })
        .eq("id", groupId)
        .then(({ error: groupUpdateError }) => {
          if (groupUpdateError) {
            logger.warn("Failed to update group last_message after send", {
              groupId,
              error: groupUpdateError,
            });
          }
        });

      const mentionedEveryone =
        extractMentionUsernames(content).includes("all");
      void this.notifyGroupMessageRecipients({
        groupId,
        senderId: userId,
        content,
        messageId: data.id,
        excludeUserIds: mentionedUserIds,
      }).catch((err) => {
        logger.error("Failed to notify group message recipients", {
          err,
          groupId,
          messageId: data.id,
        });
      });
      void this.notifyMentionedUsers({
        groupId,
        senderId: userId,
        messageId: data.id,
        mentionedUserIds,
        preview: content,
        mentionedEveryone,
      });
      if (replyToMessageId) {
        void this.notifyReplyRecipient({
          groupId,
          senderId: userId,
          messageId: data.id,
          replyToMessageId,
          preview: content,
          skipUserIds: mentionedUserIds,
        });
      }

      // Invalidate cache
      await cacheService.invalidateGroupCache(groupId);

      const withReply = await this.attachReplyPreview(data);
      return {
        ...withReply,
        threadRootId: withReply.thread_root_id || undefined,
        replyCount: 0,
        receiptStatus: "sent" as const,
        seenByCount: 0,
        seenByTotal: 0,
      };
    }
  }

  /** Notify active members after a group message is persisted (message-before-notification ordering). */
  private async notifyGroupMessageRecipients(params: {
    groupId: string;
    senderId: string;
    content: string;
    messageId: string;
    excludeUserIds?: string[];
  }): Promise<void> {
    const { groupId, senderId, content, messageId, excludeUserIds } = params;
    const [{ data: members, error: membersError }, groupMeta, sender] =
      await Promise.all([
        this.supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("pending", false),
        this.getGroupById(groupId),
        this.getUserById(senderId),
      ]);

    if (membersError) throw membersError;

    const excluded = new Set(excludeUserIds || []);
    const recipientIds = (members || [])
      .map((m) => m.user_id)
      .filter((id) => id && id !== senderId && !excluded.has(id));
    if (!recipientIds.length) return;

    const groupName = groupMeta?.name || "a group";
    const actorLabel =
      sender?.name || (sender?.username ? `@${sender.username}` : "Someone");
    const preview =
      content.length > 50 ? `${content.substring(0, 50)}…` : content;

    await Promise.all(
      recipientIds.map((recipientId) =>
        this.createNotification(recipientId, {
          message: `New message in ${groupName} from ${actorLabel}: "${preview}"`,
          link: `/chat/${groupId}`,
          type: "group_message",
          data: { groupId, messageId, senderId, preview },
        }).catch((err) => {
          logger.error("Failed to create group message notification", {
            err,
            groupId,
            recipientId,
            messageId,
          });
        }),
      ),
    );
  }

  async fetchMessages(groupId: string): Promise<Message[]> {
    const cacheKey = `group:${groupId}:messages`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("messages")
          .select(
            `
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          edited_at,
          removed_at,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          profiles!sender_id (
            id,
            name,
            username,
            avatar_url
          )
        `,
          )
          .eq("group_id", groupId)
          .order("timestamp", { ascending: true });

        if (error) throw error;

        return data.map((msg: any) => ({
          id: msg.id,
          groupId: msg.group_id,
          sender: mapProfileSender(
            resolveNestedProfile(msg.profiles),
            msg.sender_id,
          ),
          timestamp: msg.timestamp
            ? new Date(msg.timestamp).toISOString()
            : new Date().toISOString(),
          flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
          upvotes: msg.upvotes || 0,
          downvotes: msg.downvotes || 0,
          isArchived: msg.is_archived || false,
          ...this.normalizeMessageRecord(msg),
        }));
      },
      { ttl: 30 },
    ); // Cache for 30 seconds
  }

  private parseMessageContent(msg: any): Partial<Message> {
    if (msg.type === "TEXT") {
      return {
        type: "TEXT",
        text: msg.text,
      };
    } else if (msg.type === "QUESTION") {
      return {
        type: "QUESTION",
        ...msg.question_data,
      };
    }
    return {};
  }

  // Test Results Functions
  async fetchTestResults(userId: string): Promise<TestResult[]> {
    const cacheKey = `user:${userId}:test-results`;

    return cacheService.cached(
      cacheKey,
      async () => {
        const { data, error } = await this.supabase
          .from("test_sessions")
          .select(
            `
          *,
          test_results (*)
        `,
          )
          .eq("user_id", userId)
          .order("start_time", { ascending: false });

        if (error) throw error;

        return data.flatMap((session: any) =>
          session.test_results.map((result: any) => ({
            id: result.id,
            session: {
              ...session,
              startTime: session.start_time,
              endTime: session.end_time,
              isOffline: session.is_offline,
              config: session.config,
              questions: session.questions,
              userAnswers: session.user_answers,
            },
            score: result.score,
            totalQuestions: result.total_questions,
            correctAnswersCount: result.correct_answers_count,
          })),
        );
      },
      { ttl: 300 },
    ); // Cache for 5 minutes
  }

  // Real-time subscription helpers (for future use)
  getSupabaseClient() {
    return this.supabase;
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data: row } = await this.supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (row) return true;

    const { data: authData, error } =
      await this.supabase.auth.admin.getUserById(userId);
    if (error || !authData?.user) return false;
    return authData.user.app_metadata?.is_platform_admin === true;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("profiles")
        .select("id")
        .limit(1);

      if (error) throw error;
      return true;
    } catch (error) {
      logger.error("Database health check failed:", error);
      return false;
    }
  }

  async verifySupabaseToken(
    accessToken: string,
  ): Promise<{ user: any; isValid: boolean }> {
    try {
      const { data, error } = await this.supabase.auth.getUser(accessToken);
      if (error) {
        return { user: null, isValid: false };
      }
      return { user: data.user, isValid: true };
    } catch (error) {
      logger.error("Token verification failed:", error);
      return { user: null, isValid: false };
    }
  }

  // Marketplace Methods for API Routes
  async getMarketplaceCampuses(countryCode = "NG"): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("marketplace_campuses")
      .select("id, name, city, state, country_code, slug, geopolitical_zone")
      .eq("active", true)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async getMarketplaceCampusById(campusId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("marketplace_campuses")
      .select(
        "id, name, city, state, country_code, slug, active, geopolitical_zone",
      )
      .eq("id", campusId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Compact card payloads: keep only the first image per listing (cards render one),
   * signing private-bucket URLs in a single batched createSignedUrls call per bucket
   * instead of one storage round-trip per image. Prefers the 320px grid thumbnail
   * (<path>.thumb.webp, generated at upload) and falls back to the original for
   * listings created before thumbnails existed.
   */
  private async toListingCardRecords(listings: any[]): Promise<any[]> {
    const entries = listings.map((listing) => {
      const images = Array.isArray(listing.images) ? listing.images : [];
      const first =
        images.length > 0 ? this.normalizeStorageUrl(images[0]) : null;
      let parsed: { bucket: string; path: string } | null = null;
      if (first && !first.startsWith("data:")) {
        const candidate = parseStorageObjectUrl(first);
        if (candidate && isPrivateStorageBucket(candidate.bucket))
          parsed = candidate;
      }
      return { first, parsed, imageCount: images.length };
    });

    const refs = entries
      .map((entry, index) =>
        entry.parsed
          ? {
              bucket: entry.parsed.bucket,
              path: entry.parsed.path,
              index,
            }
          : null,
      )
      .filter(Boolean) as Array<{ bucket: string; path: string; index: number }>;

    const signedByIndex = await this.signStorageDisplayUrls(refs, {
      expiresInSeconds: 60 * 60 * 24,
      variant: "thumb",
    });

    return listings.map((listing, index) => {
      const entry = entries[index];
      const cardImage = entry
        ? (signedByIndex.get(index) ?? entry.first)
        : null;
      return {
        ...this.normalizeListingRecord(listing),
        images: cardImage ? [cardImage] : [],
        image_count: entry?.imageCount ?? 0,
      };
    });
  }

  /** Trim a normalized listing row to the fields listing cards actually render. */
  private pickCompactListingFields(listing: any): any {
    const {
      id,
      user_id,
      category,
      title,
      description,
      price,
      sale_price,
      sale_ends_at,
      promo_label,
      effective_price,
      is_on_sale,
      location,
      campus_id,
      country_code,
      images,
      image_count,
      status,
      created_at,
      views_count,
      seller,
      is_boosted,
    } = listing;
    return {
      id,
      user_id,
      category,
      title,
      description,
      price,
      sale_price,
      sale_ends_at,
      promo_label,
      effective_price,
      is_on_sale,
      location,
      campus_id,
      country_code,
      images,
      image_count,
      status,
      created_at,
      views_count,
      seller,
      is_boosted,
    };
  }

  async getMarketplaceListings(
    options: {
      page?: number;
      limit?: number;
      category?: string;
      categories?: string[];
      includeCustomCategories?: boolean;
      search?: string;
      minPrice?: number;
      maxPrice?: number;
      location?: string;
      campusId?: string;
      countryCode?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      responseProfile?: "compact" | "full";
    } = {},
  ): Promise<{ data: any[]; total: number }> {
    const {
      page = 1,
      limit = 20,
      category,
      categories,
      includeCustomCategories = false,
      search,
      minPrice,
      maxPrice,
      location,
      campusId,
      countryCode,
      sortBy = "created_at",
      sortOrder = "desc",
      responseProfile = "full",
    } = options;
    const profile = this.getResponseProfile(responseProfile);

    const offset = (page - 1) * limit;
    const categoryList =
      categories && categories.length > 0 ? categories : undefined;

    const useSearchRpc =
      Boolean(search) ||
      Boolean(category) ||
      Boolean(categoryList) ||
      minPrice !== undefined ||
      maxPrice !== undefined ||
      Boolean(location);

    if (useSearchRpc) {
      const { data: rpcRows, error: rpcError } = await this.supabase.rpc(
        "marketplace_search_listings",
        {
          p_search: search || "",
          p_page: page,
          p_limit: limit,
          p_category: category || null,
          p_min_price: minPrice ?? null,
          p_max_price: maxPrice ?? null,
          p_location: location || null,
          p_sort_by: sortBy,
          p_sort_order: sortOrder,
          p_campus_id: campusId || null,
          p_country_code: countryCode || null,
          p_categories: categoryList ?? null,
          p_include_custom: includeCustomCategories,
        },
      );

      if (!rpcError && rpcRows) {
        const rows = rpcRows as any[];
        const total =
          rows.length > 0 ? Number(rows[0].total_count) || rows.length : 0;
        const mapped = rows.map((row) => {
          const { total_count: _totalCount, profiles, ...rest } = row;
          return { ...rest, seller: profiles || row.seller };
        });
        if (profile === "compact") {
          const cards = await this.toListingCardRecords(mapped);
          return {
            data: cards.map((row) => this.pickCompactListingFields(row)),
            total,
          };
        }
        return { data: mapped, total };
      }
      if (rpcError) {
        console.warn(
          "marketplace_search_listings RPC failed, falling back to ilike query",
          rpcError.message,
        );
      }
    }

    const selectClause =
      profile === "compact"
        ? `
        id,
        user_id,
        category,
        title,
        description,
        price,
        sale_price,
        sale_ends_at,
        promo_label,
        location,
        campus_id,
        country_code,
        images,
        created_at,
        status,
        views_count,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `
        : `
        *,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `;

    let query = this.supabase
      .from("marketplace_listings")
      .select(selectClause, { count: "exact" })
      // Reserved stays visible (sale in progress) but purchase APIs still require active.
      .in("status", ["active", "reserved"])
      .range(offset, offset + limit - 1);

    if (countryCode) {
      query = query.eq("country_code", countryCode);
    }

    if (campusId) {
      query = query.eq("campus_id", campusId);
    }

    if (category) {
      query = query.eq("category", category);
    } else if (categoryList) {
      const inList = `category.in.(${categoryList.join(",")})`;
      query = includeCustomCategories
        ? query.or(`${inList},category.like.custom:*`)
        : query.or(inList);
    }

    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    if (minPrice !== undefined) {
      query = query.gte("price", minPrice);
    }

    if (maxPrice !== undefined) {
      query = query.lte("price", maxPrice);
    }

    if (location) {
      query = query.ilike("location", `%${location}%`);
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === "asc" });

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = data || [];
    const total = count ?? rows.length;

    if (profile === "compact") {
      const cards = await this.toListingCardRecords(rows);
      return {
        data: cards.map((row) => this.pickCompactListingFields(row)),
        total,
      };
    }

    const normalized = await Promise.all(
      rows.map((listing: any) => this.normalizeListingRecordAsync(listing)),
    );
    return { data: normalized, total };
  }

  /** Batch fetch of active listings by id (recently-viewed rail). Card-shaped payloads. */
  async getMarketplaceListingsByIds(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .select(
        `
        id,
        user_id,
        category,
        title,
        description,
        price,
        sale_price,
        sale_ends_at,
        promo_label,
        location,
        campus_id,
        country_code,
        images,
        created_at,
        status,
        views_count,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `,
      )
      .in("id", ids)
      .eq("status", "active");
    if (error) throw error;

    const cards = await this.toListingCardRecords(data || []);
    const byId = new Map(
      cards.map((row: any) => [row.id, this.pickCompactListingFields(row)]),
    );
    // Preserve the caller's id order (most recently viewed first).
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async getMarketplaceCategoryAnalytics(): Promise<
    Array<{
      category: string;
      total: number;
      active: number;
      sold: number;
    }>
  > {
    const { data, error } = await this.supabase.rpc(
      "marketplace_category_analytics",
    );
    if (!error && data) {
      return (data as any[]).map((row) => ({
        category: String(row.category || "unknown"),
        total: Number(row.total) || 0,
        active: Number(row.active) || 0,
        sold: Number(row.sold) || 0,
      }));
    }
    if (error) {
      console.warn(
        "marketplace_category_analytics RPC failed, falling back to full scan",
        error.message,
      );
    }

    const { data: rows, error: scanError } = await this.supabase
      .from("marketplace_listings")
      .select("category, status");
    if (scanError) throw scanError;

    const counts = new Map<
      string,
      { total: number; active: number; sold: number }
    >();
    for (const row of rows || []) {
      const category = String(row.category || "unknown");
      const entry = counts.get(category) || { total: 0, active: 0, sold: 0 };
      entry.total += 1;
      if (row.status === "active") entry.active += 1;
      if (row.status === "sold") entry.sold += 1;
      counts.set(category, entry);
    }

    return Array.from(counts.entries())
      .map(([category, stats]) => ({ category, ...stats }))
      .sort((a, b) => b.total - a.total);
  }

  async getMarketplaceListingById(
    listingId: string,
    options?: { requireActive?: boolean },
  ): Promise<any | null> {
    let query = this.supabase
      .from("marketplace_listings")
      .select(
        `
        *,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        ),
        campus:marketplace_campuses!campus_id (
          id,
          name,
          city,
          state,
          slug,
          country_code,
          geopolitical_zone
        )
      `,
      )
      .eq("id", listingId);

    if (options?.requireActive) {
      query = query.eq("status", "active");
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    return data ? this.normalizeListingRecordAsync(data) : null;
  }

  /**
   * Public marketplace detail: active listings for anyone; owners/admins may view non-active.
   */
  async getMarketplaceListingForViewer(
    listingId: string,
    viewerId?: string | null,
  ): Promise<any | null> {
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) return null;

    // Reserved = sale in progress: visible (read-only), but buy/offer paths still require active.
    if (listing.status === "active" || listing.status === "reserved") return listing;

    if (!viewerId) return null;

    if (listing.user_id === viewerId) return listing;

    const isAdmin = await this.isPlatformAdmin(viewerId).catch(() => false);
    return isAdmin ? listing : null;
  }

  async createMarketplaceListing(
    listingData: any,
    userId: string,
  ): Promise<any> {
    const { normalizeMarketplacePricing } =
      await import("../utils/marketplacePricing");
    const campusId = listingData.campus_id ?? listingData.campusId;
    if (!campusId) {
      throw new Error("Campus or city metadata is required");
    }
    const pricing = normalizeMarketplacePricing({
      price: listingData.price,
      sale_price: listingData.sale_price,
      salePrice: listingData.salePrice,
    });
    // Transform camelCase to snake_case for database columns
    const dbData = {
      user_id: userId,
      category: listingData.category,
      title: listingData.title,
      description: listingData.description,
      price: pricing.price,
      sale_price: pricing.sale_price,
      sale_ends_at:
        pricing.sale_price != null
          ? (listingData.sale_ends_at ?? listingData.saleEndsAt ?? null)
          : null,
      promo_label: listingData.promo_label ?? listingData.promoLabel,
      location: listingData.location,
      campus_id: campusId,
      country_code: MARKETPLACE_DEFAULT_COUNTRY,
      currency: MARKETPLACE_DEFAULT_CURRENCY,
      images: listingData.images || [],
      category_specific_fields:
        listingData.categorySpecificFields ||
        listingData.category_specific_fields ||
        {},
      listing_kind:
        listingData.listing_kind || listingData.listingKind || "single",
      bundle_items: listingData.bundle_items || listingData.bundleItems || [],
      quantity: listingData.quantity ?? null,
      status: listingData.status || "active",
    };

    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .insert(dbData)
      .select()
      .single();

    if (error) {
      logger.error("Failed to create marketplace listing:", error);
      throw error;
    }
    return data;
  }

  async updateMarketplaceListing(
    listingId: string,
    updates: any,
  ): Promise<any | null> {
    const dbUpdates: Record<string, unknown> = {};
    const assign = (key: string, ...sources: string[]) => {
      for (const source of sources) {
        if (updates?.[source] !== undefined) {
          dbUpdates[key] = updates[source];
          return;
        }
      }
    };

    assign("category", "category");
    assign("title", "title");
    assign("description", "description");
    assign("promo_label", "promo_label", "promoLabel");
    assign("location", "location");
    if (
      (updates?.campus_id !== undefined || updates?.campusId !== undefined) &&
      !(updates.campus_id ?? updates.campusId)
    ) {
      throw new Error("Campus or city metadata cannot be removed");
    }
    assign("campus_id", "campus_id", "campusId");
    if (
      updates?.country_code !== undefined ||
      updates?.countryCode !== undefined
    ) {
      dbUpdates.country_code = MARKETPLACE_DEFAULT_COUNTRY;
    }
    if (updates?.currency !== undefined) {
      dbUpdates.currency = MARKETPLACE_DEFAULT_CURRENCY;
    }
    if (updates?.images !== undefined) dbUpdates.images = updates.images;
    assign(
      "category_specific_fields",
      "categorySpecificFields",
      "category_specific_fields",
    );
    assign("listing_kind", "listing_kind", "listingKind");
    if (
      updates?.bundle_items !== undefined ||
      updates?.bundleItems !== undefined
    ) {
      dbUpdates.bundle_items = updates.bundle_items ?? updates.bundleItems;
    }
    if (updates?.quantity !== undefined) dbUpdates.quantity = updates.quantity;
    assign("status", "status");

    const touchesPricing =
      updates?.price !== undefined ||
      updates?.sale_price !== undefined ||
      updates?.salePrice !== undefined ||
      updates?.sale_ends_at !== undefined ||
      updates?.saleEndsAt !== undefined;
    if (touchesPricing) {
      const { normalizeMarketplacePricing } =
        await import("../utils/marketplacePricing");
      const current = await this.getMarketplaceListingById(listingId);
      const pricing = normalizeMarketplacePricing({
        price: updates?.price !== undefined ? updates.price : current?.price,
        sale_price:
          updates?.sale_price !== undefined || updates?.salePrice !== undefined
            ? (updates.sale_price ?? updates.salePrice)
            : current?.sale_price,
      });
      dbUpdates.price = pricing.price;
      dbUpdates.sale_price = pricing.sale_price;
      if (pricing.sale_price == null) {
        dbUpdates.sale_ends_at = null;
      } else if (
        updates?.sale_ends_at !== undefined ||
        updates?.saleEndsAt !== undefined
      ) {
        dbUpdates.sale_ends_at = updates.sale_ends_at ?? updates.saleEndsAt;
      }
    }

    if (Object.keys(dbUpdates).length === 0) {
      return this.getMarketplaceListingById(listingId);
    }

    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .update(dbUpdates)
      .eq("id", listingId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    if (updates?.status === "sold" && data?.user_id) {
      await this.maybeLogManualSoldBudget(listingId, data.user_id);
    }

    return data;
  }

  async deleteMarketplaceListing(listingId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from("marketplace_listings")
      .delete()
      .eq("id", listingId);

    if (error) throw error;
    return true;
  }

  async addMarketplaceReview(
    listingId: string,
    reviewerId: string,
    review: { rating: number; comment?: string },
  ): Promise<any> {
    const { MARKETPLACE_REVIEW_SELECT, mapMarketplaceReviewRow } =
      await import("./marketplaceReviewMapping");
    const { data, error } = await this.supabase
      .from("marketplace_reviews")
      .upsert(
        {
          listing_id: listingId,
          reviewer_id: reviewerId,
          rating: review.rating,
          comment: review.comment,
        },
        { onConflict: "listing_id,reviewer_id" },
      )
      .select(MARKETPLACE_REVIEW_SELECT)
      .single();

    if (error) throw error;
    return mapMarketplaceReviewRow(data as any);
  }

  async getMarketplaceReviews(listingId: string): Promise<any[]> {
    const { MARKETPLACE_REVIEW_SELECT, mapMarketplaceReviewRow } =
      await import("./marketplaceReviewMapping");
    const { data, error } = await this.supabase
      .from("marketplace_reviews")
      .select(MARKETPLACE_REVIEW_SELECT)
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => mapMarketplaceReviewRow(row));
  }

  async buyMarketplaceListingNow(
    listingId: string,
    buyerId: string,
    couponCode?: string,
    quantity?: number,
  ): Promise<{ order: Record<string, unknown>; budgetLogged?: boolean }> {
    const { getMarketplaceOrdersService } = await import("./marketplaceOrders");
    const order = await getMarketplaceOrdersService(this).createOrderFromBuyNow(
      listingId,
      buyerId,
      couponCode,
      quantity,
    );
    return { order, budgetLogged: false };
  }

  async boostMarketplaceListing(
    listingId: string,
    userId: string,
    durationHours: number = 72,
  ): Promise<any> {
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.user_id !== userId)
      throw new Error("Unauthorized: You do not own this listing");

    const existingFields =
      listing.category_specific_fields || listing.categorySpecificFields || {};
    const boostedUntil = existingFields.boosted_until as string | undefined;
    if (boostedUntil && new Date(boostedUntil) > new Date()) {
      return this.normalizeListingRecord(listing);
    }

    const { getMarketplaceSellerToolsService } =
      await import("./marketplaceSellerTools");
    await getMarketplaceSellerToolsService(this).consumeBoostCredit(userId);

    const newBoostedUntil = new Date(
      Date.now() + durationHours * 60 * 60 * 1000,
    ).toISOString();
    const categorySpecificFields = {
      ...existingFields,
      boosted_until: newBoostedUntil,
      boost_level: "standard",
    };

    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .update({
        category_specific_fields: categorySpecificFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", listingId)
      .select("*")
      .single();

    if (error) throw error;
    return this.normalizeListingRecordAsync(data);
  }

  async reportMarketplaceListing(
    listingId: string,
    reporterId: string,
    report: { reason: string; details?: string },
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("marketplace_reports")
      .insert({
        listing_id: listingId,
        reporter_id: reporterId,
        reason: report.reason,
        details: report.details,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async initiateMarketplaceTransaction(
    listingId: string,
    buyerId: string,
    amount: number,
    source: "buy_now" | "offer_accept" = "buy_now",
    options?: { skipBudgetLog?: boolean },
  ): Promise<any> {
    // Get listing to verify seller
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) throw new Error("Listing not found");

    const { data, error } = await this.supabase
      .from("marketplace_transactions")
      .insert({
        buyer_id: buyerId,
        seller_id: listing.user_id,
        listing_id: listingId,
        amount,
      })
      .select()
      .single();

    if (error) throw error;

    if (!options?.skipBudgetLog) {
      await this.logMarketplaceBudgetTransactions({
        listingId,
        listingTitle: listing.title || "Marketplace item",
        amount,
        sellerId: listing.user_id,
        buyerId,
        marketplaceTransactionId: data.id,
        source,
      });
    }

    return data;
  }

  async logMarketplaceBudgetTransactions(params: {
    listingId: string;
    listingTitle: string;
    amount: number;
    sellerId: string;
    buyerId?: string;
    marketplaceTransactionId?: string;
    source: "buy_now" | "offer_accept" | "manual_sold";
  }): Promise<boolean> {
    const amount = Number(params.amount) || 0;
    if (amount <= 0 || !params.sellerId) return false;

    const date = new Date().toISOString().split("T")[0];
    const title = params.listingTitle || "Marketplace item";
    const rows: Record<string, unknown>[] = [];

    if (params.marketplaceTransactionId && params.buyerId) {
      const { purchaseTxId, saleTxId } = buildMarketplaceBudgetTxIds(
        params.marketplaceTransactionId,
      );
      rows.push(
        {
          id: purchaseTxId,
          user_id: params.buyerId,
          type: MARKETPLACE_BUDGET_TYPES.PURCHASE,
          amount,
          category: MARKETPLACE_BUDGET_CATEGORIES.PURCHASE,
          description: buildMarketplacePurchaseDescription(title),
          date,
        },
        {
          id: saleTxId,
          user_id: params.sellerId,
          type: MARKETPLACE_BUDGET_TYPES.SALE,
          amount,
          category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
          description: buildMarketplaceSaleDescription(title),
          date,
        },
      );
    } else if (params.source === "manual_sold") {
      rows.push({
        id: buildManualSaleBudgetTxId(params.listingId),
        user_id: params.sellerId,
        type: MARKETPLACE_BUDGET_TYPES.SALE,
        amount,
        category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
        description: buildMarketplaceSaleDescription(title),
        date,
      });
    }

    if (rows.length === 0) return false;

    const { error } = await this.supabase
      .from("budget_transactions")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      logger.warn("Failed to log marketplace budget transactions", {
        error,
        source: params.source,
      });
      return false;
    }
    return true;
  }

  async maybeLogManualSoldBudget(
    listingId: string,
    sellerId: string,
  ): Promise<boolean> {
    const { data: existingTxn } = await this.supabase
      .from("marketplace_transactions")
      .select("id")
      .eq("listing_id", listingId)
      .limit(1)
      .maybeSingle();

    if (existingTxn) return false;

    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) return false;

    return this.logMarketplaceBudgetTransactions({
      listingId,
      listingTitle: listing.title || "Marketplace item",
      amount: Number(listing.price) || 0,
      sellerId,
      source: "manual_sold",
    });
  }

  async finalizeOfferAcceptSale(
    offerId: string,
    actorId?: string,
  ): Promise<{ orderId: string; budgetLogged: boolean }> {
    const { getMarketplaceOrdersService } = await import("./marketplaceOrders");
    const order = await getMarketplaceOrdersService(
      this,
    ).createOrderFromOfferAccept(offerId, actorId);
    return { orderId: order.id, budgetLogged: false };
  }

  // Get unread message count for a group for a specific user
  async getGroupUnreadCount(groupId: string, userId: string): Promise<number> {
    try {
      // Get user's last read timestamp for this group
      const { data: memberData, error: memberError } = await this.supabase
        .from("group_members")
        .select("last_read_at")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .single();

      if (memberError) {
        console.error("Error getting last_read_at:", memberError);
        return 0;
      }

      const lastReadAt = memberData?.last_read_at || new Date(0).toISOString();

      // Count messages after last read that were not sent by the user
      const { count, error: countError } = await this.supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .neq("sender_id", userId)
        .is("removed_at", null)
        .eq("is_archived", false)
        .gt("timestamp", lastReadAt);

      if (countError) {
        console.error("Error counting unread messages:", countError);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error("Error in getGroupUnreadCount:", error);
      return 0;
    }
  }

  // Get unread counts for all groups a user is in - OPTIMIZED: single query instead of N+1
  async getAllGroupUnreadCounts(
    userId: string,
  ): Promise<Record<string, number>> {
    try {
      // Use batch RPC function for single-query performance
      const { data, error } = await this.supabase.rpc(
        "get_unread_counts_batch",
        { p_user_id: userId },
      );

      if (error) {
        console.error("Error in batch unread counts:", error);
        if (process.env.NODE_ENV === "production") {
          return {};
        }
        return await this.getAllGroupUnreadCountsFallback(userId);
      }

      // Convert array result to Record
      const unreadCounts: Record<string, number> = {};
      if (data && Array.isArray(data)) {
        for (const item of data) {
          unreadCounts[item.group_id] = item.unread_count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllGroupUnreadCounts:", error);
      return {};
    }
  }

  // Fallback method for environments without the batch function
  private async getAllGroupUnreadCountsFallback(
    userId: string,
  ): Promise<Record<string, number>> {
    try {
      // Get all groups the user is a member of with their last_read_at
      const { data: memberships, error: memberError } = await this.supabase
        .from("group_members")
        .select("group_id, last_read_at")
        .eq("user_id", userId);

      if (memberError || !memberships) {
        console.error("Error getting memberships:", memberError);
        return {};
      }

      const unreadCounts: Record<string, number> = {};

      // For each group, count unread messages
      for (const membership of memberships) {
        const lastReadAt = membership.last_read_at || new Date(0).toISOString();

        const { count, error: countError } = await this.supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("group_id", membership.group_id)
          .neq("sender_id", userId)
          .is("removed_at", null)
          .eq("is_archived", false)
          .gt("timestamp", lastReadAt);

        if (!countError) {
          unreadCounts[membership.group_id] = count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllGroupUnreadCountsFallback:", error);
      return {};
    }
  }

  // Mark group as read for a user
  async markGroupAsRead(
    groupId: string,
    userId: string,
  ): Promise<{ success: boolean; previousLastReadAt: string | null }> {
    try {
      // Capture the prior marker before overwriting so clients can scroll to first unread.
      const { data: membership, error: readError } = await this.supabase
        .from("group_members")
        .select("last_read_at, joined_at")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .maybeSingle();

      if (readError) {
        console.error(
          "Error reading group membership for mark-as-read:",
          readError,
        );
        return { success: false, previousLastReadAt: null };
      }

      const previousLastReadAt: string | null =
        membership?.last_read_at || membership?.joined_at || null;

      const { error } = await this.supabase
        .from("group_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("user_id", userId);

      if (error) {
        console.error("Error marking group as read:", error);
        return { success: false, previousLastReadAt };
      }

      // Invalidate cache
      cacheService.delete(`group:unread:${groupId}:${userId}`);
      cacheService.delete(`user:unread:${userId}`);

      const lastReadAt = new Date().toISOString();
      void this.broadcastChatRead(groupId, { userId, lastReadAt });

      return { success: true, previousLastReadAt };
    } catch (error) {
      console.error("Error in markGroupAsRead:", error);
      return { success: false, previousLastReadAt: null };
    }
  }

  // Get unread DM count for a thread for a specific user
  async getDMUnreadCount(threadId: string, userId: string): Promise<number> {
    try {
      // Get user's last read timestamp for this thread
      const [{ data: readStatus }, { data: threadMeta }] = await Promise.all([
        this.supabase
          .from("dm_read_status")
          .select("last_read_at")
          .eq("thread_id", threadId)
          .eq("user_id", userId)
          .maybeSingle(),
        this.supabase
          .from("dm_threads")
          .select("history_cleared_at")
          .eq("id", threadId)
          .maybeSingle(),
      ]);

      // If no read status exists, count all messages not from this user
      const lastReadAt = readStatus?.last_read_at || new Date(0).toISOString();
      const historyClearedAt = readDmHistoryClearedAt(
        threadMeta?.history_cleared_at,
        userId,
      );
      const unreadFloor = effectiveDmUnreadFloor(lastReadAt, historyClearedAt);

      // Count messages after last read (and after delete cutoff) not sent by the user
      const { count, error: countError } = await this.supabase
        .from("dm_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", threadId)
        .neq("sender_id", userId)
        .is("removed_at", null)
        .gt("timestamp", unreadFloor);

      if (countError) {
        console.error("Error counting unread DMs:", countError);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error("Error in getDMUnreadCount:", error);
      return 0;
    }
  }

  // Get all DM unread counts for a user - OPTIMIZED: single query instead of N+1
  async getAllDMUnreadCounts(userId: string): Promise<Record<string, number>> {
    try {
      // Use batch RPC function for single-query performance
      const { data, error } = await this.supabase.rpc(
        "get_dm_unread_counts_batch",
        { p_user_id: userId },
      );

      if (error) {
        console.error("Error in batch DM unread counts:", error);
        if (process.env.NODE_ENV === "production") {
          return {};
        }
        return await this.getAllDMUnreadCountsFallback(userId);
      }

      // Convert array result to Record of unread counts
      const unreadCounts: Record<string, number> = {};
      if (data && Array.isArray(data)) {
        for (const item of data) {
          // Calculate unread based on last_read_at vs messages
          unreadCounts[item.thread_id] = item.unread_count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllDMUnreadCounts:", error);
      return {};
    }
  }

  // Fallback method for environments without the batch function
  private async getAllDMUnreadCountsFallback(
    userId: string,
  ): Promise<Record<string, number>> {
    try {
      // Get all DM threads the user is part of
      const { data: threads, error: threadError } = await this.supabase
        .from("dm_threads")
        .select("id, participant_ids");

      if (threadError || !threads) {
        console.error("Error getting DM threads:", threadError);
        return {};
      }

      // Filter to threads that include this user
      const userThreads = threads.filter((t: any) => {
        const participantIds = t.participant_ids;
        return Array.isArray(participantIds) && participantIds.includes(userId);
      });

      const unreadCounts: Record<string, number> = {};

      for (const thread of userThreads) {
        const count = await this.getDMUnreadCount(thread.id, userId);
        unreadCounts[thread.id] = count;
      }

      return unreadCounts;
    } catch (error) {
      console.error("Error in getAllDMUnreadCountsFallback:", error);
      return {};
    }
  }

  // Mark DM thread as read for a user; returns previous last_read_at for unread anchoring.
  async markDMAsRead(
    threadId: string,
    userId: string,
  ): Promise<{ success: boolean; previousLastReadAt: string | null }> {
    try {
      // Only participants may write read status for a thread.
      const { data: thread, error: threadError } = await this.supabase
        .from("dm_threads")
        .select("participant_ids")
        .eq("id", threadId)
        .single();

      const participantIds = Array.isArray(thread?.participant_ids)
        ? thread.participant_ids
        : [];
      if (threadError || !participantIds.includes(userId)) {
        console.error("markDMAsRead: user is not a participant of this thread");
        return { success: false, previousLastReadAt: null };
      }

      const { data: prior } = await this.supabase
        .from("dm_read_status")
        .select("last_read_at")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .maybeSingle();
      const previousLastReadAt = prior?.last_read_at || null;

      const lastReadAt = new Date().toISOString();
      const { error } = await this.supabase.from("dm_read_status").upsert(
        {
          thread_id: threadId,
          user_id: userId,
          last_read_at: lastReadAt,
        },
        { onConflict: "thread_id,user_id" },
      );

      if (error) {
        console.error("Error marking DM as read:", error);
        return { success: false, previousLastReadAt };
      }

      void this.broadcastChatRead(threadId, { userId, lastReadAt });

      return { success: true, previousLastReadAt };
    } catch (error) {
      console.error("Error in markDMAsRead:", error);
      return { success: false, previousLastReadAt: null };
    }
  }

  // "Delete for me": hide from inbox (hidden_by) and set a history cutoff so
  // pre-delete messages never resurface for this user. The other participant
  // keeps their full history; marketplace inquiry FKs are preserved.
  // A new message clears hidden_by (thread resurrects) but keeps history_cleared_at.
  async deleteDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      // Verify the user is a participant of this thread
      const { data: thread, error: fetchError } = await this.supabase
        .from("dm_threads")
        .select("participant_ids, hidden_by, history_cleared_at")
        .eq("id", threadId)
        .single();

      if (fetchError || !thread) {
        console.error("DM thread not found:", fetchError);
        return false;
      }

      const participantIds = Array.isArray(thread.participant_ids)
        ? thread.participant_ids
        : [];
      if (!participantIds.includes(userId)) {
        console.error("User is not a participant of this DM thread");
        return false;
      }

      const hiddenBy: string[] = Array.isArray(thread.hidden_by)
        ? thread.hidden_by
        : [];
      const clearedAt = new Date().toISOString();
      const nextHiddenBy = hiddenBy.includes(userId)
        ? hiddenBy
        : [...hiddenBy, userId];
      const nextHistoryClearedAt = withDmHistoryClearedAt(
        thread.history_cleared_at,
        userId,
        clearedAt,
      );

      const { error: updateError } = await this.supabase
        .from("dm_threads")
        .update({
          hidden_by: nextHiddenBy,
          history_cleared_at: nextHistoryClearedAt,
        })
        .eq("id", threadId);

      if (updateError) {
        console.error("Error hiding DM thread:", updateError);
        return false;
      }

      // Anchor read cursor at delete time so unread math cannot revive old rows
      // before history_cleared_at is applied everywhere.
      await this.supabase.from("dm_read_status").upsert(
        {
          thread_id: threadId,
          user_id: userId,
          last_read_at: clearedAt,
        },
        { onConflict: "thread_id,user_id" },
      );

      return true;
    } catch (error) {
      console.error("Error in deleteDmThread:", error);
      return false;
    }
  }

  // Archive a DM thread for a specific user
  async archiveDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      const { data: thread, error: fetchError } = await this.supabase
        .from("dm_threads")
        .select("participant_ids, archived_by")
        .eq("id", threadId)
        .single();

      if (fetchError || !thread) {
        console.error("DM thread not found:", fetchError);
        return false;
      }

      const participantIds = Array.isArray(thread.participant_ids)
        ? thread.participant_ids
        : [];
      if (!participantIds.includes(userId)) {
        console.error("User is not a participant of this DM thread");
        return false;
      }

      const archivedBy = Array.isArray(thread.archived_by)
        ? thread.archived_by
        : [];
      if (archivedBy.includes(userId)) return true; // Already archived

      const { error } = await this.supabase
        .from("dm_threads")
        .update({ archived_by: [...archivedBy, userId] })
        .eq("id", threadId);

      if (error) {
        console.error("Error archiving DM thread:", error);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error in archiveDmThread:", error);
      return false;
    }
  }

  // Unarchive a DM thread for a specific user
  async unarchiveDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      const { data: thread, error: fetchError } = await this.supabase
        .from("dm_threads")
        .select("archived_by")
        .eq("id", threadId)
        .single();

      if (fetchError || !thread) {
        console.error("DM thread not found:", fetchError);
        return false;
      }

      const archivedBy = Array.isArray(thread.archived_by)
        ? thread.archived_by
        : [];
      const { error } = await this.supabase
        .from("dm_threads")
        .update({
          archived_by: archivedBy.filter((id: string) => id !== userId),
        })
        .eq("id", threadId);

      if (error) {
        console.error("Error unarchiving DM thread:", error);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error in unarchiveDmThread:", error);
      return false;
    }
  }

  async isChatMuted(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("chat_mutes")
      .select("muted_until")
      .eq("user_id", userId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .maybeSingle();
    if (error || !data?.muted_until) return false;
    return new Date(data.muted_until).getTime() > Date.now();
  }

  async getChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<{ muted: boolean; mutedUntil: string | null }> {
    const { data, error } = await this.supabase
      .from("chat_mutes")
      .select("muted_until")
      .eq("user_id", userId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .maybeSingle();
    if (error || !data?.muted_until) {
      return { muted: false, mutedUntil: null };
    }
    const mutedUntil = data.muted_until as string;
    const muted = new Date(mutedUntil).getTime() > Date.now();
    if (!muted) {
      // Opportunistically clean expired rows.
      void this.supabase
        .from("chat_mutes")
        .delete()
        .eq("user_id", userId)
        .eq("scope_type", scopeType)
        .eq("scope_id", scopeId);
      return { muted: false, mutedUntil: null };
    }
    return { muted: true, mutedUntil };
  }

  private async assertChatMuteAccess(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    if (scopeType === "group") {
      const { data, error } = await this.supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", scopeId)
        .eq("user_id", userId)
        .eq("pending", false)
        .maybeSingle();
      return !error && !!data;
    }
    const { data, error } = await this.supabase
      .from("dm_threads")
      .select("participant_ids")
      .eq("id", scopeId)
      .maybeSingle();
    if (error || !data) return false;
    const pids = Array.isArray(data.participant_ids)
      ? data.participant_ids
      : [];
    return pids.includes(userId);
  }

  async setChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
    mutedUntil: Date,
  ): Promise<{ muted: boolean; mutedUntil: string } | null> {
    const allowed = await this.assertChatMuteAccess(userId, scopeType, scopeId);
    if (!allowed) return null;
    if (
      !(mutedUntil instanceof Date) ||
      Number.isNaN(mutedUntil.getTime()) ||
      mutedUntil.getTime() <= Date.now()
    ) {
      return null;
    }
    const untilIso = mutedUntil.toISOString();
    const { data, error } = await this.supabase
      .from("chat_mutes")
      .upsert(
        {
          user_id: userId,
          scope_type: scopeType,
          scope_id: scopeId,
          muted_until: untilIso,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,scope_type,scope_id" },
      )
      .select("muted_until")
      .single();
    if (error || !data) {
      logger.error("Failed to set chat mute", {
        error,
        userId,
        scopeType,
        scopeId,
      });
      return null;
    }
    return { muted: true, mutedUntil: data.muted_until as string };
  }

  async clearChatMute(
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ): Promise<boolean> {
    const allowed = await this.assertChatMuteAccess(userId, scopeType, scopeId);
    if (!allowed) return false;
    const { error } = await this.supabase
      .from("chat_mutes")
      .delete()
      .eq("user_id", userId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId);
    if (error) {
      logger.error("Failed to clear chat mute", {
        error,
        userId,
        scopeType,
        scopeId,
      });
      return false;
    }
    return true;
  }

  // ============ MARKETPLACE SELLER DASHBOARD METHODS ============

  // Get listings by seller (for seller dashboard)
  async getListingsBySeller(userId: string, status?: string): Promise<any[]> {
    let query = this.supabase
      .from("marketplace_listings")
      .select(
        `
        *,
        favorites_count:marketplace_favorites(count),
        inquiries_count:marketplace_inquiries(count)
      `,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (status === "active") {
      // Active shelf includes reserved (sale in progress) for seller inventory.
      query = query.in("status", ["active", "reserved"]);
    } else if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error("Error fetching seller listings:", error);
      throw error;
    }

    const mapped = (data || []).map((listing) => ({
      ...listing,
      favorites_count: listing.favorites_count?.[0]?.count || 0,
      inquiries_count: listing.inquiries_count?.[0]?.count || 0,
    }));
    // Grid cards only need the first image; prefer upload-time thumbs.
    return this.toListingCardRecords(mapped);
  }

  /** Sign similar-listing rails with thumb-or-original for the first image. */
  async signSimilarListingCards(listings: any[]): Promise<any[]> {
    return this.toListingCardRecords(listings || []);
  }

  // Update listing status (active, inactive, sold)
  async updateListingStatus(
    listingId: string,
    status: string,
    userId: string,
  ): Promise<any> {
    // Verify ownership
    const { data: listing } = await this.supabase
      .from("marketplace_listings")
      .select("user_id, status, title")
      .eq("id", listingId)
      .single();

    if (!listing || listing.user_id !== userId) {
      throw new Error("Unauthorized: You do not own this listing");
    }

    const previousStatus = listing.status;

    const { data, error } = await this.supabase
      .from("marketplace_listings")
      .update({ status })
      .eq("id", listingId)
      .select()
      .single();

    if (error) throw error;

    if (status === "sold") {
      await this.maybeLogManualSoldBudget(listingId, userId);
    }

    if (status === "active" && previousStatus !== "active") {
      const { notifyListingBackAvailable } =
        await import("./marketplaceFavoriteAlerts");
      await notifyListingBackAvailable(
        this,
        { id: listingId, user_id: userId, title: data.title || listing.title },
        previousStatus,
      );
    }

    return data;
  }

  // Increment view count
  async incrementListingViews(listingId: string): Promise<void> {
    try {
      const { error: rpcError } = await this.supabase.rpc(
        "increment_listing_views",
        { listing_id: listingId },
      );

      // Fallback if RPC doesn't exist — do a read-then-write
      if (rpcError) {
        const { data } = await this.supabase
          .from("marketplace_listings")
          .select("views_count")
          .eq("id", listingId)
          .single();

        const currentViews = data?.views_count || 0;
        await this.supabase
          .from("marketplace_listings")
          .update({ views_count: currentViews + 1 })
          .eq("id", listingId);
      }
    } catch (err) {
      logger.error("Failed to increment listing views", {
        listingId,
        error: err,
      });
    }
  }

  // Get seller stats
  async getSellerStats(userId: string): Promise<{
    totalListings: number;
    activeListings: number;
    soldListings: number;
    completedOrders: number;
    totalViews: number;
    totalInquiries: number;
    totalFavorites: number;
  }> {
    const [listingsRes, ordersRes] = await Promise.all([
      this.supabase
        .from("marketplace_listings")
        .select(
          `
          id,
          status,
          views_count,
          favorites:marketplace_favorites(count),
          inquiries:marketplace_inquiries(count)
        `,
        )
        .eq("user_id", userId),
      this.supabase
        .from("marketplace_orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", userId)
        .eq("status", "completed"),
    ]);

    const { data: listings, error } = listingsRes;
    if (error) throw error;
    if (ordersRes.error) throw ordersRes.error;

    return {
      totalListings: listings?.length || 0,
      activeListings:
        listings?.filter((l) => l.status === "active" || l.status === "reserved")
          .length || 0,
      soldListings: listings?.filter((l) => l.status === "sold").length || 0,
      completedOrders: ordersRes.count || 0,
      totalViews:
        listings?.reduce((sum, l) => sum + (l.views_count || 0), 0) || 0,
      totalInquiries:
        listings?.reduce((sum, l) => sum + (l.inquiries?.[0]?.count || 0), 0) ||
        0,
      totalFavorites:
        listings?.reduce((sum, l) => sum + (l.favorites?.[0]?.count || 0), 0) ||
        0,
    };
  }

  // ============ MARKETPLACE FAVORITES METHODS ============

  // Add listing to favorites
  async addFavorite(userId: string, listingId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from("marketplace_favorites")
      .insert({ user_id: userId, listing_id: listingId })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        // Already favorited
        return { alreadyExists: true };
      }
      throw error;
    }
    return data;
  }

  // Remove listing from favorites
  async removeFavorite(userId: string, listingId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from("marketplace_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("listing_id", listingId);

    if (error) throw error;
    return true;
  }

  // Get user's favorites
  async getUserFavorites(userId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("marketplace_favorites")
      .select(
        `
        id,
        created_at,
        listing:marketplace_listings(
          *,
          profiles!user_id(id, name, avatar_url)
        )
      `,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((favorite: any) =>
      this.normalizeFavoriteRecord(favorite),
    );
  }

  // Check if listing is favorited by user
  async isListingFavorited(
    userId: string,
    listingId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("marketplace_favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return !!data;
  }

  // ============ MARKETPLACE INQUIRIES METHODS ============

  // Create an inquiry (when buyer contacts seller about a listing)
  async createInquiry(
    listingId: string,
    buyerId: string,
    sellerId: string,
    dmThreadId: string,
    initialMessage: string,
  ): Promise<any> {
    // marketplace_inquiries.dm_thread_id FK requires dm_threads(id) first.
    // Contact-seller used to insert the inquiry before sendDirectMessage upserted the thread → 500.
    const sortedIds = [buyerId, sellerId].sort();
    const { error: threadError } = await this.supabase
      .from("dm_threads")
      .upsert(
        {
          id: dmThreadId,
          participant_ids: sortedIds,
          participants: {},
          last_message: initialMessage,
          last_message_time: new Date().toISOString(),
          status: "open",
          requested_by: null,
        },
        { onConflict: "id" },
      );
    if (threadError) {
      logger.error("Error ensuring DM thread for marketplace inquiry", {
        error: threadError,
        dmThreadId,
      });
      throw new Error(`Failed to create DM thread: ${threadError.message}`);
    }

    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .insert({
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: sellerId,
        dm_thread_id: dmThreadId,
        initial_message: initialMessage,
        status: "open",
      })
      .select(
        `
        *,
        listing:marketplace_listings(*),
        buyer:profiles!buyer_id(id, name, avatar_url),
        seller:profiles!seller_id(id, name, avatar_url)
      `,
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        // Inquiry already exists, return it
        return this.getInquiryByListingAndBuyer(listingId, buyerId);
      }
      throw error;
    }
    return data;
  }

  // Get inquiry by listing and buyer
  async getInquiryByListingAndBuyer(
    listingId: string,
    buyerId: string,
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(*),
        buyer:profiles!buyer_id(id, name, avatar_url),
        seller:profiles!seller_id(id, name, avatar_url)
      `,
      )
      .eq("listing_id", listingId)
      .eq("buyer_id", buyerId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // Get seller's inquiries
  async getSellerInquiries(sellerId: string, status?: string): Promise<any[]> {
    let query = this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(id, title, price, images, status),
        buyer:profiles!buyer_id(id, name, avatar_url)
      `,
      )
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((inquiry: any) =>
      this.normalizeInquiryRecord(inquiry),
    );
  }

  // Get buyer's inquiries
  async getBuyerInquiries(buyerId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(id, title, price, images, status),
        seller:profiles!seller_id(id, name, avatar_url)
      `,
      )
      .eq("buyer_id", buyerId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((inquiry: any) =>
      this.normalizeInquiryRecord(inquiry),
    );
  }

  // Update inquiry status
  async updateInquiryStatus(
    inquiryId: string,
    status: string,
    userId: string,
  ): Promise<any> {
    // Verify user is participant
    const { data: inquiry } = await this.supabase
      .from("marketplace_inquiries")
      .select("buyer_id, seller_id")
      .eq("id", inquiryId)
      .single();

    if (
      !inquiry ||
      (inquiry.buyer_id !== userId && inquiry.seller_id !== userId)
    ) {
      const err = new Error("Inquiry not found");
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .update({ status })
      .eq("id", inquiryId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Get inquiry by DM thread
  async getInquiryByThread(threadId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from("marketplace_inquiries")
      .select(
        `
        *,
        listing:marketplace_listings(id, title, price, images, status, user_id)
      `,
      )
      .eq("dm_thread_id", threadId)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data ? this.normalizeInquiryRecord(data) : data;
  }

  // ============ MARKETPLACE NOTIFICATIONS ============

  // Create notification for new inquiry
  async createInquiryNotification(
    sellerId: string,
    buyerName: string,
    listingTitle: string,
    inquiryId: string,
  ): Promise<void> {
    await this.createNotification(sellerId, {
      type: "marketplace_inquiry",
      message: `${buyerName} is interested in your listing "${listingTitle}"`,
      link: `/marketplace/inquiries/${inquiryId}`,
    });
  }

  // Create notification for listing purchase
  async createPurchaseNotification(
    sellerId: string,
    buyerName: string,
    listingTitle: string,
    transactionId: string,
  ): Promise<void> {
    await this.createNotification(sellerId, {
      type: "marketplace_purchase",
      message: `${buyerName} purchased your listing "${listingTitle}"`,
      link: `/marketplace/transactions/${transactionId}`,
    });
  }

  // ============ CUSTOM CATEGORIES ============

  async getCustomCategories(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from("custom_categories")
      .select("*")
      .order("usage_count", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async createCustomCategory(name: string, userId: string): Promise<any> {
    // Upsert: if name exists, return existing
    const { data: existing } = await this.supabase
      .from("custom_categories")
      .select("*")
      .eq("name", name)
      .single();

    if (existing) return existing;

    const { data, error } = await this.supabase
      .from("custom_categories")
      .insert({ name, created_by: userId })
      .select()
      .single();

    if (error) {
      // Handle race condition: another insert happened between select and insert
      if (error.code === "23505") {
        const { data: raceData } = await this.supabase
          .from("custom_categories")
          .select("*")
          .eq("name", name)
          .single();
        return raceData;
      }
      throw error;
    }
    return data;
  }

  async incrementCategoryUsage(categoryName: string): Promise<void> {
    // Increment usage_count by 1 for the given category
    const { data } = await this.supabase
      .from("custom_categories")
      .select("usage_count")
      .eq("name", categoryName)
      .single();

    if (data) {
      await this.supabase
        .from("custom_categories")
        .update({ usage_count: (data.usage_count || 0) + 1 })
        .eq("name", categoryName);
    }
  }

  // ============ USER PREFERENCES ============

  async getUserPreferences(userId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      logger.error("Error fetching user preferences", { userId, error });
      throw error;
    }

    return data;
  }

  async upsertUserPreferences(
    userId: string,
    prefs: { theme?: string; preferences?: Record<string, any> },
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: userId,
          theme: prefs.theme || "light",
          preferences: prefs.preferences || {},
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
        },
      )
      .select()
      .single();

    if (error) {
      logger.error("Error upserting user preferences", { userId, error });
      throw error;
    }

    return data;
  }

  // ─── Notes ───────────────────────────────────────────────────

  private mapNote(
    row: any,
    extras?: {
      accessRole?: "owner" | "editor" | "viewer" | "group_member";
      owner?: {
        id: string;
        name?: string;
        username?: string;
        avatarUrl?: string;
      };
    },
  ) {
    return {
      id: row.id,
      userId: row.user_id,
      folderId: row.folder_id || undefined,
      groupId: row.group_id || undefined,
      title: row.title,
      body: row.body || "",
      summary: row.summary || undefined,
      sourceType: row.source_type || "typed",
      youtubeUrl: row.youtube_url || undefined,
      youtubeVideoId: row.youtube_video_id || undefined,
      isShared: row.is_shared || false,
      // Intentionally omit dormant plaintext share_token (secure links use note_share_links).
      copiedFromNoteId: row.copied_from_note_id || undefined,
      isArchived: Boolean(row.is_archived),
      isPinned: Boolean(row.is_pinned),
      pinnedAt: row.pinned_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version:
        typeof row.version === "number"
          ? row.version
          : Number(row.version) || 1,
      accessRole: extras?.accessRole,
      owner: extras?.owner,
    };
  }

  /**
   * Canonical note access resolver for read/list/mutation gates.
   * Roles: owner > editor > viewer > group_member.
   */
  async resolveNoteAccess(
    noteId: string,
    userId: string,
  ): Promise<{
    noteId: string;
    ownerId: string;
    accessRole: "owner" | "editor" | "viewer" | "group_member";
    canEdit: boolean;
    isOwner: boolean;
    groupId?: string;
  } | null> {
    const { data, error } = await this.supabase
      .from("notes")
      .select("id, user_id, group_id")
      .eq("id", noteId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    if (data.user_id === userId) {
      return {
        noteId: data.id,
        ownerId: data.user_id,
        accessRole: "owner",
        canEdit: true,
        isOwner: true,
        groupId: data.group_id || undefined,
      };
    }

    const { data: collab } = await this.supabase
      .from("note_collaborators")
      .select("role")
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .maybeSingle();

    if (collab?.role === "editor" || collab?.role === "owner") {
      return {
        noteId: data.id,
        ownerId: data.user_id,
        accessRole: "editor",
        canEdit: true,
        isOwner: false,
        groupId: data.group_id || undefined,
      };
    }
    if (collab?.role === "viewer") {
      return {
        noteId: data.id,
        ownerId: data.user_id,
        accessRole: "viewer",
        canEdit: false,
        isOwner: false,
        groupId: data.group_id || undefined,
      };
    }

    if (data.group_id) {
      const { data: member } = await this.supabase
        .from("group_members")
        .select("user_id, pending")
        .eq("group_id", data.group_id)
        .eq("user_id", userId)
        .eq("pending", false)
        .maybeSingle();
      if (member) {
        return {
          noteId: data.id,
          ownerId: data.user_id,
          accessRole: "group_member",
          canEdit: false,
          isOwner: false,
          groupId: data.group_id,
        };
      }
    }

    return null;
  }

  async isNoteOwner(userId: string, noteId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("notes")
      .select("user_id")
      .eq("id", noteId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data && data.user_id === userId);
  }

  private async getNoteOwnerPresentation(ownerId: string) {
    const { data } = await this.supabase
      .from("profiles")
      .select("id, name, username, avatar_url")
      .eq("id", ownerId)
      .maybeSingle();
    if (!data) return { id: ownerId };
    return {
      id: data.id,
      name: data.name || undefined,
      username: data.username || undefined,
      avatarUrl: data.avatar_url || undefined,
    };
  }

  private mapNoteFolder(row: any) {
    return {
      id: row.id,
      userId: row.user_id,
      groupId: row.group_id || undefined,
      parentId: row.parent_id || undefined,
      name: row.name,
      color: row.color || "#6366f1",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getNoteFolders(userId: string) {
    const { data, error } = await this.supabase
      .from("note_folders")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => this.mapNoteFolder(row));
  }

  async createNoteFolder(
    userId: string,
    payload: {
      name: string;
      color?: string;
      groupId?: string;
      parentId?: string;
    },
  ) {
    const { data, error } = await this.supabase
      .from("note_folders")
      .insert({
        user_id: userId,
        name: payload.name,
        color: payload.color || "#6366f1",
        group_id: payload.groupId || null,
        parent_id: payload.parentId || null,
      })
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteFolder(data);
  }

  async updateNoteFolder(
    userId: string,
    folderId: string,
    updates: { name?: string; color?: string },
  ) {
    const { data, error } = await this.supabase
      .from("note_folders")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", folderId)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteFolder(data);
  }

  async deleteNoteFolder(userId: string, folderId: string) {
    const { error } = await this.supabase
      .from("note_folders")
      .delete()
      .eq("id", folderId)
      .eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  async getNotes(
    userId: string,
    options?: { folderId?: string; groupId?: string; archived?: boolean },
  ) {
    let ownedQuery = this.supabase
      .from("notes")
      .select("*")
      .eq("user_id", userId)
      .order("is_pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    if (options?.folderId)
      ownedQuery = ownedQuery.eq("folder_id", options.folderId);
    if (options?.groupId)
      ownedQuery = ownedQuery.eq("group_id", options.groupId);
    if (options?.archived === true)
      ownedQuery = ownedQuery.eq("is_archived", true);
    else if (options?.archived === false)
      ownedQuery = ownedQuery.eq("is_archived", false);

    const { data: ownedRows, error: ownedError } = await ownedQuery;
    if (ownedError) throw ownedError;

    const owned = (ownedRows || []).map((row: any) =>
      this.mapNote(row, { accessRole: "owner" }),
    );

    // Folder/group filtered lists stay owned-only (shared notes keep owner's folder).
    if (options?.folderId || options?.groupId) {
      return owned;
    }

    const { data: collabRows, error: collabError } = await this.supabase
      .from("note_collaborators")
      .select("note_id, role, notes(*)")
      .eq("user_id", userId);
    if (collabError) throw collabError;

    const ownedIds = new Set(owned.map((n) => n.id));
    const ownerIds = Array.from(
      new Set(
        (collabRows || [])
          .map((row: any) => row.notes?.user_id)
          .filter(
            (id: unknown): id is string =>
              typeof id === "string" && id !== userId,
          ),
      ),
    );
    const ownerMap = new Map<
      string,
      { id: string; name?: string; username?: string; avatarUrl?: string }
    >();
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        ownerMap.set(ownerId, await this.getNoteOwnerPresentation(ownerId));
      }),
    );

    const shared = (collabRows || [])
      .filter((row: any) => {
        if (!row.notes || ownedIds.has(row.notes.id)) return false;
        if (options?.archived === true) return Boolean(row.notes.is_archived);
        if (options?.archived === false) return !row.notes.is_archived;
        return true;
      })
      .map((row: any) => {
        const role =
          row.role === "editor" || row.role === "owner"
            ? ("editor" as const)
            : ("viewer" as const);
        return this.mapNote(row.notes, {
          accessRole: role,
          owner: ownerMap.get(row.notes.user_id) || { id: row.notes.user_id },
        });
      });

    return [...owned, ...shared].sort((a, b) => {
      const pinDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      if (pinDelta !== 0) return pinDelta;
      return (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
  }

  async getNote(noteId: string, userId: string) {
    const access = await this.resolveNoteAccess(noteId, userId);
    if (!access) throw new Error("Note not found or access denied");

    const { data, error } = await this.supabase
      .from("notes")
      .select("*")
      .eq("id", noteId)
      .single();
    if (error) throw error;

    const owner = access.isOwner
      ? undefined
      : await this.getNoteOwnerPresentation(access.ownerId);

    return this.mapNote(data, {
      accessRole: access.accessRole,
      owner,
    });
  }

  async createNote(
    userId: string,
    payload: {
      title?: string;
      body?: string;
      folderId?: string;
      groupId?: string;
      sourceType?: string;
      youtubeUrl?: string;
      youtubeVideoId?: string;
      summary?: string;
      copiedFromNoteId?: string;
    },
  ) {
    const { data, error } = await this.supabase
      .from("notes")
      .insert({
        user_id: userId,
        title: payload.title || "Untitled Note",
        body: payload.body || "",
        folder_id: payload.folderId || null,
        group_id: payload.groupId || null,
        source_type: payload.sourceType || "typed",
        youtube_url: payload.youtubeUrl || null,
        youtube_video_id: payload.youtubeVideoId || null,
        summary: payload.summary || null,
        copied_from_note_id: payload.copiedFromNoteId || null,
      })
      .select()
      .single();
    if (error) throw error;
    return this.mapNote(data, { accessRole: "owner" });
  }

  async canEditNote(userId: string, noteId: string): Promise<boolean> {
    const access = await this.resolveNoteAccess(noteId, userId);
    return Boolean(access?.canEdit);
  }

  async updateNote(
    userId: string,
    noteId: string,
    updates: Record<string, unknown>,
    options: {
      expectedVersion?: number;
      expectedUpdatedAt?: string;
      /** AI/system writers may retry once after a concurrent user edit. */
      allowRetryOnConflict?: boolean;
    } = {},
  ) {
    const allowed = await this.canEditNote(userId, noteId);
    if (!allowed) {
      const err = new Error("Note not found or access denied") as Error & {
        code?: string;
        status?: number;
      };
      err.code = "PGRST116";
      err.status = 403;
      throw err;
    }

    const dbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.body !== undefined) dbUpdates.body = updates.body;
    if (updates.summary !== undefined) dbUpdates.summary = updates.summary;
    if (updates.folderId !== undefined)
      dbUpdates.folder_id = updates.folderId || null;
    if (updates.groupId !== undefined)
      dbUpdates.group_id = updates.groupId || null;
    if (updates.isShared !== undefined) dbUpdates.is_shared = updates.isShared;
    if (updates.youtubeUrl !== undefined)
      dbUpdates.youtube_url = updates.youtubeUrl;
    if (updates.youtubeVideoId !== undefined)
      dbUpdates.youtube_video_id = updates.youtubeVideoId;
    if (updates.isPinned !== undefined) {
      const pinned = Boolean(updates.isPinned);
      dbUpdates.is_pinned = pinned;
      dbUpdates.pinned_at = pinned ? new Date().toISOString() : null;
    }
    if (updates.isArchived !== undefined) {
      const archived = Boolean(updates.isArchived);
      dbUpdates.is_archived = archived;
      if (archived) {
        dbUpdates.is_pinned = false;
        dbUpdates.pinned_at = null;
      }
    }

    const maxAttempts = options.allowRetryOnConflict ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { data: current, error: currentError } = await this.supabase
        .from("notes")
        .select("updated_at, version")
        .eq("id", noteId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) {
        const err = new Error("Note not found or access denied") as Error & {
          code?: string;
          status?: number;
        };
        err.code = "PGRST116";
        err.status = 404;
        throw err;
      }

      const expectedVersion =
        options.expectedVersion != null && attempt === 0
          ? Number(options.expectedVersion)
          : Number(current.version) || 1;
      const expectedUpdatedAt =
        options.expectedUpdatedAt && attempt === 0
          ? options.expectedUpdatedAt
          : (current.updated_at as string);

      // Trigger bumps version/updated_at; CAS against the values we last read.
      let query = this.supabase
        .from("notes")
        .update(dbUpdates)
        .eq("id", noteId);
      if (Number.isFinite(expectedVersion)) {
        query = query.eq("version", expectedVersion);
      } else if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt);
      }

      const { data, error } = await query.select().maybeSingle();
      if (error) throw error;
      if (data) return this.mapNote(data);

      if (attempt + 1 >= maxAttempts) {
        const latest = await this.getNote(noteId, userId).catch(() => null);
        throw new VersionConflictError(
          "Note was updated elsewhere. Refresh and try again.",
          latest,
        );
      }
    }

    throw new VersionConflictError(
      "Note was updated elsewhere. Refresh and try again.",
    );
  }

  async deleteNote(userId: string, noteId: string) {
    const { error } = await this.supabase
      .from("notes")
      .delete()
      .eq("id", noteId)
      .eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  async getNoteAttachment(noteId: string, attachmentId: string) {
    const { data, error } = await this.supabase
      .from("note_attachments")
      .select("*")
      .eq("note_id", noteId)
      .eq("id", attachmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async updateNoteAttachment(
    attachmentId: string,
    updates: { metadata?: Record<string, unknown>; extractedText?: string },
  ) {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;
    if (updates.extractedText !== undefined)
      dbUpdates.extracted_text = updates.extractedText;

    const { data, error } = await this.supabase
      .from("note_attachments")
      .update(dbUpdates)
      .eq("id", attachmentId)
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async uploadNoteFile(params: {
    storagePath: string;
    buffer: Buffer;
    contentType: string;
    upsert?: boolean;
  }): Promise<{ path: string }> {
    const bucket = "note-files";
    const isImage = (params.contentType || "").toLowerCase().startsWith("image/");
    const attemptUpload = async () =>
      this.supabase.storage
        .from(bucket)
        .upload(params.storagePath, params.buffer, {
          contentType: params.contentType,
          cacheControl: isImage ? IMMUTABLE_IMAGE_CACHE_CONTROL : "3600",
          upsert: params.upsert === true,
        });

    let uploadResult = await attemptUpload();
    if (
      uploadResult.error &&
      typeof uploadResult.error.message === "string" &&
      uploadResult.error.message.toLowerCase().includes("bucket") &&
      uploadResult.error.message.toLowerCase().includes("not found")
    ) {
      await this.supabase.storage.createBucket(bucket, { public: false });
      uploadResult = await attemptUpload();
    }

    const { error } = uploadResult;
    if (error) {
      logger.error("Error uploading note file:", {
        error,
        path: params.storagePath,
      });
      throw new Error(error.message);
    }
    return { path: params.storagePath };
  }

  /**
   * Mint a short-lived signed upload URL so browsers can PUT lecture audio
   * directly to Supabase Storage (avoids CF Worker / API body size & timeout).
   */
  async createSignedNoteFileUploadUrl(storagePath: string): Promise<{
    signedUrl: string;
    token: string;
    path: string;
  }> {
    const bucket = "note-files";
    if (
      !storagePath ||
      storagePath.includes("..") ||
      storagePath.startsWith("/") ||
      storagePath.includes("\\")
    ) {
      throw new Error("Invalid storage path");
    }

    const attempt = async () =>
      this.supabase.storage.from(bucket).createSignedUploadUrl(storagePath);

    let result = await attempt();
    if (
      result.error &&
      typeof result.error.message === "string" &&
      result.error.message.toLowerCase().includes("bucket") &&
      result.error.message.toLowerCase().includes("not found")
    ) {
      await this.supabase.storage.createBucket(bucket, { public: false });
      result = await attempt();
    }

    if (result.error || !result.data?.signedUrl || !result.data?.token) {
      logger.error("Error creating signed note-file upload URL:", {
        error: result.error,
        path: storagePath,
      });
      throw new Error(
        result.error?.message || "Failed to create signed upload URL",
      );
    }

    return {
      signedUrl: this.normalizeStorageUrl(result.data.signedUrl),
      token: result.data.token,
      path: result.data.path || storagePath,
    };
  }

  async createSignedNoteFileUrl(
    storagePath: string,
    expiresInSeconds = 60 * 60 * 24,
    variant: "thumb" | "original" = "original",
  ): Promise<string> {
    return this.createSignedStorageUrlWithVariant(
      "note-files",
      storagePath,
      expiresInSeconds,
      variant,
    );
  }

  async deleteNoteFile(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from("note-files")
      .remove([storagePath]);
    if (error) {
      logger.warn("Failed to delete note file from storage", {
        error,
        storagePath,
      });
    }
  }

  async downloadNoteFile(
    storagePath: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const { data, error } = await this.supabase.storage
      .from("note-files")
      .download(storagePath);
    if (error || !data) {
      throw new Error(error?.message || "Failed to download note file");
    }
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const lower = storagePath.toLowerCase();
    let contentType = "application/octet-stream";
    if (lower.endsWith(".pdf")) contentType = "application/pdf";
    else if (lower.endsWith(".pptx")) {
      contentType =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else if (lower.endsWith(".ppt"))
      contentType = "application/vnd.ms-powerpoint";
    else if (lower.endsWith(".png")) contentType = "image/png";
    else if (lower.endsWith(".gif")) contentType = "image/gif";
    else if (lower.endsWith(".webp")) contentType = "image/webp";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
      contentType = "image/jpeg";
    else {
      const detected = detectImageMime(buffer);
      if (detected) contentType = detected;
    }
    return { buffer, contentType };
  }

  resolveNoteAttachmentStoragePath(attachment: {
    fileUrl?: string;
    metadata?: Record<string, unknown>;
    type?: string;
  }): string | null {
    const meta = attachment.metadata || {};
    if (
      typeof meta.previewStoragePath === "string" &&
      meta.previewStoragePath
    ) {
      return meta.previewStoragePath;
    }
    if (typeof meta.storagePath === "string" && meta.storagePath) {
      return meta.storagePath;
    }
    if (!attachment.fileUrl) return null;
    try {
      const url = new URL(attachment.fileUrl);
      const marker = "/storage/v1/object/";
      const idx = url.pathname.indexOf(marker);
      if (idx === -1) return null;
      let after = url.pathname.slice(idx + marker.length);
      if (after.startsWith("sign/")) after = after.slice("sign/".length);
      if (after.startsWith("public/")) after = after.slice("public/".length);
      const parts = after.split("/");
      if (parts.length < 2) return null;
      const bucket = parts[0];
      if (bucket !== "note-files") return null;
      return decodeURIComponent(parts.slice(1).join("/"));
    } catch {
      return null;
    }
  }

  async getNoteAttachments(noteId: string) {
    const { data, error } = await this.supabase
      .from("note_attachments")
      .select("*")
      .eq("note_id", noteId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      noteId: row.note_id,
      type: row.type,
      fileUrl: row.file_url || undefined,
      fileName: row.file_name || undefined,
      extractedText: row.extracted_text || undefined,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  async addNoteAttachment(
    noteId: string,
    payload: {
      type: string;
      fileUrl?: string;
      fileName?: string;
      extractedText?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const { data, error } = await this.supabase
      .from("note_attachments")
      .insert({
        note_id: noteId,
        type: payload.type,
        file_url: payload.fileUrl || null,
        file_name: payload.fileName || null,
        extracted_text: payload.extractedText || null,
        metadata: payload.metadata || {},
      })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async getNoteCollaborators(noteId: string) {
    const { data, error } = await this.supabase
      .from("note_collaborators")
      .select("*, profiles(id, name, avatar_url)")
      .eq("note_id", noteId);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      noteId: row.note_id,
      userId: row.user_id,
      role: row.role,
      addedAt: row.added_at,
      user: row.profiles
        ? {
            id: row.profiles.id,
            name: row.profiles.name,
            avatarUrl: row.profiles.avatar_url,
          }
        : undefined,
    }));
  }

  async addNoteCollaborator(
    noteId: string,
    ownerId: string,
    collaboratorUserId: string,
    role: string = "editor",
  ) {
    const note = await this.getNote(noteId, ownerId);
    if (note.userId !== ownerId)
      throw new Error("Only the note owner can add collaborators");

    const normalizedRole = role === "viewer" ? "viewer" : "editor";
    const resolvedUserId =
      await this.resolveCollaboratorUserId(collaboratorUserId);
    if (resolvedUserId === ownerId) {
      throw new Error("You cannot add yourself as a collaborator.");
    }

    const { data: existing } = await this.supabase
      .from("note_collaborators")
      .select("role")
      .eq("note_id", noteId)
      .eq("user_id", resolvedUserId)
      .maybeSingle();

    const grantRole =
      existing?.role === "editor" && normalizedRole === "viewer"
        ? "editor"
        : normalizedRole;

    const { data, error } = await this.supabase
      .from("note_collaborators")
      .upsert({
        note_id: noteId,
        user_id: resolvedUserId,
        role: grantRole,
      })
      .select()
      .single();
    if (error) throw error;

    const actor = await this.getNoteOwnerPresentation(ownerId);
    void this.createNotification(resolvedUserId, {
      type: "note_share_invite",
      message: `${actor.name || actor.username || "Someone"} shared "${note.title}" with you`,
      link: `/notes/${noteId}`,
      data: { noteId, role: grantRole, fromUserId: ownerId },
    }).catch(() => {});

    return {
      noteId: data.note_id,
      userId: data.user_id,
      role: data.role,
      addedAt: data.added_at,
    };
  }

  async removeNoteCollaborator(
    noteId: string,
    ownerId: string,
    collaboratorUserId: string,
  ) {
    const note = await this.getNote(noteId, ownerId);
    if (note.userId !== ownerId)
      throw new Error("Only the note owner can remove collaborators");

    const { error } = await this.supabase
      .from("note_collaborators")
      .delete()
      .eq("note_id", noteId)
      .eq("user_id", collaboratorUserId);
    if (error) throw error;
    return true;
  }

  async updateNoteCollaboratorRole(
    noteId: string,
    ownerId: string,
    collaboratorUserId: string,
    role: "viewer" | "editor",
  ) {
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can change collaborator roles");
    }
    if (collaboratorUserId === ownerId) {
      throw new Error("Cannot change the owner role via collaborator update");
    }
    const { data, error } = await this.supabase
      .from("note_collaborators")
      .update({ role })
      .eq("note_id", noteId)
      .eq("user_id", collaboratorUserId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Collaborator not found");
    return {
      noteId: data.note_id,
      userId: data.user_id,
      role: data.role,
      addedAt: data.added_at,
    };
  }

  /** Collaborator leaves a shared note (self-remove). Owners cannot leave. */
  async leaveNoteCollaboration(noteId: string, userId: string) {
    if (await this.isNoteOwner(userId, noteId)) {
      throw new Error("Note owners cannot leave their own note");
    }
    const access = await this.resolveNoteAccess(noteId, userId);
    if (
      !access ||
      (access.accessRole !== "viewer" && access.accessRole !== "editor")
    ) {
      throw new Error("You are not a collaborator on this note");
    }
    const { error } = await this.supabase
      .from("note_collaborators")
      .delete()
      .eq("note_id", noteId)
      .eq("user_id", userId);
    if (error) throw error;
    return true;
  }

  async createNoteShareLink(
    noteId: string,
    ownerId: string,
    role: "viewer" | "editor",
    options?: { expiresAt?: string | null },
  ) {
    const { generateNoteShareToken, hashNoteShareToken, buildNoteShareWebUrl } =
      await import("./noteShareTokens");
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can create share links");
    }
    if (role !== "viewer" && role !== "editor") {
      throw new Error("role must be viewer or editor");
    }

    const token = generateNoteShareToken();
    const tokenHash = hashNoteShareToken(token);
    const { data, error } = await this.supabase
      .from("note_share_links")
      .insert({
        note_id: noteId,
        created_by: ownerId,
        token_hash: tokenHash,
        role,
        expires_at: options?.expiresAt || null,
      })
      .select(
        "id, note_id, role, expires_at, revoked_at, created_at, last_redeemed_at",
      )
      .single();
    if (error) throw error;

    return {
      id: data.id,
      noteId: data.note_id,
      role: data.role as "viewer" | "editor",
      expiresAt: data.expires_at || undefined,
      revokedAt: data.revoked_at || undefined,
      createdAt: data.created_at,
      lastRedeemedAt: data.last_redeemed_at || undefined,
      // Plaintext returned once for the owner to copy; never stored.
      token,
      url: buildNoteShareWebUrl(token),
    };
  }

  async listNoteShareLinks(noteId: string, ownerId: string) {
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can list share links");
    }
    const { data, error } = await this.supabase
      .from("note_share_links")
      .select(
        "id, note_id, role, expires_at, revoked_at, created_at, last_redeemed_at",
      )
      .eq("note_id", noteId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      noteId: row.note_id,
      role: row.role as "viewer" | "editor",
      expiresAt: row.expires_at || undefined,
      revokedAt: row.revoked_at || undefined,
      createdAt: row.created_at,
      lastRedeemedAt: row.last_redeemed_at || undefined,
      isActive:
        !row.revoked_at &&
        (!row.expires_at || new Date(row.expires_at) > new Date()),
    }));
  }

  async revokeNoteShareLink(noteId: string, ownerId: string, linkId: string) {
    if (!(await this.isNoteOwner(ownerId, noteId))) {
      throw new Error("Only the note owner can revoke share links");
    }
    const { data, error } = await this.supabase
      .from("note_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", linkId)
      .eq("note_id", noteId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Share link not found or already revoked");
    return true;
  }

  async previewNoteShareLink(token: string, userId: string) {
    const { hashNoteShareToken, isValidNoteShareTokenFormat } =
      await import("./noteShareTokens");
    if (!isValidNoteShareTokenFormat(token)) {
      const err = new Error("Invalid share link") as Error & { code?: string };
      err.code = "share_link_invalid";
      throw err;
    }
    const tokenHash = hashNoteShareToken(token);
    const { data: link, error } = await this.supabase
      .from("note_share_links")
      .select("id, note_id, role, expires_at, revoked_at, created_by")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) throw error;
    if (!link) {
      const err = new Error("Share link not found") as Error & {
        code?: string;
      };
      err.code = "share_link_not_found";
      throw err;
    }
    if (link.revoked_at) {
      const err = new Error("This share link has been revoked") as Error & {
        code?: string;
      };
      err.code = "share_link_revoked";
      throw err;
    }
    if (link.expires_at && new Date(link.expires_at) <= new Date()) {
      const err = new Error("This share link has expired") as Error & {
        code?: string;
      };
      err.code = "share_link_expired";
      throw err;
    }

    const { data: note, error: noteError } = await this.supabase
      .from("notes")
      .select("id, title, user_id")
      .eq("id", link.note_id)
      .single();
    if (noteError) throw noteError;

    const owner = await this.getNoteOwnerPresentation(note.user_id);
    const existing = await this.resolveNoteAccess(note.id, userId);

    return {
      shareLinkId: link.id,
      noteId: note.id,
      title: note.title,
      role: link.role as "viewer" | "editor",
      owner,
      alreadyHasAccess: Boolean(existing),
      currentAccessRole: existing?.accessRole,
      isOwner: note.user_id === userId,
    };
  }

  async acceptNoteShareLink(token: string, userId: string) {
    const { hashNoteShareToken, isValidNoteShareTokenFormat } =
      await import("./noteShareTokens");
    if (!isValidNoteShareTokenFormat(token)) {
      const err = new Error("Invalid share link") as Error & { code?: string };
      err.code = "share_link_invalid";
      throw err;
    }
    const tokenHash = hashNoteShareToken(token);
    const { data, error } = await this.supabase.rpc("accept_note_share_link", {
      p_token_hash: tokenHash,
      p_user_id: userId,
    });
    if (error) {
      const message = error.message || "Failed to accept share link";
      const err = new Error(
        message.includes("share_link_revoked")
          ? "This share link has been revoked"
          : message.includes("share_link_expired")
            ? "This share link has expired"
            : message.includes("share_link_not_found")
              ? "Share link not found"
              : "Failed to accept share link",
      ) as Error & { code?: string };
      if (message.includes("share_link_revoked"))
        err.code = "share_link_revoked";
      else if (message.includes("share_link_expired"))
        err.code = "share_link_expired";
      else if (message.includes("share_link_not_found"))
        err.code = "share_link_not_found";
      throw err;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.note_id) {
      throw new Error("Failed to accept share link");
    }

    const note = await this.getNote(row.note_id, userId);

    // Notify owner (best-effort) when a new collaborator accepts
    if (!row.already_accepted && note.userId !== userId) {
      const { data: profile } = await this.supabase
        .from("profiles")
        .select("name, username")
        .eq("id", userId)
        .maybeSingle();
      const actor = profile?.name || profile?.username || "Someone";
      void this.createNotification(note.userId, {
        type: "note_share_accepted",
        message: `${actor} accepted your invite to "${note.title}"`,
        link: `/notes/${note.id}`,
        data: {
          noteId: note.id,
          redeemerUserId: userId,
          role: row.granted_role,
        },
      }).catch(() => {});
    }

    return {
      note,
      grantedRole: row.granted_role as string,
      alreadyAccepted: Boolean(row.already_accepted),
      shareLinkId: row.share_link_id as string,
    };
  }

  /**
   * Detached personal copy: note body + storage-backed attachments.
   * Excludes collaborators, comments, group membership, and quiz history.
   */
  async copyNoteForUser(sourceNoteId: string, userId: string) {
    const source = await this.getNote(sourceNoteId, userId);
    const attachments = await this.getNoteAttachments(sourceNoteId);

    const copyTitle = source.title?.startsWith("Copy of ")
      ? source.title
      : `Copy of ${source.title || "Untitled Note"}`;

    const created = await this.createNote(userId, {
      title: copyTitle,
      body: source.body || "",
      summary: source.summary,
      sourceType: source.sourceType,
      youtubeUrl: source.youtubeUrl,
      youtubeVideoId: source.youtubeVideoId,
      // Personal copy is never group-shared by default
      folderId: undefined,
      groupId: undefined,
      copiedFromNoteId: source.id,
    });

    for (const attachment of attachments) {
      let fileUrl = attachment.fileUrl as string | undefined;
      const storagePath = this.resolveNoteAttachmentStoragePath(attachment);
      if (storagePath) {
        try {
          const downloaded = await this.downloadNoteFile(storagePath);
          const newPath = buildNoteStoragePath(
            userId,
            attachment.fileName || "file",
          );
          await this.uploadNoteFile({
            storagePath: newPath,
            buffer: downloaded.buffer,
            contentType: downloaded.contentType,
          });
          fileUrl = newPath;
        } catch (err) {
          logger.warn(
            "Failed to copy note attachment file; keeping metadata only",
            {
              err,
              sourceNoteId,
              attachmentId: attachment.id,
            },
          );
          // External URLs (youtube) or failed downloads: preserve original fileUrl if external
          if (storagePath && fileUrl === storagePath) {
            fileUrl = undefined;
          }
        }
      }

      await this.addNoteAttachment(created.id, {
        type: attachment.type,
        fileUrl,
        fileName: attachment.fileName,
        extractedText: attachment.extractedText,
        metadata: {
          ...(attachment.metadata || {}),
          copiedFromAttachmentId: attachment.id,
        },
      });
    }

    return this.getNote(created.id, userId);
  }

  async getNoteComments(noteId: string) {
    const { data, error } = await this.supabase
      .from("note_comments")
      .select(NOTE_COMMENT_SELECT)
      .eq("note_id", noteId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => mapNoteCommentRow(row));
  }

  async addNoteComment(noteId: string, userId: string, comment: string) {
    const { data, error } = await this.supabase
      .from("note_comments")
      .insert({ note_id: noteId, user_id: userId, comment })
      .select(NOTE_COMMENT_SELECT)
      .single();
    if (error) throw error;
    return mapNoteCommentRow(data as any);
  }

  async shareNoteWithGroup(noteId: string, userId: string, groupId: string) {
    return this.updateNote(userId, noteId, { groupId, isShared: true });
  }

  private mapNoteQuiz(row: any) {
    return {
      date: String(row.updated_at || row.created_at || "").slice(0, 10),
      noteId: row.note_id,
      questions: Array.isArray(row.questions) ? row.questions : [],
      answers:
        row.answers && typeof row.answers === "object" ? row.answers : {},
      completed: Boolean(row.completed),
      studyGoal: row.study_goal || "retention",
    };
  }

  async getNoteQuiz(userId: string, noteId: string) {
    await this.getNote(noteId, userId);
    const { data, error } = await this.supabase
      .from("note_quizzes")
      .select("*")
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapNoteQuiz(data) : null;
  }

  async upsertNoteQuiz(
    userId: string,
    noteId: string,
    payload: {
      studyGoal: string;
      questions: unknown[];
    },
  ) {
    await this.getNote(noteId, userId);

    // REL-02: never wipe an in-progress or completed quiz on regenerate.
    const existing = await this.getNoteQuiz(userId, noteId);
    if (existing) {
      const answerCount =
        existing.answers && typeof existing.answers === "object"
          ? Object.keys(existing.answers).length
          : 0;
      if (existing.completed || answerCount > 0) {
        return existing;
      }

      const { data, error } = await this.supabase
        .from("note_quizzes")
        .update({
          study_goal: payload.studyGoal,
          questions: payload.questions,
          answers: {},
          completed: false,
          updated_at: new Date().toISOString(),
        })
        .eq("note_id", noteId)
        .eq("user_id", userId)
        .eq("completed", false)
        .eq("answers", {})
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const raced = await this.getNoteQuiz(userId, noteId);
        if (raced) return raced;
        throw new Error("Failed to update note quiz");
      }
      return this.mapNoteQuiz(data);
    }

    const { data, error } = await this.supabase
      .from("note_quizzes")
      .insert({
        note_id: noteId,
        user_id: userId,
        study_goal: payload.studyGoal,
        questions: payload.questions,
        answers: {},
        completed: false,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) {
      // Concurrent first insert: return the winner's row rather than wipe.
      if (error.code === "23505") {
        const raced = await this.getNoteQuiz(userId, noteId);
        if (raced) return raced;
      }
      throw error;
    }
    return this.mapNoteQuiz(data);
  }

  async updateNoteQuiz(
    userId: string,
    noteId: string,
    updates: { answers?: Record<string, string>; completed?: boolean },
  ) {
    await this.getNote(noteId, userId);
    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.answers !== undefined) dbUpdates.answers = updates.answers;
    if (updates.completed !== undefined)
      dbUpdates.completed = updates.completed;

    const { data, error } = await this.supabase
      .from("note_quizzes")
      .update(dbUpdates)
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteQuiz(data);
  }

  async getAdminAnalytics(days: number): Promise<AdminAnalyticsPayload> {
    const [{ data, error }, { data: zoneData, error: zoneError }] =
      await Promise.all([
        this.supabase.rpc("admin_analytics", { p_days: days }),
        this.supabase.rpc("marketplace_zone_analytics", { p_days: days }),
      ]);
    if (error) throw error;

    const analytics = data as AdminAnalyticsPayload;
    if (zoneError || !zoneData || typeof zoneData !== "object") {
      if (zoneError) {
        logger.warn("marketplace_zone_analytics RPC failed", {
          error: zoneError.message,
        });
      }
      return analytics;
    }

    const zones = zoneData as {
      gmvByZone?: Array<{ zone: string; gmv: number; orders: number }>;
      listingsByZone?: Array<{
        zone: string;
        total: number;
        active: number;
        sold: number;
      }>;
      searchesByZone?: Array<{ zone: string; count: number }>;
      searchesByCampus?: Array<{ campus: string; count: number }>;
    };
    return {
      ...analytics,
      marketplaceKpis: analytics.marketplaceKpis
        ? {
            ...analytics.marketplaceKpis,
            gmvByZone: zones.gmvByZone || [],
            listingsByZone: zones.listingsByZone || [],
          }
        : analytics.marketplaceKpis,
      searchAnalytics: analytics.searchAnalytics
        ? {
            ...analytics.searchAnalytics,
            searchesByCampus:
              zones.searchesByCampus ||
              analytics.searchAnalytics.searchesByCampus,
            searchesByZone: zones.searchesByZone || [],
          }
        : analytics.searchAnalytics,
    };
  }
}

export interface AdminAnalyticsPayload {
  periodDays: number;
  kpis: {
    totalUsers: number;
    dau: number;
    wau: number;
    mau: number;
    mobileAppUsers: number;
    webOnlyUsers: number;
    activeGroups: number;
  };
  marketplaceKpis?: {
    gmv: number;
    ordersCount: number;
    aov: number;
    disputedRate: number;
    disputedCount: number;
    gmvByCategory: Array<{ category: string; gmv: number; orders: number }>;
    gmvByCampus: Array<{ campus: string; gmv: number; orders: number }>;
    gmvByZone?: Array<{ zone: string; gmv: number; orders: number }>;
    listingsByZone?: Array<{
      zone: string;
      total: number;
      active: number;
      sold: number;
    }>;
  };
  retentionCohorts?: {
    signups: number;
    d1: number;
    d7: number;
    d30: number;
    d1Count: number;
    d7Count: number;
    d30Count: number;
  };
  searchAnalytics?: {
    topQueries: Array<{ query: string; count: number }>;
    zeroResultQueries: Array<{ query: string; count: number }>;
    searchesByCampus: Array<{ campus: string; count: number }>;
    searchesByZone?: Array<{ zone: string; count: number }>;
    totalSearches: number;
  };
  acquisitionFunnel?: {
    guestListingViews: number;
    signupStarted: number;
    signupsCompleted: number;
    onboardingCompleted: number;
  };
  studyFunnel?: {
    testsStarted: number;
    testsCompleted: number;
    testsCompletedWeb: number;
    testsCompletedMobile: number;
    flashcardSessionsStarted: number;
    flashcardSessionsCompleted: number;
    notesCreated: number;
    aiToolUses: number;
    aiToolsByType: Record<string, number>;
  };
  platformFromEvents?: {
    webDau: number;
    mobileDau: number;
    webActivePeriod: number;
    mobileActivePeriod: number;
  };
  streakDistribution: Record<string, number>;
  featureTotals: {
    tests: number;
    flashcards: number;
    newFlashcards: number;
    questions: number;
    games: number;
    dailyQuizzes: number;
    studyActions: number;
  };
  aiByFeature: Record<string, number>;
  platformSplit: {
    mobileAppUsers: number;
    webOnlyUsers: number;
  };
  series: Array<{
    date: string;
    signups: number;
    activeUsers: number;
    tests: number;
    flashcards: number;
    newFlashcards: number;
    questions: number;
    games: number;
    dailyQuizzes: number;
    groupMessages: number;
    dmMessages: number;
    aiEvents: number;
    newListings: number;
    orders: number;
    gmv?: number;
  }>;
}

// Configuration - do NOT create singleton at module level
// The server.ts initializes the service with proper config
// export const supabaseService = new SupabaseService(dbConfig);
