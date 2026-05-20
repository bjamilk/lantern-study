-- User Question Stats table
CREATE TABLE user_question_stats (
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    correct_attempts INTEGER DEFAULT 0,
    incorrect_attempts INTEGER DEFAULT 0,
    last_attempted TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, question_id)
);

-- Index for performance
CREATE INDEX idx_user_question_stats_user_id ON user_question_stats(user_id);