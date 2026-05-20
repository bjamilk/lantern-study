-- Drop the CHECK constraint on marketplace_listings.category to allow custom categories
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_category_check;

-- Create custom_categories table for user-defined marketplace categories
CREATE TABLE IF NOT EXISTS custom_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT custom_categories_name_unique UNIQUE (name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_custom_categories_name ON custom_categories(name);
CREATE INDEX IF NOT EXISTS idx_custom_categories_usage ON custom_categories(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_custom_categories_created_by ON custom_categories(created_by);

-- RLS
ALTER TABLE custom_categories ENABLE ROW LEVEL SECURITY;

-- Anyone can read custom categories
CREATE POLICY "custom_categories_select" ON custom_categories
  FOR SELECT USING (true);

-- Authenticated users can create custom categories
CREATE POLICY "custom_categories_insert" ON custom_categories
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Creator can update their own categories
CREATE POLICY "custom_categories_update" ON custom_categories
  FOR UPDATE USING (created_by = auth.uid());

-- Creator can delete their own categories
CREATE POLICY "custom_categories_delete" ON custom_categories
  FOR DELETE USING (created_by = auth.uid());
