-- Recurring budget transactions (allowance, hostel, data/airtime, subscriptions).
-- Hand-apply in the Supabase SQL editor — this repo hand-applies migrations.
--
-- A rule stores what to post and how often; the API materialises due rules into
-- real budget_transactions rows on demand (client calls POST /budget/recurring/run
-- on load). Materialisation is idempotent: each generated row is tagged with
-- (recurring_rule_id, recurring_date) and a partial unique index makes a repeat
-- run a no-op, so calling run on every load can never double-post.

CREATE TABLE IF NOT EXISTS budget_recurring_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    category TEXT,
    description TEXT,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
    -- For monthly rules: which day of the month to post on (1-31, clamped to the
    -- month's length). Null for weekly rules (they post every 7 days from next_date).
    day_of_month INT CHECK (day_of_month BETWEEN 1 AND 31),
    -- The next date this rule is due to post. Advanced by the run endpoint.
    next_date DATE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_recurring_user
    ON budget_recurring_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_recurring_due
    ON budget_recurring_transactions(user_id, next_date) WHERE active;

ALTER TABLE budget_recurring_transactions ENABLE ROW LEVEL SECURITY;

-- Owner-only policies (defence in depth — the API uses the service role and
-- mutates these on the user's behalf; direct client access stays self-scoped).
DROP POLICY IF EXISTS "recurring_select_own" ON budget_recurring_transactions;
CREATE POLICY "recurring_select_own" ON budget_recurring_transactions
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "recurring_insert_own" ON budget_recurring_transactions;
CREATE POLICY "recurring_insert_own" ON budget_recurring_transactions
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "recurring_update_own" ON budget_recurring_transactions;
CREATE POLICY "recurring_update_own" ON budget_recurring_transactions
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "recurring_delete_own" ON budget_recurring_transactions;
CREATE POLICY "recurring_delete_own" ON budget_recurring_transactions
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Idempotency tag on generated transactions.
ALTER TABLE budget_transactions
    ADD COLUMN IF NOT EXISTS recurring_rule_id UUID
        REFERENCES budget_recurring_transactions(id) ON DELETE SET NULL;
ALTER TABLE budget_transactions
    ADD COLUMN IF NOT EXISTS recurring_date DATE;

-- One materialised row per (rule, date): a repeat run hits ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_tx_recurring
    ON budget_transactions(recurring_rule_id, recurring_date)
    WHERE recurring_rule_id IS NOT NULL;
