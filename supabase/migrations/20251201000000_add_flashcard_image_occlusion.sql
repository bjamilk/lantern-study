-- Add image occlusion support for flashcards

-- Add columns for image-based flashcards
ALTER TABLE flashcards
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS occlusion_data JSONB;

-- Update type constraint to allow the new IMAGE_OCCLUSION card type
ALTER TABLE flashcards
  DROP CONSTRAINT IF EXISTS flashcards_type_check;

ALTER TABLE flashcards
  ADD CONSTRAINT flashcards_type_check
  CHECK (type IN ('BASIC', 'CLOZE', 'IMAGE_OCCLUSION'));

-- Replace existing flashcard field constraints with one that covers all types
ALTER TABLE flashcards
  DROP CONSTRAINT IF EXISTS check_basic_card_fields;

ALTER TABLE flashcards
  DROP CONSTRAINT IF EXISTS check_cloze_card_fields;

ALTER TABLE flashcards
  ADD CONSTRAINT check_flashcard_fields
  CHECK (
    (type = 'BASIC' AND front IS NOT NULL AND back IS NOT NULL) OR
    (type = 'CLOZE' AND cloze_text IS NOT NULL AND front IS NULL AND back IS NULL) OR
    (type = 'IMAGE_OCCLUSION' AND image_url IS NOT NULL AND front IS NOT NULL)
  );
