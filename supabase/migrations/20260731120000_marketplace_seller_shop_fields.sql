-- Light shop storefront: branding fields on marketplace_seller_preferences

ALTER TABLE public.marketplace_seller_preferences
  ADD COLUMN IF NOT EXISTS shop_name text,
  ADD COLUMN IF NOT EXISTS shop_bio text,
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS shop_updated_at timestamptz;

-- Ensure a prefs row exists for every user who has listed
INSERT INTO public.marketplace_seller_preferences (seller_id, shop_name)
SELECT DISTINCT l.user_id, COALESCE(NULLIF(TRIM(p.name), ''), 'Shop')
FROM public.marketplace_listings l
JOIN public.profiles p ON p.id = l.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketplace_seller_preferences sp WHERE sp.seller_id = l.user_id
)
ON CONFLICT (seller_id) DO NOTHING;

-- Backfill shop_name from profile when missing
UPDATE public.marketplace_seller_preferences sp
SET shop_name = COALESCE(NULLIF(TRIM(p.name), ''), 'Shop'),
    shop_updated_at = COALESCE(sp.shop_updated_at, NOW())
FROM public.profiles p
WHERE sp.seller_id = p.id
  AND (sp.shop_name IS NULL OR TRIM(sp.shop_name) = '');

COMMENT ON COLUMN public.marketplace_seller_preferences.shop_name IS
  'Public shop display name; defaults to profile name.';
COMMENT ON COLUMN public.marketplace_seller_preferences.shop_bio IS
  'Short public shop about text (optional).';
COMMENT ON COLUMN public.marketplace_seller_preferences.cover_image_url IS
  'Optional cover image path/URL for the seller shop page.';
