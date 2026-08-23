-- Phase 3 L follow-up — make the communities SELECT policies reachable.
--
-- 20260824120000 created `communities_select_public` and
-- `community_members_select_own` but never issued a table-level SELECT grant,
-- so no role could exercise them: PostgREST denied every read with 42501
-- (permission denied for table) BEFORE row-level security was consulted, and
-- both policies were dead code.
--
-- This is fail-CLOSED, not a data leak — nothing was over-exposed. The API uses
-- the service role, which bypasses RLS and already held GRANT ALL, so no
-- endpoint was broken by it. What was broken is any direct PostgREST read from
-- a client, which is how the rest of the app reads public tables.
--
-- Matches the grant shape of profile_follows (20260823123000_creators.sql).
-- Idempotent; safe to re-run. 20260824120000 has been corrected too, so a fresh
-- environment gets it right without this file.

GRANT SELECT ON public.communities TO authenticated;
GRANT SELECT ON public.community_members TO authenticated;

-- Writes stay service-role only: a direct INSERT would bypass the auto/joined
-- distinction that the privacy model depends on, and would let a client inflate
-- member_count. Re-revoked here including PUBLIC, which the original omitted.
REVOKE INSERT, UPDATE, DELETE ON public.communities FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_members FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- De-recurse community_members_select_own.
--
-- As originally written the policy contained a subquery over community_members
-- from inside a policy ON community_members. Postgres rejects that at RUNTIME
-- with 42P17 "infinite recursion detected in policy for relation" — it does not
-- fail at CREATE POLICY time, so the migration applied cleanly and the fault
-- only appears on the first read. The missing SELECT grant above was masking
-- it: every read died at 42501 before RLS ran. Granting SELECT without this
-- would have traded a dead policy for a recursion error.
--
-- Own rows only. Co-member rosters come from GET /communities/:id/members,
-- which runs as the service role and does the membership check in code.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS community_members_select_own ON public.community_members;
CREATE POLICY community_members_select_own ON public.community_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
