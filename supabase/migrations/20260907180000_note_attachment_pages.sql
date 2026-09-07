-- Page model for note attachments (Wave 0 of the walk-through work).
--
-- Why: every document a student uploads is stored as ONE blob of text on
-- note_attachments.extracted_text. pdfPageOcr.ts already reads a PDF page by
-- page and then joins the pages with "\n\n" and throws the boundaries away, so
-- nothing downstream can say "this sentence is on page 7". Walk-me-through
-- mode, per-page quizzes and the page-scoped honesty clamp all need that
-- boundary back, so it gets a real table rather than a JSONB column: it is read
-- one page at a time and it grows with OCR (bounded by MAX_OCR_PDF_PAGES).
--
-- This changes nothing about existing extraction. extracted_text keeps being
-- written exactly as it is today; these rows are an ADDITION beside it.
--
-- The API feature-detects this table on every path. Until this migration is
-- hand-applied, the pages endpoint reports `available: false` with an empty
-- page list and every writer silently skips — the walk-through UI says the
-- document has not been split into pages yet rather than inventing pages.
--
-- Everything below is idempotent so a partial run can be re-run.

-- ============ 1. the table ============
--
-- PK (attachment_id, page_index) is what makes a re-extraction idempotent: a
-- backfill upserts the same page rather than duplicating it. page_index is
-- 0-based to match the arrays every client indexes with.
--
-- image_path is the storage path of a rendered page image inside the private
-- `note-files` bucket, NOT a URL: signed URLs expire (the chat/board photo
-- regression), so the path is stored and signed per request.

CREATE TABLE IF NOT EXISTS public.note_attachment_pages (
  attachment_id uuid NOT NULL REFERENCES public.note_attachments(id) ON DELETE CASCADE,
  page_index integer NOT NULL CHECK (page_index >= 0),
  text text NOT NULL DEFAULT '',
  image_path text,
  char_count integer NOT NULL DEFAULT 0 CHECK (char_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attachment_id, page_index)
);

COMMENT ON TABLE public.note_attachment_pages IS
  'Per-page text (and optional rendered page image path) for a note attachment. Written by the OCR / text-extraction paths; read by walk-through mode. extracted_text on note_attachments stays the whole-document blob.';
COMMENT ON COLUMN public.note_attachment_pages.page_index IS '0-based page number.';
COMMENT ON COLUMN public.note_attachment_pages.image_path IS
  'Storage path in the private note-files bucket. Signed per request — never store a signed URL.';

-- Listing a document's pages in order is the only read pattern; the PK already
-- serves it, but the explicit index keeps the ordered scan cheap as the table
-- grows past one attachment's worth of rows.
CREATE INDEX IF NOT EXISTS note_attachment_pages_attachment_idx
  ON public.note_attachment_pages (attachment_id, page_index);

-- ============ 2. RLS ============
--
-- Reads follow the attachment, which follows the note — owner, collaborator, or
-- a member of the group the note is shared into. That is exactly the existing
-- note_attachments_select policy (`public.can_read_note(note_id)`), joined one
-- level further out; writing a narrower rule here would hide pages from a
-- collaborator who can already read the whole extracted text.
--
-- The rule is reached through the SECURITY DEFINER helper rather than a
-- hand-written join over notes / note_collaborators / group_members: those
-- tables carry their own policies, and inlining them here is the recursion the
-- 20260725024724 migration removed (42P17).
--
-- Writes are service-role only. Every writer is a server extraction path, and
-- the service role bypasses RLS, so there is deliberately no INSERT/UPDATE
-- policy for `authenticated`: a client must not be able to forge page text that
-- the AI will later treat as document ground truth.

ALTER TABLE public.note_attachment_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_attachment_pages_select ON public.note_attachment_pages;
CREATE POLICY note_attachment_pages_select ON public.note_attachment_pages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.note_attachments a
      WHERE a.id = note_attachment_pages.attachment_id
        AND public.can_read_note(a.note_id)
    )
  );
