-- Marketplace Inquiries table (links DMs to listings)
CREATE TABLE IF NOT EXISTS marketplace_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  dm_thread_id TEXT REFERENCES dm_threads(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'negotiating', 'closed', 'purchased')),
  initial_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(listing_id, buyer_id)
);

-- Marketplace Favorites table
CREATE TABLE IF NOT EXISTS marketplace_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, listing_id)
);

-- Add views_count to marketplace_listings
ALTER TABLE marketplace_listings 
ADD COLUMN IF NOT EXISTS views_count INTEGER DEFAULT 0;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_marketplace_inquiries_listing ON marketplace_inquiries(listing_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_inquiries_seller ON marketplace_inquiries(seller_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_inquiries_buyer ON marketplace_inquiries(buyer_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_favorites_user ON marketplace_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_favorites_listing ON marketplace_favorites(listing_id);

-- Enable RLS
ALTER TABLE marketplace_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_favorites ENABLE ROW LEVEL SECURITY;

-- RLS policies for inquiries
CREATE POLICY "Users can view their own inquiries" ON marketplace_inquiries
  FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "Buyers can create inquiries" ON marketplace_inquiries
  FOR INSERT WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Participants can update inquiries" ON marketplace_inquiries
  FOR UPDATE USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- RLS policies for favorites
CREATE POLICY "Users can view their own favorites" ON marketplace_favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own favorites" ON marketplace_favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own favorites" ON marketplace_favorites
  FOR DELETE USING (auth.uid() = user_id);
