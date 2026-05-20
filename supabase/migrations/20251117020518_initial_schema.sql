-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    phone TEXT,
    points INTEGER DEFAULT 0,
    stats JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    badges JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Groups table
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    avatar_url TEXT,
    description TEXT,
    last_message TEXT,
    last_message_time TIMESTAMPTZ,
    admin_ids JSONB DEFAULT '[]',
    permissions JSONB DEFAULT '{}',
    parent_id UUID REFERENCES groups(id),
    is_archived BOOLEAN DEFAULT FALSE,
    invite_id TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Group members
CREATE TABLE group_members (
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    pending BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (group_id, user_id)
);

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    type TEXT NOT NULL CHECK (type IN ('TEXT', 'QUESTION')),
    text TEXT,
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    flagged_as_similar_user_ids JSONB DEFAULT '[]',
    is_archived BOOLEAN DEFAULT FALSE,
    question_data JSONB,
    image_url TEXT
);

-- Question votes
CREATE TABLE question_votes (
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
    PRIMARY KEY (message_id, user_id)
);

-- DM threads
CREATE TABLE dm_threads (
    id TEXT PRIMARY KEY,
    participant_ids JSONB NOT NULL,
    participants JSONB NOT NULL,
    last_message TEXT,
    last_message_time TIMESTAMPTZ
);

-- DM messages
CREATE TABLE dm_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id TEXT REFERENCES dm_threads(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Test sessions
CREATE TABLE test_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    config JSONB NOT NULL,
    questions JSONB NOT NULL,
    user_answers JSONB DEFAULT '{}',
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    is_offline BOOLEAN DEFAULT FALSE
);

-- Test results
CREATE TABLE test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES test_sessions(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    correct_answers_count INTEGER NOT NULL,
    total_questions INTEGER NOT NULL
);

-- Decks
CREATE TABLE decks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flashcards
CREATE TABLE flashcards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('BASIC', 'CLOZE')),
    front TEXT NOT NULL,
    back TEXT,
    cloze_text TEXT,
    srs_data JSONB DEFAULT '{}',
    tags JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
    amount REAL NOT NULL,
    category TEXT,
    description TEXT,
    date DATE DEFAULT CURRENT_DATE
);

-- Budgets
CREATE TABLE budgets (
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    target_amount REAL NOT NULL,
    PRIMARY KEY (user_id, month)
);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    date TIMESTAMPTZ DEFAULT NOW(),
    read BOOLEAN DEFAULT FALSE
);

-- Indexes for performance
CREATE INDEX idx_groups_parent_id ON groups(parent_id);
CREATE INDEX idx_messages_group_id ON messages(group_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_dm_messages_thread_id ON dm_messages(thread_id);
CREATE INDEX idx_test_sessions_user_id ON test_sessions(user_id);
CREATE INDEX idx_flashcards_deck_id ON flashcards(deck_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);

-- Row Level Security (RLS) policies
-- ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE question_votes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE dm_threads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE dm_messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (simplified for now)
-- For profiles: users can only see their own data
-- CREATE POLICY profiles_policy ON profiles FOR ALL USING (auth.uid() = id);

-- For groups: users can see groups they are members of
-- CREATE POLICY groups_policy ON groups FOR SELECT USING (
--     EXISTS (SELECT 1 FROM group_members WHERE group_id = groups.id AND user_id = auth.uid())
-- );

-- For messages: users can see messages in groups they are members of
-- CREATE POLICY messages_policy ON messages FOR SELECT USING (
--     EXISTS (SELECT 1 FROM group_members WHERE group_id = messages.group_id AND user_id = auth.uid())
-- );

-- Allow inserts/updates for group messages if member
-- CREATE POLICY messages_insert_policy ON messages FOR INSERT WITH CHECK (
--     EXISTS (SELECT 1 FROM group_members WHERE group_id = messages.group_id AND user_id = auth.uid())
-- );

-- Similar for other tables, but for simplicity, allow all for now (adjust later)
-- Note: For production, define proper policies

-- Similarly for other tables, but for now, skip detailed policies and focus on schema
