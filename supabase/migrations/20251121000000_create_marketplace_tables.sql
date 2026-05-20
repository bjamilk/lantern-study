-- Create marketplace_listings table
CREATE TABLE marketplace_listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('textbook_exchange', 'pq_bank', 'lecture_notes', 'project_thesis', 'data_collection', 'aso_ebi', 'campus_services', 'equipment_rental', 'accommodation', 'travel_transport', 'personal_goods', 'events_social')),
  title TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  location TEXT,
  images JSONB DEFAULT '[]',
  category_specific_fields JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create marketplace_reviews table
CREATE TABLE marketplace_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create marketplace_reports table
CREATE TABLE marketplace_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT CHECK (reason IN ('scam', 'spam', 'inappropriate', 'other')),
  details TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create marketplace_transactions table for escrow
CREATE TABLE marketplace_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'refunded', 'disputed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance (critical for 300k users)
CREATE INDEX idx_marketplace_listings_user_id ON marketplace_listings(user_id);
CREATE INDEX idx_marketplace_listings_category ON marketplace_listings(category);
CREATE INDEX idx_marketplace_listings_status ON marketplace_listings(status);
CREATE INDEX idx_marketplace_listings_price ON marketplace_listings(price);
CREATE INDEX idx_marketplace_listings_created_at ON marketplace_listings(created_at DESC);
CREATE INDEX idx_marketplace_reviews_listing_id ON marketplace_reviews(listing_id);
CREATE INDEX idx_marketplace_reports_listing_id ON marketplace_reports(listing_id);
CREATE INDEX idx_marketplace_transactions_buyer_id ON marketplace_transactions(buyer_id);
CREATE INDEX idx_marketplace_transactions_seller_id ON marketplace_transactions(seller_id);

-- Full-text search index for global search
CREATE INDEX idx_marketplace_listings_search ON marketplace_listings USING gin(to_tsvector('english', title || ' ' || description));

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_marketplace_listings_updated_at BEFORE UPDATE ON marketplace_listings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();