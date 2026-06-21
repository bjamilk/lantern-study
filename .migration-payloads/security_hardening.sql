-- Security hardening migration
-- Fixes RLS gaps identified in security audit

-- ============================================
-- Shared deck access predicate (mirrors decks_select)
-- ============================================
CREATE OR REPLACE FUNCTION public.user_can_access_deck(p_deck_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.decks d
    WHERE d.id = p_deck_id
      AND (
        d.user_id = auth.uid()
        OR d.created_by = auth.uid()
        OR d.is_shared = true
        OR EXISTS (
          SELECT 1 FROM public.deck_collaborators dc
          WHERE dc.deck_id = d.id AND dc.user_id = auth.uid()
        )
      )
  );
$$;

-- ============================================
-- flashcards_select — scope to deck access
-- ============================================
DROP POLICY IF EXISTS flashcards_select ON public.flashcards;
CREATE POLICY flashcards_select ON public.flashcards
  FOR SELECT TO authenticated
  USING (public.user_can_access_deck(deck_id));

-- ============================================
-- flashcard_comments_select — scope to deck access
-- ============================================
DROP POLICY IF EXISTS flashcard_comments_select ON public.flashcard_comments;
CREATE POLICY flashcard_comments_select ON public.flashcard_comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.flashcards f
      WHERE f.id = flashcard_id AND public.user_can_access_deck(f.deck_id)
    )
  );

-- ============================================
-- study_sessions_select — scope to deck access
-- ============================================
DROP POLICY IF EXISTS study_sessions_select ON public.study_sessions;
CREATE POLICY study_sessions_select ON public.study_sessions
  FOR SELECT TO authenticated
  USING (
    deck_id IS NULL OR public.user_can_access_deck(deck_id)
  );

DROP POLICY IF EXISTS study_session_participants_select ON public.study_session_participants;
CREATE POLICY study_session_participants_select ON public.study_session_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.study_sessions ss
      WHERE ss.id = session_id
        AND (ss.deck_id IS NULL OR public.user_can_access_deck(ss.deck_id))
    )
  );

-- ============================================
-- notifications_insert — prevent spoofing
-- ============================================
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- profiles_select — own profile + group co-members
-- ============================================
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_members gm_self
      JOIN public.group_members gm_other ON gm_self.group_id = gm_other.group_id
      WHERE gm_self.user_id = auth.uid()
        AND gm_other.user_id = profiles.id
        AND gm_self.pending = false
        AND gm_other.pending = false
    )
  );

-- ============================================
-- ai_companion_messages — create table + RLS
-- ============================================
CREATE TABLE IF NOT EXISTS public.ai_companion_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  actions JSONB,
  feedback TEXT CHECK (feedback IN ('up', 'down')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companion_messages_user_created
  ON public.ai_companion_messages(user_id, created_at DESC);

ALTER TABLE public.ai_companion_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companion_select_own ON public.ai_companion_messages;
DROP POLICY IF EXISTS companion_insert_own ON public.ai_companion_messages;
DROP POLICY IF EXISTS companion_update_own ON public.ai_companion_messages;
DROP POLICY IF EXISTS companion_delete_own ON public.ai_companion_messages;

CREATE POLICY companion_select_own ON public.ai_companion_messages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY companion_insert_own ON public.ai_companion_messages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY companion_update_own ON public.ai_companion_messages
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY companion_delete_own ON public.ai_companion_messages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- Storage — owner-scoped UPDATE/DELETE
-- Objects must be stored under {auth.uid()}/filename
-- ============================================
DROP POLICY IF EXISTS "Allow authenticated updates to question-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from question-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from flashcard-images" ON storage.objects;

CREATE POLICY "Owner updates question-images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'question-images' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'question-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Owner deletes question-images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'question-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Owner updates marketplace-images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'marketplace-images' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'marketplace-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Owner deletes marketplace-images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'marketplace-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Owner updates flashcard-images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'flashcard-images' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'flashcard-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Owner deletes flashcard-images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'flashcard-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Require uploads to use owner path prefix
DROP POLICY IF EXISTS "Allow authenticated uploads to question-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to flashcard-images" ON storage.objects;

CREATE POLICY "Owner uploads question-images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'question-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Owner uploads marketplace-images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'marketplace-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Owner uploads flashcard-images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'flashcard-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================
-- increment_listing_views — restrict to service_role
-- ============================================
REVOKE ALL ON FUNCTION public.increment_listing_views(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_listing_views(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.increment_listing_views(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_listing_views(UUID) TO service_role;

-- ============================================
-- Batch RPCs — enforce auth.uid() matches p_user_id
-- ============================================
CREATE OR REPLACE FUNCTION public.get_unread_counts_batch(p_user_id UUID)
RETURNS TABLE(group_id UUID, unread_count BIGINT) AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT gm.group_id, COALESCE(COUNT(m.id), 0)::BIGINT as unread_count
  FROM group_members gm
  LEFT JOIN messages m ON m.group_id = gm.group_id
    AND m.timestamp > COALESCE(gm.last_read_at, gm.joined_at)
    AND m.sender_id != p_user_id
  WHERE gm.user_id = p_user_id AND gm.pending = false
  GROUP BY gm.group_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

CREATE OR REPLACE FUNCTION public.get_group_stats_batch(p_user_id UUID)
RETURNS TABLE(group_id UUID, total_messages BIGINT, total_questions BIGINT, member_count BIGINT) AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT gm.group_id,
    (SELECT COUNT(*) FROM messages WHERE messages.group_id = gm.group_id)::BIGINT,
    (SELECT COUNT(*) FROM messages WHERE messages.group_id = gm.group_id AND type = 'QUESTION')::BIGINT,
    (SELECT COUNT(*) FROM group_members WHERE group_members.group_id = gm.group_id AND pending = false)::BIGINT
  FROM group_members gm
  WHERE gm.user_id = p_user_id AND gm.pending = false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

CREATE OR REPLACE FUNCTION public.get_dm_unread_counts_batch(p_user_id UUID)
RETURNS TABLE(thread_id TEXT, unread_count BIGINT) AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT dt.id as thread_id, COALESCE(COUNT(dm.id), 0)::BIGINT as unread_count
  FROM dm_threads dt
  LEFT JOIN dm_messages dm ON dm.thread_id = dt.id
    AND dm.sender_id != p_user_id
    AND dm.timestamp > COALESCE(
      (SELECT last_read_at FROM dm_read_status WHERE dm_read_status.thread_id = dt.id AND dm_read_status.user_id = p_user_id),
      '1970-01-01'::TIMESTAMPTZ
    )
  WHERE dt.participant_ids ? p_user_id::TEXT
  GROUP BY dt.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

REVOKE ALL ON FUNCTION public.get_unread_counts_batch(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_group_stats_batch(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dm_unread_counts_batch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_counts_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_stats_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dm_unread_counts_batch(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_flashcard_due_counts(p_user_id UUID)
RETURNS TABLE(deck_id UUID, due_count BIGINT, new_count BIGINT) AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT d.id as deck_id,
    COUNT(CASE WHEN f.srs_data IS NOT NULL AND (f.srs_data->>'nextReviewDate')::DATE <= CURRENT_DATE THEN 1 END)::BIGINT,
    COUNT(CASE WHEN f.srs_data IS NULL OR f.srs_data->>'repetitions' IS NULL OR (f.srs_data->>'repetitions')::INT = 0 THEN 1 END)::BIGINT
  FROM decks d
  LEFT JOIN flashcards f ON f.deck_id = d.id
  WHERE d.user_id = p_user_id
  GROUP BY d.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

CREATE OR REPLACE FUNCTION public.mark_group_as_read(p_user_id UUID, p_group_id UUID)
RETURNS VOID AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE group_members SET last_read_at = NOW() WHERE user_id = p_user_id AND group_id = p_group_id;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY INVOKER;

CREATE OR REPLACE FUNCTION public.mark_dm_as_read(p_user_id UUID, p_thread_id TEXT)
RETURNS VOID AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  INSERT INTO dm_read_status (thread_id, user_id, last_read_at)
  VALUES (p_thread_id, p_user_id, NOW())
  ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW();
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY INVOKER;

REVOKE ALL ON FUNCTION public.get_flashcard_due_counts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_group_as_read(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_dm_as_read(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_flashcard_due_counts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_group_as_read(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_dm_as_read(UUID, TEXT) TO authenticated;

-- ============================================
-- groups_insert — bind creator as admin
-- ============================================
DROP POLICY IF EXISTS groups_insert ON public.groups;
CREATE POLICY groups_insert ON public.groups
  FOR INSERT TO authenticated
  WITH CHECK (admin_ids @> jsonb_build_array(auth.uid()::text));

-- ============================================
-- custom_categories_insert — enforce created_by
-- ============================================
DROP POLICY IF EXISTS custom_categories_insert ON public.custom_categories;
CREATE POLICY custom_categories_insert ON public.custom_categories
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
