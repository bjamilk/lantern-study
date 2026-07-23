-- Keep retained audit rows efficient during profile lifecycle cleanup and make
-- the intentionally service-only RLS posture explicit to database tooling.

CREATE INDEX IF NOT EXISTS idx_chat_message_audit_actor
  ON public.chat_message_audit (actor_id)
  WHERE actor_id IS NOT NULL;

DROP POLICY IF EXISTS chat_message_audit_service_select
  ON public.chat_message_audit;
CREATE POLICY chat_message_audit_service_select
  ON public.chat_message_audit
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS chat_message_audit_service_insert
  ON public.chat_message_audit;
CREATE POLICY chat_message_audit_service_insert
  ON public.chat_message_audit
  FOR INSERT
  TO service_role
  WITH CHECK (true);
