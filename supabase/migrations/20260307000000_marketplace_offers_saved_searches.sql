-- Migration: Add marketplace_offers and saved_searches tables
-- Date: 2026-03-07

-- ============================================================
-- 1. marketplace_offers table
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'countered', 'expired', 'withdrawn')),
    counter_amount DECIMAL(10,2),
    message TEXT,
    parent_offer_id UUID REFERENCES marketplace_offers(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for offers
CREATE INDEX IF NOT EXISTS idx_marketplace_offers_listing ON marketplace_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_offers_buyer ON marketplace_offers(buyer_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_offers_seller ON marketplace_offers(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_offers_status ON marketplace_offers(status);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_marketplace_offers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_marketplace_offers_updated_at
    BEFORE UPDATE ON marketplace_offers
    FOR EACH ROW
    EXECUTE FUNCTION update_marketplace_offers_updated_at();

-- RLS for marketplace_offers
ALTER TABLE marketplace_offers ENABLE ROW LEVEL SECURITY;

-- Buyers and sellers can view their own offers
CREATE POLICY "Users can view their own offers"
    ON marketplace_offers FOR SELECT
    USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- Buyers can create offers
CREATE POLICY "Buyers can create offers"
    ON marketplace_offers FOR INSERT
    WITH CHECK (auth.uid() = buyer_id);

-- Buyers can update (withdraw) and sellers can update (accept/decline/counter) their own offers
CREATE POLICY "Participants can update offers"
    ON marketplace_offers FOR UPDATE
    USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- ============================================================
-- 2. saved_searches table
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}',
    notify BOOLEAN NOT NULL DEFAULT TRUE,
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for saved_searches
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_notify ON saved_searches(user_id, notify) WHERE notify = TRUE;

-- RLS for saved_searches
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own saved searches
CREATE POLICY "Users can view their own saved searches"
    ON saved_searches FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saved searches"
    ON saved_searches FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved searches"
    ON saved_searches FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved searches"
    ON saved_searches FOR DELETE
    USING (auth.uid() = user_id);
