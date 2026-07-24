export type NoteCommentProfile = {
  id?: string;
  name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

export type NoteCommentRow = {
  id: string;
  note_id: string;
  user_id: string;
  comment: string;
  created_at: string;
  resolved: boolean;
  profiles?: NoteCommentProfile | NoteCommentProfile[] | null;
};

function resolveNestedProfile(
  profiles: NoteCommentProfile | NoteCommentProfile[] | null | undefined
): NoteCommentProfile | null {
  if (Array.isArray(profiles)) return profiles[0] ?? null;
  return profiles ?? null;
}

/** Normalize both list and create responses so every comment carries its author. */
export function mapNoteCommentRow(row: NoteCommentRow) {
  const profile = resolveNestedProfile(row.profiles);
  const displayName =
    (typeof profile?.name === 'string' && profile.name.trim()) ||
    (typeof profile?.username === 'string' && profile.username.trim()) ||
    'User';

  return {
    id: row.id,
    noteId: row.note_id,
    userId: row.user_id,
    comment: row.comment,
    createdAt: row.created_at,
    resolved: row.resolved,
    user: {
      id: profile?.id || row.user_id,
      name: displayName,
      username: profile?.username || undefined,
      avatarUrl: profile?.avatar_url || undefined,
    },
  };
}

export const NOTE_COMMENT_SELECT = `
  id,
  note_id,
  user_id,
  comment,
  created_at,
  resolved,
  profiles!note_comments_user_id_fkey (
    id,
    name,
    username,
    avatar_url
  )
`;
