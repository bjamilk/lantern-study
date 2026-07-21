-- Idempotent reaffirmation of audit quick wins already applied:
-- SEC-01/02 RPC privileges, CONC-02 unique test_results.session_id

-- SEC-01: legacy 3-arg search_users must not exist
DROP FUNCTION IF EXISTS public.search_users(text, uuid, integer);

-- SEC-01: privacy-aware overload stays service_role-only
REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.search_users(text, uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(text, uuid, uuid, integer) TO service_role;

-- SEC-02: record_study_activity not callable by anon/authenticated clients
REVOKE ALL ON FUNCTION public.record_study_activity(uuid, text, integer, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_study_activity(uuid, text, integer, date) FROM anon;
REVOKE ALL ON FUNCTION public.record_study_activity(uuid, text, integer, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_study_activity(uuid, text, integer, date) TO service_role;

-- CONC-02: one result row per session
CREATE UNIQUE INDEX IF NOT EXISTS test_results_session_id_unique
  ON public.test_results (session_id);
