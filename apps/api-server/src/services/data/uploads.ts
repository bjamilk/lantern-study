/**
 * data/uploads.ts — every bytes-into-Storage path in the server.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1b, step 8):
 * the whole IMAGE AND FILE UPLOADS section, 14 methods — flashcard images,
 * deck/note/study-set covers, marketplace listing images, chat images and
 * audio, question images, and profile and group avatars.
 *
 * ## What it touches
 *
 * Tables: `decks`, `notes`, `study_sets` (the three cover-path columns —
 * `assertCoverColumn` reaches them through `COVER_TABLE_BY_KIND[kind]`, one of
 * the seven dynamic `.from(<identifier>)` sites frozen by
 * `supabase.tableInventory.test.ts`). Buckets: `flashcard-images`,
 * `cover-images`, `marketplace-images`, `note-files`, `question-images`,
 * `profile-avatars`, `group-avatars`.
 *
 * ## The shape every upload here shares, and a new one must copy
 *
 *   - a size ceiling checked on the DECODED buffer, before any processing;
 *   - `assertImageMagicBytes` — the declared content type is never trusted; a
 *     file is what its bytes say it is;
 *   - `processImageForUpload` normalizes to WebP (animated GIFs pass through)
 *     and yields an optional thumb, uploaded best-effort by
 *     `uploadSiblingThumb` so a thumb failure never fails the real upload;
 *   - a path whose FIRST segment is the owner's user id, because
 *     `data/storageAcl.ts` derives authorization from that segment. Owner and
 *     artefact id segments are stripped to `[A-Za-z0-9_-]` so neither can
 *     introduce a separator or a traversal;
 *   - `upsert: false` plus a timestamp in the filename, because the objects
 *     are served with an immutable cache header and reusing a path would serve
 *     the old picture forever;
 *   - the bucket is created on demand by the service role, so there is no
 *     manual dashboard step — but a new bucket must also be added to
 *     `PRIVATE_STORAGE_BUCKETS`, or the deny-by-default gate refuses to sign
 *     anything in it.
 *
 * ## The gotcha
 *
 * Callers persist the returned PATH, never the URL: signed URLs expire (24 h
 * maximum), and a frozen signed URL stored in a row is how chat and board
 * photos went blank after a day.
 *
 * Signing is INJECTED (`SignUrlDeps`), not imported from `data/storageAcl.ts`
 * directly: `coverImages.test.ts` spies on `createSignedStorageUrl` through the
 * facade, and a direct sibling call would step around the spy. The two chat
 * uploads additionally need the group / DM membership checks, which are still
 * in the monolith, so they take `ChatUploadDeps`.
 */
import { logger } from "../../utils/logger";
import {
  assertImageMagicBytes,
  clampSignedUrlTtl,
  detectImageMime,
  STORAGE_SIGNED_URL_MAX_TTL,
} from "../../utils/fileValidation";
import {
  parseStoredStorageRef,
  storageThumbPath,
} from "@lantern/shared/utils/storageUrl";
import { cacheService } from "../cache";
import {
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  processImageForUpload,
} from "../imageProcessing";

import type { DataClient } from "./client";
import {
  COVER_IMAGE_BUCKET,
  COVER_IMAGE_MIGRATION,
  COVER_TABLE_BY_KIND,
  CoverColumnMissingError,
  CoverStorageUnavailableError,
  isMissingCoverPathColumn,
} from "./coverImages";
/**
 * The two signers, from `data/storageAcl.ts`.
 *
 * They are INJECTED rather than imported directly, even though that module is
 * a sibling leaf and the import would be legal. `coverImages.test.ts` does
 * `jest.spyOn(service, 'createSignedStorageUrl')` and asserts the upload
 * returns what the spy produced; a direct call bypasses the spy (and any
 * future override) and the test fails on the real client.
 */
export type SignUrlDeps = {
  createSignedStorageUrl: (
    bucket: string,
    path: string,
    expiresInSeconds?: number,
  ) => Promise<string>;
  createSignedStorageUrlWithVariant: (
    bucket: string,
    path: string,
    expiresInSeconds?: number,
    variant?: "thumb" | "original",
  ) => Promise<string>;
};

/**
 * What the two chat uploads additionally need from sections still in the
 * monolith: a chat attachment is only accepted from someone already in the
 * conversation. Injected so this module stays a leaf.
 */
export type ChatUploadDeps = SignUrlDeps & {
  isGroupMember: (groupId: string, userId: string) => Promise<boolean>;
  isDmThreadParticipant: (threadId: string, userId: string) => Promise<boolean>;
};

/** Best-effort sibling thumb upload; failures never fail the parent upload. */
export async function uploadSiblingThumb(
  supabase: DataClient,
  bucket: string,
  filePath: string,
  thumb: Buffer | null,
): Promise<void> {
  if (!thumb) return;
  try {
    const { error: thumbError } = await supabase.storage
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

export async function uploadFlashcardImage(
  supabase: DataClient,
  deps: SignUrlDeps,
  params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    folder?: string;
  },
): Promise<{ url: string; path: string }> {
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
    params.fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    "flashcard";
  const filePath = `${ownerPrefix}${folderSegment}${timestamp}-${baseName}.${normalized.ext}`;

  const attemptUpload = async () => {
    return supabase.storage.from(bucket).upload(filePath, normalized.buffer, {
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
    await supabase.storage.createBucket(bucket, { public: false });
    uploadResult = await attemptUpload();
  }

  const { error } = uploadResult;
  if (error) {
    logger.error("Error uploading flashcard image:", { error, filePath });
    throw new Error(error.message);
  }

  await uploadSiblingThumb(supabase, bucket, filePath, thumb);
  const signedUrl = await deps.createSignedStorageUrl(bucket, filePath);

  return {
    url: signedUrl,
    path: filePath,
  };
}

/**
 * Cheap probe: is `cover_path` there at all?
 *
 * Called BEFORE any byte is uploaded. Storing first and discovering the
 * missing column afterwards leaves an orphan object behind on every attempt
 * — and the cleanup runs against the same storage that may itself be the
 * thing that is broken. One `select ... limit 1` costs nothing and makes a
 * missing migration a clean 503.
 */
export async function assertCoverColumn(
  supabase: DataClient,
  kind: "deck" | "note" | "study-set",
): Promise<void> {
  const table = COVER_TABLE_BY_KIND[kind];
  const { error } = await supabase.from(table).select("cover_path").limit(1);
  if (!error) return;
  if (isMissingCoverPathColumn(error)) {
    logger.error("[cover] cover_path column missing", {
      table,
      migration: COVER_IMAGE_MIGRATION,
      code: (error as any)?.code,
      message: error.message,
    });
    throw new CoverColumnMissingError();
  }
  // Anything else (RLS on an empty probe, a transient read) is not a reason
  // to refuse the upload — the owner-scoped write below reports it properly.
  logger.warn("[cover] column probe failed (continuing)", {
    table,
    code: (error as any)?.code,
    message: error.message,
  });
}

/**
 * Store a deck/note cover image.
 *
 * Mirrors uploadFlashcardImage: magic-byte validated, normalized to WebP
 * (animated GIFs pass through), with a best-effort 320px sibling thumb. The
 * caller persists the returned PATH — the signed URLs expire in 24h.
 */
export async function uploadCoverImage(
  supabase: DataClient,
  deps: SignUrlDeps,
  params: {
    userId: string;
    kind: "deck" | "note" | "study-set";
    id: string;
    fileName: string;
    base64Data: string;
    contentType: string;
  },
): Promise<{ path: string; url: string; thumbUrl: string | null }> {
  const bucket = COVER_IMAGE_BUCKET;
  const buffer = Buffer.from(params.base64Data, "base64");
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("Image exceeds 10 MB limit");
  }
  assertImageMagicBytes(buffer, params.contentType);
  const { normalized, thumb } = await processImageForUpload(
    buffer,
    "flashcard",
    { detectedMime: detectImageMime(buffer) || params.contentType },
  );

  const ownerSegment = params.userId.replace(/[^a-zA-Z0-9_-]/g, "");
  const idSegment = params.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const kindSegment =
    params.kind === "deck"
      ? "decks"
      : params.kind === "study-set"
        ? "study-sets"
        : "notes";
  const baseName =
    params.fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    "cover";
  // Timestamped so the path changes on every replace: the objects are served
  // with an immutable cache header, and reusing a path would serve the old
  // picture from cache forever.
  const filePath = `${ownerSegment}/${kindSegment}/${idSegment}/${Date.now()}-${baseName}.${normalized.ext}`;

  const attemptUpload = async () =>
    supabase.storage.from(bucket).upload(filePath, normalized.buffer, {
      contentType: normalized.contentType,
      cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
      upsert: false,
    });

  let uploadResult = await attemptUpload();
  // First cover ever uploaded: the bucket does not exist yet. The service
  // role can create it, so this needs no dashboard step.
  if (
    uploadResult.error &&
    typeof uploadResult.error.message === "string" &&
    uploadResult.error.message.toLowerCase().includes("bucket") &&
    uploadResult.error.message.toLowerCase().includes("not found")
  ) {
    const created = await supabase.storage.createBucket(bucket, {
      public: false,
      allowedMimeTypes: ["image/webp", "image/png", "image/jpeg", "image/gif"],
      fileSizeLimit: 10 * 1024 * 1024,
    });
    // createBucket returns its error rather than throwing. Swallowing it is
    // how "the bucket does not exist and cannot be made" became a blank 500.
    if ((created as any)?.error) {
      logger.error("[cover] bucket auto-create failed", {
        bucket,
        message: (created as any).error?.message,
      });
      throw new CoverStorageUnavailableError(
        (created as any).error?.message || "bucket could not be created",
      );
    }
    uploadResult = await attemptUpload();
  }
  if (uploadResult.error) {
    logger.error("[cover] upload failed", {
      bucket,
      filePath,
      message: uploadResult.error.message,
    });
    throw new CoverStorageUnavailableError(uploadResult.error.message);
  }

  await uploadSiblingThumb(supabase, bucket, filePath, thumb);
  const url = await deps.createSignedStorageUrl(bucket, filePath);
  let thumbUrl: string | null = null;
  if (thumb) {
    try {
      thumbUrl = await deps.createSignedStorageUrlWithVariant(
        bucket,
        filePath,
        60 * 60 * 24,
        "thumb",
      );
    } catch {
      thumbUrl = null;
    }
  }
  // Bucket-qualified, so `parseStoredStorageRef` resolves it on every client
  // without a cover-specific special case. A bare path parses as null there
  // and is handed straight to <img>, which renders an empty box.
  return { path: `${bucket}/${filePath}`, url, thumbUrl };
}

/** Best-effort removal of a cover object and its sibling thumb. Never throws. */
export async function deleteCoverObject(
  supabase: DataClient,
  coverPath: string | null | undefined,
): Promise<void> {
  if (!coverPath) return;
  const path = coverPath.startsWith(`${COVER_IMAGE_BUCKET}/`)
    ? coverPath.slice(COVER_IMAGE_BUCKET.length + 1)
    : coverPath;
  if (!path || path.includes("..")) return;
  try {
    await supabase.storage
      .from(COVER_IMAGE_BUCKET)
      .remove([path, storageThumbPath(path)]);
  } catch (error: any) {
    logger.warn("Cover object delete failed", {
      path,
      error: error?.message,
    });
  }
}

/**
 * Write (or clear with null) a deck cover path. Owner-scoped.
 * Returns the PREVIOUS path so the caller can delete the replaced object.
 */
export async function setDeckCoverPath(
  supabase: DataClient,
  deckId: string,
  userId: string,
  coverPath: string | null,
): Promise<{ previousPath: string | null }> {
  const { data: current, error: readError } = await supabase
    .from("decks")
    .select("id, cover_path")
    .eq("id", deckId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) {
    if (isMissingCoverPathColumn(readError))
      throw new CoverColumnMissingError();
    throw readError;
  }
  if (!current) return { previousPath: null };

  const { error } = await supabase
    .from("decks")
    .update({ cover_path: coverPath })
    .eq("id", deckId)
    .eq("user_id", userId);
  if (error) {
    if (isMissingCoverPathColumn(error)) throw new CoverColumnMissingError();
    throw error;
  }
  await cacheService.deletePattern(`deck:${deckId}:user:*`);
  await cacheService.deletePattern(`decks:user:${userId}*`);
  await cacheService.deletePattern(`decks:${userId}*`);
  return { previousPath: (current as any).cover_path ?? null };
}

/** Same for notes. Owner-scoped: a cover is the owner's presentation choice. */
export async function setNoteCoverPath(
  supabase: DataClient,
  noteId: string,
  userId: string,
  coverPath: string | null,
): Promise<{ previousPath: string | null }> {
  const { data: current, error: readError } = await supabase
    .from("notes")
    .select("id, cover_path")
    .eq("id", noteId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) {
    if (isMissingCoverPathColumn(readError))
      throw new CoverColumnMissingError();
    throw readError;
  }
  if (!current) return { previousPath: null };

  const { error } = await supabase
    .from("notes")
    .update({ cover_path: coverPath })
    .eq("id", noteId)
    .eq("user_id", userId);
  if (error) {
    if (isMissingCoverPathColumn(error)) throw new CoverColumnMissingError();
    throw error;
  }
  await cacheService.delete(`note:${noteId}`);
  return { previousPath: (current as any).cover_path ?? null };
}

/**
 * Same for a study set. Owner-scoped for the same reason decks are: a set's
 * cover is the shape the owner chose for it, and `study_sets` rows are
 * already owner-only.
 */
export async function setStudySetCoverPath(
  supabase: DataClient,
  setId: string,
  userId: string,
  coverPath: string | null,
): Promise<{ previousPath: string | null }> {
  const { data: current, error: readError } = await supabase
    .from("study_sets")
    .select("id, cover_path")
    .eq("id", setId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) {
    if (isMissingCoverPathColumn(readError))
      throw new CoverColumnMissingError();
    throw readError;
  }
  if (!current) return { previousPath: null };

  const { error } = await supabase
    .from("study_sets")
    .update({ cover_path: coverPath })
    .eq("id", setId)
    .eq("user_id", userId);
  if (error) {
    if (isMissingCoverPathColumn(error)) throw new CoverColumnMissingError();
    throw error;
  }
  return { previousPath: (current as any).cover_path ?? null };
}

/** SEC-07: marketplace images — magic-byte validated server upload. */
export async function uploadMarketplaceImage(
  supabase: DataClient,
  deps: SignUrlDeps,
  params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    listingId?: string;
    purpose?: "shop" | "listing";
  },
): Promise<{ url: string; path: string; storageUrl: string }> {
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
    params.fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    "photo";
  const safeName = `${baseName}.${normalized.ext}`;
  const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
  const listingSegment = params.listingId
    ? `listings/${params.listingId.replace(/[^a-zA-Z0-9_-]/g, "")}/`
    : params.purpose === "shop"
      ? "shop/"
      : "temp/";
  const filePath = `${ownerPrefix}${listingSegment}${timestamp}-${safeName}`;

  const { error } = await supabase.storage
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
  await uploadSiblingThumb(supabase, bucket, filePath, thumb);

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
  const storageUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

  return {
    url: await deps.createSignedStorageUrl(bucket, filePath),
    path: filePath,
    storageUrl,
  };
}

/** SEC-07: chat images stored under note-files/{userId}/chat/{groupId}/... */
export async function uploadChatImage(
  supabase: DataClient,
  deps: ChatUploadDeps,
  params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    groupId?: string;
  },
): Promise<{ url: string; path: string }> {
  const bucket = "note-files";
  const timestamp = Date.now();
  const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
  const chatId = (params.groupId || "general").replace(/[^a-zA-Z0-9_-]/g, "");
  if (params.groupId) {
    const member = await deps.isGroupMember(params.groupId, params.userId);
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
    params.fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    "chat";
  const filePath = `${ownerPrefix}chat/${chatId}/${timestamp}-${baseName}.${normalized.ext}`;

  const { error } = await supabase.storage
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

  await uploadSiblingThumb(supabase, bucket, filePath, thumb);

  return {
    // `clampSignedUrlTtl` caps every signed URL at STORAGE_SIGNED_URL_MAX_TTL
    // (24h), so asking for a week only ever produced a 24h URL that then
    // rotted inside `messages.text`. Ask for what we actually get, and let
    // clients re-sign on read (POST /api/v1/storage/signed-url[s]).
    url: await deps.createSignedStorageUrl(
      bucket,
      filePath,
      STORAGE_SIGNED_URL_MAX_TTL,
    ),
    path: filePath,
  };
}

/** Chat voice notes under note-files/{userId}/chat/{groupId|dm/threadId}/... */
export async function uploadChatAudio(
  supabase: DataClient,
  deps: ChatUploadDeps,
  params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    groupId?: string;
    threadId?: string;
  },
): Promise<{ url: string; path: string }> {
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
  if (!allowed.includes(params.contentType) && !allowed.includes(contentType)) {
    throw new Error("Unsupported audio type. Use webm, mp4/m4a, ogg, or wav.");
  }
  let chatSegment: string;
  if (params.groupId) {
    const member = await deps.isGroupMember(params.groupId, params.userId);
    if (!member) throw new Error("Not a member of this group");
    chatSegment = params.groupId.replace(/[^a-zA-Z0-9_-]/g, "");
  } else if (params.threadId) {
    const participant = await deps.isDmThreadParticipant(
      params.threadId,
      params.userId,
    );
    if (!participant) throw new Error("Not a participant of this conversation");
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

  const { error } = await supabase.storage
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
    // `clampSignedUrlTtl` caps every signed URL at STORAGE_SIGNED_URL_MAX_TTL
    // (24h), so asking for a week only ever produced a 24h URL that then
    // rotted inside `messages.text`. Ask for what we actually get, and let
    // clients re-sign on read (POST /api/v1/storage/signed-url[s]).
    url: await deps.createSignedStorageUrl(
      bucket,
      filePath,
      STORAGE_SIGNED_URL_MAX_TTL,
    ),
    path: filePath,
  };
}

/** SEC-07: question/message images — magic-byte validated server upload. */
export async function uploadQuestionImage(
  supabase: DataClient,
  deps: SignUrlDeps,
  params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  },
): Promise<{ url: string; path: string }> {
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
    params.fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    "question";
  const filePath = `${ownerPrefix}questions/${timestamp}-${baseName}.${normalized.ext}`;

  const { error } = await supabase.storage
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

  await uploadSiblingThumb(supabase, bucket, filePath, thumb);

  return {
    url: await deps.createSignedStorageUrl(bucket, filePath),
    path: filePath,
  };
}

export async function uploadProfileAvatar(
  supabase: DataClient,
  deps: SignUrlDeps,
  params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
  },
): Promise<{ url: string; path: string; avatarUrl: string }> {
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

  const { error } = await supabase.storage
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
    const { data: existing } = await supabase.storage
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
      await supabase.storage.from(bucket).remove(stale);
    }
  } catch (cleanupError) {
    logger.warn("Failed to clean up old profile avatars", {
      cleanupError,
      userId: safeUserId,
    });
  }

  const signedUrl = await deps.createSignedStorageUrl(bucket, filePath);
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
  const avatarUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

  return { url: signedUrl, path: filePath, avatarUrl };
}

export async function uploadGroupAvatar(
  supabase: DataClient,
  deps: SignUrlDeps,
  params: {
    groupId: string;
    fileName: string;
    base64Data: string;
    contentType: string;
  },
): Promise<{ url: string; path: string; avatarUrl: string }> {
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

  const { error } = await supabase.storage
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
    const { data: existing } = await supabase.storage
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
      await supabase.storage.from(bucket).remove(stale);
    }
  } catch (cleanupError) {
    logger.warn("Failed to clean up old group avatars", {
      cleanupError,
      groupId: safeGroupId,
    });
  }

  const signedUrl = await deps.createSignedStorageUrl(bucket, filePath);
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
  const avatarUrl = `${base}/storage/v1/object/${bucket}/${filePath}`;

  return { url: signedUrl, path: filePath, avatarUrl };
}
