-- Unified marketplace order pipeline (Bumpa-inspired campus deal flow)

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  offer_id UUID REFERENCES marketplace_offers(id) ON DELETE SET NULL,
  inquiry_id UUID REFERENCES marketplace_inquiries(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES marketplace_transactions(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'buy_now'
    CHECK (source IN ('buy_now', 'offer_accept', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN (
      'pending_payment', 'paid', 'ready_for_pickup', 'buyer_confirmed',
      'completed', 'cancelled', 'disputed'
    )),
  fulfillment_mode TEXT NOT NULL DEFAULT 'campus_meetup'
    CHECK (fulfillment_mode IN ('campus_meetup', 'hall_dropoff')),
  meeting_location TEXT,
  seller_note TEXT,
  seller_confirmed_at TIMESTAMPTZ,
  buyer_confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer ON marketplace_orders(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_seller ON marketplace_orders(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_listing ON marketplace_orders(listing_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON marketplace_orders(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_completed ON marketplace_orders(seller_id, completed_at)
  WHERE status = 'completed';

CREATE OR REPLACE FUNCTION update_marketplace_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_marketplace_orders_updated_at ON marketplace_orders;
CREATE TRIGGER trigger_marketplace_orders_updated_at
  BEFORE UPDATE ON marketplace_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_marketplace_orders_updated_at();

ALTER TABLE marketplace_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view own orders"
  ON marketplace_orders FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

CREATE POLICY "Buyers can create orders"
  ON marketplace_orders FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "Participants can update own orders"
  ON marketplace_orders FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- Allow participants to update transaction status (escrow release/refund)
DROP POLICY IF EXISTS "Users can view own transactions" ON marketplace_transactions;
CREATE POLICY "Users can view own transactions"
  ON marketplace_transactions FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can create transactions" ON marketplace_transactions;
CREATE POLICY "Authenticated users can create transactions"
  ON marketplace_transactions FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "Participants can update own transactions"
  ON marketplace_transactions FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());
