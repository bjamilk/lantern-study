-- A study set's tile art, chosen rather than derived.
--
-- Until now a set's pastel hue and glyph came only from a hash of its id
-- (packages/shared/src/study/setPresentation.ts). That gives every set a
-- stable identity for free, which is the right DEFAULT — but it is not a
-- choice, and the reference lets a student pick: this one is the mint
-- monitor, that one the peach lightbulb. Two columns hold the pick.
--
-- NULL is the normal state and means "derive it", so an existing database
-- needs no backfill and a set nobody has customised keeps exactly the tile it
-- has today. Clearing a pick writes NULL again rather than freezing the hash's
-- answer into the row — a reset must go back to deriving, not to a snapshot.
--
-- Precedence the clients render with, unchanged by this migration except for
-- the middle rung: cover picture > chosen tile > hashed tile.
--
-- The CHECKs name the six values each column accepts. They are the same six
-- the shared module exports, and they are duplicated here on purpose: the API
-- validates the PATCH, but the API is not the only thing that can write this
-- table, and a hue of 'chartreuse' would render as a missing key on every
-- surface at once rather than as a rejected write.
--
-- RLS is unchanged. `study_sets` is already owner-scoped and tile art is just
-- another column on a row its owner already controls.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS tile_hue text;

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS tile_glyph text;

-- `IF NOT EXISTS` does not exist for constraints, so the re-run guard is a
-- catalog check. DROP-then-ADD would briefly leave the table unconstrained and
-- would fail differently if a bad row had been written in between.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.study_sets'::regclass
      AND conname = 'study_sets_tile_hue_check'
  ) THEN
    ALTER TABLE public.study_sets
      ADD CONSTRAINT study_sets_tile_hue_check
      CHECK (tile_hue IS NULL OR tile_hue IN ('mint', 'peach', 'lilac', 'lime', 'sky', 'butter'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.study_sets'::regclass
      AND conname = 'study_sets_tile_glyph_check'
  ) THEN
    ALTER TABLE public.study_sets
      ADD CONSTRAINT study_sets_tile_glyph_check
      CHECK (tile_glyph IS NULL OR tile_glyph IN ('layers', 'monitor', 'lightbulb', 'book', 'flask', 'globe'));
  END IF;
END
$$;

COMMENT ON COLUMN public.study_sets.tile_hue IS
  'Chosen tile pastel (mint|peach|lilac|lime|sky|butter). NULL means derive it from the set id — see packages/shared/src/study/setPresentation.ts. A cover image still wins over both.';

COMMENT ON COLUMN public.study_sets.tile_glyph IS
  'Chosen tile glyph (layers|monitor|lightbulb|book|flask|globe). NULL means derive it from the set id and title.';
