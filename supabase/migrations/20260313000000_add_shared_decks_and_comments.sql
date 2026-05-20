-- Allow decks to be shared and support collaboration

ALTER TABLE decks
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id),
  -- NOTE: Postgres does not allow referencing another column in a DEFAULT.
  -- We intentionally omit a default here; the application should set created_by.
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- Collaboration table (who can edit a shared deck)
CREATE TABLE IF NOT EXISTS deck_collaborators (
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer','editor','owner')),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (deck_id, user_id)
);

-- Comments / peer review notes on flashcards
CREATE TABLE IF NOT EXISTS flashcard_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flashcard_id UUID REFERENCES flashcards(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE
);

-- Group study session tracking
CREATE TABLE IF NOT EXISTS study_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS study_session_participants (
  session_id UUID REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);
