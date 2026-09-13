-- Companion image attachments
--
-- A student can hand the companion a photo of a page, a slide or a diagram.
-- The chat model itself has no vision path (companionChat goes through the
-- text providers), so the image is READ once at upload time — Tesseract, with
-- the Gemini vision transcriber as the escalation — and it is the extracted
-- TEXT that grounds the answer.
--
-- The text lives here rather than travelling in the chat request because the
-- request body is client-controlled: a forged `extractedText` would be a free
-- prompt-injection channel into the companion. The client sends ids; the
-- server reads the text back out of this table for rows the user owns.
CREATE TABLE IF NOT EXISTS public.companion_image_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  content_type TEXT,
  extracted_text TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  extraction_provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS companion_image_attachments_user_idx
  ON public.companion_image_attachments (user_id, created_at DESC);

ALTER TABLE public.companion_image_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own companion image attachments"
  ON public.companion_image_attachments;
CREATE POLICY "Users read own companion image attachments"
  ON public.companion_image_attachments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own companion image attachments"
  ON public.companion_image_attachments;
CREATE POLICY "Users delete own companion image attachments"
  ON public.companion_image_attachments
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.companion_image_attachments IS
  'Photos attached to an AI companion turn, with the text read out of them at upload time.';
