-- Fix flashcard table schema to properly handle BASIC and CLOZE card types
-- Make front nullable for CLOZE cards, and add proper constraints

-- First, drop the existing NOT NULL constraint on front
ALTER TABLE flashcards ALTER COLUMN front DROP NOT NULL;

-- Add check constraints to ensure proper data based on card type
-- For BASIC cards: front and back must be provided
-- For CLOZE cards: cloze_text must be provided
ALTER TABLE flashcards ADD CONSTRAINT check_basic_card_fields
    CHECK (
        (type = 'BASIC' AND front IS NOT NULL AND back IS NOT NULL) OR
        (type = 'CLOZE' AND cloze_text IS NOT NULL)
    );

-- Add check constraint to ensure CLOZE cards don't have front/back fields
ALTER TABLE flashcards ADD CONSTRAINT check_cloze_card_fields
    CHECK (
        (type = 'CLOZE' AND front IS NULL AND back IS NULL) OR
        (type = 'BASIC')
    );