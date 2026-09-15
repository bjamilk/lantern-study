-- Paystack settlement hardening (hotfix H4).
--
-- 1. Two-phase webhook dedupe: the claim row is written with processed_at NULL
--    and stamped only after processing succeeds, so a crash mid-processing no
--    longer turns every Paystack retry into a silent "duplicate" no-op.
-- 2. A 'paying' state for per-order payouts, so a compare-and-set claim can
--    make exactly one caller transfer money for an order.
-- 3. Failure reasons and the Paystack key mode, so a stuck payout or a
--    cross-mode settlement is visible instead of silent.
--
-- Idempotent: safe to re-apply.

-- 1. paystack_webhook_events.processed_at becomes a completion stamp ---------
ALTER TABLE public.paystack_webhook_events
  ALTER COLUMN processed_at DROP DEFAULT;

ALTER TABLE public.paystack_webhook_events
  ALTER COLUMN processed_at DROP NOT NULL;

-- Finding unfinished claims (a retry, or reconciliation) must not scan.
CREATE INDEX IF NOT EXISTS paystack_webhook_events_unprocessed_idx
  ON public.paystack_webhook_events (created_at)
  WHERE processed_at IS NULL;

COMMENT ON COLUMN public.paystack_webhook_events.processed_at IS
  'NULL = claimed but not yet processed (a retry may re-process it); set = handled, later deliveries are true duplicates.';

-- 2. Per-order payout claim state -------------------------------------------
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
  CHECK (payout_status IN ('pending', 'paying', 'paid_out', 'skipped'));

COMMENT ON COLUMN public.marketplace_orders.payout_status IS
  'pending -> paying (CAS-claimed by exactly one caller) -> paid_out; skipped for orders that never pay out.';

-- 3. Diagnosable failures and Paystack key mode ------------------------------
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS payout_failed_reason text;

ALTER TABLE public.marketplace_payments
  ADD COLUMN IF NOT EXISTS payout_failed_reason text;

ALTER TABLE public.marketplace_payments
  ADD COLUMN IF NOT EXISTS paystack_mode text
    CHECK (paystack_mode IS NULL OR paystack_mode IN ('live', 'test'));

COMMENT ON COLUMN public.marketplace_payments.paystack_mode IS
  'Which Paystack secret key opened this session. Settlement refuses a row whose mode differs from the running server (NULL = legacy row, predates the stamp).';
