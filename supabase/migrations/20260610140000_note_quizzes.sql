-- Persist generated note quizzes (questions, answers, progress)

CREATE TABLE IF NOT EXISTS note_quizzes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  study_goal TEXT NOT NULL DEFAULT 'retention',
  questions JSONB NOT NULL DEFAULT '[]',
  answers JSONB NOT NULL DEFAULT '{}',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_note_quizzes_user ON note_quizzes(user_id);
CREATE INDEX IF NOT EXISTS idx_note_quizzes_note ON note_quizzes(note_id);

ALTER TABLE note_quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_quizzes_select ON note_quizzes FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY note_quizzes_insert ON note_quizzes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY note_quizzes_update ON note_quizzes FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY note_quizzes_delete ON note_quizzes FOR DELETE TO authenticated
  USING (user_id = auth.uid());
