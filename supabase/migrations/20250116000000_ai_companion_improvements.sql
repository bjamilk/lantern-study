-- AI analytics table (ai_companion_messages is created in 20260607000000_security_hardening.sql)

CREATE TABLE IF NOT EXISTS ai_analytics (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event       TEXT        NOT NULL,
  metadata    JSONB       DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_analytics_user_id ON ai_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_analytics_event   ON ai_analytics(event);
CREATE INDEX IF NOT EXISTS idx_ai_analytics_created ON ai_analytics(created_at DESC);

-- RLS: users can only read/write their own analytics rows
ALTER TABLE ai_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own analytics"
  ON ai_analytics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own analytics"
  ON ai_analytics FOR SELECT
  USING (auth.uid() = user_id);
