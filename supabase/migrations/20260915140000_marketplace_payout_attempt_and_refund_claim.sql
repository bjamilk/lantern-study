-- Marketplace money claims: retryable payouts and a refund that cannot double
-- (fix round G3 — findings H1, H2, H3).
--
-- 1. `payout_attempt` — H1. The Paystack transfer reference used to be a pure
--    hash of the order id, so the retry that `transfer.failed` /
--    `transfer.reversed` explicitly enables sent Paystack the reference it had
--    just rejected as a duplicate, forever: the seller could never be paid for
--    that order. The reference is now derived from (order id, attempt) and this
--    counter is incremented only when Paystack has definitively burnt a
--    reference, so it stays deterministic per attempt — a duplicate of the same
--    attempt is still refused by Paystack.
--
-- 2. `refund_hold` on marketplace_orders.payout_status — H3. Refund and payout
--    now compete for ONE claim slot on the order row: the payout CAS takes
--    pending -> paying, the refund CAS takes pending -> refund_hold, and
--    neither can start from the other's state. Before this, the refund merely
--    READ payout_status, so a payout claimed between the read and the refund
--    meant both the buyer and the seller were paid.
--
-- 3. `refunding` on marketplace_payments.status — H2. The refund claim for
--    single-order checkouts. Two concurrent refunds both read 'paid' and both
--    reached Paystack, which is sent no idempotency key of its own, so the
--    buyer was refunded twice.
--
-- Hand-applied (this repo has no automatic migration runner). The API degrades
-- safely without it: `payout_attempt` is only ever WRITTEN back when it is
-- already non-zero, and the two new states simply never occur — the code then
-- behaves as it did before this round, minus the fixes.
--
-- Idempotent: safe to re-apply.

-- 1. Per-attempt payout references ------------------------------------------
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS payout_attempt integer NOT NULL DEFAULT 0;

ALTER TABLE public.marketplace_payments
  ADD COLUMN IF NOT EXISTS payout_attempt integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.marketplace_orders.payout_attempt IS
  'Transfer attempts Paystack has burnt for this order. Incremented ONLY by transfer.failed / transfer.reversed; folded into the deterministic transfer reference so a reversed payout can be retried.';

COMMENT ON COLUMN public.marketplace_payments.payout_attempt IS
  'Transfer attempts Paystack has burnt for this payment (single-order checkout). See marketplace_orders.payout_attempt.';

-- 2. The refund claim on the order row ---------------------------------------
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.marketplace_orders'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%payout_status%'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.marketplace_orders DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payout_status_check
  CHECK (payout_status IN ('pending', 'paying', 'refund_hold', 'paid_out', 'skipped'));

COMMENT ON COLUMN public.marketplace_orders.payout_status IS
  'One claim slot, two directions: pending -> paying (payout, CAS-claimed by exactly one caller) -> paid_out, or pending -> refund_hold (refund) -> skipped. skipped also covers orders that never pay out.';

-- 3. The refund claim on the payment row -------------------------------------
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.marketplace_payments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%'
    AND pg_get_constraintdef(oid) ILIKE '%payout_pending%'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.marketplace_payments DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.marketplace_payments
  ADD CONSTRAINT marketplace_payments_status_check
  CHECK (status IN (
    'initialized',
    'paid',
    'payout_pending',
    'paid_out',
    'refunding',
    'refunded',
    'partially_refunded',
    'failed'
  ));

COMMENT ON COLUMN public.marketplace_payments.status IS
  'initialized -> paid -> payout_pending -> paid_out, or paid -> refunding (the refund claim) -> refunded. refunding is held only while the Paystack refund call is in flight.';
