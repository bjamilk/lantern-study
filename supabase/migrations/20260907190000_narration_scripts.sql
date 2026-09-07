-- Narration scripts — the storage half of "read this document to me".
--
-- What this feature is NOT: there is no video, no rendered audio file and no
-- text-to-speech vendor anywhere in it. The server writes a SCRIPT — one short
-- spoken paragraph per page of an uploaded document — and the student's own
-- device speaks it (speechSynthesis on web, expo-speech on mobile). So what is
-- stored here is a few kilobytes of text per document, and a deck plays
-- offline once the script and the page images are cached.
--
-- Why its own table rather than a JSONB column on note_attachments: a script
-- belongs to a (document, student) pair, not to the document. Two students who
-- both narrate the same shared note each pay for and own their own script, and
-- one of them regenerating theirs must not overwrite the other's. That is
-- exactly a two-column primary key, and it is also the idempotency key that
-- stops a retry being charged twice.
--
-- The API feature-detects this table on every path, the same way the page model
-- (20260907180000) does. Until this migration is hand-applied the narration
-- routes answer 200 with `available: false` and reason `schema_missing`, and the
-- clients say reading aloud is not available yet rather than charging for a
-- script they cannot store.
--
-- Everything below is idempotent so a partial run can be re-run.

-- ============ 1. the table ============
--
-- PK (attachment_id, user_id) with a separate `version` column: one CURRENT
-- script per student per document. Regenerating bumps `version` in place rather
-- than accumulating rows — a student wants the latest reading, not a history,
-- and an unbounded history of scripts is storage nobody asked for.
--
-- `segments` is the script itself: an array of
--   { pageIndex, order, text, estimatedSeconds, startMs, durationMs }
-- shaped like a transcript segment (the same shape youtubeTranscript.ts uses),
-- with a page index instead of a video offset. It is written whole, read whole,
-- and never queried into, so JSONB is right here where a table was right for
-- note_attachment_pages.
--
-- `credit_cost` records what this run actually charged (2 for ≤20 pages, 3
-- above — packages/shared/src/utils/aiCredits.ts). Stored rather than
-- recomputed so the ledger stays honest if the price ever changes.

CREATE TABLE IF NOT EXISTS public.narration_scripts (
  attachment_id uuid NOT NULL REFERENCES public.note_attachments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  credit_cost integer NOT NULL DEFAULT 0 CHECK (credit_cost >= 0),
  /* Why a run failed, in the student's words. NULL whenever status <> 'failed'. */
  error_message text,
  /* The job that is writing (or wrote) this script, for the progress sheet. */
  job_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attachment_id, user_id)
);

COMMENT ON TABLE public.narration_scripts IS
  'Per-student narration script for one note attachment: the text a device speaks, one segment per page. No audio is stored or generated server-side.';
COMMENT ON COLUMN public.narration_scripts.segments IS
  'Array of { pageIndex, order, text, estimatedSeconds, startMs, durationMs }. Written whole; never queried into.';
COMMENT ON COLUMN public.narration_scripts.version IS
  'Bumped on a deliberate regeneration. (attachment_id, user_id, version) is the idempotency key: a retry at the same version is never charged twice.';
COMMENT ON COLUMN public.narration_scripts.credit_cost IS
  'AI uses this run actually charged, as charged. Recorded, not recomputed.';

-- "What have I had read to me?" is the only list query, and it is per student.
CREATE INDEX IF NOT EXISTS narration_scripts_user_idx
  ON public.narration_scripts (user_id, updated_at DESC);

-- ============ 2. updated_at ============
--
-- Reuses the trigger function the rest of the schema already uses when it
-- exists; otherwise the column simply keeps its insert value, which is honest.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS narration_scripts_set_updated_at ON public.narration_scripts;
    CREATE TRIGGER narration_scripts_set_updated_at
      BEFORE UPDATE ON public.narration_scripts
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- ============ 3. RLS ============
--
-- A student reads their OWN row and nothing else. Deliberately narrower than
-- the page model's rule: pages are the document, which a collaborator can
-- already read in full, but a script is a thing this student paid an AI use
-- for. Sharing it would let one member of a group note spend a credit and the
-- rest read it for free, which is not the deal the counter describes.
--
-- Writes are service-role only (the service role bypasses RLS, so there is
-- deliberately no INSERT/UPDATE policy for `authenticated`): the script is
-- what the device will SPEAK, and a client that could forge it could put words
-- in the app's mouth over a page that says something else.

ALTER TABLE public.narration_scripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS narration_scripts_select ON public.narration_scripts;
CREATE POLICY narration_scripts_select ON public.narration_scripts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Deleting your own script is safe and is how a student clears a bad reading;
-- the next request simply regenerates it (and is charged, which is correct —
-- it is a new run).
DROP POLICY IF EXISTS narration_scripts_delete ON public.narration_scripts;
CREATE POLICY narration_scripts_delete ON public.narration_scripts
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
