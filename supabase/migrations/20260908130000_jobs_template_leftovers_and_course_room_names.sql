-- Two things the application code cannot reach on its own.
--
-- PENDING HAND-APPLICATION. Nothing here runs until someone applies it.
--
-- 1. Jobs published before the template gate existed.
--
--    The shared gate (`describeJobTemplateLeftovers`, 2026-08-19) refuses a
--    publish whose title or body still holds a "[bracketed placeholder]", and
--    both server publish paths now enforce it — create, update, and (as of
--    this change) school approval. But a gate only guards writes. A posting
--    made BEFORE 2026-08-19 stays live for ever: on device the jobs board's
--    first result was "Internship — [team / function]", with the template's
--    own hint line ("Team, duration, location or remote, stipend if any,
--    start date.") as its whole description.
--
--    Such a posting is returned to `draft`, not deleted and not hidden: the
--    poster keeps it, sees it under "My job posts", and can publish it again
--    the moment the copy is real. Anything already closed, paused or moderated
--    is left exactly as it is.
--
-- 2. Course rooms named "PHARM 212 — PHARM 212".
--
--    `ensure_scope_community` names a derived course room
--    `code || ' — ' || title` (20260824120000). When a course's title is its
--    code again — a very common way to add a course — the room's name doubles.
--    The clients now collapse this at display time (`communityDisplayName`),
--    which is what covers rooms minted after this runs. This pass fixes the
--    names already stored, so the two agree. `ensure_scope_community` is left
--    alone deliberately: it is the source of truth for a room's identity, and
--    rewriting its naming rule is a change to what the row IS, not to what a
--    student reads.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Un-publish job postings whose copy is still template boilerplate.
-- ---------------------------------------------------------------------------

UPDATE public.job_postings
SET status = 'draft',
    updated_at = now()
WHERE status = 'active'
  AND (
    title ~ '\[[^\[\]\n]{1,80}\]'
    OR description ~ '\[[^\[\]\n]{1,80}\]'
  );

-- ---------------------------------------------------------------------------
-- 2. Undo "CODE — CODE" course room names already stored.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collapse_duplicate_scope_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- Em dash only: the separator the derivation uses. A hyphen is ordinary
  -- punctuation in a name a student typed and must never be touched.
  SELECT CASE
    WHEN p_name IS NULL THEN NULL
    WHEN array_length(string_to_array(p_name, ' — '), 1) = 2
     AND lower(btrim(split_part(p_name, ' — ', 1)))
       = lower(btrim(split_part(p_name, ' — ', 2)))
    THEN btrim(split_part(p_name, ' — ', 1))
    ELSE p_name
  END;
$$;

COMMENT ON FUNCTION public.collapse_duplicate_scope_name(text) IS
  'A derived course room is named "code — title". When the title IS the code, say it once.';

UPDATE public.communities
SET name = public.collapse_duplicate_scope_name(name)
WHERE kind = 'course'
  AND name <> public.collapse_duplicate_scope_name(name);

COMMIT;
