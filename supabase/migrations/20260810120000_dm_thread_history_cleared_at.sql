-- Per-user DM history cutoff for "delete for me".
-- Delete hides the thread (hidden_by) AND records when that user cleared history.
-- A new message may un-hide the thread for inbox resurrection, but messages at or
-- before history_cleared_at[user_id] stay invisible to that user.

ALTER TABLE public.dm_threads
  ADD COLUMN IF NOT EXISTS history_cleared_at jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.dm_threads.history_cleared_at IS
  'Map of user_id -> ISO timestamptz when that user deleted the chat. Messages at or before this time are hidden for that user only. Survives thread resurrection (hidden_by clear).';

COMMENT ON COLUMN public.dm_threads.hidden_by IS
  'User ids who deleted (hid) this thread from their inbox. Cleared when a new message arrives so the thread can resurface; history_cleared_at still hides pre-delete messages for that user.';

-- Unread counts must ignore messages at or before the viewer's history cutoff.
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
    AND dm.timestamp > GREATEST(
      COALESCE(
        (
          SELECT last_read_at
          FROM public.dm_read_status
          WHERE dm_read_status.thread_id = dt.id
            AND dm_read_status.user_id = p_user_id
        ),
        '1970-01-01'::TIMESTAMPTZ
      ),
      COALESCE(
        NULLIF(dt.history_cleared_at ->> p_user_id::TEXT, '')::TIMESTAMPTZ,
        '1970-01-01'::TIMESTAMPTZ
      )
    )
  WHERE dt.participant_ids ? p_user_id::TEXT
     OR dt.participant_ids @> to_jsonb(ARRAY[p_user_id::TEXT])
  GROUP BY dt.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dm_unread_counts_batch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dm_unread_counts_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dm_unread_counts_batch(UUID) TO service_role;
