import AsyncStorage from '@react-native-async-storage/async-storage';
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

export async function readWorkspaceRecents(): Promise<WorkspaceRecent[]> {
  try {
    return parseRecents(await AsyncStorage.getItem(WORKSPACE_RECENTS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export async function touchWorkspaceRecent(courseId: string): Promise<WorkspaceRecent[]> {
  const next = upsertWorkspaceRecent(await readWorkspaceRecents(), courseId);
  try {
    await AsyncStorage.setItem(WORKSPACE_RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience.
  }
  return next;
}
