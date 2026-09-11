import {
  WORKSPACE_RECENTS_STORAGE_KEY,
  upsertWorkspaceRecent,
  type WorkspaceRecent,
} from '@lantern/shared';

function parseRecents(raw: string | null): WorkspaceRecent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is WorkspaceRecent =>
        Boolean(
          row &&
            typeof row === 'object' &&
            typeof (row as WorkspaceRecent).courseId === 'string' &&
            typeof (row as WorkspaceRecent).openedAt === 'number'
        )
    );
  } catch {
    return [];
  }
}

export function readWorkspaceRecents(): WorkspaceRecent[] {
  if (typeof localStorage === 'undefined') return [];
  return parseRecents(localStorage.getItem(WORKSPACE_RECENTS_STORAGE_KEY));
}

export function touchWorkspaceRecent(courseId: string): WorkspaceRecent[] {
  const next = upsertWorkspaceRecent(readWorkspaceRecents(), courseId);
  try {
    localStorage.setItem(WORKSPACE_RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode — recents are a convenience, not a store.
  }
  return next;
}
