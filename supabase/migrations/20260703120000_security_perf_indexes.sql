-- Security / performance indexes for high-traffic ownership and filter queries

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_id
  ON notifications (user_id, id);

CREATE INDEX IF NOT EXISTS idx_test_sessions_user_id_id
  ON test_sessions (user_id, id);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id
  ON saved_searches (user_id);

CREATE INDEX IF NOT EXISTS idx_group_challenges_challenger_status
  ON group_challenges (challenger_id, status);

CREATE INDEX IF NOT EXISTS idx_group_challenges_opponent_status
  ON group_challenges (opponent_id, status);
