-- P3: Client message IDs for deduplication and advisory locks for idempotency races.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT;

ALTER TABLE public.dm_messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_group_client_message_id
  ON public.messages (group_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_messages_thread_client_message_id
  ON public.dm_messages (thread_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Serialize concurrent idempotency claims for the same user/operation/key.
CREATE OR REPLACE FUNCTION public.claim_idempotency_lock(
  p_user_id UUID,
  p_operation TEXT,
  p_idempotency_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_key BIGINT;
BEGIN
  lock_key := hashtextextended(
    coalesce(p_user_id::text, '') || '|' || coalesce(p_operation, '') || '|' || coalesce(p_idempotency_key, ''),
    0
  );
  PERFORM pg_advisory_xact_lock(lock_key);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_idempotency_lock(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_idempotency_lock(UUID, TEXT, TEXT) TO service_role;
