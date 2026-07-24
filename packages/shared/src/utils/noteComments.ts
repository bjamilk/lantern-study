import type { NoteComment } from '../types';

/**
 * Merge comment snapshots without duplicating a comment that arrives through
 * both the POST response and a realtime/poll refresh.
 */
export function mergeNoteComments(...snapshots: NoteComment[][]): NoteComment[] {
  const byId = new Map<string, NoteComment>();

  for (const snapshot of snapshots) {
    for (const comment of snapshot) {
      const existing = byId.get(comment.id);
      byId.set(comment.id, {
        ...existing,
        ...comment,
        user: comment.user ?? existing?.user,
      });
    }
  }

  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}
