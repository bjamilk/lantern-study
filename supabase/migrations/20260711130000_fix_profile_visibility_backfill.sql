-- Fix backfill: nested jsonb_set paths do not create missing parent keys (e.g. privacy).

UPDATE public.profiles
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{privacy}',
  COALESCE(settings->'privacy', '{}'::jsonb)
    || jsonb_build_object('profileVisibility', 'public'),
  true
)
WHERE settings IS NULL
   OR settings->'privacy' IS NULL
   OR settings->'privacy'->>'profileVisibility' IS NULL;
