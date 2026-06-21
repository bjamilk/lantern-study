-- Group member-vs-member challenge duels (async)

CREATE TABLE IF NOT EXISTS group_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  challenger_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  opponent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'completed', 'cancelled')),
  config JSONB NOT NULL DEFAULT '{}',
  question_ids JSONB NOT NULL DEFAULT '[]',
  winner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  completed_at TIMESTAMPTZ,
  CONSTRAINT group_challenges_different_participants CHECK (challenger_id <> opponent_id)
);

CREATE TABLE IF NOT EXISTS challenge_participants (
  challenge_id UUID NOT NULL REFERENCES group_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  total_time NUMERIC NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  max_streak INTEGER NOT NULL DEFAULT 0,
  answers JSONB NOT NULL DEFAULT '{}',
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (challenge_id, user_id)
);

-- Extend notifications for typed challenge events
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_group_challenges_challenger ON group_challenges(challenger_id, status);
CREATE INDEX IF NOT EXISTS idx_group_challenges_opponent ON group_challenges(opponent_id, status);
CREATE INDEX IF NOT EXISTS idx_group_challenges_group ON group_challenges(group_id, status);
CREATE INDEX IF NOT EXISTS idx_group_challenges_expires ON group_challenges(expires_at) WHERE status = 'pending';

ALTER TABLE group_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_challenges_participant_select ON group_challenges
  FOR SELECT TO authenticated
  USING (challenger_id = auth.uid() OR opponent_id = auth.uid());

CREATE POLICY group_challenges_challenger_insert ON group_challenges
  FOR INSERT TO authenticated
  WITH CHECK (challenger_id = auth.uid());

CREATE POLICY group_challenges_participant_update ON group_challenges
  FOR UPDATE TO authenticated
  USING (challenger_id = auth.uid() OR opponent_id = auth.uid())
  WITH CHECK (challenger_id = auth.uid() OR opponent_id = auth.uid());

CREATE POLICY challenge_participants_select ON challenge_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM group_challenges gc
      WHERE gc.id = challenge_id
        AND gc.status = 'completed'
        AND (gc.challenger_id = auth.uid() OR gc.opponent_id = auth.uid())
    )
  );

CREATE POLICY challenge_participants_own_write ON challenge_participants
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Realtime for challenge notifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_challenges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_challenges;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.group_challenges REPLICA IDENTITY FULL;
