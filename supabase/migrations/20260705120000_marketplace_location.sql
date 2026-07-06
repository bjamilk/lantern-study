-- Marketplace structured location + currency
CREATE TABLE IF NOT EXISTS marketplace_campuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'NG',
  slug TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_campuses_country ON marketplace_campuses(country_code);
CREATE INDEX IF NOT EXISTS idx_marketplace_campuses_active ON marketplace_campuses(active);

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS campus_id UUID REFERENCES marketplace_campuses(id),
  ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'NG',
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN';

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_campus_id ON marketplace_listings(campus_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_country_code ON marketplace_listings(country_code);

-- Seed Nigerian campuses
INSERT INTO marketplace_campuses (name, city, state, country_code, slug) VALUES
  ('University of Lagos', 'Lagos', 'Lagos', 'NG', 'university-of-lagos'),
  ('University of Nigeria, Nsukka', 'Nsukka', 'Enugu', 'NG', 'university-of-nigeria-nsukka'),
  ('Obafemi Awolowo University', 'Ile-Ife', 'Osun', 'NG', 'obafemi-awolowo-university'),
  ('University of Ibadan', 'Ibadan', 'Oyo', 'NG', 'university-of-ibadan'),
  ('Ahmadu Bello University', 'Zaria', 'Kaduna', 'NG', 'ahmadu-bello-university'),
  ('University of Benin', 'Benin City', 'Edo', 'NG', 'university-of-benin'),
  ('University of Port Harcourt', 'Port Harcourt', 'Rivers', 'NG', 'university-of-port-harcourt'),
  ('Covenant University', 'Ota', 'Ogun', 'NG', 'covenant-university'),
  ('Babcock University', 'Ilishan-Remo', 'Ogun', 'NG', 'babcock-university'),
  ('Lagos State University', 'Ojo', 'Lagos', 'NG', 'lagos-state-university'),
  ('Federal University of Technology, Akure', 'Akure', 'Ondo', 'NG', 'futa-akure'),
  ('Nnamdi Azikiwe University', 'Awka', 'Anambra', 'NG', 'nnamdi-azikiwe-university'),
  ('University of Jos', 'Jos', 'Plateau', 'NG', 'university-of-jos'),
  ('Bayero University Kano', 'Kano', 'Kano', 'NG', 'bayero-university-kano'),
  ('University of Calabar', 'Calabar', 'Cross River', 'NG', 'university-of-calabar'),
  ('Federal University of Technology, Minna', 'Minna', 'Niger', 'NG', 'fut-minna'),
  ('University of Maiduguri', 'Maiduguri', 'Borno', 'NG', 'university-of-maiduguri'),
  ('Lagos University Teaching Hospital', 'Lagos', 'Lagos', 'NG', 'luth-lagos'),
  ('Yaba College of Technology', 'Yaba', 'Lagos', 'NG', 'yaba-college-of-technology'),
  ('Pan-Atlantic University', 'Lekki', 'Lagos', 'NG', 'pan-atlantic-university')
ON CONFLICT (slug) DO NOTHING;

-- Best-effort backfill campus_id from free-text location
UPDATE marketplace_listings ml
SET campus_id = mc.id
FROM marketplace_campuses mc
WHERE ml.campus_id IS NULL
  AND ml.location IS NOT NULL
  AND (
    ml.location ILIKE '%' || mc.name || '%'
    OR ml.location ILIKE '%' || mc.city || '%'
  );

ALTER TABLE marketplace_campuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_campuses_public_read ON marketplace_campuses;
CREATE POLICY marketplace_campuses_public_read ON marketplace_campuses
  FOR SELECT USING (active = TRUE);
