/**
 * Creates the ai_companion_messages table for the AI companion feature.
 * Run: node tmp_create_companion_table.js
 */
const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
});

const sql = `
-- Companion conversation history
CREATE TABLE IF NOT EXISTS ai_companion_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  actions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companion_messages_user_created
  ON ai_companion_messages(user_id, created_at DESC);

ALTER TABLE ai_companion_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "companion_select_own" ON ai_companion_messages;
DROP POLICY IF EXISTS "companion_insert_own" ON ai_companion_messages;
DROP POLICY IF EXISTS "companion_delete_own" ON ai_companion_messages;

CREATE POLICY "companion_select_own"
  ON ai_companion_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "companion_insert_own"
  ON ai_companion_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "companion_delete_own"
  ON ai_companion_messages FOR DELETE
  USING (auth.uid() = user_id);
`;

async function run() {
  await client.connect();
  console.log('Connected to Supabase local DB');
  try {
    await client.query(sql);
    console.log('✅  ai_companion_messages table created with RLS policies');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
