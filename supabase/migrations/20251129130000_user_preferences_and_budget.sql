-- Migration: Add user preferences and budget tables for cross-device sync

-- User preferences table (theme, settings that should sync across devices)
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
    preferences JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Budget table (monthly budget settings)
CREATE TABLE IF NOT EXISTS user_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    monthly_limit DECIMAL(12,2) DEFAULT 0,
    month_year TEXT NOT NULL, -- Format: "YYYY-MM"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, month_year)
);

-- Budget transactions table
CREATE TABLE IF NOT EXISTS budget_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'investment')),
    amount DECIMAL(12,2) NOT NULL,
    category TEXT,
    description TEXT,
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pending sync results table (for offline test results waiting to sync)
CREATE TABLE IF NOT EXISTS pending_sync_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    result_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    synced BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMPTZ
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_budgets_user ON user_budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_budgets_month ON user_budgets(user_id, month_year);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_user ON budget_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_date ON budget_transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_pending_sync_results_user ON pending_sync_results(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_sync_results_synced ON pending_sync_results(user_id, synced);

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_sync_results ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_preferences
CREATE POLICY "Users can view own preferences" ON user_preferences
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own preferences" ON user_preferences
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own preferences" ON user_preferences
    FOR UPDATE USING (auth.uid() = user_id);

-- RLS policies for user_budgets
CREATE POLICY "Users can view own budgets" ON user_budgets
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own budgets" ON user_budgets
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own budgets" ON user_budgets
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own budgets" ON user_budgets
    FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for budget_transactions
CREATE POLICY "Users can view own transactions" ON budget_transactions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions" ON budget_transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own transactions" ON budget_transactions
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own transactions" ON budget_transactions
    FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for pending_sync_results
CREATE POLICY "Users can view own pending results" ON pending_sync_results
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pending results" ON pending_sync_results
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pending results" ON pending_sync_results
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own pending results" ON pending_sync_results
    FOR DELETE USING (auth.uid() = user_id);
