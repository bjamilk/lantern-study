-- Lecturer-first class sections (docs/phase-teach-portal-contract.md).
-- Hand-apply after 20260906120000_create_deck_with_cards.sql.
--
-- Why: the student product has courses + self-enrolment but no lecturer-owned
-- class, roster, official corpus, assignments, or campus staff. This migration
-- adds those tables without requiring Canvas / Google Classroom / Moodle.
-- Capability is class-scoped (class_members.role) — there is no global teacher
-- flag. Writes go through the API (service role); authenticated users may
-- SELECT their own memberships and published materials.
--
-- Everything is idempotent so a partial run can be re-run.

-- ============ 1a. class_sections ============

CREATE TABLE IF NOT EXISTS public.class_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  institution_id uuid REFERENCES public.marketplace_campuses(id) ON DELETE SET NULL,
  title text NOT NULL,
  academic_year text NOT NULL,
  semester smallint CHECK (semester IN (1, 2)),
  join_code text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_sections_title_len CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  CONSTRAINT class_sections_join_code_len CHECK (char_length(join_code) BETWEEN 6 AND 8)
);

CREATE UNIQUE INDEX IF NOT EXISTS class_sections_join_code_uidx
  ON public.class_sections (join_code);
CREATE INDEX IF NOT EXISTS class_sections_course_idx ON public.class_sections (course_id);
CREATE INDEX IF NOT EXISTS class_sections_institution_idx ON public.class_sections (institution_id);
CREATE INDEX IF NOT EXISTS class_sections_created_by_idx ON public.class_sections (created_by);

DROP TRIGGER IF EXISTS class_sections_updated_at ON public.class_sections;
CREATE TRIGGER class_sections_updated_at
  BEFORE UPDATE ON public.class_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 1b. class_members ============

CREATE TABLE IF NOT EXISTS public.class_members (
  class_id uuid NOT NULL REFERENCES public.class_sections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('instructor', 'ta', 'student')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);

CREATE INDEX IF NOT EXISTS class_members_user_status_idx
  ON public.class_members (user_id, status);
CREATE INDEX IF NOT EXISTS class_members_class_role_idx
  ON public.class_members (class_id, role, status);

-- ============ 1c. class_invites (optional extra codes; section.join_code is the hall QR) ============

CREATE TABLE IF NOT EXISTS public.class_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.class_sections(id) ON DELETE CASCADE,
  code text NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'ta')),
  expires_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_invites_code_len CHECK (char_length(code) BETWEEN 6 AND 8)
);

CREATE UNIQUE INDEX IF NOT EXISTS class_invites_code_uidx ON public.class_invites (code);
CREATE INDEX IF NOT EXISTS class_invites_class_idx ON public.class_invites (class_id);

-- ============ 1d. class_materials ============

CREATE TABLE IF NOT EXISTS public.class_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.class_sections(id) ON DELETE CASCADE,
  note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'lecture' CHECK (kind IN ('syllabus', 'lecture', 'reading', 'slide')),
  title text NOT NULL,
  body_snapshot text NOT NULL DEFAULT '',
  published_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_materials_class_idx ON public.class_materials (class_id);
CREATE INDEX IF NOT EXISTS class_materials_published_idx
  ON public.class_materials (class_id, published_at)
  WHERE published_at IS NOT NULL;

DROP TRIGGER IF EXISTS class_materials_updated_at ON public.class_materials;
CREATE TRIGGER class_materials_updated_at
  BEFORE UPDATE ON public.class_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 1e. assignments ============

CREATE TABLE IF NOT EXISTS public.class_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.class_sections(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('test', 'deck', 'notes', 'open')),
  due_at timestamptz,
  note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  deck_id uuid REFERENCES public.decks(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_assignments_class_idx
  ON public.class_assignments (class_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.class_assignment_progress (
  assignment_id uuid NOT NULL REFERENCES public.class_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed')),
  score numeric CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  completed_at timestamptz,
  PRIMARY KEY (assignment_id, user_id)
);

CREATE INDEX IF NOT EXISTS class_assignment_progress_user_idx
  ON public.class_assignment_progress (user_id, status);

-- ============ 1f. institution_staff ============

CREATE TABLE IF NOT EXISTS public.institution_staff (
  institution_id uuid NOT NULL REFERENCES public.marketplace_campuses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('instructor', 'department_admin', 'institution_admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, user_id)
);

CREATE INDEX IF NOT EXISTS institution_staff_user_idx
  ON public.institution_staff (user_id, status);

-- ============ 1g. RLS ============

ALTER TABLE public.class_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_assignment_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS class_sections_select_member ON public.class_sections;
CREATE POLICY class_sections_select_member ON public.class_sections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_members m
      WHERE m.class_id = class_sections.id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS class_members_select_same_class ON public.class_members;
CREATE POLICY class_members_select_same_class ON public.class_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_members mine
      WHERE mine.class_id = class_members.class_id
        AND mine.user_id = auth.uid()
        AND mine.status = 'active'
    )
  );

DROP POLICY IF EXISTS class_invites_select_staff ON public.class_invites;
CREATE POLICY class_invites_select_staff ON public.class_invites
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_members m
      WHERE m.class_id = class_invites.class_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.role IN ('instructor', 'ta')
    )
  );

DROP POLICY IF EXISTS class_materials_select_member ON public.class_materials;
CREATE POLICY class_materials_select_member ON public.class_materials
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_members m
      WHERE m.class_id = class_materials.class_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND (
          class_materials.published_at IS NOT NULL
          OR m.role IN ('instructor', 'ta')
        )
    )
  );

DROP POLICY IF EXISTS class_assignments_select_member ON public.class_assignments;
CREATE POLICY class_assignments_select_member ON public.class_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.class_members m
      WHERE m.class_id = class_assignments.class_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS class_assignment_progress_select_own_or_staff ON public.class_assignment_progress;
CREATE POLICY class_assignment_progress_select_own_or_staff ON public.class_assignment_progress
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.class_assignments a
      JOIN public.class_members m ON m.class_id = a.class_id
      WHERE a.id = class_assignment_progress.assignment_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.role IN ('instructor', 'ta')
    )
  );

DROP POLICY IF EXISTS institution_staff_select_own ON public.institution_staff;
CREATE POLICY institution_staff_select_own ON public.institution_staff
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND status = 'active');

GRANT SELECT ON public.class_sections TO authenticated;
GRANT SELECT ON public.class_members TO authenticated;
GRANT SELECT ON public.class_invites TO authenticated;
GRANT SELECT ON public.class_materials TO authenticated;
GRANT SELECT ON public.class_assignments TO authenticated;
GRANT SELECT ON public.class_assignment_progress TO authenticated;
GRANT SELECT ON public.institution_staff TO authenticated;

GRANT ALL ON public.class_sections TO service_role;
GRANT ALL ON public.class_members TO service_role;
GRANT ALL ON public.class_invites TO service_role;
GRANT ALL ON public.class_materials TO service_role;
GRANT ALL ON public.class_assignments TO service_role;
GRANT ALL ON public.class_assignment_progress TO service_role;
GRANT ALL ON public.institution_staff TO service_role;
