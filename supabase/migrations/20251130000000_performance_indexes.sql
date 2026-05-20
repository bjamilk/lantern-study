-- ============================================
-- PERFORMANCE INDEXES FOR 300K CONCURRENT USERS
-- Created: 2025-11-30
-- ============================================

-- ============================================
-- MESSAGES TABLE - High traffic table
-- ============================================
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_timestamp ON messages(group_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_type_question ON messages(type) WHERE type = 'QUESTION';
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);

-- ============================================
-- GROUP MEMBERS - Frequent membership lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_pending ON group_members(pending) WHERE pending = true;
CREATE INDEX IF NOT EXISTS idx_group_members_joined ON group_members(joined_at DESC);

-- ============================================
-- DM THREADS - JSONB indexing for participant lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_dm_threads_participants ON dm_threads USING GIN(participant_ids);
CREATE INDEX IF NOT EXISTS idx_dm_threads_last_message ON dm_threads(last_message_time DESC);

-- ============================================
-- DM MESSAGES - Conversation queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_dm_messages_timestamp ON dm_messages(thread_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dm_messages_sender ON dm_messages(sender_id);

-- ============================================
-- NOTIFICATIONS - User inbox queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(user_id, date DESC);

-- ============================================
-- FLASHCARDS - SRS and deck queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_flashcards_srs ON flashcards USING GIN(srs_data);
CREATE INDEX IF NOT EXISTS idx_flashcards_created ON flashcards(created_at DESC);

-- ============================================
-- DECKS - User deck queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_decks_user_id ON decks(user_id);
CREATE INDEX IF NOT EXISTS idx_decks_created ON decks(created_at DESC);

-- ============================================
-- MARKETPLACE - Search and filtering
-- ============================================
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_active ON marketplace_listings(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_category_price ON marketplace_listings(category, price);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_user ON marketplace_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_created ON marketplace_listings(created_at DESC);

-- ============================================
-- MARKETPLACE FAVORITES - User favorites
-- ============================================
CREATE INDEX IF NOT EXISTS idx_marketplace_favorites_user ON marketplace_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_favorites_listing ON marketplace_favorites(listing_id);

-- ============================================
-- MARKETPLACE INQUIRIES - Conversation tracking
-- ============================================
CREATE INDEX IF NOT EXISTS idx_marketplace_inquiries_buyer ON marketplace_inquiries(buyer_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_inquiries_seller ON marketplace_inquiries(seller_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_inquiries_listing ON marketplace_inquiries(listing_id);

-- ============================================
-- QUESTION VOTES - Vote counting
-- ============================================
CREATE INDEX IF NOT EXISTS idx_question_votes_message ON question_votes(message_id);
CREATE INDEX IF NOT EXISTS idx_question_votes_user ON question_votes(user_id);

-- ============================================
-- TEST SESSIONS - User history
-- ============================================
CREATE INDEX IF NOT EXISTS idx_test_sessions_user_start ON test_sessions(user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_test_sessions_offline ON test_sessions(is_offline) WHERE is_offline = true;

-- ============================================
-- TEST RESULTS - Score lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_test_results_session ON test_results(session_id);

-- ============================================
-- USER QUESTION STATS - Performance tracking
-- ============================================
CREATE INDEX IF NOT EXISTS idx_user_question_stats_user ON user_question_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_question_stats_question ON user_question_stats(question_id);

-- ============================================
-- PROFILES - User lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_profiles_created ON profiles(created_at DESC);

-- ============================================
-- GROUPS - Hierarchy and search
-- ============================================
CREATE INDEX IF NOT EXISTS idx_groups_parent ON groups(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_groups_archived ON groups(is_archived) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_groups_invite ON groups(invite_id) WHERE invite_id IS NOT NULL;

-- ============================================
-- OFFLINE BUNDLES - User bundle lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_offline_bundles_user ON offline_bundles(user_id);

-- ============================================
-- BUDGET TRANSACTIONS - Financial queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_budget_transactions_user ON budget_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_date ON budget_transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_type ON budget_transactions(type);

-- ============================================
-- ANALYZE tables to update query planner statistics
-- ============================================
ANALYZE messages;
ANALYZE group_members;
ANALYZE dm_threads;
ANALYZE dm_messages;
ANALYZE notifications;
ANALYZE flashcards;
ANALYZE decks;
ANALYZE marketplace_listings;
ANALYZE question_votes;
ANALYZE test_sessions;
ANALYZE profiles;
ANALYZE groups;
