-- Promote purpose-tagged topic rooms to their real kind.
--
-- 20260908120000 widened communities.kind. Student-made rooms created before
-- that (and any created while the CHECK still refused new kinds) are filed as
-- `topic` with the purpose as a tag. Chips then had to retry without kind.
-- This writes the real kind so Hostel / Clubs / Events queries hit the column.
--
-- SAFE TO RE-RUN. The CHECK is re-asserted first so a host that has not
-- applied governance yet does not write a kind the old constraint would reject.

ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_kind_check;

ALTER TABLE public.communities
  ADD CONSTRAINT communities_kind_check CHECK (kind IN (
    'institution', 'programme', 'level', 'course',
    'topic', 'interest', 'club', 'hostel', 'event', 'faith', 'sports', 'general'
  ));

UPDATE public.communities
SET kind = CASE
  WHEN tags @> ARRAY['club']::text[] THEN 'club'
  WHEN tags @> ARRAY['hostel']::text[] THEN 'hostel'
  WHEN tags @> ARRAY['event']::text[] THEN 'event'
  WHEN tags @> ARRAY['faith']::text[] THEN 'faith'
  WHEN tags @> ARRAY['sports']::text[] OR tags @> ARRAY['sport']::text[] THEN 'sports'
  WHEN tags @> ARRAY['interest']::text[] THEN 'interest'
  ELSE kind
END
WHERE kind = 'topic'
  AND tags IS NOT NULL
  AND tags && ARRAY['club', 'hostel', 'event', 'faith', 'sports', 'sport', 'interest']::text[];
