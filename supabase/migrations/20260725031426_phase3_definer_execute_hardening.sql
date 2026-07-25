-- Phase 3: tighten EXECUTE on SECURITY DEFINER / API-only RPCs.
-- Keep authenticated EXECUTE on RLS helpers used inside policies/views.

-- ---------------------------------------------------------------------------
-- Notes helpers: revoke PUBLIC/anon (RLS still needs authenticated)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.can_read_note(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_note(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_read_note(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_note_collaborator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_note_collaborator(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_note_collaborator(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- API-only DEFINER RPCs: service_role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM anon;
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO service_role;

-- ---------------------------------------------------------------------------
-- marketplace_search_listings: API / service_role only (undo perf_v1 re-grant)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text, uuid, text, text[], boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text, uuid, text, text[], boolean
) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text, uuid, text, text[], boolean
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text, uuid, text, text[], boolean
) TO service_role;
