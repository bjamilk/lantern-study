-- Cover images for decks and notes.
--
-- We persist a storage REFERENCE ("bucket/path", or a bare path in the
-- cover-images bucket), never a signed URL: signed URLs expire after 24h and a
-- stored one turns into a broken image the next day. Clients re-sign on read
-- through POST /api/v1/storage/signed-urls (variant:'thumb' for grids).
--
-- RLS is unchanged on purpose. Both tables are already owner-scoped, and a
-- cover is just another column on a row the owner already controls.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS cover_path text;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS cover_path text;

COMMENT ON COLUMN public.decks.cover_path IS
  'Storage reference for the deck cover image (cover-images bucket, {ownerId}/decks/{deckId}/...). Never a signed URL — clients re-sign via /api/v1/storage/signed-urls.';

COMMENT ON COLUMN public.notes.cover_path IS
  'Storage reference for the note cover image (cover-images bucket, {ownerId}/notes/{noteId}/...). Never a signed URL — clients re-sign via /api/v1/storage/signed-urls.';

-- Study sets carry a cover too (SF2 device pass: StudyFetch gives the SET the
-- picture, and it is the chip in every room header and switcher row). The
-- column is also declared in 20260911130000_study_set_workspace.sql; repeating
-- it here is deliberate — that migration is hand-applied and may not have run
-- on a database that has this one, and IF NOT EXISTS makes the overlap a no-op.
ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS cover_path text;

COMMENT ON COLUMN public.study_sets.cover_path IS
  'Storage reference for the study set cover image (cover-images bucket, {ownerId}/study-sets/{setId}/...). Never a signed URL — clients re-sign via /api/v1/storage/signed-urls.';
