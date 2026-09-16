/**
 * data/coverImages.ts — the cover-image vocabulary shared by decks, notes and
 * study sets.
 *
 * ## Purpose
 *
 * Moved verbatim out of `services/supabase.ts` module scope (monolith lane
 * M1b, step 7). It is not a repository — no queries, no client — just the
 * bucket name, the migration name, the "column is missing" predicate and the
 * two typed errors that let a route answer 503 ("not available yet") instead
 * of a blanket 500. `data/decks.ts` and `data/uploads.ts` both need them, and
 * importing them from the monolith would be a cycle.
 *
 * Every symbol is re-exported from `services/supabase.ts`, so `routes/notes.ts`
 * and `coverImages.test.ts` keep their existing import path.
 *
 * ## The gotcha
 *
 * `isMissingCoverPathColumn` matches BOTH shapes the absence arrives in — the
 * PostgREST `PGRST204` schema-cache message and the Postgres `42703` — and
 * looks in `details`/`hint` as well as `message`. Matching only one of them is
 * how a missing migration became a blank 500.
 */

/** Bucket for deck/note covers. Created by the service role on first upload. */
export const COVER_IMAGE_BUCKET = "cover-images";

/** Named so a 503 can tell the operator exactly what to apply. */
export const COVER_IMAGE_MIGRATION = "20260913120000_cover_images.sql";

/**
 * The cover_path column is missing, i.e. the migration above has not been
 * applied to this database. Callers answer 503 rather than 500 so the client
 * can say "not available yet" instead of "something broke".
 */
export function isMissingCoverPathColumn(
  error:
    | { code?: string; message?: string; details?: string; hint?: string }
    | null
    | undefined,
): boolean {
  if (!error) return false;
  // PostgREST and Postgres describe the same absence two different ways, and
  // the column name can arrive in `details`/`hint` rather than `message`:
  //   - UPDATE through PostgREST: PGRST204 "Could not find the 'cover_path'
  //     column of 'study_sets' in the schema cache" (NOT a Postgres code);
  //   - SELECT that reaches Postgres: 42703 "column decks.cover_path does not
  //     exist".
  // Matching only one of them is how a missing migration became a blank 500.
  const code = String((error as { code?: unknown }).code ?? "");
  const text =
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  if (!text.includes("cover_path")) return false;
  return (
    code === "PGRST204" ||
    code === "42703" ||
    text.includes("schema cache") ||
    text.includes("does not exist")
  );
}

export class CoverColumnMissingError extends Error {
  readonly migration = COVER_IMAGE_MIGRATION;
  constructor() {
    super("Covers need a server update — try again later");
    this.name = "CoverColumnMissingError";
  }
}

/**
 * Storage could not take the bytes: the bucket is absent and could not be
 * created, its policy refuses the write, or the object name collided. A
 * distinct error so the route says "storage", not the blanket 500 that made
 * a missing bucket and a missing column look identical from the client.
 */
export class CoverStorageUnavailableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super("Cover storage is not ready");
    this.name = "CoverStorageUnavailableError";
    this.detail = detail;
  }
}

/** The table each cover kind writes its column on. */
export const COVER_TABLE_BY_KIND: Record<
  "deck" | "note" | "study-set",
  "decks" | "notes" | "study_sets"
> = {
  deck: "decks",
  note: "notes",
  "study-set": "study_sets",
};
