-- Bumpa-style address book, seller-quoted shipping, unified checkout.
-- No courier integration. Live rate-shop is a later wave.

ALTER TABLE public.marketplace_seller_preferences
  ADD COLUMN IF NOT EXISTS shipping_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipping_fee_naira numeric(10, 2),
  ADD COLUMN IF NOT EXISTS shipping_free_over_naira numeric(10, 2),
  ADD COLUMN IF NOT EXISTS ships_from_campus_id text,
  ADD COLUMN IF NOT EXISTS ships_from_city text;

ALTER TABLE public.marketplace_seller_preferences
  DROP CONSTRAINT IF EXISTS marketplace_seller_preferences_shipping_fee_check;
ALTER TABLE public.marketplace_seller_preferences
  ADD CONSTRAINT marketplace_seller_preferences_shipping_fee_check
  CHECK (shipping_fee_naira IS NULL OR shipping_fee_naira >= 0);

ALTER TABLE public.marketplace_seller_preferences
  DROP CONSTRAINT IF EXISTS marketplace_seller_preferences_shipping_free_over_check;
ALTER TABLE public.marketplace_seller_preferences
  ADD CONSTRAINT marketplace_seller_preferences_shipping_free_over_check
  CHECK (shipping_free_over_naira IS NULL OR shipping_free_over_naira > 0);

CREATE TABLE IF NOT EXISTS public.marketplace_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text,
  recipient_name text NOT NULL,
  phone text NOT NULL,
  campus_id text,
  city text NOT NULL,
  line1 text NOT NULL,
  line2 text,
  landmark text,
  hall text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_addresses_user_id_idx
  ON public.marketplace_addresses (user_id, is_default DESC, updated_at DESC);

ALTER TABLE public.marketplace_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own marketplace addresses" ON public.marketplace_addresses;
CREATE POLICY "Owners manage own marketplace addresses"
  ON public.marketplace_addresses FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.marketplace_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('draft', 'awaiting_payment', 'paid', 'failed', 'cancelled')),
  item_amount_kobo integer NOT NULL DEFAULT 0 CHECK (item_amount_kobo >= 0),
  shipping_amount_kobo integer NOT NULL DEFAULT 0 CHECK (shipping_amount_kobo >= 0),
  total_charged_kobo integer NOT NULL DEFAULT 0 CHECK (total_charged_kobo >= 0),
  payment_id uuid,
  shipping_address jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_checkouts_buyer_id_idx
  ON public.marketplace_checkouts (buyer_id, created_at DESC);

ALTER TABLE public.marketplace_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyers read own marketplace checkouts" ON public.marketplace_checkouts;
CREATE POLICY "Buyers read own marketplace checkouts"
  ON public.marketplace_checkouts FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid());

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS checkout_id uuid REFERENCES public.marketplace_checkouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_amount numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_address jsonb,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_payout_kobo integer,
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending'
    CHECK (payout_status IN ('pending', 'paid_out', 'skipped'));

CREATE INDEX IF NOT EXISTS marketplace_orders_checkout_id_idx
  ON public.marketplace_orders (checkout_id);

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_fulfillment_mode_check;
ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_fulfillment_mode_check
  CHECK (fulfillment_mode IN ('campus_meetup', 'hall_dropoff', 'digital', 'shipping'));

ALTER TABLE public.marketplace_payments
  ADD COLUMN IF NOT EXISTS checkout_id uuid REFERENCES public.marketplace_checkouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_amount_kobo integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS marketplace_payments_checkout_id_idx
  ON public.marketplace_payments (checkout_id);

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_status_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_status_check
  CHECK (status IN (
    'awaiting_payment',
    'pending_payment',
    'paid',
    'ready_for_pickup',
    'shipped',
    'buyer_confirmed',
    'completed',
    'cancelled',
    'disputed'
  ));
