-- Companion answers keep the sources they were read out of.
--
-- `ai_companion_messages` stored `content` and `actions` but had nowhere to put
-- the citation the model's answer was grounded in, so source chips were
-- live-only: the moment the rail reloaded, the same answer came back as plain
-- prose with "(Excerpt 1)" stranded inside the sentence and nothing to tap. In
-- production that was every observation of the feature, because the rail
-- reloads its thread on mount.
--
-- Shape (written by apps/api-server/src/routes/aiCompanion.ts, validated
-- client-side by normalizeCompanionCitation):
--   { "noteId": uuid, "noteTitle": text, "excerpts": [1, 3, 4] }
-- NULL means the answer was not grounded in a note — a general answer — and
-- must render no chips rather than invented ones.
--
-- The API tolerates this column being absent, so it can be applied at any time
-- without a deploy window; messages written before it lands keep no citations
-- and cannot be back-filled, since the excerpt indexes were never recorded.

ALTER TABLE public.ai_companion_messages
  ADD COLUMN IF NOT EXISTS citations JSONB;

COMMENT ON COLUMN public.ai_companion_messages.citations IS
  'Grounding for an assistant reply: {noteId, noteTitle, excerpts[]}. NULL for ungrounded answers.';
