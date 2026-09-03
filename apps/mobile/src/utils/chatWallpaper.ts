/**
 * Chat wallpaper — pure helpers.
 *
 * This module imports NOTHING outside TypeScript itself. `npx jest` runs it in
 * a node environment with no React Native or Expo runtime, so a single
 * `react-native` / `expo-*` import here would break the whole test run. Every
 * disk and picker call lives in `stores/chatWallpaperStore.ts` instead.
 */

export const CHAT_WALLPAPER_DIR = 'chat-wallpapers';
export const CHAT_WALLPAPER_MANIFEST_VERSION = 1;

/** A saved photo. `path` is RELATIVE to FileSystem.documentDirectory. */
export interface WallpaperPhoto {
  path: string; // e.g. "chat-wallpapers/<userId>/group-abc-1756900000000.jpg"
  savedAt: number;
}

/**
 * Per-chat value:
 *   key ABSENT     -> inherit the default
 *   null           -> this chat is deliberately plain, even if a default exists
 *   WallpaperPhoto -> this chat's own photo
 */
export type ChatWallpaperEntry = WallpaperPhoto | null;

export interface ChatWallpaperManifest {
  v: number;
  default: WallpaperPhoto | null; // null = no default
  chats: Record<string, ChatWallpaperEntry>;
}

export const EMPTY_MANIFEST: ChatWallpaperManifest = { v: 1, default: null, chats: {} };

function freshEmptyManifest(): ChatWallpaperManifest {
  // Never hand back EMPTY_MANIFEST by reference: callers store it in zustand
  // state and the reducers would then be mutating a module constant.
  return { v: CHAT_WALLPAPER_MANIFEST_VERSION, default: null, chats: {} };
}

export function chatWallpaperStorageKey(userId: string): string {
  return `lantern_chat_wallpaper:${userId}`;
}

export function groupWallpaperScopeKey(groupId: string): string {
  return `group:${groupId}`;
}

export function dmWallpaperScopeKey(threadId: string): string {
  return `dm:${threadId}`;
}

/** THE resolution rule. Absent -> default; null -> none; photo -> photo. */
export function resolveChatWallpaper(
  manifest: ChatWallpaperManifest | null | undefined,
  scopeKey: string,
): WallpaperPhoto | null {
  if (!manifest) return null;
  if (Object.prototype.hasOwnProperty.call(manifest.chats, scopeKey)) {
    return manifest.chats[scopeKey] ?? null;
  }
  return manifest.default ?? null;
}

/** True when the chat has its own entry (photo OR explicit none). Drives "Use my default". */
export function hasChatOverride(
  manifest: ChatWallpaperManifest | null | undefined,
  scopeKey: string,
): boolean {
  if (!manifest) return false;
  return Object.prototype.hasOwnProperty.call(manifest.chats, scopeKey);
}

export function withDefaultWallpaper(
  m: ChatWallpaperManifest,
  photo: WallpaperPhoto | null,
): ChatWallpaperManifest {
  return { v: m.v, default: photo, chats: { ...m.chats } };
}

export function withChatWallpaper(
  m: ChatWallpaperManifest,
  scopeKey: string,
  photo: WallpaperPhoto,
): ChatWallpaperManifest {
  return { v: m.v, default: m.default, chats: { ...m.chats, [scopeKey]: photo } };
}

/** Explicit "no background here", which outranks the default. */
export function withChatWallpaperNone(
  m: ChatWallpaperManifest,
  scopeKey: string,
): ChatWallpaperManifest {
  return { v: m.v, default: m.default, chats: { ...m.chats, [scopeKey]: null } };
}

/** DELETES the key, so the chat follows the default again. */
export function withChatInheritDefault(
  m: ChatWallpaperManifest,
  scopeKey: string,
): ChatWallpaperManifest {
  const chats = { ...m.chats };
  delete chats[scopeKey];
  return { v: m.v, default: m.default, chats };
}

/** Every relative path the manifest still references. */
export function referencedWallpaperPaths(m: ChatWallpaperManifest): string[] {
  const paths: string[] = [];
  if (m.default) paths.push(m.default.path);
  for (const key of Object.keys(m.chats)) {
    const entry = m.chats[key];
    if (entry) paths.push(entry.path);
  }
  return Array.from(new Set(paths));
}

/**
 * Files in the user's wallpaper folder that nothing references any more.
 * `fileNames` are bare names from readDirectoryAsync (no directory part).
 */
export function orphanedWallpaperFiles(
  m: ChatWallpaperManifest,
  userId: string,
  fileNames: string[],
): string[] {
  const kept = new Set(
    referencedWallpaperPaths(m)
      .filter((p) => p.startsWith(`${CHAT_WALLPAPER_DIR}/${userId}/`))
      .map((p) => p.slice(`${CHAT_WALLPAPER_DIR}/${userId}/`.length)),
  );
  return fileNames.filter((name) => !kept.has(name));
}

/** Drop every reference to a path whose file has gone missing. */
export function forgetWallpaperPath(
  m: ChatWallpaperManifest,
  path: string,
): ChatWallpaperManifest {
  const chats: Record<string, ChatWallpaperEntry> = {};
  for (const key of Object.keys(m.chats)) {
    const entry = m.chats[key];
    // An explicit `null` is a user decision, not a reference — leave it alone.
    if (entry && entry.path === path) continue;
    chats[key] = entry;
  }
  return {
    v: m.v,
    default: m.default && m.default.path === path ? null : m.default,
    chats,
  };
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('..')) return false;
  if (value.startsWith('/')) return false;
  // An absolute uri saved by an older build is useless: on iOS the app
  // container path changes on every install/update.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

function normalizePhoto(raw: unknown): WallpaperPhoto | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as { path?: unknown; savedAt?: unknown };
  if (!isSafeRelativePath(candidate.path)) return null;
  const savedAt = typeof candidate.savedAt === 'number' ? candidate.savedAt : 0;
  return { path: candidate.path, savedAt };
}

/** Tolerant parse of whatever came out of AsyncStorage. Never throws. */
export function normalizeManifest(raw: string | null | undefined): ChatWallpaperManifest {
  if (!raw) return freshEmptyManifest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return freshEmptyManifest();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return freshEmptyManifest();
  }
  const doc = parsed as { v?: unknown; default?: unknown; chats?: unknown };
  if (doc.v !== CHAT_WALLPAPER_MANIFEST_VERSION) return freshEmptyManifest();

  const chats: Record<string, ChatWallpaperEntry> = {};
  if (doc.chats && typeof doc.chats === 'object' && !Array.isArray(doc.chats)) {
    const source = doc.chats as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (value === null) {
        chats[key] = null;
        continue;
      }
      const photo = normalizePhoto(value);
      if (photo) chats[key] = photo;
      // Anything else is dropped: a malformed entry must not survive a restart.
    }
  }

  return {
    v: CHAT_WALLPAPER_MANIFEST_VERSION,
    default: normalizePhoto(doc.default),
    chats,
  };
}

/**
 * Is `raw` a manifest document this build understands well enough to base a
 * DELETE on?
 *
 * `normalizeManifest` is deliberately forgiving — it answers "an empty
 * manifest" for a document it cannot read, which is the right answer for
 * RENDERING and a catastrophic one for SWEEPING: an empty manifest references
 * no files, so `sweepOrphans` would take every wallpaper the student owns. That
 * is reachable two ways: a future `v` bump (every existing user's photos
 * deleted on first launch of the new build) and a corrupt document. So the
 * sweep asks this first, and only ever runs against a document that is either
 * absent (a genuinely new user) or at the current version.
 */
export function manifestDocumentIsSweepable(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined || raw === '') return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return (parsed as { v?: unknown }).v === CHAT_WALLPAPER_MANIFEST_VERSION;
}

/** `${dir}${photo.path}` with exactly one slash; null-safe. */
export function absoluteWallpaperUri(
  documentDirectory: string | null,
  photo: WallpaperPhoto | null,
): string | null {
  if (!documentDirectory || !photo) return null;
  const base = documentDirectory.endsWith('/') ? documentDirectory : `${documentDirectory}/`;
  const rel = photo.path.startsWith('/') ? photo.path.slice(1) : photo.path;
  return `${base}${rel}`;
}

/** Filename for a new save. scopeKey is "default" | "group:<id>" | "dm:<id>". */
export function wallpaperFileName(scopeKey: string | 'default', now: number): string {
  const slug = (scopeKey || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
  return `${slug || 'default'}-${now}.jpg`;
}

export function wallpaperRelativePath(userId: string, fileName: string): string {
  return `${CHAT_WALLPAPER_DIR}/${userId}/${fileName}`;
}

/**
 * Scrim alpha over the wallpaper. There is deliberately no way to reach 0: a
 * student must not be able to make their own transcript unreadable.
 */
export function wallpaperScrimAlpha(opts: { isDark: boolean; highContrast: boolean }): number {
  if (opts.highContrast) return opts.isDark ? 0.78 : 0.72;
  return opts.isDark ? 0.55 : 0.45;
}
