-- ============================================================
-- PRODUCTION INDEXES FOR 100K+ CONCURRENT USERS
-- Run: npx supabase db reset --local
-- ============================================================
-- Schema column reference:
-- messages: timestamp (not created_at), sender_id (not user_id), text (not content)
-- flashcards: srs_data (JSONB, not next_review_date column)
-- notifications: date (not created_at), read (not is_read)
-- decks: user_id, name, created_at
-- ============================================================

-- ============================================================
-- MESSAGES INDEXES
-- ============================================================

-- Primary query: Get messages for a group ordered by time
CREATE INDEX IF NOT EXISTS idx_messages_group_timestamp 
ON messages(group_id, timestamp DESC);

-- Filter questions by sender
CREATE INDEX IF NOT EXISTS idx_messages_sender_type 
ON messages(sender_id, type) WHERE type = 'QUESTION';

-- Filter by group and type
CREATE INDEX IF NOT EXISTS idx_messages_group_type_v2 
ON messages(group_id, type);

-- Full-text search on message text
CREATE INDEX IF NOT EXISTS idx_messages_text_search 
ON messages USING GIN(to_tsvector('english', COALESCE(text, '')));

-- ============================================================
-- USER QUESTION STATS INDEXES
-- ============================================================

-- Primary lookup for spaced repetition
CREATE INDEX IF NOT EXISTS idx_user_question_stats_lookup 
ON user_question_stats(user_id, question_id);

-- Find questions user struggles with
CREATE INDEX IF NOT EXISTS idx_user_question_stats_incorrect 
ON user_question_stats(user_id, incorrect_attempts DESC) 
WHERE incorrect_attempts > 0;

-- Find recently attempted questions
CREATE INDEX IF NOT EXISTS idx_user_question_stats_recent 
ON user_question_stats(user_id, last_attempted DESC);

-- ============================================================
-- FLASHCARD INDEXES (using decks table, not flashcard_decks)
-- ============================================================

-- Get flashcards by deck
CREATE INDEX IF NOT EXISTS idx_flashcards_deck_v2 
ON flashcards(deck_id);

-- ============================================================
-- DECKS INDEXES
-- ============================================================

-- Get user's decks
CREATE INDEX IF NOT EXISTS idx_decks_user_created 
ON decks(user_id, created_at DESC);

-- ============================================================
-- TEST RESULTS INDEXES
-- ============================================================

-- Get user's test history via session
CREATE INDEX IF NOT EXISTS idx_test_sessions_user 
ON test_sessions(user_id, start_time DESC);

-- Get test results by session
CREATE INDEX IF NOT EXISTS idx_test_results_session 
ON test_results(session_id);

-- ============================================================
-- GROUP MEMBERS INDEXES
-- ============================================================

-- Check membership and get user's groups
CREATE INDEX IF NOT EXISTS idx_group_members_user 
ON group_members(user_id, group_id);

-- Get pending members
CREATE INDEX IF NOT EXISTS idx_group_members_pending 
ON group_members(group_id, pending) 
WHERE pending = true;

-- ============================================================
-- GROUPS INDEXES
-- ============================================================

-- Get child groups
CREATE INDEX IF NOT EXISTS idx_groups_parent_v2 
ON groups(parent_id) WHERE parent_id IS NOT NULL;

-- Search groups by name
CREATE INDEX IF NOT EXISTS idx_groups_name_search 
ON groups USING GIN(to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- Get active groups
CREATE INDEX IF NOT EXISTS idx_groups_active
ON groups(is_archived) WHERE is_archived = false;

-- ============================================================
-- PROFILES INDEXES
-- ============================================================

-- Phone lookup
CREATE INDEX IF NOT EXISTS idx_profiles_phone
ON profiles(phone) WHERE phone IS NOT NULL;

-- Points for leaderboards
CREATE INDEX IF NOT EXISTS idx_profiles_points
ON profiles(points DESC);

-- ============================================================
-- NOTIFICATIONS INDEXES
-- ============================================================

-- Get unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
ON notifications(user_id, date DESC) 
WHERE read = false;

-- Get all notifications for user
CREATE INDEX IF NOT EXISTS idx_notifications_user_date 
ON notifications(user_id, date DESC);

-- ============================================================
-- DM MESSAGES INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_dm_messages_thread_timestamp 
ON dm_messages(thread_id, timestamp DESC);

-- ============================================================
-- DM THREADS INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_dm_threads_last_message 
ON dm_threads(last_message_time DESC);

-- ============================================================
-- QUESTION VOTES INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_question_votes_message 
ON question_votes(message_id);

CREATE INDEX IF NOT EXISTS idx_question_votes_user 
ON question_votes(user_id);

-- ============================================================
-- TRANSACTIONS INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_transactions_user_date 
ON transactions(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_category 
ON transactions(user_id, category);

-- ============================================================
-- MARKETPLACE INDEXES (if table exists)
-- ============================================================

-- Listings by user
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_user 
ON marketplace_listings(user_id);

-- Active listings
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_active 
ON marketplace_listings(status) 
WHERE status = 'active';

-- Listings by category
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_category
ON marketplace_listings(category, created_at DESC);

-- ============================================================
-- USER PREFERENCES INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_v2 
ON user_preferences(user_id);

-- ============================================================
-- ANALYZE TABLES FOR QUERY OPTIMIZER
-- ============================================================

ANALYZE messages;
ANALYZE profiles;
ANALYZE groups;
ANALYZE group_members;
ANALYZE flashcards;
ANALYZE decks;
ANALYZE test_sessions;
ANALYZE test_results;
ANALYZE user_question_stats;
ANALYZE notifications;
ANALYZE dm_messages;
ANALYZE dm_threads;
ANALYZE question_votes;
ANALYZE transactions;
