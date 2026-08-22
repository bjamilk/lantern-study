-- Library search indexes (Phase 1 · B of docs/PLAN-2026-08-22-knowledge-network.md;
-- contract docs/phase1-library-archive-contract.md §1). Hand-apply in the
-- Supabase SQL editor — this repo hand-applies migrations; sequence after
-- 20260822130000_academic_identity_and_courses.sql.
--
-- Why: GET /api/v1/library/search unions ILIKE '%q%' matches across notes,
-- decks, flashcards and offline bundles for the caller. Every query is
-- owner-scoped (user_id = caller, or a collaborator row), so the planner
-- usually walks the per-user btree first — but the trigram indexes below let it
-- satisfy `%q%` on the text columns without a sequential rescan of large
-- decks/notebooks, and they are what the cross-user library search of a later
-- phase (campus-wide notes discovery) will lean on. pg_trgm is already enabled
-- (20260601010000_marketplace_indexed_search.sql); the CREATE EXTENSION is a
-- no-op guard.
--
-- Idempotent: every statement is IF NOT EXISTS.
--
-- Indexed columns (GIN, gin_trgm_ops):
--   notes.title                      — note titles
--   left(notes.body, 4000)           — expression index bounding the size of
--                                      note bodies we index (a 200 KB body would
--                                      otherwise bloat the GIN index and slow
--                                      every note save). NOTE: PostgREST's
--                                      `body.ilike.%q%` does not match this
--                                      expression, so today it only serves a
--                                      query written as `left(body, 4000) ILIKE`
--                                      (i.e. an RPC); it is created now so the
--                                      RPC/search upgrade needs no migration.
--   decks.name, flashcards.front, flashcards.back, offline_bundles.display_name
--   (+ offline_bundles.group_name — the search matches it too and it is NOT
--    NULL on every row; display_name is nullable).
--
-- Not indexed: note_attachments.extracted_text (whole-document OCR/PDF text;
-- a trigram index on it would dwarf the table — the attachment branch of the
-- search stays owner-scoped + sequential) and notes.summary (short, rarely
-- the only match).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Notes
CREATE INDEX IF NOT EXISTS notes_title_trgm_idx
  ON public.notes USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS notes_body_head_trgm_idx
  ON public.notes USING gin (left(body, 4000) gin_trgm_ops);

-- Decks + flashcards
CREATE INDEX IF NOT EXISTS decks_name_trgm_idx
  ON public.decks USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS flashcards_front_trgm_idx
  ON public.flashcards USING gin (front gin_trgm_ops);

CREATE INDEX IF NOT EXISTS flashcards_back_trgm_idx
  ON public.flashcards USING gin (back gin_trgm_ops);

-- Offline bundles (display_name is the user-assigned name; group_name the source group)
CREATE INDEX IF NOT EXISTS offline_bundles_display_name_trgm_idx
  ON public.offline_bundles USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS offline_bundles_group_name_trgm_idx
  ON public.offline_bundles USING gin (group_name gin_trgm_ops);

-- Owner-scoped search walks: (user_id) already exists on notes
-- (idx_notes_user_updated), decks and offline_bundles (idx_offline_bundles_user_id);
-- flashcards are reached through decks(id) — its PK. Collaborator lookups use
-- the (note_id, user_id) / (deck_id, user_id) primary keys, so a user_id-led
-- index makes "what do I collaborate on" cheap:
CREATE INDEX IF NOT EXISTS note_collaborators_user_idx
  ON public.note_collaborators (user_id);

CREATE INDEX IF NOT EXISTS deck_collaborators_user_idx
  ON public.deck_collaborators (user_id);

-- Rollback (manual):
-- DROP INDEX IF EXISTS public.deck_collaborators_user_idx;
-- DROP INDEX IF EXISTS public.note_collaborators_user_idx;
-- DROP INDEX IF EXISTS public.offline_bundles_group_name_trgm_idx;
-- DROP INDEX IF EXISTS public.offline_bundles_display_name_trgm_idx;
-- DROP INDEX IF EXISTS public.flashcards_back_trgm_idx;
-- DROP INDEX IF EXISTS public.flashcards_front_trgm_idx;
-- DROP INDEX IF EXISTS public.decks_name_trgm_idx;
-- DROP INDEX IF EXISTS public.notes_body_head_trgm_idx;
-- DROP INDEX IF EXISTS public.notes_title_trgm_idx;
