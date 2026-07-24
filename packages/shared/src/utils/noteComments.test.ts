import type { NoteComment } from '../types';
import { mergeNoteComments } from './noteComments';

const baseComment: NoteComment = {
  id: 'comment-1',
  noteId: 'note-1',
  userId: 'user-1',
  comment: 'First',
  createdAt: '2026-07-24T00:00:00.000Z',
  resolved: false,
};

describe('mergeNoteComments', () => {
  it('deduplicates a POST response and refreshed snapshot by id', () => {
    const merged = mergeNoteComments(
      [baseComment],
      [{ ...baseComment, user: { id: 'user-1', name: 'Ada' } }]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.user?.name).toBe('Ada');
  });

  it('preserves author data when a later snapshot omits it', () => {
    const merged = mergeNoteComments(
      [{ ...baseComment, user: { id: 'user-1', name: 'Ada' } }],
      [baseComment]
    );

    expect(merged[0]?.user?.name).toBe('Ada');
  });

  it('sorts concurrent comments chronologically', () => {
    const later = {
      ...baseComment,
      id: 'comment-2',
      createdAt: '2026-07-24T00:01:00.000Z',
    };

    expect(mergeNoteComments([later], [baseComment]).map((comment) => comment.id)).toEqual([
      'comment-1',
      'comment-2',
    ]);
  });
});
