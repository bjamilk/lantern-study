-- Phase 2 H — AI Study Product Factory: server-generated study-pack drafts.
--
-- A student turns a note / folder / course into a sellable study pack: one AI
-- credit charge enqueues a background job (ai.studyPack.generate) that
-- summarises the sources into a guide, generates flashcards + questions,
-- classifies the course and suggests a price, then leaves a `ready` draft the
-- student reviews and publishes (POST /marketplace/study-packs/publish
-- { draftId }, which flips the draft to `published`).
--
-- Hand-apply AFTER 20260823120000_study_packs.sql (the publish path consumes a
-- ready draft's content, so the packs table must exist first).

CREATE TABLE IF NOT EXISTS public.study_pack_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Provenance: the notes this draft was built from.
  source_note_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  folder_id uuid,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'generating', 'ready', 'failed', 'published')),
  -- The generated study-pack content, same shape as marketplace_study_packs.content:
  --   { guide, summaries, flashcards, questions, weakSections }
  content jsonb,
  counts jsonb,
  suggested_title text,
  suggested_description text,
  suggested_price_kobo integer,
  -- { courseCode, level, semester, institutionId }
  classification jsonb,
  error text,
  job_id text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_pack_drafts_user
  ON public.study_pack_drafts(user_id, created_at DESC);

-- RLS: the owner may READ their drafts (the Drafts screen renders them
-- directly); all writes go through the service role (the generation worker and
-- the routes). Draft content is the student's own material pre-publish.
ALTER TABLE public.study_pack_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_pack_drafts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.study_pack_drafts TO service_role;
CREATE POLICY "Users can view their own study pack drafts"
  ON public.study_pack_drafts FOR SELECT
  USING (auth.uid() = user_id);
GRANT SELECT ON public.study_pack_drafts TO authenticated;

COMMENT ON TABLE public.study_pack_drafts IS
  'AI-generated study-pack drafts (Phase 2 H); reviewed then published into marketplace_study_packs.';
