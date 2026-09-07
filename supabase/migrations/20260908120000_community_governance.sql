-- Community governance — kinds beyond academia, board post kinds, moderating
-- roles, mutes, invite codes.
--
-- Founder decisions (2026-09-07, binding):
--   * Communities open to every signed-in student with an academic profile,
--     and members POST. The gate is enforced in the API (a client flag is not
--     a gate); nothing here grants a write, because every community write
--     still goes through the service role.
--   * Communities go BEYOND academic discussion: interest, club, hostel,
--     event, faith, sports, general — same moderation everywhere.
--   * Academic kinds stay derived and official. A student-made community is
--     never `is_official`; that is enforced in the API, and the CHECK below
--     only widens the vocabulary.
--
-- SAFE TO RE-RUN. Every statement is IF NOT EXISTS or a DROP/CREATE pair.
--
-- The API ships BEFORE this is applied and degrades honestly without it
-- (schemaCapabilities.ts probes each column/table): new kinds are refused at
-- creation with 503, post_kind is dropped from a write and reads as
-- 'discussion', mutes are absent so nobody is muted, invites answer 503.

-- ============ 1. communities.kind — the campus-life kinds ============
-- Drop and recreate rather than ADD: a CHECK cannot be extended in place.
-- 'topic' is KEPT, unrenamed: it is what every community created before today
-- carries, and dropping it would violate the new constraint on existing rows.

ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_kind_check;

ALTER TABLE public.communities
  ADD CONSTRAINT communities_kind_check CHECK (kind IN (
    -- derived from the academic profile by ensure_scope_community
    'institution', 'programme', 'level', 'course',
    -- student-created; never is_official
    'topic', 'interest', 'club', 'hostel', 'event', 'faith', 'sports', 'general'
  ));

COMMENT ON COLUMN public.communities.kind IS
  'institution/programme/level/course are DERIVED from the academic profile and are the only kinds that may be is_official. topic/interest/club/hostel/event/faith/sports/general are student-created.';

-- ============ 2. event communities carry a schedule ============
-- Nullable on every kind: only kind = 'event' ever sets them, and the API
-- clears them on any other kind rather than trusting the client.

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS location text
    CHECK (location IS NULL OR char_length(location) <= 120);

-- Discovery lists events soonest-first, so the index is on the start time of
-- events only — the other kinds never read it.
CREATE INDEX IF NOT EXISTS communities_event_starts_idx
  ON public.communities (starts_at)
  WHERE kind = 'event' AND starts_at IS NOT NULL;

-- Free-text discovery searches name AND description; the name trigram index
-- already exists (20260824120000), this is its description half.
CREATE INDEX IF NOT EXISTS communities_description_trgm_idx
  ON public.communities USING gin (description gin_trgm_ops);

-- ============ 3. mutes on community_members ============
-- A muted member READS everything and cannot post. There is deliberately no
-- permanent mute: a mute nobody remembers to lift is a ban with no appeal,
-- and bans belong to the Phase 1 · E suspension machinery.

ALTER TABLE public.community_members
  ADD COLUMN IF NOT EXISTS muted_until timestamptz,
  ADD COLUMN IF NOT EXISTS muted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS muted_reason text
    CHECK (muted_reason IS NULL OR char_length(muted_reason) <= 200);

-- Only live mutes are ever read; an expired row is simply not a mute.
CREATE INDEX IF NOT EXISTS community_members_muted_idx
  ON public.community_members (community_id, muted_until)
  WHERE muted_until IS NOT NULL;

COMMENT ON COLUMN public.community_members.muted_until IS
  'A live mute (muted_until > now()) blocks posting in this community. Reading is never blocked. NULL or past = not muted.';

-- ============ 4. board post kinds ============
-- NO POLL value: a poll needs its own vote table, realtime fan-out and abuse
-- story, and shipping the enum value without them is a dead feature in
-- production. NULL = legacy = 'discussion'; the backfill is therefore a no-op.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS post_kind text
    CHECK (post_kind IS NULL OR post_kind IN ('discussion', 'question', 'announcement', 'event')),
  -- Why a moderator removed a post. `removed_at` / `removed_by` already exist
  -- (20260723210655); this is the missing third column, so a tombstone can
  -- say what happened instead of just that something did.
  ADD COLUMN IF NOT EXISTS removed_reason text
    CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 300),
  -- The accepted answer on a `question` post: a comment in its own thread.
  ADD COLUMN IF NOT EXISTS answered_message_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.messages.post_kind IS
  'Board post kind: discussion | question | announcement | event. NULL = legacy = discussion. Only owner/admin/moderator may write announcement (enforced in the API).';

-- ============ 5. pins: one ordinary pin per board, plus announcements ============
-- 20260903120000 created idx_messages_one_pin_per_group as UNIQUE (group_id)
-- WHERE pinned_at IS NOT NULL. Announcements pin by default and up to three
-- may be live per COMMUNITY, so that index would make the second announcement
-- on a board fail with 23505. Narrow it to non-announcement pins: a board
-- still has at most ONE ordinary pinned post, and announcement pins are
-- bounded by the API (BOARD_ANNOUNCEMENT_PIN_MAX, oldest unpins).

DROP INDEX IF EXISTS public.idx_messages_one_pin_per_group;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_one_pin_per_group
  ON public.messages (group_id)
  WHERE pinned_at IS NOT NULL AND (post_kind IS NULL OR post_kind <> 'announcement');

-- Finding the live announcements of a community means "pinned announcements
-- across these group ids", which is a group_id IN (...) scan.
CREATE INDEX IF NOT EXISTS idx_messages_pinned_announcements
  ON public.messages (group_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL AND post_kind = 'announcement';

-- ============ 6. community_invites ============
-- A private community is joinable ONLY by code. Codes come from an
-- unambiguous alphabet (no O/0, no I/1/L) because they are read off one phone
-- and typed into another.

CREATE TABLE IF NOT EXISTS public.community_invites (
  code text PRIMARY KEY CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_invites_community_idx
  ON public.community_invites (community_id, created_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.community_invites ENABLE ROW LEVEL SECURITY;

-- No SELECT policy at all, and that is the point. A client must never be able
-- to enumerate or probe codes: redemption goes through
-- POST /communities/join-by-code, which runs as the service role and answers
-- every refusal with the SAME string, so the endpoint cannot become an oracle
-- for which codes exist.
REVOKE ALL ON public.community_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_invites TO service_role;

COMMENT ON TABLE public.community_invites IS
  'Invite codes. Private communities are joinable ONLY by code. Deliberately unreadable by authenticated clients: redemption is a service-role endpoint that answers every refusal identically.';

-- Atomic redemption. Doing this in the API as read-then-update lets two
-- students on the last seat of a max_uses invite both win the race; a single
-- conditional UPDATE ... RETURNING cannot.
CREATE OR REPLACE FUNCTION public.redeem_community_invite(p_code text)
RETURNS TABLE (community_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.community_invites ci
  SET uses = ci.uses + 1
  WHERE ci.code = p_code
    AND ci.revoked_at IS NULL
    AND (ci.expires_at IS NULL OR ci.expires_at > now())
    AND (ci.max_uses IS NULL OR ci.uses < ci.max_uses)
  RETURNING ci.community_id;
$$;

REVOKE ALL ON FUNCTION public.redeem_community_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_community_invite(text) TO service_role;

-- ============ 7. reports gain the two community targets ============
-- Reuses the Phase 1 · E content_reports table and its whole queue. There is
-- exactly one moderation stack; a second one is a review blocker.

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_target_type_check;

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_target_type_check CHECK (target_type IN (
    'listing','question_bank','note','deck','user','group','message','dm_message','job_posting',
    'community_post','community_member'
  ));

NOTIFY pgrst, 'reload schema';
