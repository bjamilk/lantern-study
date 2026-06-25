-- RLS privilege verification (run via scripts/verify-rls-privileges.ps1 against cloud or local).
-- Documents expected outcomes after 20260625120000_rls_privilege_hardening.sql.
--
-- | Test | Role | Operation | Expected |
-- |------|------|-----------|----------|
-- | profiles escalation | authenticated (self) | UPDATE settings with is_platform_admin | Key stripped; not persisted |
-- | admin_audit_log | authenticated | SELECT | Denied (no grant / no policy) |
-- | platform_admins | authenticated | SELECT | Denied |
-- | favorite milestones | authenticated | INSERT | Denied |
-- | group boundary | member (non-admin) | DELETE other member | Row remains |
-- | group admin | group admin | DELETE member | Success |

-- ---------------------------------------------------------------------------
-- Schema checks (service_role / migration audit)
-- ---------------------------------------------------------------------------

-- Helpers exist
SELECT
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_platform_admin'
  ) AS has_is_platform_admin,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_group_admin'
  ) AS has_is_group_admin,
  EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'profiles' AND t.tgname = 'profiles_strip_privileged_settings'
  ) AS has_profiles_settings_trigger;

-- marketplace_favorite_milestones policy is service_role only
SELECT pol.polname, pol.polroles::regrole[]
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
WHERE cls.relname = 'marketplace_favorite_milestones';

-- groups_update has WITH CHECK
SELECT pol.polname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
WHERE cls.relname = 'groups' AND pol.polname = 'groups_update';

-- authenticated should not have write grants on sensitive tables
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee IN ('authenticated', 'anon')
  AND table_schema = 'public'
  AND table_name IN ('admin_audit_log', 'platform_admins', 'marketplace_favorite_milestones')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'SELECT')
ORDER BY table_name, grantee, privilege_type;
