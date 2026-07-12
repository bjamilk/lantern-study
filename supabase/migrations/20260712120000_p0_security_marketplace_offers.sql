-- P0 F-01: Lock down marketplace_offers client writes; server-only mutations via API service role.
-- Mirrors marketplace_orders / marketplace_transactions hardening in 20260711140000.

DROP POLICY IF EXISTS "Buyers can create offers" ON public.marketplace_offers;
DROP POLICY IF EXISTS "Participants can update offers" ON public.marketplace_offers;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.marketplace_offers FROM authenticated, anon;

GRANT SELECT ON TABLE public.marketplace_offers TO authenticated;

-- SELECT remains governed by "Users can view their own offers" RLS (buyer_id / seller_id).
