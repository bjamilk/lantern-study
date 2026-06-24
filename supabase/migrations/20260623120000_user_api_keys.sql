-- User API keys for programmatic access (hashed secrets; plaintext shown once at creation)

CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{read}',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_api_keys_permissions_check CHECK (
    permissions <@ ARRAY['read', 'write', 'admin']::text[]
  )
);

CREATE INDEX IF NOT EXISTS user_api_keys_prefix_idx
  ON public.user_api_keys (key_prefix)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS user_api_keys_user_id_idx
  ON public.user_api_keys (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_api_keys_service_role ON public.user_api_keys;
CREATE POLICY user_api_keys_service_role ON public.user_api_keys
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_api_keys_select_own ON public.user_api_keys;
CREATE POLICY user_api_keys_select_own ON public.user_api_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND revoked_at IS NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_api_keys TO service_role;
