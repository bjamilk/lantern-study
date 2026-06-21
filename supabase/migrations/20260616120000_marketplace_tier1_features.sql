-- Tier 1 marketplace features: seller coupons, order discount tracking

CREATE TABLE IF NOT EXISTS marketplace_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL CHECK (discount_value > 0),
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketplace_coupons_seller_code_unique UNIQUE (seller_id, code)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_coupons_seller ON marketplace_coupons(seller_id, active);
CREATE INDEX IF NOT EXISTS idx_marketplace_coupons_code ON marketplace_coupons(UPPER(code));

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES marketplace_coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE marketplace_coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sellers manage own coupons"
  ON marketplace_coupons FOR ALL
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Buyers can read active coupons for validation"
  ON marketplace_coupons FOR SELECT
  USING (active = true);
