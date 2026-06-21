-- AI inference audit log (metadata only — no full prompts)
CREATE TABLE IF NOT EXISTS public.ai_inference_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  token_estimate INTEGER,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_inference_log_user_created
  ON public.ai_inference_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_inference_log_created
  ON public.ai_inference_log(created_at);

ALTER TABLE public.ai_inference_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_inference_log_select_own ON public.ai_inference_log;
CREATE POLICY ai_inference_log_select_own ON public.ai_inference_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS ai_inference_log_insert_service ON public.ai_inference_log;
CREATE POLICY ai_inference_log_insert_service ON public.ai_inference_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.ai_inference_log IS 'Metadata audit trail for AI endpoints; 90-day retention';
