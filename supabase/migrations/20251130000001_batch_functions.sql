-- ============================================
-- BATCH QUERY FUNCTIONS FOR PERFORMANCE
-- Eliminates N+1 query patterns
-- Created: 2025-11-30
-- ============================================

-- ============================================
-- Add last_read_at column to group_members if not exists
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'group_members' AND column_name = 'last_read_at'
  ) THEN
    ALTER TABLE group_members ADD COLUMN last_read_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- ============================================
-- BATCH UNREAD COUNTS
-- Returns unread message counts for all groups a user belongs to
-- Replaces N separate queries with 1 query
-- ============================================
CREATE OR REPLACE FUNCTION get_unread_counts_batch(p_user_id UUID)
RETURNS TABLE(group_id UUID, unread_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gm.group_id,
    COALESCE(COUNT(m.id), 0)::BIGINT as unread_count
  FROM group_members gm
  LEFT JOIN messages m ON m.group_id = gm.group_id 
    AND m.timestamp > COALESCE(gm.last_read_at, gm.joined_at)
    AND m.sender_id != p_user_id
  WHERE gm.user_id = p_user_id
    AND gm.pending = false
  GROUP BY gm.group_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- BATCH GROUP STATS
-- Returns stats for all groups a user belongs to
-- ============================================
CREATE OR REPLACE FUNCTION get_group_stats_batch(p_user_id UUID)
RETURNS TABLE(
  group_id UUID,
  total_messages BIGINT,
  total_questions BIGINT,
  member_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gm.group_id,
    (SELECT COUNT(*) FROM messages WHERE messages.group_id = gm.group_id)::BIGINT as total_messages,
    (SELECT COUNT(*) FROM messages WHERE messages.group_id = gm.group_id AND type = 'QUESTION')::BIGINT as total_questions,
    (SELECT COUNT(*) FROM group_members WHERE group_members.group_id = gm.group_id AND pending = false)::BIGINT as member_count
  FROM group_members gm
  WHERE gm.user_id = p_user_id
    AND gm.pending = false;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- BATCH DM UNREAD COUNTS
-- Returns unread counts for all DM threads
-- ============================================
CREATE OR REPLACE FUNCTION get_dm_unread_counts_batch(p_user_id UUID)
RETURNS TABLE(thread_id TEXT, unread_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dt.id as thread_id,
    COALESCE(COUNT(dm.id), 0)::BIGINT as unread_count
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
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- CREATE DM READ STATUS TABLE IF NOT EXISTS
-- ============================================
CREATE TABLE IF NOT EXISTS dm_read_status (
  thread_id TEXT REFERENCES dm_threads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_read_status_user ON dm_read_status(user_id);

-- ============================================
-- BATCH FLASHCARD DUE COUNTS
-- Returns count of due cards per deck
-- ============================================
CREATE OR REPLACE FUNCTION get_flashcard_due_counts(p_user_id UUID)
RETURNS TABLE(deck_id UUID, due_count BIGINT, new_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id as deck_id,
    COUNT(CASE 
      WHEN f.srs_data IS NOT NULL 
        AND (f.srs_data->>'nextReviewDate')::DATE <= CURRENT_DATE 
      THEN 1 
    END)::BIGINT as due_count,
    COUNT(CASE 
      WHEN f.srs_data IS NULL 
        OR f.srs_data->>'repetitions' IS NULL 
        OR (f.srs_data->>'repetitions')::INT = 0 
      THEN 1 
    END)::BIGINT as new_count
  FROM decks d
  LEFT JOIN flashcards f ON f.deck_id = d.id
  WHERE d.user_id = p_user_id
  GROUP BY d.id;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- MARK GROUP AS READ
-- Updates last_read_at for a user in a group
-- ============================================
CREATE OR REPLACE FUNCTION mark_group_as_read(p_user_id UUID, p_group_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE group_members 
  SET last_read_at = NOW() 
  WHERE user_id = p_user_id AND group_id = p_group_id;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ============================================
-- MARK DM AS READ
-- Updates last_read_at for a user in a DM thread
-- ============================================
CREATE OR REPLACE FUNCTION mark_dm_as_read(p_user_id UUID, p_thread_id TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO dm_read_status (thread_id, user_id, last_read_at)
  VALUES (p_thread_id, p_user_id, NOW())
  ON CONFLICT (thread_id, user_id) 
  DO UPDATE SET last_read_at = NOW();
END;
$$ LANGUAGE plpgsql VOLATILE;
