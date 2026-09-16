/**
 * data/storageAcl.ts — storage references, signed-URL minting, and the
 * authorization gate that decides who may be handed a signature.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1b, step 5).
 * Two halves that only make sense together:
 *
 *  - the MINTERS (`createSignedStorageUrl`, `…WithVariant`,
 *    `signStorageDisplayUrl(s)`) — the service role can sign any object in any
 *    bucket, so these are the only way bytes leave Storage;
 *  - the GATE (`canAccessStorageObject` and its two confused-deputy helpers) —
 *    the one thing standing between a caller and a signature.
 *
 * Treat everything here as security code, not plumbing. The invariants are
 * written out in full on `canAccessStorageObject` below; they travelled with
 * the code from the monolith and none of them changed in the move.
 *
 * ## What it touches
 *
 * Tables: `marketplace_listings` (published-cover check), `flashcards` and
 * `messages` (the two exact-reference lookups). Every private bucket in
 * `PRIVATE_STORAGE_BUCKETS` (`@lantern/shared/utils/storageUrl`) is reachable
 * through the minters.
 *
 * ## The gotcha — outward calls are INJECTED, not imported
 *
 * The gate's decision for four buckets is "can this user read the ARTEFACT
 * that references the object?", which is `verifyDeckAccess`, `resolveNoteAccess`,
 * `isGroupMember`, `isDmThreadParticipant`, `isProfileVisibleToViewer` and
 * `canViewPeerChatAvatar` — all still in the monolith, and all in sections
 * later lanes own. They arrive as `StorageAclDeps` so this module stays a leaf
 * and never imports `SupabaseService` back.
 *
 * That also keeps the existing tests honest: `services/storageAccess.test.ts`
 * `jest.spyOn`s `isProfileVisibleToViewer` / `canViewPeerChatAvatar` on a real
 * `SupabaseService` instance, so the delegation must build its `deps` inline,
 * with arrow functions that read `this.<method>` AT CALL TIME. Capturing the
 * method references once (e.g. in the constructor) would bypass every spy and
 * quietly un-test the gate.
 *
 * ## The other gotcha — `supabaseUrl`, the second field
 *
 * `normalizeStorageUrl` rewrites legacy `localhost:54321` URLs to the
 * configured Supabase URL, so it needs the URL, not the client. It is the only
 * reason `SupabaseService` has a second instance field at all. Functions here
 * take `supabaseUrl` explicitly rather than reaching for a module-level
 * singleton.
 */
import {
  isPrivateStorageBucket,
  parseStorageObjectUrl,
  parseStoredStorageRef,
  storageThumbPath,
} from "@lantern/shared/utils/storageUrl";

import { clampSignedUrlTtl } from "../../utils/fileValidation";

import type { DataClient } from "./client";

/** Bucket for deck/note covers. Created by the service role on first upload. */
const COVER_IMAGE_BUCKET = "cover-images";

/** All `canAccessFlashcardImage` needs: the deck read/edit predicate. */
export type FlashcardImageDeps = {
  verifyDeckAccess: (
    userId: string,
    deckId: string,
    level?: "read" | "edit" | "owner",
  ) => Promise<boolean>;
};

/** All `canAccessQuestionImage` needs: the group-membership predicate. */
export type QuestionImageDeps = {
  isGroupMember: (groupId: string, userId: string) => Promise<boolean>;
};

/**
 * The artefact-read predicates the full gate needs from sections that are
 * still in the monolith. Injected so this module does not import
 * `SupabaseService`.
 *
 * Build these as arrow functions over `this` inline at the call site — see
 * the header: capturing bound references would defeat the `jest.spyOn`s in
 * `storageAccess.test.ts`.
 */
export type StorageAclDeps = FlashcardImageDeps &
  QuestionImageDeps & {
    resolveNoteAccess: (noteId: string, userId: string) => Promise<unknown>;
    isDmThreadParticipant: (
      threadId: string,
      userId: string,
    ) => Promise<boolean>;
    isProfileVisibleToViewer: (
      viewerId: string,
      targetId: string,
    ) => Promise<boolean>;
    canViewPeerChatAvatar: (
      viewerId: string,
      peerId: string,
    ) => Promise<boolean>;
  };

/** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
export function normalizeStorageUrl(supabaseUrl: string, url: string): string {
  if (!url) return url;
  const base = supabaseUrl.replace(/\/$/, "");
  return url.replace(/https?:\/\/(localhost|127\.0\.0\.1):54321/gi, base);
}

export function resolveStorageReference(
  supabaseUrl: string,
  bucket?: string,
  path?: string,
  url?: string,
): { bucket: string; path: string } | null {
  if (bucket && path) return { bucket, path };
  if (!url) return null;
  return (
    parseStoredStorageRef(normalizeStorageUrl(supabaseUrl, url)) ||
    parseStoredStorageRef(url)
  );
}

// FIXED (F10): the default was 24 h — the maximum — so every caller that
// omitted a TTL minted a day-long bearer link. It is now `undefined`, which
// lets `clampSignedUrlTtl` apply its conservative one-hour default, and the
// bucket is passed so a sensitive bucket gets its own lower ceiling.
export async function createSignedStorageUrl(
  supabase: DataClient,
  supabaseUrl: string,
  bucket: string,
  path: string,
  expiresInSeconds?: number,
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
  const ttl = clampSignedUrlTtl(expiresInSeconds, bucket);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Failed to create signed URL");
  }
  return normalizeStorageUrl(supabaseUrl, data.signedUrl);
}

/**
 * Sign a storage object for display. When variant is `thumb`, prefer the
 * sibling `<path>.thumb.webp` and fall back to the original if missing.
 * ACL checks must always use the original path.
 */
export async function createSignedStorageUrlWithVariant(
  supabase: DataClient,
  supabaseUrl: string,
  bucket: string,
  path: string,
  expiresInSeconds?: number,
  variant: "thumb" | "original" = "original",
): Promise<string> {
  if (variant !== "thumb") {
    return createSignedStorageUrl(
      supabase,
      supabaseUrl,
      bucket,
      path,
      expiresInSeconds,
    );
  }
  const ttl = clampSignedUrlTtl(expiresInSeconds, bucket);
  const thumbPath = storageThumbPath(path);
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls([thumbPath, path], ttl);
    if (!error && data) {
      const thumbResult = data[0];
      const originalResult = data[1];
      const signedUrl =
        (thumbResult && !thumbResult.error && thumbResult.signedUrl) ||
        (originalResult && !originalResult.error && originalResult.signedUrl) ||
        null;
      if (signedUrl) return normalizeStorageUrl(supabaseUrl, signedUrl);
    }
  } catch {
    // Fall through to original-only sign.
  }
  return createSignedStorageUrl(
    supabase,
    supabaseUrl,
    bucket,
    path,
    expiresInSeconds,
  );
}

/**
 * Batch sign display URLs. When variant is `thumb`, prefers sibling thumbs
 * with original fallback (same pattern as marketplace compact cards).
 */
export async function signStorageDisplayUrls(
  supabase: DataClient,
  supabaseUrl: string,
  refs: Array<{ bucket: string; path: string; index: number }>,
  options?: {
    expiresInSeconds?: number;
    variant?: "thumb" | "original";
  },
): Promise<Map<number, string>> {
  const variant = options?.variant || "original";
  const signedByIndex = new Map<number, string>();
  const byBucket = new Map<string, Array<{ index: number; path: string }>>();
  for (const ref of refs) {
    if (!ref.bucket || !ref.path || !isPrivateStorageBucket(ref.bucket))
      continue;
    const group = byBucket.get(ref.bucket) || [];
    group.push({ index: ref.index, path: ref.path });
    byBucket.set(ref.bucket, group);
  }

  for (const [bucket, items] of byBucket) {
    try {
      // FIXED (F10): the TTL is clamped PER BUCKET, inside the loop. One
      // clamp outside it gave every bucket in a mixed batch the same
      // ceiling, which is exactly how a sensitive bucket inherits a cover
      // image's lifetime.
      const ttl = clampSignedUrlTtl(options?.expiresInSeconds, bucket);
      const paths =
        variant === "thumb"
          ? items.flatMap((item) => [storageThumbPath(item.path), item.path])
          : items.map((item) => item.path);
      const { data, error } = await supabase.storage
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
            signedByIndex.set(
              item.index,
              normalizeStorageUrl(supabaseUrl, signedUrl),
            );
          }
        });
      } else {
        items.forEach((item, i) => {
          const result = data[i];
          if (result && !result.error && result.signedUrl) {
            signedByIndex.set(
              item.index,
              normalizeStorageUrl(supabaseUrl, result.signedUrl),
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

export async function signStorageDisplayUrl(
  supabase: DataClient,
  supabaseUrl: string,
  url: string,
  expiresInSeconds = 60 * 60 * 24,
  variant: "thumb" | "original" = "original",
): Promise<string> {
  if (!url || url.startsWith("data:")) return url;
  const parsed =
    parseStoredStorageRef(normalizeStorageUrl(supabaseUrl, url)) ||
    parseStoredStorageRef(url);
  // Unknown / non-private buckets: never mint service-role signed URLs for them.
  if (!parsed || !isPrivateStorageBucket(parsed.bucket)) {
    return normalizeStorageUrl(supabaseUrl, url);
  }
  return createSignedStorageUrlWithVariant(
    supabase,
    supabaseUrl,
    parsed.bucket,
    parsed.path,
    expiresInSeconds,
    variant,
  );
}

// ===========================================================================
// STORAGE ACL — the authorization gate for every signed URL
//
// All eight buckets are PRIVATE, so an object is only reachable through a
// signed URL, and `canAccessStorageObject` is the one thing standing between
// a caller and a signature. The service role can sign anything; this method
// decides whether it should. Treat it as security code, not plumbing.
//
// Invariants a change must preserve:
//
//  1. DENY BY DEFAULT. An unknown bucket returns false (the
//     `isPrivateStorageBucket` allowlist), and every branch below that does
//     not explicitly grant falls through to `return false` at the end.
//     Adding a bucket without adding a branch denies it — which is correct.
//  2. PATH HYGIENE. A path containing `..`, starting with `/`, or containing
//     a backslash is rejected outright, before anything is parsed out of it.
//     Authorization is then derived from path SEGMENTS (`parts[0]` is the
//     owner), so a traversal that survived would authorize the wrong object.
//  3. OWNER SHORT-CIRCUIT. `parts[0] === userId` grants; everything after
//     that point answers the harder question "may a NON-owner read this?".
//
// CONFUSED-DEPUTY DEFENCES (two, both deliberate and both easy to delete by
// accident). Object paths embed the UPLOADER's id, and rows that reference
// an object are written by users. So "some row I can read points at this
// object" is NOT proof the object is mine to share — an attacker can put any
// path in a row they own. Both checks below therefore require the PATH OWNER
// to be independently authorized on the referencing artefact:
//
//  - `canAccessFlashcardImage`: the viewer must be able to READ a deck that
//    references the object, AND the path owner must be able to EDIT that
//    same deck. Planting a stranger's image path on your own card grants
//    nothing, because you are not an editor of their deck.
//  - `canAccessQuestionImage`: the viewer must be a member of a group whose
//    message references the object, AND the path owner must be a member of
//    that same group.
//
// Both also match the reference EXACTLY (`storageUrlMatchesObject`) after an
// `ilike '%path%'` narrowing query; the ilike is a prefilter only, never the
// decision, and the pattern is escaped (`escapeIlikePattern`) so a path
// containing `%` or `_` cannot widen it.
//
// COVER PATHS are hardened at construction rather than at read time:
// `uploadCoverImage` strips the owner and artefact id segments to
// `[A-Za-z0-9_-]`, so neither can introduce a separator or a traversal, and
// `normalizeCoverRef` (packages/shared/src/utils/storageUrl.ts) refuses to
// bucket-qualify a ref that already names another private bucket, is absolute,
// or contains `..`/backslashes — a legacy ref cannot be rewritten into a
// pointer at someone else's bucket.
//
// Do not weaken any of the above to fix a 403. A cover or avatar that fails
// to load is a missing read predicate on the ARTEFACT, not a reason to widen
// the bucket rules.
// ===========================================================================
export async function canAccessStorageObject(
  supabase: DataClient,
  deps: StorageAclDeps,
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
    // Published shop covers live under {owner}/shop/. Anyone who can see the
    // shop card may re-sign them. Legacy covers under {owner}/temp/ stay
    // owner-only here; list/profile responses sign those with the service role.
    if (parts[1] === "shop") return true;
    if (parts[1] === "listings" && parts[2]) {
      const listingId = parts[2];
      const { data } = await supabase
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
    return canAccessFlashcardImage(supabase, deps, userId, path);
  }

  if (bucket === "question-images") {
    if (!userId) return false;
    return canAccessQuestionImage(supabase, deps, userId, path);
  }

  if (bucket === COVER_IMAGE_BUCKET) {
    // {ownerId}/decks/{deckId}/... or {ownerId}/notes/{noteId}/...
    // The owner already returned true above; everyone else has to be able to
    // READ the artefact the cover belongs to (shared deck, note collaborator),
    // or the cover would 403 on exactly the screens that show it.
    if (!userId) return false;
    const scope = parts[1];
    const artefactId = parts[2];
    if (!artefactId) return false;
    if (scope === "decks") {
      return deps.verifyDeckAccess(userId, artefactId, "read");
    }
    if (scope === "notes") {
      const access = await deps.resolveNoteAccess(artefactId, userId);
      return Boolean(access);
    }
    return false;
  }

  if (bucket === "note-files") {
    // Chat attachments: {ownerId}/chat/{groupId}/... or {ownerId}/chat/dm/{threadId}/...
    if (userId && parts[1] === "chat" && parts[2]) {
      if (parts[2] === "dm" && parts[3]) {
        return deps.isDmThreadParticipant(parts[3], userId);
      }
      return deps.isGroupMember(parts[2], userId);
    }
    return false;
  }

  if (bucket === "profile-avatars") {
    if (!userId) return false;
    // Public/friends visibility, or conversation peers (DM / shared group) for chat bubbles.
    if (await deps.isProfileVisibleToViewer(userId, ownerId)) return true;
    return deps.canViewPeerChatAvatar(userId, ownerId);
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
    return deps.isGroupMember(groupId, userId);
  }

  return false;
}

/** @internal — the ilike prefilter escape; no caller outside this module. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/** True when stored image_url refers to exactly this storage object (not a substring plant). */
export function storageUrlMatchesObject(
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
export async function canAccessFlashcardImage(
  supabase: DataClient,
  deps: FlashcardImageDeps,
  userId: string,
  path: string,
): Promise<boolean> {
  const pathOwner = path.split("/")[0];
  if (!pathOwner) return false;

  const escapedPath = escapeIlikePattern(path);
  const { data: cards, error } = await supabase
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
          storageUrlMatchesObject(c.image_url, "flashcard-images", path),
        )
        .map((c) => c.deck_id)
        .filter(Boolean),
    ),
  ];

  for (const deckId of deckIds) {
    const canRead = await deps.verifyDeckAccess(userId, deckId, "read");
    if (!canRead) continue;
    // Path owner must be an editor/owner of the referencing deck — not merely mentioned in image_url.
    if (await deps.verifyDeckAccess(pathOwner, deckId, "edit")) return true;
  }
  return false;
}

/**
 * True when the image is on a group message the user can see, and the uploader
 * (path owner) is also a member of that group (blocks URL planting).
 */
export async function canAccessQuestionImage(
  supabase: DataClient,
  deps: QuestionImageDeps,
  userId: string,
  path: string,
): Promise<boolean> {
  const pathOwner = path.split("/")[0];
  if (!pathOwner) return false;

  const escapedPath = escapeIlikePattern(path);
  const { data: rows, error } = await supabase
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
          storageUrlMatchesObject(r.image_url, "question-images", path),
        )
        .map((r) => r.group_id)
        .filter(Boolean),
    ),
  ];

  for (const groupId of groupIds) {
    if (!(await deps.isGroupMember(groupId, userId))) continue;
    if (await deps.isGroupMember(groupId, pathOwner)) return true;
  }
  return false;
}
