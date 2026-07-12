-- P0 Auth-02: Lock down marketplace_inquiries client writes; server-only mutations via API service role.
-- Mirrors marketplace_offers hardening in 20260712120000.

DROP POLICY IF EXISTS "Buyers can create inquiries" ON public.marketplace_inquiries;
DROP POLICY IF EXISTS "Participants can update inquiries" ON public.marketplace_inquiries;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.marketplace_inquiries FROM authenticated, anon;

GRANT SELECT ON TABLE public.marketplace_inquiries TO authenticated;

-- SELECT remains governed by "Users can view their own inquiries" RLS (buyer_id / seller_id).
