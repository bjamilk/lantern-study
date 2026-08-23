-- Phase 3 L — Communities + discovery.
--
-- A community is the *place* a campus network happens: everyone at UNILAG,
-- everyone on MBBS 300-level, everyone taking PHM 201, plus horizontal
-- interest communities anyone can join.
--
-- Membership has two sources:
--   'auto'   — derived from profiles.institution_id / programme / study_level
--              and user_courses. Recomputed by refresh_auto_communities().
--   'joined' — an affirmative act by the user (horizontal communities, or
--              opting into a community outside their derived set).
--
-- The distinction matters for privacy: only 'joined' membership widens
-- profile_visible_to_viewer's "groups" tier (see §6). Auto-derived membership
-- must NOT make a private-ish profile visible to a whole university.
--
-- Hand-apply order: this is the FIRST Phase 3 migration. Apply before
-- 20260824121000_activity_feed_presence.sql.

-- ============ 1. communities ============

CREATE TABLE IF NOT EXISTS public.communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('institution', 'programme', 'level', 'course', 'topic')),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  -- Scope keys. Which ones are set depends on `kind`; the partial unique
  -- indexes below keep one canonical community per scope.
  institution_id uuid REFERENCES public.marketplace_campuses(id) ON DELETE CASCADE,
  programme text,
  study_level smallint CHECK (study_level BETWEEN 100 AND 900),
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  tags text[] NOT NULL DEFAULT '{}',
  -- 'derived' communities are auto-populated and cannot be left permanently
  -- (leaving is honoured, but refresh_auto_communities re-adds unless opted out).
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  is_official boolean NOT NULL DEFAULT false,
  member_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One canonical community per scope. COALESCE onto sentinels so NULL scope
-- keys still collide (Postgres treats NULLs as distinct in unique indexes).
CREATE UNIQUE INDEX IF NOT EXISTS communities_institution_uidx
  ON public.communities (institution_id)
  WHERE kind = 'institution';

CREATE UNIQUE INDEX IF NOT EXISTS communities_programme_uidx
  ON public.communities (
    COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(programme)
  )
  WHERE kind = 'programme' AND programme IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS communities_level_uidx
  ON public.communities (
    COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
    study_level
  )
  WHERE kind = 'level' AND study_level IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS communities_course_uidx
  ON public.communities (course_id)
  WHERE kind = 'course';

CREATE INDEX IF NOT EXISTS communities_kind_members_idx
  ON public.communities (kind, member_count DESC);
CREATE INDEX IF NOT EXISTS communities_institution_idx
  ON public.communities (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS communities_tags_idx
  ON public.communities USING gin (tags);
CREATE INDEX IF NOT EXISTS communities_name_trgm_idx
  ON public.communities USING gin (name gin_trgm_ops);

DROP TRIGGER IF EXISTS update_communities_updated_at ON public.communities;
CREATE TRIGGER update_communities_updated_at
  BEFORE UPDATE ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 2. community_members ============

CREATE TABLE IF NOT EXISTS public.community_members (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  source text NOT NULL DEFAULT 'joined' CHECK (source IN ('auto', 'joined')),
  -- Set when a user explicitly leaves an auto-derived community; the refresh
  -- job honours it instead of re-adding them on every profile save.
  opted_out_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_members_user_idx
  ON public.community_members (user_id) WHERE opted_out_at IS NULL;
CREATE INDEX IF NOT EXISTS community_members_community_idx
  ON public.community_members (community_id, joined_at DESC) WHERE opted_out_at IS NULL;
-- Drives the privacy fold-in in §6 — explicit joins only.
CREATE INDEX IF NOT EXISTS community_members_joined_idx
  ON public.community_members (user_id, community_id)
  WHERE source = 'joined' AND opted_out_at IS NULL;

-- ============ 3. RLS ============
-- Reads are open to authenticated users for public communities (Discover needs
-- them); every write goes through the API, mirroring marketplace inquiries.

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS communities_select_public ON public.communities;
CREATE POLICY communities_select_public ON public.communities
  FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id = communities.id
        AND cm.user_id = auth.uid()
        AND cm.opted_out_at IS NULL
    )
  );

-- Writes: service_role only. Direct inserts would bypass the auto/joined
-- distinction and let a client inflate member_count (same class of hole the
-- Phase 2 review found on profile_follows).
REVOKE INSERT, UPDATE, DELETE ON public.communities FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_members FROM PUBLIC, anon, authenticated;
-- The SELECT policies above are only reachable if the ROLE also holds a
-- table-level SELECT grant. Without this, RLS never gets a chance to run and
-- every read fails 42501 — the policies become dead code. Same shape as
-- profile_follows in 20260823123000_creators.sql.
GRANT SELECT ON public.communities TO authenticated;
GRANT SELECT ON public.community_members TO authenticated;
GRANT ALL ON public.communities TO service_role;
GRANT ALL ON public.community_members TO service_role;

DROP POLICY IF EXISTS community_members_select_own ON public.community_members;
-- OWN ROWS ONLY, and deliberately so. The obvious "or anyone I share a
-- community with" clause would need a subquery over community_members from
-- inside a policy ON community_members, which Postgres rejects at runtime with
-- 42P17 "infinite recursion detected in policy for relation". Co-member rosters
-- are served by GET /communities/:id/members, which runs as the service role
-- and applies the membership check in application code.
CREATE POLICY community_members_select_own ON public.community_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============ 4. member_count maintenance ============

CREATE OR REPLACE FUNCTION public.community_member_count_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community uuid;
BEGIN
  v_community := COALESCE(NEW.community_id, OLD.community_id);
  UPDATE public.communities c
  SET member_count = (
    SELECT COUNT(*) FROM public.community_members cm
    WHERE cm.community_id = v_community AND cm.opted_out_at IS NULL
  )
  WHERE c.id = v_community;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS community_members_count_sync ON public.community_members;
CREATE TRIGGER community_members_count_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.community_members
  FOR EACH ROW EXECUTE FUNCTION public.community_member_count_sync();

-- ============ 5. groups gain discovery fields ============
-- GET /groups stays memberships-only and cached per user; GET /groups/discover
-- reads these columns with its own cache key.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'community', 'public')),
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS member_count integer NOT NULL DEFAULT 0;

-- Existing groups keep today's behaviour: invite-only, undiscoverable.
CREATE INDEX IF NOT EXISTS groups_discover_idx
  ON public.groups (visibility, member_count DESC)
  WHERE visibility IN ('community', 'public') AND is_archived IS NOT TRUE;
CREATE INDEX IF NOT EXISTS groups_community_idx
  ON public.groups (community_id) WHERE community_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS groups_course_idx
  ON public.groups (course_id) WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS groups_tags_idx ON public.groups USING gin (tags);

CREATE OR REPLACE FUNCTION public.group_member_count_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
BEGIN
  v_group := COALESCE(NEW.group_id, OLD.group_id);
  UPDATE public.groups g
  SET member_count = (
    SELECT COUNT(*) FROM public.group_members gm
    WHERE gm.group_id = v_group AND gm.pending IS NOT TRUE
  )
  WHERE g.id = v_group;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS group_members_count_sync ON public.group_members;
CREATE TRIGGER group_members_count_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_member_count_sync();

-- Backfill the counter for existing groups.
UPDATE public.groups g
SET member_count = sub.c
FROM (
  SELECT group_id, COUNT(*)::int AS c
  FROM public.group_members
  WHERE pending IS NOT TRUE
  GROUP BY group_id
) sub
WHERE sub.group_id = g.id AND g.member_count IS DISTINCT FROM sub.c;

-- ============ 6. profile_visible_to_viewer folds in JOINED communities ============
-- The "groups" privacy tier means "people I share a space with". Phase 3 adds
-- communities as a kind of space — but ONLY communities the user explicitly
-- joined. Auto-derived institution membership must not turn a 'groups'-tier
-- profile into a university-wide public profile.

CREATE OR REPLACE FUNCTION public.profile_visible_to_viewer(viewer_id UUID, target_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  visibility TEXT;
BEGIN
  IF viewer_id IS NULL OR target_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF viewer_id = target_id THEN
    RETURN TRUE;
  END IF;

  SELECT COALESCE(settings->'privacy'->>'profileVisibility', 'public')
  INTO visibility
  FROM public.profiles
  WHERE id = target_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF visibility = 'public' THEN
    RETURN TRUE;
  END IF;

  IF visibility = 'private' THEN
    RETURN FALSE;
  END IF;

  -- 'groups' tier: shared group OR shared explicitly-joined community.
  RETURN EXISTS (
    SELECT 1
    FROM public.group_members gm_self
    JOIN public.group_members gm_other ON gm_self.group_id = gm_other.group_id
    WHERE gm_self.user_id = viewer_id
      AND gm_other.user_id = target_id
  ) OR EXISTS (
    SELECT 1
    FROM public.community_members cm_self
    JOIN public.community_members cm_other ON cm_self.community_id = cm_other.community_id
    WHERE cm_self.user_id = viewer_id
      AND cm_other.user_id = target_id
      AND cm_self.source = 'joined' AND cm_self.opted_out_at IS NULL
      AND cm_other.source = 'joined' AND cm_other.opted_out_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_visible_to_viewer(uuid, uuid) TO service_role;

-- ============ 7. ensure_scope_community + refresh_auto_communities ============
-- Derived communities are created lazily the first time somebody's academic
-- profile implies them, so an empty deployment does not need seed data.

CREATE OR REPLACE FUNCTION public.ensure_scope_community(
  p_kind text,
  p_institution_id uuid,
  p_programme text,
  p_study_level smallint,
  p_course_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slug text;
  v_name text;
  v_inst_name text;
  v_inst_slug text;
  v_course_code text;
  v_course_title text;
BEGIN
  IF p_kind = 'institution' THEN
    IF p_institution_id IS NULL THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM public.communities
      WHERE kind = 'institution' AND institution_id = p_institution_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    SELECT name, slug INTO v_inst_name, v_inst_slug
      FROM public.marketplace_campuses WHERE id = p_institution_id;
    IF v_inst_name IS NULL THEN RETURN NULL; END IF;
    v_slug := 'campus-' || v_inst_slug;
    v_name := v_inst_name;

  ELSIF p_kind = 'programme' THEN
    IF p_programme IS NULL OR btrim(p_programme) = '' THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM public.communities
      WHERE kind = 'programme'
        AND COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(p_institution_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND lower(programme) = lower(p_programme);
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    SELECT slug INTO v_inst_slug FROM public.marketplace_campuses WHERE id = p_institution_id;
    v_slug := 'programme-' || COALESCE(v_inst_slug || '-', '')
      || regexp_replace(lower(btrim(p_programme)), '[^a-z0-9]+', '-', 'g');
    v_name := btrim(p_programme);

  ELSIF p_kind = 'level' THEN
    IF p_study_level IS NULL THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM public.communities
      WHERE kind = 'level'
        AND COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(p_institution_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND study_level = p_study_level;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    SELECT slug INTO v_inst_slug FROM public.marketplace_campuses WHERE id = p_institution_id;
    v_slug := 'level-' || COALESCE(v_inst_slug || '-', '') || p_study_level::text;
    v_name := p_study_level::text || ' level';

  ELSIF p_kind = 'course' THEN
    IF p_course_id IS NULL THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM public.communities
      WHERE kind = 'course' AND course_id = p_course_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    SELECT code, title, institution_id INTO v_course_code, v_course_title, p_institution_id
      FROM public.courses WHERE id = p_course_id;
    IF v_course_code IS NULL THEN RETURN NULL; END IF;
    v_slug := 'course-' || replace(p_course_id::text, '-', '');
    v_name := v_course_code || COALESCE(' — ' || v_course_title, '');

  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO public.communities (
    kind, slug, name, institution_id, programme, study_level, course_id, is_official
  ) VALUES (
    p_kind, v_slug, v_name, p_institution_id,
    CASE WHEN p_kind = 'programme' THEN btrim(p_programme) ELSE NULL END,
    CASE WHEN p_kind = 'level' THEN p_study_level ELSE NULL END,
    CASE WHEN p_kind = 'course' THEN p_course_id ELSE NULL END,
    true
  )
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_scope_community(text, uuid, text, smallint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_scope_community(text, uuid, text, smallint, uuid)
  TO service_role;

-- Recompute one user's auto memberships. Called after academic-profile saves
-- and course enrolment changes. Never touches 'joined' rows, and never
-- re-adds a community the user explicitly left (opted_out_at).
CREATE OR REPLACE FUNCTION public.refresh_auto_communities(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_institution uuid;
  v_programme text;
  v_level smallint;
  v_wanted uuid[] := '{}';
  v_cid uuid;
  v_course record;
  v_count integer := 0;
BEGIN
  SELECT institution_id, programme, study_level
  INTO v_institution, v_programme, v_level
  FROM public.profiles WHERE id = p_user_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  v_cid := public.ensure_scope_community('institution', v_institution, NULL, NULL, NULL);
  IF v_cid IS NOT NULL THEN v_wanted := v_wanted || v_cid; END IF;

  v_cid := public.ensure_scope_community('programme', v_institution, v_programme, NULL, NULL);
  IF v_cid IS NOT NULL THEN v_wanted := v_wanted || v_cid; END IF;

  v_cid := public.ensure_scope_community('level', v_institution, NULL, v_level, NULL);
  IF v_cid IS NOT NULL THEN v_wanted := v_wanted || v_cid; END IF;

  FOR v_course IN
    SELECT course_id FROM public.user_courses
    WHERE user_id = p_user_id AND status = 'active'
    LIMIT 40
  LOOP
    v_cid := public.ensure_scope_community('course', NULL, NULL, NULL, v_course.course_id);
    IF v_cid IS NOT NULL THEN v_wanted := v_wanted || v_cid; END IF;
  END LOOP;

  -- Add the ones that are missing and were not opted out of.
  INSERT INTO public.community_members (community_id, user_id, source)
  SELECT c, p_user_id, 'auto'
  FROM unnest(v_wanted) AS c
  ON CONFLICT (community_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Drop auto rows whose scope no longer applies (changed programme, dropped
  -- a course). 'joined' rows survive: the user asked to be there.
  DELETE FROM public.community_members cm
  WHERE cm.user_id = p_user_id
    AND cm.source = 'auto'
    AND NOT (cm.community_id = ANY(v_wanted));

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_auto_communities(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_auto_communities(uuid) TO service_role;

COMMENT ON TABLE public.communities IS
  'Phase 3 L — campus/programme/level/course/topic communities; derived ones are is_official and auto-populated.';
COMMENT ON TABLE public.community_members IS
  'Phase 3 L — membership. source=auto is derived from the academic profile; only source=joined widens profile_visible_to_viewer.';
