-- Allow presentation as a note source type (PowerPoint import)

ALTER TABLE notes
  DROP CONSTRAINT IF EXISTS notes_source_type_check;

ALTER TABLE notes
  ADD CONSTRAINT notes_source_type_check
  CHECK (source_type IN ('typed', 'youtube', 'pdf', 'audio', 'import', 'presentation'));
