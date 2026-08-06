-- Paystack marketplace payments: seller payout profiles, payment rows, webhook dedupe.
-- Soft escrow (marketplace_transactions) remains for legacy orders; new checkouts use marketplace_payments.

CREATE TABLE IF NOT EXISTS public.marketplace_seller_payout_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  paystack_recipient_code text UNIQUE,
  bank_code text,
  account_number_last4 text,
  account_name text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketplace_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.marketplace_orders(id) ON DELETE SET NULL,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_amount_kobo integer NOT NULL CHECK (item_amount_kobo >= 0),
  service_fee_kobo integer NOT NULL CHECK (service_fee_kobo >= 0),
  total_charged_kobo integer NOT NULL CHECK (total_charged_kobo >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  paystack_reference text NOT NULL UNIQUE,
  paystack_access_code text,
  paystack_transaction_id text,
  status text NOT NULL DEFAULT 'initialized'
    CHECK (status IN (
      'initialized',
      'paid',
      'payout_pending',
      'paid_out',
      'refunded',
      'partially_refunded',
      'failed'
    )),
  paid_at timestamptz,
  payout_transfer_code text,
  payout_at timestamptz,
  refund_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_payments_total_matches
    CHECK (total_charged_kobo = item_amount_kobo + service_fee_kobo)
);

CREATE INDEX IF NOT EXISTS marketplace_payments_order_id_idx
  ON public.marketplace_payments (order_id);
CREATE INDEX IF NOT EXISTS marketplace_payments_buyer_id_idx
  ON public.marketplace_payments (buyer_id);
CREATE INDEX IF NOT EXISTS marketplace_payments_seller_id_idx
  ON public.marketplace_payments (seller_id);
CREATE INDEX IF NOT EXISTS marketplace_payments_status_idx
  ON public.marketplace_payments (status);

-- Optional link from order → payment (legacy orders keep payment_id null)
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.marketplace_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS marketplace_orders_payment_id_idx
  ON public.marketplace_orders (payment_id)
  WHERE payment_id IS NOT NULL;

-- Allow awaiting_payment for Paystack-initialized orders (extend check if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'marketplace_orders_status_check'
      AND conrelid = 'public.marketplace_orders'::regclass
  ) THEN
    ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_status_check;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_status_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_status_check
  CHECK (status IN (
    'awaiting_payment',
    'pending_payment',
    'paid',
    'ready_for_pickup',
    'buyer_confirmed',
    'completed',
    'cancelled',
    'disputed'
  ));

CREATE TABLE IF NOT EXISTS public.paystack_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload_hash text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paystack_webhook_events_type_idx
  ON public.paystack_webhook_events (event_type);

-- Lock down: service_role only (API). No client INSERT/UPDATE/DELETE.
ALTER TABLE public.marketplace_seller_payout_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paystack_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketplace_seller_payout_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketplace_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.paystack_webhook_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.marketplace_seller_payout_profiles TO service_role;
GRANT ALL ON public.marketplace_payments TO service_role;
GRANT ALL ON public.paystack_webhook_events TO service_role;

COMMENT ON TABLE public.marketplace_payments IS
  'Paystack marketplace charges: buyer pays item+5% fee; seller payout on confirm_received.';
COMMENT ON TABLE public.marketplace_seller_payout_profiles IS
  'Paystack Transfer recipients for marketplace sellers.';
