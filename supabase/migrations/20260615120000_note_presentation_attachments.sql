-- Allow presentation attachments on notes (PowerPoint uploads with PDF preview)

ALTER TABLE note_attachments
  DROP CONSTRAINT IF EXISTS note_attachments_type_check;

ALTER TABLE note_attachments
  ADD CONSTRAINT note_attachments_type_check
  CHECK (type IN ('pdf', 'audio', 'image', 'youtube', 'presentation'));
