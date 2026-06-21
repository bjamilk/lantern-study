-- Tier 2 marketplace: bundles, seller preferences, campaign log

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS listing_kind TEXT NOT NULL DEFAULT 'single'
    CHECK (listing_kind IN ('single', 'bundle')),
  ADD COLUMN IF NOT EXISTS bundle_items JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS marketplace_seller_preferences (
  seller_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  hall_dropoff_enabled BOOLEAN NOT NULL DEFAULT false,
  hall_dropoff_min_amount DECIMAL(10,2) CHECK (hall_dropoff_min_amount IS NULL OR hall_dropoff_min_amount > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_campaign_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  segment TEXT,
  message_preview TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_campaign_log_seller_day
  ON marketplace_campaign_log(seller_id, created_at DESC);

ALTER TABLE marketplace_seller_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_campaign_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sellers manage own marketplace preferences"
  ON marketplace_seller_preferences FOR ALL
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Anyone can read seller pickup preferences"
  ON marketplace_seller_preferences FOR SELECT
  USING (true);

CREATE POLICY "Sellers read own campaign log"
  ON marketplace_campaign_log FOR SELECT
  USING (auth.uid() = seller_id);

CREATE POLICY "Sellers insert own campaign log"
  ON marketplace_campaign_log FOR INSERT
  WITH CHECK (auth.uid() = seller_id);
