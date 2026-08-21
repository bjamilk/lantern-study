-- Widen marketplace_listings_status_check to the FULL status vocabulary the app
-- writes (hand-apply in the Supabase SQL editor — this repo hand-applies
-- migrations).
--
-- Primary motivation: deleteMarketplaceListingSafely archives a listing
-- (status = 'archived') instead of cascade-deleting it when only terminal orders
-- (completed/cancelled) remain, so order receipts and payment evidence are
-- preserved (apps/api-server/src/services/supabase.ts). But
-- marketplace_listings_status_check was last defined as
-- ('active','inactive','sold','reserved') in
-- 20260731140000_listing_reserved_on_order.sql and never widened, so the archive
-- UPDATE violates the check and DELETE returns 500 for any listing with a
-- terminal order.
--
-- While fixing that, the constraint is reconciled with EVERY status application
-- code actually persists to marketplace_listings.status, so the CHECK is a true
-- superset and can never fail an otherwise-valid write:
--   active / inactive / sold  — seller endpoint, whitelisted in
--                               routes/marketplace.ts (PUT /listings/:id/status)
--   reserved                  — order lifecycle (offer-accept / buy-now DB fns)
--   archived                  — delete/archive path (supabase.ts)
--   removed_by_admin          — admin remove + report-resolve
--                               (routes/admin.ts: update status='removed_by_admin')
--   suspended_by_admin        — admin suspend (routes/admin.ts)
-- The admin statuses were ALSO missing from the reserved-era constraint, so
-- omitting them here would (a) fail this migration's ADD if any listing is
-- already admin-removed/suspended, and (b) break admin moderation going forward
-- (the next admin remove/suspend UPDATE would violate the new constraint). They
-- are included for that reason, matching the shared listing status union in
-- packages/shared/src/types/index.ts.
--
-- Discovery invariant is unchanged: browse/search queries filter status =
-- 'active', so archived / sold / admin-actioned listings drop out of discovery
-- while their history is preserved.

ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_check;

ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status IN (
    'active',
    'inactive',
    'sold',
    'reserved',
    'archived',
    'suspended_by_admin',
    'removed_by_admin'
  ));
