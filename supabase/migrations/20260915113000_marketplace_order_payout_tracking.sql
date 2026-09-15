-- Marketplace order payout tracking + cancellation compensation (hotfix H4b).
--
-- H4 gave per-order (unified checkout) payouts a CAS claim but nowhere to
-- record WHICH Paystack transfer was claimed, so a later transfer.failed /
-- transfer.reversed had nothing to match on and the order stayed 'paid_out'
-- after the money came back. It also had nowhere to record that a cancellation
-- side effect (refund / escrow void / stock restore) failed after the status
-- had already been flipped.
--
-- Idempotent: safe to re-apply.

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS payout_transfer_code text;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS payout_reference text;

COMMENT ON COLUMN public.marketplace_orders.payout_transfer_code IS
  'Paystack transfer_code for this order''s payout. Set while payout_status = ''paying''; transfer.success / transfer.failed / transfer.reversed webhooks match on it.';

COMMENT ON COLUMN public.marketplace_orders.payout_reference IS
  'Deterministic Paystack transfer reference for this order''s payout, matched when a transfer webhook carries no transfer_code.';

-- A webhook matches on these; without an index every transfer event scans.
CREATE INDEX IF NOT EXISTS marketplace_orders_payout_transfer_code_idx
  ON public.marketplace_orders (payout_transfer_code)
  WHERE payout_transfer_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_orders_payout_reference_idx
  ON public.marketplace_orders (payout_reference)
  WHERE payout_reference IS NOT NULL;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS cancellation_note text;

COMMENT ON COLUMN public.marketplace_orders.cancellation_note IS
  'Set when a cancellation side effect (refund, escrow void, stock restore) failed AFTER the status was claimed as cancelled, so support can finish it by hand.';
