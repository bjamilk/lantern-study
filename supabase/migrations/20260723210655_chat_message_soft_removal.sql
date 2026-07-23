-- Preserve message history while allowing a sender to edit or remove a
-- text/voice message for everyone during a short, server-enforced window.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.dm_messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_group_visible_timestamp
  ON public.messages (group_id, timestamp DESC)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dm_messages_thread_visible_timestamp
  ON public.dm_messages (thread_id, timestamp DESC)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.chat_message_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately not foreign keys: account/group lifecycle cleanup can delete
  -- source rows, but must not cascade into the retained audit history.
  group_message_id UUID,
  dm_message_id UUID,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('EDIT', 'REMOVE')),
  previous_text TEXT,
  new_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_message_audit_exactly_one_parent
    CHECK (num_nonnulls(group_message_id, dm_message_id) = 1)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_audit_group_message
  ON public.chat_message_audit (group_message_id, created_at DESC)
  WHERE group_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_message_audit_dm_message
  ON public.chat_message_audit (dm_message_id, created_at DESC)
  WHERE dm_message_id IS NOT NULL;

ALTER TABLE public.chat_message_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_message_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.chat_message_audit TO service_role;

-- Message mutations are intentionally available only to the trusted API.
-- This prevents an authenticated client from bypassing the 30-minute rule or
-- physically deleting the audit source row through PostgREST.
DROP POLICY IF EXISTS messages_update ON public.messages;
DROP POLICY IF EXISTS messages_delete ON public.messages;
DROP POLICY IF EXISTS dm_messages_update ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_delete ON public.dm_messages;

CREATE OR REPLACE FUNCTION public.edit_chat_message(
  p_message_kind TEXT,
  p_message_id UUID,
  p_actor_id UUID,
  p_new_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_group_message public.messages%ROWTYPE;
  v_dm_message public.dm_messages%ROWTYPE;
BEGIN
  IF p_new_text IS NULL OR length(btrim(p_new_text)) = 0 OR length(p_new_text) > 50000 THEN
    RETURN jsonb_build_object('status', 'invalid_content');
  END IF;

  IF p_message_kind = 'group' THEN
    SELECT *
    INTO v_group_message
    FROM public.messages
    WHERE id = p_message_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_group_message.sender_id IS DISTINCT FROM p_actor_id THEN
      RETURN jsonb_build_object('status', 'forbidden');
    END IF;
    IF upper(v_group_message.type) <> 'TEXT' THEN
      RETURN jsonb_build_object('status', 'not_editable');
    END IF;
    IF btrim(COALESCE(v_group_message.text, '')) ~*
      '^\[audio\]\(https?://[^)[:space:]]+\)$' THEN
      RETURN jsonb_build_object('status', 'not_editable');
    END IF;
    IF v_group_message.removed_at IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'removed');
    END IF;
    IF v_group_message.timestamp IS NULL
      OR v_group_message.timestamp < v_now - INTERVAL '30 minutes' THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    IF v_group_message.text IS NOT DISTINCT FROM p_new_text THEN
      RETURN jsonb_build_object('status', 'ok', 'message', to_jsonb(v_group_message));
    END IF;

    INSERT INTO public.chat_message_audit (
      group_message_id,
      actor_id,
      action,
      previous_text,
      new_text
    )
    VALUES (
      v_group_message.id,
      p_actor_id,
      'EDIT',
      v_group_message.text,
      p_new_text
    );

    UPDATE public.messages
    SET text = p_new_text,
        edited_at = v_now
    WHERE id = p_message_id
    RETURNING * INTO v_group_message;

    RETURN jsonb_build_object('status', 'ok', 'message', to_jsonb(v_group_message));
  ELSIF p_message_kind = 'dm' THEN
    SELECT *
    INTO v_dm_message
    FROM public.dm_messages
    WHERE id = p_message_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_dm_message.sender_id IS DISTINCT FROM p_actor_id THEN
      RETURN jsonb_build_object('status', 'forbidden');
    END IF;
    IF btrim(COALESCE(v_dm_message.text, '')) ~*
      '^\[audio\]\(https?://[^)[:space:]]+\)$' THEN
      RETURN jsonb_build_object('status', 'not_editable');
    END IF;
    IF v_dm_message.removed_at IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'removed');
    END IF;
    IF v_dm_message.timestamp IS NULL
      OR v_dm_message.timestamp < v_now - INTERVAL '30 minutes' THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    IF v_dm_message.text IS NOT DISTINCT FROM p_new_text THEN
      RETURN jsonb_build_object('status', 'ok', 'message', to_jsonb(v_dm_message));
    END IF;

    INSERT INTO public.chat_message_audit (
      dm_message_id,
      actor_id,
      action,
      previous_text,
      new_text
    )
    VALUES (
      v_dm_message.id,
      p_actor_id,
      'EDIT',
      v_dm_message.text,
      p_new_text
    );

    UPDATE public.dm_messages
    SET text = p_new_text,
        edited_at = v_now
    WHERE id = p_message_id
    RETURNING * INTO v_dm_message;

    RETURN jsonb_build_object('status', 'ok', 'message', to_jsonb(v_dm_message));
  END IF;

  RETURN jsonb_build_object('status', 'invalid_kind');
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_chat_message(
  p_message_kind TEXT,
  p_message_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_group_message public.messages%ROWTYPE;
  v_dm_message public.dm_messages%ROWTYPE;
BEGIN
  IF p_message_kind = 'group' THEN
    SELECT *
    INTO v_group_message
    FROM public.messages
    WHERE id = p_message_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_group_message.sender_id IS DISTINCT FROM p_actor_id THEN
      RETURN jsonb_build_object('status', 'forbidden');
    END IF;
    IF upper(v_group_message.type) <> 'TEXT' THEN
      RETURN jsonb_build_object('status', 'not_removable');
    END IF;
    IF v_group_message.removed_at IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'removed');
    END IF;
    IF v_group_message.timestamp IS NULL
      OR v_group_message.timestamp < v_now - INTERVAL '30 minutes' THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;

    INSERT INTO public.chat_message_audit (
      group_message_id,
      actor_id,
      action,
      previous_text
    )
    VALUES (
      v_group_message.id,
      p_actor_id,
      'REMOVE',
      v_group_message.text
    );

    UPDATE public.messages
    SET text = NULL,
        image_url = NULL,
        removed_at = v_now,
        removed_by = p_actor_id
    WHERE id = p_message_id
    RETURNING * INTO v_group_message;

    RETURN jsonb_build_object('status', 'ok', 'message', to_jsonb(v_group_message));
  ELSIF p_message_kind = 'dm' THEN
    SELECT *
    INTO v_dm_message
    FROM public.dm_messages
    WHERE id = p_message_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_dm_message.sender_id IS DISTINCT FROM p_actor_id THEN
      RETURN jsonb_build_object('status', 'forbidden');
    END IF;
    IF v_dm_message.removed_at IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'removed');
    END IF;
    IF v_dm_message.timestamp IS NULL
      OR v_dm_message.timestamp < v_now - INTERVAL '30 minutes' THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;

    INSERT INTO public.chat_message_audit (
      dm_message_id,
      actor_id,
      action,
      previous_text
    )
    VALUES (
      v_dm_message.id,
      p_actor_id,
      'REMOVE',
      v_dm_message.text
    );

    UPDATE public.dm_messages
    SET text = '',
        removed_at = v_now,
        removed_by = p_actor_id
    WHERE id = p_message_id
    RETURNING * INTO v_dm_message;

    RETURN jsonb_build_object('status', 'ok', 'message', to_jsonb(v_dm_message));
  END IF;

  RETURN jsonb_build_object('status', 'invalid_kind');
END;
$$;

REVOKE ALL ON FUNCTION public.edit_chat_message(TEXT, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_chat_message(TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_chat_message(TEXT, UUID, UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_chat_message(TEXT, UUID, UUID)
  TO service_role;

-- Hidden messages should not create unread badges.
CREATE OR REPLACE FUNCTION public.get_unread_counts_batch(p_user_id UUID)
RETURNS TABLE(group_id UUID, unread_count BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT gm.group_id, COALESCE(COUNT(m.id), 0)::BIGINT
  FROM public.group_members gm
  LEFT JOIN public.messages m
    ON m.group_id = gm.group_id
    AND m.timestamp > COALESCE(gm.last_read_at, gm.joined_at)
    AND m.sender_id != p_user_id
    AND m.removed_at IS NULL
    AND COALESCE(m.is_archived, false) = false
  WHERE gm.user_id = p_user_id
    AND gm.pending = false
  GROUP BY gm.group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dm_unread_counts_batch(p_user_id UUID)
RETURNS TABLE(thread_id TEXT, unread_count BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT dt.id, COALESCE(COUNT(dm.id), 0)::BIGINT
  FROM public.dm_threads dt
  LEFT JOIN public.dm_messages dm
    ON dm.thread_id = dt.id
    AND dm.sender_id != p_user_id
    AND dm.removed_at IS NULL
    AND dm.timestamp > COALESCE(
      (
        SELECT last_read_at
        FROM public.dm_read_status
        WHERE dm_read_status.thread_id = dt.id
          AND dm_read_status.user_id = p_user_id
      ),
      '1970-01-01'::TIMESTAMPTZ
    )
  WHERE dt.participant_ids ? p_user_id::TEXT
  GROUP BY dt.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unread_counts_batch(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dm_unread_counts_batch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_counts_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dm_unread_counts_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_counts_batch(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dm_unread_counts_batch(UUID) TO service_role;
