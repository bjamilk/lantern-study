/**
 * data/decks.ts — `decks`, `flashcards`, `deck_collaborators`: creation,
 * collaboration, listing, import/export and the card writes.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1b, step 7):
 * the whole DECKS AND FLASHCARDS section, 20 methods.
 *
 * ## What it touches
 *
 * Tables: `decks`, `flashcards`, `deck_collaborators`. No storage buckets
 * (cover UPLOADS live in the uploads repository; a cover REF is only
 * normalized here, by `normalizeCoverRef`), and one RPC,
 * `create_deck_with_cards`.
 *
 * ## The gotchas
 *
 * 1. THE ACCESS GATE IS NOT IN THIS FILE — yet. `verifyDeckAccess`,
 *    `getAccessibleDeckIds` and `getDeckForUser` are still in the monolith
 *    (they sit inside its OFFLINE BUNDLES banner, misfiled, and move with that
 *    section), so they arrive as `DeckDeps`. `data/storageAcl.ts` injects
 *    `verifyDeckAccess` too — widening it widens flashcard and cover image
 *    access.
 *
 * 2. BULK CREATION IS ATOMIC OR COMPENSATED. `createDeckWithCards` prefers the
 *    RPC; when the RPC is missing it falls back to a deck insert plus a card
 *    insert, with `deleteDeckRowBestEffort` as the compensating action — a
 *    half-created deck is worse than none.
 *
 * 3. A COLUMN THE MIGRATION HAS NOT ADDED 42703s THE WHOLE LIST. `getDecks`
 *    probes `topic_id` and `cover_path` and re-runs the query without them,
 *    and writes go through `writeWithTopicFallback` (now in `data/academic.ts`)
 *    for the same reason. These ladders are not dead code: the migrations are
 *    hand-applied.
 *
 * 4. Concurrent edits raise `VersionConflictError` rather than last-write-wins,
 *    so a collaborator never silently overwrites another's edit.
 *
 * The two deck page-size constants moved with the section: they were private
 * statics on `SupabaseService` and `getDecks` was their only reader.
 */
import { PublicError } from "../../utils/safeError";
import {
  applyCourseFilter,
  courseFilterKey,
  isMissingTopicColumn,
  type CourseFilter,
} from "../academicCourses";
import { cacheService } from "../cache";
import {
  cardToFlashcardRow,
  DeckWithCardsError,
  isMissingRpcError,
  type NormalizedDeckCard,
} from "../deckWithCards";
import { logger } from "../../utils/logger";
import { normalizeCoverRef } from "@lantern/shared/utils/storageUrl";

import { writeWithTopicFallback } from "./academic";
import { isMissingCoverPathColumn } from "./coverImages";
import type { DataClient } from "./client";

/** Moved with the section: `getDecks` was the only reader of either. */
const DEFAULT_DECK_PAGE_SIZE = 20;
const MAX_DECK_PAGE_SIZE = 50;

/**
 * The deck access gate and the course/topic resolvers, which still live in the
 * monolith. Injected so this module stays a leaf and never imports
 * `SupabaseService` back.
 *
 * Build them as arrow functions over `this` inline at the call site, so a
 * `jest.spyOn(service, 'verifyDeckAccess')` still intercepts.
 */
export type DeckDeps = {
  verifyDeckAccess: (
    userId: string,
    deckId: string,
    level?: "read" | "edit" | "owner",
  ) => Promise<boolean>;
  getAccessibleDeckIds: (userId: string) => Promise<string[]>;
  getDeckForUser: (deckId: string, userId: string) => Promise<any | null>;
  resolveArtefactTopic: (input: {
    topicId?: unknown;
    courseId?: unknown;
    currentCourseId?: string | null;
  }) => Promise<string | null | undefined>;
  resolveArtefactTopicPatch: (
    table: string,
    id: string,
    updates: { topicId?: unknown; courseId?: unknown },
  ) => Promise<string | null | undefined>;
  getResponseProfile: (profile?: string) => "compact" | "full";
};

export async function createDeck(
  supabase: DataClient,
  deps: DeckDeps,
  deckData: {
    name: string;
    description?: string;
    isShared?: boolean;
    courseId?: string | null;
    studySetId?: string | null;
    topicId?: string | null;
  },
  userId: string,
): Promise<any> {
  const topicId = await deps.resolveArtefactTopic({
    topicId: deckData.topicId,
    courseId: deckData.courseId,
  });
  const { data, error } = await writeWithTopicFallback(
    (row) => supabase.from("decks").insert(row).select().single(),
    {
      name: deckData.name,
      description: deckData.description || "",
      user_id: userId,
      is_shared: deckData.isShared ?? false,
      course_id: deckData.courseId || null,
      ...(deckData.studySetId !== undefined
        ? { study_set_id: deckData.studySetId || null }
        : {}),
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
    },
  );

  if (error) {
    logger.error("Error creating deck:", { error, deckData, userId });
    throw new Error(error.message || "Failed to create deck");
  }

  // Cache the new deck
  await cacheService.set(`deck:${data.id}`, data, 1800); // 30 minutes

  return data;
}

/**
 * Create a deck AND its cards as one unit.
 *
 * Preferred path is the `create_deck_with_cards` RPC (one transaction). That
 * migration is hand-applied, so while it is missing this compensates: insert
 * the deck, insert the cards, and DELETE the deck if any card fails. Either
 * way a caller that sees an error can be sure no empty deck was left behind —
 * which is the whole point (an interrupted generate used to strand a
 * "0 cards" deck that no client-side rollback could reach).
 */
export async function createDeckWithCards(
  supabase: DataClient,
  deps: DeckDeps,
  deckData: {
    name: string;
    description?: string;
    isShared?: boolean;
    courseId?: string | null;
    studySetId?: string | null;
    topicId?: string | null;
  },
  cards: NormalizedDeckCard[],
  userId: string,
): Promise<{ deck: any; flashcards: any[]; atomic: boolean }> {
  // Resolved before anything is written: a topic that belongs to another
  // course is a PublicError (400), not a half-written deck.
  const topicId = await deps.resolveArtefactTopic({
    topicId: deckData.topicId,
    courseId: deckData.courseId,
  });

  const rpcResult = await tryCreateDeckWithCardsRpc(
    supabase,
    deckData,
    topicId,
    cards,
    userId,
  );
  if (rpcResult) {
    if (deckData.studySetId) {
      await updateDeck(
        supabase,
        deps,
        rpcResult.deckId,
        { studySetId: deckData.studySetId },
        userId,
      );
    }
    await invalidateDeckCaches(supabase, userId, rpcResult.deckId);
    const deck = await getDeckRow(supabase, rpcResult.deckId);
    const flashcards = await getDeckCardRows(supabase, rpcResult.deckId);
    return { deck, flashcards, atomic: true };
  }

  // ---- Compensating path (RPC not present on this database) ----
  const { data: deck, error: deckError } = await writeWithTopicFallback(
    (row) => supabase.from("decks").insert(row).select().single(),
    {
      name: deckData.name,
      description: deckData.description || "",
      user_id: userId,
      is_shared: deckData.isShared ?? false,
      course_id: deckData.courseId || null,
      ...(deckData.studySetId !== undefined
        ? { study_set_id: deckData.studySetId || null }
        : {}),
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
    },
  );

  if (deckError || !deck) {
    logger.error("Error creating deck (with-cards)", {
      error: deckError,
      userId,
    });
    throw new DeckWithCardsError(
      "DECK_WRITE_FAILED",
      deckError?.message || "Failed to create deck",
      true,
    );
  }

  const { data: inserted, error: cardsError } = await supabase
    .from("flashcards")
    .insert(cards.map((card) => cardToFlashcardRow(card, deck.id)))
    .select();

  // A partial insert is the same failure as none: PostgREST inserts the array
  // in one statement, so any error means zero rows landed.
  if (cardsError || !inserted || inserted.length !== cards.length) {
    const rolledBack = await deleteDeckRowBestEffort(supabase, deck.id);
    logger.error("Cards failed after deck insert — deck removed", {
      error: cardsError,
      deckId: deck.id,
      rolledBack,
      expected: cards.length,
      inserted: inserted?.length ?? 0,
    });
    await invalidateDeckCaches(supabase, userId, deck.id);
    throw new DeckWithCardsError(
      "CARD_WRITE_FAILED",
      cardsError?.message || "Failed to save the deck's cards",
      rolledBack,
    );
  }

  await invalidateDeckCaches(supabase, userId, deck.id);
  return { deck, flashcards: inserted, atomic: false };
}

/**
 * Add generated cards to a deck the student already has.
 *
 * The generate flow opened from inside a deck promises the cards land in
 * THAT deck; creating a second one named after it left a duplicate in the
 * library and the original still empty. No deck row is written here, so a
 * single PostgREST insert (one statement, all rows or none) is the whole
 * transaction — nothing to compensate.
 *
 * Returns null when the caller may not edit the deck, which the route
 * answers as 404 rather than leaking whether the deck exists.
 */
export async function addCardsToExistingDeck(
  supabase: DataClient,
  deps: DeckDeps,
  deckId: string,
  cards: NormalizedDeckCard[],
  userId: string,
): Promise<{ deck: any; flashcards: any[]; atomic: boolean } | null> {
  const canEdit = await deps.verifyDeckAccess(userId, deckId, "edit");
  if (!canEdit) return null;

  // The FULL row, not fetchDeckRecord's projection: the client merges what
  // comes back over its local copy, and a row missing `topic_id` would file
  // the student's deck under no topic until the next refetch.
  const { data: deck, error: deckError } = await supabase
    .from("decks")
    .select("*")
    .eq("id", deckId)
    .maybeSingle();
  if (deckError) throw deckError;
  if (!deck) return null;

  const { data: inserted, error: cardsError } = await supabase
    .from("flashcards")
    .insert(cards.map((card) => cardToFlashcardRow(card, deckId)))
    .select();

  if (cardsError || !inserted || inserted.length !== cards.length) {
    logger.error("Cards failed for existing deck", {
      error: cardsError,
      deckId,
      expected: cards.length,
      inserted: inserted?.length ?? 0,
    });
    // One statement: an error means zero rows landed, so the deck is
    // exactly as the student left it.
    throw new DeckWithCardsError(
      "CARD_WRITE_FAILED",
      cardsError?.message || "Failed to save the deck's cards",
      true,
    );
  }

  await invalidateDeckCaches(supabase, userId, deckId);
  return { deck, flashcards: inserted, atomic: true };
}

/** Returns null when this database has no `create_deck_with_cards` yet. */
export async function tryCreateDeckWithCardsRpc(
  supabase: DataClient,
  deckData: {
    name: string;
    description?: string;
    isShared?: boolean;
    courseId?: string | null;
  },
  topicId: string | null | undefined,
  cards: NormalizedDeckCard[],
  userId: string,
): Promise<{ deckId: string } | null> {
  const { data, error } = await supabase.rpc("create_deck_with_cards", {
    p_owner: userId,
    p_deck: {
      name: deckData.name,
      description: deckData.description || "",
      is_shared: deckData.isShared ?? false,
      course_id: deckData.courseId || null,
      ...(topicId ? { topic_id: topicId } : {}),
    },
    p_cards: cards.map((card) => ({
      type: card.type,
      front: card.front,
      back: card.back,
      clozeText: card.clozeText,
      imageUrl: card.imageUrl,
      occlusionData: card.occlusionData,
      tags: card.tags,
    })),
  });

  if (error) {
    if (isMissingRpcError(error)) return null;
    logger.error("create_deck_with_cards RPC failed", { error, userId });
    // The function is transactional: an error means nothing was written.
    throw new DeckWithCardsError(
      "CARD_WRITE_FAILED",
      error.message || "Failed to create deck",
      true,
    );
  }

  const deckId =
    (data as any)?.deckId ||
    (data as any)?.deck_id ||
    (Array.isArray(data) ? data[0]?.deckId : null);
  if (!deckId) {
    throw new DeckWithCardsError(
      "CARD_WRITE_FAILED",
      "Failed to create deck",
      true,
    );
  }
  return { deckId: String(deckId) };
}

export async function getDeckRow(
  supabase: DataClient,
  deckId: string,
): Promise<any> {
  const { data } = await supabase
    .from("decks")
    .select("*")
    .eq("id", deckId)
    .maybeSingle();
  return data || { id: deckId };
}

export async function getDeckCardRows(
  supabase: DataClient,
  deckId: string,
): Promise<any[]> {
  const { data } = await supabase
    .from("flashcards")
    .select("*")
    .eq("deck_id", deckId);
  return data || [];
}

/** Best effort: report whether the orphan deck row is actually gone. */
export async function deleteDeckRowBestEffort(
  supabase: DataClient,
  deckId: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("decks").delete().eq("id", deckId);
    return !error;
  } catch (err) {
    logger.error("Failed to remove partial deck", { deckId, err });
    return false;
  }
}

export async function invalidateDeckCaches(
  supabase: DataClient,
  userId: string,
  deckId?: string,
): Promise<void> {
  if (deckId) {
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`deck:${deckId}:user:*`);
  }
  await cacheService.delete(`decks:user:${userId}`);
  await cacheService.deletePattern(`decks:user:${userId}*`);
  await cacheService.deletePattern(`decks:${userId}*`);
  await cacheService.deletePattern("flashcards:*");
}

export async function getDecks(
  supabase: DataClient,
  deps: DeckDeps,
  userId: string,
  includeShared: boolean = false,
  options: {
    page?: number;
    limit?: number;
    responseProfile?: "compact" | "full";
    /** Academic archive filter (decks.course_id): unfiled → IS NULL, course → eq. */
    courseFilter?: CourseFilter;
    /** Same, one level down (decks.topic_id): unfiled → no topic in that course. */
    topicFilter?: CourseFilter;
  } = {},
): Promise<any[]> {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(
    MAX_DECK_PAGE_SIZE,
    Math.max(1, options.limit || DEFAULT_DECK_PAGE_SIZE),
  );
  const profile = deps.getResponseProfile(options.responseProfile);
  const offset = (page - 1) * limit;
  // v2: includeShared means owned + collaborator decks — never every globally shared deck.
  const cacheKey = `decks:user:${userId}:scope:${includeShared ? "owned_collab" : "owned"}:p${page}:l${limit}:profile:${profile}:course:${courseFilterKey(options.courseFilter)}:topic:${courseFilterKey(options.topicFilter)}:v2`;
  const cached = await cacheService.get<any[]>(cacheKey);
  if (cached !== null) return cached;

  const baseSelectClause =
    profile === "compact"
      ? "id, name, user_id, is_shared, course_id, study_set_id, created_at, study_count"
      : // study_count (Phase 3 M) is selected so "studied by N" can render;
        // without it the counter is written but never readable by a client.
        //
        // study_set_id is projected for the same reason: the mappers already
        // read it, so omitting it here made EVERY deck arrive as
        // `studySetId: null` — a study set's Cards grid could never match its
        // own decks, however correctly they had been filed.
        "id, name, description, user_id, is_shared, course_id, study_set_id, created_at, study_count";

  let accessibleIds: string[] | null = null;
  if (includeShared) {
    // Owned decks + decks where the user is an explicit collaborator.
    // Do NOT list every is_shared=true deck in the product (that leaked other users' libraries).
    accessibleIds = await deps.getAccessibleDeckIds(userId);
    if (accessibleIds.length === 0) {
      await cacheService.set(cacheKey, [], 1800);
      return [];
    }
  }

  // topic_id is projected (and filtered) only while it exists — naming a
  // column the migration has not added yet 42703s the whole deck list.
  // Same rule as topic_id: project cover_path only while it exists, or the
  // whole deck list 42703s before the migration is applied.
  let withCover = true;
  const runQuery = (withTopic: boolean) => {
    const selectClause = withCover
      ? `${baseSelectClause}, cover_path`
      : baseSelectClause;
    let query = supabase
      .from("decks")
      .select(withTopic ? `${selectClause}, topic_id` : selectClause)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    query = applyCourseFilter(query, "course_id", options.courseFilter);
    if (withTopic) {
      query = applyCourseFilter(query, "topic_id", options.topicFilter);
    }
    return accessibleIds
      ? query.in("id", accessibleIds)
      : query.eq("user_id", userId);
  };

  let { data, error }: { data: any; error: any } = await runQuery(true);
  if (error && isMissingCoverPathColumn(error)) {
    withCover = false;
    ({ data, error } = await runQuery(true));
  }
  if (error && isMissingTopicColumn(error)) {
    // No deck can carry a topic before the migration: a named topic matches
    // nothing, and "no topic" matches every deck.
    if (options.topicFilter?.kind === "course") {
      await cacheService.set(cacheKey, [], 1800);
      return [];
    }
    ({ data, error } = await runQuery(false));
  }

  if (error) throw error;

  const decks = (
    (data || []) as unknown as Array<{ id: string; [key: string]: unknown }>
  ).filter((d) => d && typeof d.id === "string" && d.id);
  const deckIds = decks.map((d) => d.id);
  const cardCountByDeck: Record<string, number> = {};

  if (deckIds.length > 0) {
    const { data: cardRows, error: countError } = await supabase
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
    // Raw storage path; the client re-signs it through /storage/signed-urls.
    coverPath: normalizeCoverRef((d as any).cover_path ?? null),
  }));

  await cacheService.set(cacheKey, decksWithCounts, 1800); // 30 minutes
  return decksWithCounts;
}

export async function getSharedDecks(supabase: DataClient): Promise<any[]> {
  const cacheKey = `decks:shared`;
  const cached = await cacheService.get<any[]>(cacheKey);
  if (cached !== null) return cached;

  const { data, error } = await supabase
    .from("decks")
    .select("*")
    .eq("is_shared", true)
    .order("created_at", { ascending: false });

  if (error) throw error;

  await cacheService.set(cacheKey, data, 1800); // 30 minutes
  return data;
}

export async function getDeckCollaborators(
  supabase: DataClient,
  deps: DeckDeps,
  deckId: string,
  userId: string,
): Promise<any[]> {
  const hasAccess = await deps.verifyDeckAccess(userId, deckId, "read");
  if (!hasAccess) return [];

  const cacheKey = `deck_collaborators:${deckId}`;
  const cached = await cacheService.get<any[]>(cacheKey);
  if (cached !== null) return cached;

  const { data, error } = await supabase
    .from("deck_collaborators")
    .select(
      "user_id, role, added_at, profiles!deck_collaborators_user_id_fkey(id, name, avatar_url)",
    )
    .eq("deck_id", deckId);

  if (error) throw error;

  await cacheService.set(cacheKey, data, 300);
  return data;
}

export async function addDeckCollaborator(
  supabase: DataClient,
  deps: DeckDeps,
  deckId: string,
  userId: string,
  role: string = "editor",
  requesterId?: string,
): Promise<any> {
  const actorId = requesterId || userId;
  const canManage = await deps.verifyDeckAccess(actorId, deckId, "owner");
  if (!canManage) throw new Error("Access denied");

  const { data, error } = await supabase
    .from("deck_collaborators")
    .insert({ deck_id: deckId, user_id: userId, role })
    .select()
    .single();

  if (error) throw error;

  await cacheService.delete(`deck_collaborators:${deckId}`);
  return data;
}

export async function removeDeckCollaborator(
  supabase: DataClient,
  deps: DeckDeps,
  deckId: string,
  userId: string,
  requesterId?: string,
): Promise<boolean> {
  const actorId = requesterId || userId;
  const isOwner = await deps.verifyDeckAccess(actorId, deckId, "owner");
  if (!isOwner && actorId !== userId) throw new Error("Access denied");

  const { error } = await supabase
    .from("deck_collaborators")
    .delete()
    .eq("deck_id", deckId)
    .eq("user_id", userId);

  if (error) throw error;

  await cacheService.delete(`deck_collaborators:${deckId}`);
  return true;
}

export async function getDeck(
  supabase: DataClient,
  deckId: string,
): Promise<any | null> {
  const cacheKey = `deck:${deckId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null) return cached;

  const { data, error } = await supabase
    .from("decks")
    // course_id/study_set_id: where the deck is filed. Without them a single
    // deck read answered `courseId: null, studySetId: null` for every deck,
    // whatever the row said.
    .select(
      "id, name, description, user_id, is_shared, course_id, study_set_id, created_at",
    )
    .eq("id", deckId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  await cacheService.set(cacheKey, data, 1800); // 30 minutes
  return data;
}

export async function updateDeck(
  supabase: DataClient,
  deps: DeckDeps,
  deckId: string,
  updates: {
    name?: string;
    description?: string;
    isPublic?: boolean;
    isShared?: boolean;
    courseId?: string | null;
    studySetId?: string | null;
    topicId?: string | null;
  },
  userId: string,
): Promise<any | null> {
  const canEdit = await deps.verifyDeckAccess(userId, deckId, "edit");
  if (!canEdit) return null;

  // Validated against the course the deck ENDS UP with; moving or unfiling
  // the deck takes its topic with it.
  const topicId = await deps.resolveArtefactTopicPatch(
    "decks",
    deckId,
    updates,
  );

  const { data, error } = await writeWithTopicFallback(
    (payload) =>
      supabase.from("decks").update(payload).eq("id", deckId).select().single(),
    {
      name: updates.name,
      description: updates.description,
      is_public: updates.isPublic,
      is_shared: updates.isShared,
      // undefined = untouched (dropped by JSON), null = cleared
      course_id:
        updates.courseId === undefined ? undefined : updates.courseId || null,
      study_set_id:
        updates.studySetId === undefined
          ? undefined
          : updates.studySetId || null,
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
    },
  );

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  // Update cache
  await cacheService.set(`deck:${deckId}`, data, 1800);
  await cacheService.deletePattern(`deck:${deckId}:user:*`);

  return data;
}

export async function deleteDeck(
  supabase: DataClient,
  deps: DeckDeps,
  deckId: string,
  userId: string,
): Promise<boolean> {
  const isOwner = await deps.verifyDeckAccess(userId, deckId, "owner");
  if (!isOwner) return false;

  const { error } = await supabase.from("decks").delete().eq("id", deckId);

  if (error) throw error;

  // Clear cache
  await cacheService.delete(`deck:${deckId}`);
  await cacheService.deletePattern(`deck:${deckId}:user:*`);
  await cacheService.deletePattern(`decks:user:*`);

  return true;
}

export async function exportDeck(
  supabase: DataClient,
  deps: DeckDeps,
  deckId: string,
  userId: string,
): Promise<any | null> {
  const deck = await deps.getDeckForUser(deckId, userId);
  if (!deck) return null;

  const { data: flashcards, error } = await supabase
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

export async function importDeck(
  supabase: DataClient,
  importData: any,
  userId: string,
): Promise<any> {
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

  const { data: newDeck, error: deckError } = await supabase
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

    const { error: cardsError } = await supabase
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
    const { data: cards } = await supabase
      .from("flashcards")
      .select("*")
      .eq("deck_id", newDeck.id);
    insertedFlashcards = cards || [];
  }

  return { deck: newDeck, flashcards: insertedFlashcards };
}

/**
 * Replace all cards in an existing deck in place, keeping the deck row (and
 * its id) stable. Used when a study pack the buyer owns publishes a new
 * version: the buyer's delivered deck is refreshed without creating a
 * duplicate deck. The deck's owner is NOT re-checked here — callers pass a
 * deck id they materialised for that buyer (delivered_refs.deckId), never a
 * client-supplied id.
 */
export async function replaceDeckCards(
  supabase: DataClient,
  deckId: string,
  cards: Array<{
    front?: string;
    back?: string;
    type?: string;
    clozeText?: string;
    cloze_text?: string;
    occlusion_data?: unknown;
    occlusionData?: unknown;
    image_url?: string;
    imageUrl?: string;
    tags?: unknown;
  }>,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("flashcards")
    .delete()
    .eq("deck_id", deckId);
  if (deleteError) {
    logger.error("Error clearing deck cards for replacement:", deleteError);
    throw deleteError;
  }

  if (cards && cards.length > 0) {
    const rows = cards.map((card) => {
      const cardType = card.type || "BASIC";
      const insertData: any = { deck_id: deckId, type: cardType };
      if (cardType === "CLOZE") {
        insertData.cloze_text = card.clozeText || card.cloze_text;
      } else if (cardType === "IMAGE_OCCLUSION") {
        insertData.front = card.front;
        insertData.back = card.back;
        const occlusionData = card.occlusion_data || card.occlusionData;
        if (occlusionData) insertData.occlusion_data = occlusionData;
      } else {
        insertData.front = card.front;
        insertData.back = card.back;
      }
      const imageUrl = card.image_url || card.imageUrl;
      if (imageUrl) insertData.image_url = imageUrl;
      if (Array.isArray(card.tags) && card.tags.length > 0) {
        insertData.tags = card.tags;
      }
      return insertData;
    });
    const { error: insertError } = await supabase
      .from("flashcards")
      .insert(rows);
    if (insertError) {
      logger.error("Error inserting replacement deck cards:", insertError);
      throw insertError;
    }
  }

  await cacheService.deletePattern("flashcards:*");
  await cacheService.delete(`deck:${deckId}`);
  // The per-user deck list bakes in a computed card_count, so it must be
  // rebuilt after the card set changes (same broad pattern importDeck uses).
  await cacheService.deletePattern(`decks:user:*`);
}

export async function createFlashcard(
  supabase: DataClient,
  deps: DeckDeps,
  flashcardData: {
    deckId: string;
    type?: string;
    front?: string;
    back?: string;
    clozeText?: string;
    imageUrl?: string;
    occlusionData?: any;
    tags?: string[];
    userId?: string;
  },
): Promise<any> {
  const cardType = flashcardData.type || "BASIC";

  if (!flashcardData.userId) {
    throw new Error("Authentication required");
  }
  const canEdit = await deps.verifyDeckAccess(
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

  const { data, error } = await supabase
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
