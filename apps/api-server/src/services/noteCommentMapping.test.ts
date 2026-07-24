import { mapNoteCommentRow } from './noteCommentMapping';

describe('mapNoteCommentRow', () => {
  const baseRow = {
    id: 'comment-1',
    note_id: 'note-1',
    user_id: 'user-1',
    comment: 'Looks good',
    created_at: '2026-07-24T00:00:00.000Z',
    resolved: false,
  };

  it('attaches the joined author profile', () => {
    const mapped = mapNoteCommentRow({
      ...baseRow,
      profiles: {
        id: 'user-1',
        name: 'Ada Lovelace',
        username: 'ada',
        avatar_url: 'https://example.com/ada.png',
      },
    });

    expect(mapped.user).toEqual({
      id: 'user-1',
      name: 'Ada Lovelace',
      username: 'ada',
      avatarUrl: 'https://example.com/ada.png',
    });
  });

  it('supports array-shaped PostgREST relations and username fallback', () => {
    const mapped = mapNoteCommentRow({
      ...baseRow,
      profiles: [
        {
          id: 'user-1',
          name: ' ',
          username: 'ada',
          avatar_url: null,
        },
      ],
    });

    expect(mapped.user.name).toBe('ada');
  });

  it('keeps a stable generic author when a profile join is unavailable', () => {
    const mapped = mapNoteCommentRow({ ...baseRow, profiles: null });

    expect(mapped.user).toEqual({
      id: 'user-1',
      name: 'User',
      username: undefined,
      avatarUrl: undefined,
    });
  });
});
