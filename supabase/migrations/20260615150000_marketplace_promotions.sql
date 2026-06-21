-- Listing promotions (scheduled sale price)

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS sale_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS sale_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promo_label TEXT;

ALTER TABLE marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_sale_price_check;

ALTER TABLE marketplace_listings
  ADD CONSTRAINT marketplace_listings_sale_price_check
  CHECK (
    sale_price IS NULL
    OR (sale_price >= 0 AND (price IS NULL OR sale_price < price))
  );

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_on_sale
  ON marketplace_listings(sale_ends_at)
  WHERE sale_price IS NOT NULL AND sale_ends_at IS NOT NULL;
