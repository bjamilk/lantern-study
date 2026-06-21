-- Notes system: folders, documents, attachments, collaboration

CREATE TABLE IF NOT EXISTS note_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  parent_id UUID REFERENCES note_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES note_folders(id) ON DELETE SET NULL,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Note',
  body TEXT NOT NULL DEFAULT '',
  summary TEXT,
  source_type TEXT NOT NULL DEFAULT 'typed' CHECK (source_type IN ('typed', 'youtube', 'pdf', 'audio', 'import')),
  youtube_url TEXT,
  youtube_video_id TEXT,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'audio', 'image', 'youtube')),
  file_url TEXT,
  file_name TEXT,
  extracted_text TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_collaborators (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'owner')),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id)
);

CREATE TABLE IF NOT EXISTS note_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_group ON notes(group_id);
CREATE INDEX IF NOT EXISTS idx_note_folders_user ON note_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id);
CREATE INDEX IF NOT EXISTS idx_note_collaborators_user ON note_collaborators(user_id);

-- Storage bucket for note files (PDF, audio)
INSERT INTO storage.buckets (id, name, public)
VALUES ('note-files', 'note-files', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE note_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_comments ENABLE ROW LEVEL SECURITY;

-- Folders: owner only
CREATE POLICY note_folders_select ON note_folders FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY note_folders_insert ON note_folders FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY note_folders_update ON note_folders FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY note_folders_delete ON note_folders FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Notes: owner, collaborator, or group member for shared group notes
CREATE POLICY notes_select ON notes FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM note_collaborators nc WHERE nc.note_id = notes.id AND nc.user_id = auth.uid())
    OR (group_id IS NOT NULL AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = notes.group_id AND gm.user_id = auth.uid()))
  );
CREATE POLICY notes_insert ON notes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY notes_update ON notes FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM note_collaborators nc WHERE nc.note_id = notes.id AND nc.user_id = auth.uid() AND nc.role IN ('editor', 'owner'))
  );
CREATE POLICY notes_delete ON notes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Attachments: via note access
CREATE POLICY note_attachments_select ON note_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND (
    n.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM note_collaborators nc WHERE nc.note_id = n.id AND nc.user_id = auth.uid())
    OR (n.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = n.group_id AND gm.user_id = auth.uid()))
  )));
CREATE POLICY note_attachments_insert ON note_attachments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.user_id = auth.uid()));
CREATE POLICY note_attachments_delete ON note_attachments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.user_id = auth.uid()));

-- Collaborators
CREATE POLICY note_collaborators_select ON note_collaborators FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.user_id = auth.uid())
  );
CREATE POLICY note_collaborators_insert ON note_collaborators FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.user_id = auth.uid()));
CREATE POLICY note_collaborators_delete ON note_collaborators FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.user_id = auth.uid())
  );

-- Comments
CREATE POLICY note_comments_select ON note_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND (
    n.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM note_collaborators nc WHERE nc.note_id = n.id AND nc.user_id = auth.uid())
    OR (n.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = n.group_id AND gm.user_id = auth.uid()))
  )));
CREATE POLICY note_comments_insert ON note_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY note_comments_delete ON note_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Storage policies for note-files
CREATE POLICY note_files_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'note-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY note_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'note-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY note_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'note-files' AND (storage.foldername(name))[1] = auth.uid()::text);
