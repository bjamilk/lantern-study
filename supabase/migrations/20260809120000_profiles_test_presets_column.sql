-- Move test presets out of profiles.settings JSONB into a dedicated column
-- so preset saves cannot wipe notifications/study/appearance settings.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS test_presets jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migrate legacy presets nested under settings.test_presets.
UPDATE public.profiles
SET
  test_presets = CASE
    WHEN jsonb_typeof(settings->'test_presets') = 'array' THEN settings->'test_presets'
    ELSE test_presets
  END,
  settings = CASE
    WHEN settings ? 'test_presets' THEN settings - 'test_presets'
    ELSE settings
  END
WHERE
  settings ? 'test_presets'
  OR (jsonb_typeof(settings->'test_presets') = 'array' AND jsonb_array_length(COALESCE(settings->'test_presets', '[]'::jsonb)) > 0);

COMMENT ON COLUMN public.profiles.test_presets IS
  'Saved test configuration presets (array). Kept separate from settings JSONB for CAS safety.';
