-- Honest payment states (hand-apply in the Supabase SQL editor).
--
-- Companion to the API change that stops orders being born status='paid':
-- clicking "Pay now" used to create an order already recorded as paid with no
-- money moving (resolveInitialOrderStatus defaulted to 'paid'), the buyer could
-- mark their own order paid, and the seller's "Request payment" button flipped
-- pending_payment to paid as a side effect. The API now creates every order as
-- pending_payment and only two things may assert payment: a verified Paystack
-- settlement, or the seller explicitly confirming receipt.
--
-- This migration adds the evidence column those paths write.

-- When the order actually became paid — set by markPaymentPaid (Paystack
-- settlement) and by the seller's mark_paid attestation. NULL means no payment
-- was ever recorded, which both clients' timelines now render honestly instead
-- of inferring "Paid" from status ordering.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

COMMENT ON COLUMN public.marketplace_orders.paid_at IS
  'When payment was actually recorded: Paystack settlement time, or the moment the seller confirmed receiving payment. NULL = no payment evidence (e.g. cash at pickup that nobody confirmed).';

-- Backfill from real Paystack settlements only. Legacy orders that reached
-- "paid" through the old no-evidence paths stay NULL on purpose: we do not
-- know that money ever moved for them, and stamping them now would fabricate
-- exactly the record this change exists to stop fabricating.
UPDATE public.marketplace_orders o
SET paid_at = p.paid_at
FROM public.marketplace_payments p
WHERE o.payment_id = p.id
  AND o.paid_at IS NULL
  AND p.paid_at IS NOT NULL
  AND p.status IN ('paid', 'payout_pending', 'paid_out');

-- Note on the order-creation RPCs: marketplace_create_buy_now_order and
-- marketplace_create_offer_accept_order still declare p_initial_status DEFAULT
-- 'paid'. Both are EXECUTE-revoked from PUBLIC and granted only to
-- service_role (20260710190000, 20260721130000 et seq.), so the default is
-- unreachable by clients; the API is the enforcement point and now always
-- passes 'pending_payment'. The defaults are left alone here deliberately —
-- recreating the full function bodies in a hand-applied migration risks drift
-- against 20260818120000 for zero access-control gain. Fold a DEFAULT
-- 'pending_payment' into the next migration that has to touch those functions
-- anyway.
