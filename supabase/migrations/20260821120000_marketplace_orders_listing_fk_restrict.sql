-- Defense-in-depth for the listing-delete data-loss defect (hand-apply in the
-- Supabase SQL editor — this repo hand-applies migrations; DO NOT run in the
-- delete hot path).
--
-- marketplace_orders.listing_id was created ON DELETE CASCADE
-- (20260615140000_marketplace_orders.sql), so deleting a listing hard-deletes
-- every order on it — including paid/completed orders with their receipts and
-- payment evidence. The API now guards this at the application layer
-- (deleteMarketplaceListingSafely: block while orders are open, archive when
-- only terminal orders exist, hard-delete only when there are none). This
-- migration makes the database itself refuse a destructive cascade, so a stray
-- raw DELETE (a future code path, an admin console, a manual query) can never
-- silently shred order history again.
--
-- RESTRICT: the delete fails if any order still references the listing. The
-- application path deletes only listings with zero orders, so it is unaffected.

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_listing_id_fkey;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_listing_id_fkey
  FOREIGN KEY (listing_id)
  REFERENCES public.marketplace_listings(id)
  ON DELETE RESTRICT;
