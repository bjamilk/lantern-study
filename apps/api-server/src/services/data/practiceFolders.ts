/**
 * data/practiceFolders.ts — folders that hold a study set's quizzes and tests.
 *
 * ## Purpose
 *
 * PR #130 unified the quiz and test libraries into one Practice hub and found
 * there was nothing to file them INTO. Quizzes and tests are rows of ONE table
 * and the quiz/test split is DERIVED on the client (`studyTestDoor`), not
 * stored — so one nullable column files both doors, and one folder holds a
 * mix. This module is the CRUD behind it, plus the one predicate the route
 * needs before it lets a test move.
 *
 * ## What it touches
 *
 * Two tables. The folders table this migration creates, and the sessions table
 * the practice-folder column was added to (`20260918120000_practice_folders`).
 * No bucket, no cache, no cross-module dep — every function takes the client
 * and its own arguments, so the composition root binds it with `bindDb` alone.
 *
 * ## Ownership
 *
 * The client here is the SERVICE-ROLE client, which BYPASSES RLS. The
 * `user_id` predicate on every statement IS the access control, and it is not
 * optional on any of them — including the reads, where a missing predicate
 * would list another account's folders rather than fail loudly. `study_set_id`
 * rides alongside it on every folder statement because a folder is the SET's,
 * so "my folder, but in a different set" must miss as cleanly as "not mine".
 *
 * ## The gotchas
 *
 * 1. MIGRATION TOLERANCE. 20260918120000 is applied BY HAND and the API ships
 *    first, so every function here runs against a database with no folders
 *    table and no column. Reads DEGRADE (empty list, empty counts) so the hub
 *    renders exactly as it did before the feature; writes REFUSE with
 *    `PracticeFolderSchemaMissingError`, which the route answers 503 with the
 *    migration filename. A write that reported success over a row that never
 *    changed is the failure mode this avoids — the same rule
 *    `SetTileColumnMissingError` follows.
 *
 * 2. DELETING A FOLDER KEEPS ITS CONTENTS. The column is
 *    `ON DELETE SET NULL`, so the delete below unfiles the folder's quizzes
 *    and tests in the same statement rather than taking them with it. Nothing
 *    here unfiles them first, and nothing should: a two-statement version can
 *    fail between them, and the constraint cannot.
 *
 * 3. THE MOVE IS TWO CHECKS, NOT ONE. `folderBelongsToSet` proves the
 *    DESTINATION is this owner's folder in this set; the update's own
 *    `user_id` predicate proves the TEST is this owner's. Dropping either one
 *    lets a caller file somebody else's quiz, or file their own quiz into
 *    somebody else's folder. Both are required parameters for that reason.
 */
import { PublicError } from "../../utils/safeError";
import {
  isMissingSchemaError,
  markPracticeFoldersMissing,
} from "../schemaCapabilities";
import type { DataClient } from "./client";
import { mustWrite } from "./writeResult";

/** The migration a 503 names, so the operator knows exactly what to apply. */
export const PRACTICE_FOLDER_MIGRATION = "20260918120000_practice_folders.sql";

/** Same ceiling study-set folders use: enough to organise, not enough to hoard. */
export const MAX_PRACTICE_FOLDERS = 40;

/** The 80 the table's CHECK constraint enforces. */
export const PRACTICE_FOLDER_TITLE_MAX = 80;

/**
 * The folders migration has not been applied to this database.
 *
 * Not a `PublicError` (which would be a 400, i.e. the student's mistake) and
 * not a bare throw (a 500, i.e. a bug): the route answers 503 and names the
 * file, because the fix is a hand-applied migration and no retry helps.
 */
export class PracticeFolderSchemaMissingError extends Error {
  readonly migration = PRACTICE_FOLDER_MIGRATION;
  constructor() {
    super("Practice folders need a server update — try again later");
    this.name = "PracticeFolderSchemaMissingError";
  }
}

/**
 * Refuse a write whose schema is not there yet, and remember the answer so the
 * next caller does not have to discover it the same way.
 */
function refuseIfSchemaMissing(error: unknown): void {
  if (!isMissingSchemaError(error)) return;
  markPracticeFoldersMissing();
  throw new PracticeFolderSchemaMissingError();
}

/** The columns every read of a folder asks for, spelled out once. */
const FOLDER_COLUMNS = "id, study_set_id, title, created_at, updated_at";

/**
 * One row as every client reads it. Pure and exported for the same reason
 * `mapTestListRow` is: the shape is a contract two clients share, so it is
 * testable on its own and cannot drift between the four routes that return it.
 */
export function mapPracticeFolder(row: any) {
  return {
    id: row.id,
    studySetId: row.study_set_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/** The title the row will hold, or a 400 explaining why there is no row. */
function normalizeTitle(input: unknown): string {
  const title = typeof input === "string" ? input.trim() : "";
  if (!title) {
    throw new PublicError("Name the folder");
  }
  return title.slice(0, PRACTICE_FOLDER_TITLE_MAX);
}

/**
 * This owner's folders in this set, newest first.
 *
 * Degrades to an empty list when the migration is unapplied: a student who
 * cannot yet have folders and a student who has none see the same hub, and
 * neither sees an error.
 */
export async function listPracticeFolders(
  db: DataClient,
  userId: string,
  studySetId: string,
) {
  const { data, error } = await db
    .from("practice_folders")
    .select(FOLDER_COLUMNS)
    .eq("user_id", userId)
    .eq("study_set_id", studySetId)
    .order("created_at", { ascending: false });
  if (error && isMissingSchemaError(error)) {
    markPracticeFoldersMissing();
    return [];
  }
  if (error) throw error;
  return (data || []).map((row: any) => mapPracticeFolder(row));
}

/**
 * How many quizzes and tests sit in each of this set's folders.
 *
 * One grouped read rather than a count per folder: the hub draws every folder
 * card at once, and N+1 counts on a set with a dozen folders is a dozen round
 * trips for one number each. Folders with nothing in them are absent from the
 * map, so the caller reads `counts[id] ?? 0`.
 */
export async function countPracticeFolderItems(
  db: DataClient,
  userId: string,
  studySetId: string,
): Promise<Record<string, number>> {
  const folders = await listPracticeFolders(db, userId, studySetId);
  if (folders.length === 0) return {};
  const ids = folders.map((folder) => folder.id);
  const { data, error } = await db
    .from("test_sessions")
    .select("practice_folder_id")
    .eq("user_id", userId)
    .in("practice_folder_id", ids);
  if (error && isMissingSchemaError(error)) {
    markPracticeFoldersMissing();
    return {};
  }
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data || []) as any[]) {
    const id = row?.practice_folder_id;
    if (typeof id !== "string") continue;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Is `folderId` this owner's folder, in this set?
 *
 * The predicate the move is gated on. `false` covers all three misses — no
 * such folder, somebody else's folder, this owner's folder in a different set
 * — deliberately, so a caller cannot tell which by the answer it gets.
 */
export async function practiceFolderBelongsToSet(
  db: DataClient,
  userId: string,
  studySetId: string,
  folderId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("practice_folders")
    .select("id")
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("study_set_id", studySetId)
    .maybeSingle();
  if (error && isMissingSchemaError(error)) {
    markPracticeFoldersMissing();
    return false;
  }
  if (error) throw error;
  return Boolean(data);
}

/** A new folder in this set. The cap is counted first, so it cannot be raced past by one. */
export async function createPracticeFolder(
  db: DataClient,
  userId: string,
  studySetId: string,
  input: { title?: unknown },
) {
  const title = normalizeTitle(input?.title);
  const existing = await listPracticeFolders(db, userId, studySetId);
  if (existing.length >= MAX_PRACTICE_FOLDERS) {
    throw new PublicError(
      `You can keep at most ${MAX_PRACTICE_FOLDERS} folders in one set`,
    );
  }
  const result = await db
    .from("practice_folders")
    .insert({ user_id: userId, study_set_id: studySetId, title })
    .select(FOLDER_COLUMNS)
    .single();
  refuseIfSchemaMissing(result.error);
  const { data } = mustWrite(result, {
    table: "practice_folders",
    op: "insert",
    userId,
    studySetId,
  });
  return mapPracticeFolder(data);
}

/**
 * Rename one folder. `null` means nothing matched the three predicates, which
 * the route turns into a 404 — the row may not exist, and confirming which is
 * information a caller who does not own it has not earned.
 */
export async function renamePracticeFolder(
  db: DataClient,
  userId: string,
  studySetId: string,
  folderId: string,
  input: { title?: unknown },
) {
  const title = normalizeTitle(input?.title);
  const result = await db
    .from("practice_folders")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("study_set_id", studySetId)
    .select(FOLDER_COLUMNS)
    .maybeSingle();
  refuseIfSchemaMissing(result.error);
  const { data } = mustWrite(result, {
    table: "practice_folders",
    op: "update",
    userId,
    studySetId,
    folderId,
  });
  return data ? mapPracticeFolder(data) : null;
}

/**
 * Delete one folder. Its quizzes and tests are KEPT — the column is
 * `ON DELETE SET NULL`, so they are unfiled by the same statement and land
 * back at the top level of the hub. `false` means nothing matched.
 */
export async function deletePracticeFolder(
  db: DataClient,
  userId: string,
  studySetId: string,
  folderId: string,
): Promise<boolean> {
  const result = await db
    .from("practice_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("study_set_id", studySetId)
    .select("id")
    .maybeSingle();
  refuseIfSchemaMissing(result.error);
  const { data } = mustWrite(result, {
    table: "practice_folders",
    op: "delete",
    userId,
    studySetId,
    folderId,
  });
  return Boolean(data);
}

/**
 * File one quiz or test into a folder, or unfile it with `null`.
 *
 * The caller must ALREADY have proved the destination folder is this owner's
 * and in this set (`practiceFolderBelongsToSet`); this statement proves the
 * TEST is this owner's, via its own `user_id` predicate. `false` means no test
 * of this owner has that id.
 */
export async function setTestPracticeFolder(
  db: DataClient,
  userId: string,
  testId: string,
  folderId: string | null,
): Promise<boolean> {
  const result = await db
    .from("test_sessions")
    .update({ practice_folder_id: folderId })
    .eq("id", testId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  refuseIfSchemaMissing(result.error);
  const { data } = mustWrite(result, {
    table: "test_sessions",
    op: "update",
    userId,
    testId,
    reason: "practice_folder_move",
  });
  return Boolean(data);
}
