-- SEC-10: Supabase advisor remediations
-- - member_profiles SECURITY DEFINER → security_invoker
-- - mutable search_path on flagged functions
-- - revoke EXECUTE on DEFINER RPCs that must not be client-callable
--
-- Note: leaked password protection (auth_leaked_password_protection) is a
-- Dashboard Auth setting (Pro+ entitlement). Enable at:
-- Authentication → Providers → Email → Prevent use of leaked passwords.

-- ---------------------------------------------------------------------------
-- ERROR: member_profiles security definer view
-- Recreate as security_invoker. profiles RLS remains owner-only SELECT, so
-- this view cannot bypass RLS / leak phone+settings (intentional).
-- Co-member discovery stays on the API (service_role), not PostgREST.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.member_profiles;
CREATE VIEW public.member_profiles
WITH (security_barrier = true, security_invoker = true) AS
SELECT
  id,
  name,
  first_name,
  last_name,
  username,
  avatar_url,
  points,
  stats,
  badges,
  created_at,
  last_seen_at
FROM public.profiles
WHERE public.profile_visible_to(id);

COMMENT ON VIEW public.member_profiles IS
  'Privacy-safe profile columns; security_invoker respects profiles RLS.';

GRANT SELECT ON public.member_profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- WARN: function_search_path_mutable — pin search_path
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.get_unread_counts_batch(uuid) SET search_path = public;
ALTER FUNCTION public.get_group_stats_batch(uuid) SET search_path = public;
ALTER FUNCTION public.get_dm_unread_counts_batch(uuid) SET search_path = public;
ALTER FUNCTION public.get_flashcard_due_counts(uuid) SET search_path = public;
ALTER FUNCTION public.mark_group_as_read(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.mark_dm_as_read(uuid, text) SET search_path = public;
ALTER FUNCTION public.is_username_available(text) SET search_path = public;
ALTER FUNCTION public.increment_listing_views(uuid) SET search_path = public;
ALTER FUNCTION public.update_marketplace_offers_updated_at() SET search_path = public;
ALTER FUNCTION public.marketplace_listings_search_vector_trigger() SET search_path = public;
ALTER FUNCTION public.update_marketplace_orders_updated_at() SET search_path = public;
ALTER FUNCTION public.marketplace_search_listings(text, integer, integer, text, numeric, numeric, text, text, text)
  SET search_path = public;
ALTER FUNCTION public.bump_flashcard_version() SET search_path = public;
ALTER FUNCTION public.bump_note_version() SET search_path = public;
ALTER FUNCTION public.bump_profile_settings_version() SET search_path = public;

-- ---------------------------------------------------------------------------
-- WARN: anon/authenticated EXECUTE on trigger / internal DEFINER functions
-- Keep is_username_available executable (signup / username check).
-- Keep is_group_member / profile_visible_to* for RLS + API (authenticated).
-- ---------------------------------------------------------------------------

-- Trigger-only: never call via PostgREST (owner/trigger retain EXECUTE)
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

REVOKE ALL ON FUNCTION public.sync_message_vote_counts_from_vote() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_message_vote_counts_from_vote() FROM anon;
REVOKE ALL ON FUNCTION public.sync_message_vote_counts_from_vote() FROM authenticated;

-- API uses service_role for these
REVOKE ALL ON FUNCTION public.increment_listing_views(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_listing_views(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.increment_listing_views(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_listing_views(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_study_activity(uuid, text, integer, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_study_activity(uuid, text, integer, date) FROM anon;
REVOKE ALL ON FUNCTION public.record_study_activity(uuid, text, integer, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_study_activity(uuid, text, integer, date) TO service_role;

-- Helper RPCs: no anonymous direct calls; authenticated kept for RLS / policies
REVOKE ALL ON FUNCTION public.is_group_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.profile_visible_to(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_visible_to(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_visible_to(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) TO authenticated, service_role;

-- Username check remains available to anon (pre-auth signup)
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated, service_role;
