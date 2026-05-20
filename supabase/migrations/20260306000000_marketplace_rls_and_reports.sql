-- Enable RLS on marketplace tables that were missing it
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_transactions ENABLE ROW LEVEL SECURITY;

-- ============ marketplace_listings policies ============

-- Anyone can view active listings
CREATE POLICY "Anyone can view active listings"
  ON marketplace_listings FOR SELECT
  USING (status = 'active' OR user_id = auth.uid());

-- Authenticated users can create listings
CREATE POLICY "Authenticated users can create listings"
  ON marketplace_listings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update their own listings
CREATE POLICY "Users can update own listings"
  ON marketplace_listings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own listings
CREATE POLICY "Users can delete own listings"
  ON marketplace_listings FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============ marketplace_reviews policies ============

-- Anyone can view reviews
CREATE POLICY "Anyone can view reviews"
  ON marketplace_reviews FOR SELECT
  USING (true);

-- Authenticated users can create reviews
CREATE POLICY "Authenticated users can create reviews"
  ON marketplace_reviews FOR INSERT
  TO authenticated
  WITH CHECK (reviewer_id = auth.uid());

-- Users can update their own reviews
CREATE POLICY "Users can update own reviews"
  ON marketplace_reviews FOR UPDATE
  TO authenticated
  USING (reviewer_id = auth.uid());

-- Users can delete their own reviews
CREATE POLICY "Users can delete own reviews"
  ON marketplace_reviews FOR DELETE
  TO authenticated
  USING (reviewer_id = auth.uid());

-- ============ marketplace_reports policies ============

-- Users can view their own reports
CREATE POLICY "Users can view own reports"
  ON marketplace_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Authenticated users can create reports
CREATE POLICY "Authenticated users can create reports"
  ON marketplace_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- ============ marketplace_transactions policies ============

-- Buyer and seller can view their transactions
CREATE POLICY "Users can view own transactions"
  ON marketplace_transactions FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- Authenticated users can create transactions (as buyer)
CREATE POLICY "Authenticated users can create transactions"
  ON marketplace_transactions FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid());

-- ============ Expand report reason CHECK constraint ============

-- Drop old constraint and add expanded one
ALTER TABLE marketplace_reports DROP CONSTRAINT IF EXISTS marketplace_reports_reason_check;
ALTER TABLE marketplace_reports ADD CONSTRAINT marketplace_reports_reason_check
  CHECK (reason IN ('scam', 'spam', 'inappropriate', 'other'));

-- ============ Add increment_listing_views RPC function ============

CREATE OR REPLACE FUNCTION increment_listing_views(listing_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE marketplace_listings
  SET views_count = COALESCE(views_count, 0) + 1
  WHERE id = listing_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
