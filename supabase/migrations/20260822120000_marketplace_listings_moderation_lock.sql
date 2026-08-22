-- Lock moderation outcomes on marketplace listings (hand-apply in the Supabase
-- SQL editor — this repo hand-applies migrations; sequence after
-- 20260821140000_budget_recurring_transactions.sql).
--
-- Problem: "Users can update own listings" / "Users can delete own listings"
-- (20260306000000_marketplace_rls_and_reports.sql) let a seller UPDATE any
-- column of their own row — status included — and DELETE it. So once an admin
-- sets status = 'removed_by_admin' / 'suspended_by_admin'
-- (apps/api-server/src/routes/admin.ts: listing remove/suspend, report
-- resolution), the owner could flip it straight back to 'active' with a plain
-- PostgREST UPDATE, rewrite the reported content, or DELETE the row (which
-- cascades marketplace_reports away and lets them relist a copy) — and, before
-- the matching API change, do the same through PUT /marketplace/listings/:id
-- (/status) and DELETE /marketplace/listings/:id. The jobs board already locks
-- its moderated statuses (packages/shared/src/jobs/lifecycle.ts); this is the
-- listing equivalent at the database layer.
--
-- Rules for any writer that is NOT the API (service role), the SQL editor /
-- psql / migrations (login role postgres or supabase_admin) or a superuser:
--   * a row whose status is 'suspended_by_admin' / 'removed_by_admin' is
--     read-only — no column may change except the counters the app bumps
--     (views_count, favorites_count, inquiries_count) and updated_at — and it
--     may not be deleted;
--   * no transition may ENTER a moderated status.
-- The API enforces the seller-side transition table for its own callers
-- (packages/shared/src/marketplace/lifecycle.ts via SupabaseService
-- updateListingStatus / updateMarketplaceListing, the DELETE route and
-- question-bank update-content), and admin routes / order-lifecycle RPCs run as
-- the service role, so they are unaffected.
--
-- Role detection: public.is_service_role_caller() (20260704110000) for the API;
-- session_user for direct sessions. NOTE current_setting('role') is the literal
-- 'none' in a plain session, so it must never be used for the postgres check.
-- session_user is 'authenticator' for every PostgREST request, so the direct-
-- session exemption never widens the client exemption.
--
-- Cascades (2026-08-22 adversarial review): deleting an account
-- (auth.admin.deleteUser → GoTrue) cascades auth.users → profiles →
-- marketplace_listings (user_id ON DELETE CASCADE) and fires the ON DELETE SET
-- NULL actions on takedown_by / appeal_decided_by (20260822140000). Those rows
-- reach this trigger with session_user = 'supabase_auth_admin' (GoTrue's login
-- role) and/or pg_trigger_depth() > 1 (every FK cascade / SET NULL action runs
-- as a nested trigger). Without an exemption a moderated listing raised 42501
-- and the WHOLE account deletion failed. Both are therefore exempt — for the
-- UPDATE and the DELETE branch alike. A direct seller write is depth 1 with
-- session_user 'authenticator', so it stays blocked; a cascade can only
-- originate from a parent row the writer may delete (their own profiles row,
-- i.e. account deletion), which is the intended outcome.

CREATE OR REPLACE FUNCTION public.marketplace_listings_guard_moderated_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old_cmp jsonb;
  v_new_cmp jsonb;
BEGIN
  -- Exemptions (cover BOTH the UPDATE and the DELETE branch below):
  --   * the API (service role), SQL editor / psql / migrations, superusers;
  --   * GoTrue-driven cascades (auth.admin.deleteUser): session_user = 'supabase_auth_admin';
  --   * any FK cascade / SET NULL action: pg_trigger_depth() > 1 — a direct
  --     seller write is depth 1, so this never widens the client exemption.
  IF public.is_service_role_caller()
     OR session_user IN ('postgres', 'supabase_admin')
     OR session_user = 'supabase_auth_admin'
     OR current_setting('is_superuser', true) = 'on'
     OR pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('suspended_by_admin', 'removed_by_admin') THEN
      RAISE EXCEPTION
        'Listing % was taken down by Lantern moderation and cannot be deleted by the seller',
        OLD.id
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status IN ('suspended_by_admin', 'removed_by_admin') THEN
    v_old_cmp := to_jsonb(OLD) - 'views_count' - 'favorites_count' - 'inquiries_count' - 'updated_at';
    v_new_cmp := to_jsonb(NEW) - 'views_count' - 'favorites_count' - 'inquiries_count' - 'updated_at';
    IF v_new_cmp IS DISTINCT FROM v_old_cmp THEN
      RAISE EXCEPTION
        'Listing status % was set by Lantern moderation; the listing is read-only for the seller',
        OLD.status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('suspended_by_admin', 'removed_by_admin')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'Only Lantern moderation can set listing status %',
      NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_status
  ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_guard_moderated_status
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_listings_guard_moderated_status();

DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_delete
  ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_guard_moderated_delete
  BEFORE DELETE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_listings_guard_moderated_status();

-- Rollback:
-- DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_status ON public.marketplace_listings;
-- DROP TRIGGER IF EXISTS marketplace_listings_guard_moderated_delete ON public.marketplace_listings;
-- DROP FUNCTION IF EXISTS public.marketplace_listings_guard_moderated_status();
