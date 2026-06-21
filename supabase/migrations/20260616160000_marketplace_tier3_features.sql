-- Tier 3 marketplace: quantity, payment proof, boost credits, favorite milestones

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0);

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_submitted_at TIMESTAMPTZ;

ALTER TABLE marketplace_seller_preferences
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boost_credits INTEGER NOT NULL DEFAULT 1 CHECK (boost_credits >= 0),
  ADD COLUMN IF NOT EXISTS require_payment_confirmation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS favorite_alert_threshold INTEGER NOT NULL DEFAULT 3 CHECK (favorite_alert_threshold >= 1);

CREATE TABLE IF NOT EXISTS marketplace_favorite_milestones (
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  milestone INTEGER NOT NULL CHECK (milestone > 0),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (listing_id, milestone)
);

ALTER TABLE marketplace_favorite_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages favorite milestones"
  ON marketplace_favorite_milestones FOR ALL
  USING (true)
  WITH CHECK (true);
