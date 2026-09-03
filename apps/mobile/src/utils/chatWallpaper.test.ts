import {
  absoluteWallpaperUri,
  chatWallpaperStorageKey,
  dmWallpaperScopeKey,
  forgetWallpaperPath,
  groupWallpaperScopeKey,
  hasChatOverride,
  manifestDocumentIsSweepable,
  normalizeManifest,
  orphanedWallpaperFiles,
  resolveChatWallpaper,
  wallpaperFileName,
  wallpaperRelativePath,
  wallpaperScrimAlpha,
  withChatInheritDefault,
  withChatWallpaper,
  withChatWallpaperNone,
  withDefaultWallpaper,
  type ChatWallpaperManifest,
  type WallpaperPhoto,
} from './chatWallpaper';

const defaultPhoto: WallpaperPhoto = { path: 'chat-wallpapers/u1/default-1.jpg', savedAt: 1 };
const chatPhoto: WallpaperPhoto = { path: 'chat-wallpapers/u1/group-x-2.jpg', savedAt: 2 };

function manifest(over: Partial<ChatWallpaperManifest> = {}): ChatWallpaperManifest {
  return { v: 1, default: null, chats: {}, ...over };
}

describe('resolveChatWallpaper', () => {
  it('falls back to the default when the chat has no entry', () => {
    expect(resolveChatWallpaper(manifest({ default: defaultPhoto }), 'group:x')).toEqual(
      defaultPhoto,
    );
  });

  it('returns null when there is no entry and no default', () => {
    expect(resolveChatWallpaper(manifest(), 'group:x')).toBeNull();
  });

  it('lets an explicit none beat the default', () => {
    const m = manifest({ default: defaultPhoto, chats: { 'group:x': null } });
    expect(resolveChatWallpaper(m, 'group:x')).toBeNull();
  });

  it('prefers the chat photo over a different default', () => {
    const m = manifest({ default: defaultPhoto, chats: { 'group:x': chatPhoto } });
    expect(resolveChatWallpaper(m, 'group:x')).toEqual(chatPhoto);
  });

  it('is null-safe', () => {
    expect(resolveChatWallpaper(null, 'group:x')).toBeNull();
    expect(resolveChatWallpaper(undefined, 'group:x')).toBeNull();
  });
});

describe('overrides', () => {
  it('withChatInheritDefault deletes the key and restores the default', () => {
    const m = withChatInheritDefault(
      manifest({ default: defaultPhoto, chats: { 'group:x': chatPhoto } }),
      'group:x',
    );
    expect('group:x' in m.chats).toBe(false);
    expect(resolveChatWallpaper(m, 'group:x')).toEqual(defaultPhoto);
  });

  it('withChatWallpaperNone sets null and hasChatOverride tracks all three states', () => {
    const none = withChatWallpaperNone(manifest({ default: defaultPhoto }), 'group:x');
    expect(none.chats['group:x']).toBeNull();
    expect(hasChatOverride(none, 'group:x')).toBe(true);
    expect(hasChatOverride(manifest({ chats: { 'group:x': chatPhoto } }), 'group:x')).toBe(true);
    expect(hasChatOverride(manifest({ default: defaultPhoto }), 'group:x')).toBe(false);
  });

  it('never mutates its input', () => {
    const original = manifest({ default: defaultPhoto, chats: { 'group:x': chatPhoto } });
    const snapshot = JSON.parse(JSON.stringify(original));
    withDefaultWallpaper(original, null);
    withChatWallpaper(original, 'group:y', chatPhoto);
    withChatWallpaperNone(original, 'group:x');
    withChatInheritDefault(original, 'group:x');
    forgetWallpaperPath(original, chatPhoto.path);
    expect(original).toEqual(snapshot);
  });
});

describe('orphanedWallpaperFiles', () => {
  it('keeps files referenced by the default or by any chat entry', () => {
    const m = manifest({ default: defaultPhoto, chats: { 'group:x': chatPhoto, 'dm:y': null } });
    const files = ['default-1.jpg', 'group-x-2.jpg', 'stale-3.jpg', 'stale-4.jpg'];
    expect(orphanedWallpaperFiles(m, 'u1', files)).toEqual(['stale-3.jpg', 'stale-4.jpg']);
  });

  it('treats everything as orphaned when the manifest is empty', () => {
    expect(orphanedWallpaperFiles(manifest(), 'u1', ['a.jpg'])).toEqual(['a.jpg']);
  });
});

describe('forgetWallpaperPath', () => {
  it('clears the default and every chat entry pointing at the path, sparing explicit none', () => {
    const m = manifest({
      default: chatPhoto,
      chats: { 'group:x': chatPhoto, 'dm:y': null, 'group:z': defaultPhoto },
    });
    const next = forgetWallpaperPath(m, chatPhoto.path);
    expect(next.default).toBeNull();
    expect('group:x' in next.chats).toBe(false);
    expect(next.chats['dm:y']).toBeNull();
    expect(next.chats['group:z']).toEqual(defaultPhoto);
  });
});

describe('normalizeManifest', () => {
  it('returns a fresh empty manifest for unusable input', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '"x"', '{"v":2}']) {
      expect(normalizeManifest(raw as string | null)).toEqual({ v: 1, default: null, chats: {} });
    }
  });

  it('returns a new object each time, never a shared constant', () => {
    const a = normalizeManifest(null);
    const b = normalizeManifest(null);
    expect(a).not.toBe(b);
  });

  it('drops entries whose path is absolute or escapes the directory', () => {
    const raw = JSON.stringify({
      v: 1,
      default: { path: 'file:///abs.jpg', savedAt: 1 },
      chats: {
        'group:a': { path: '../escape.jpg', savedAt: 1 },
        'group:b': { path: '/abs/x.jpg', savedAt: 1 },
        'group:c': { nope: true },
        'group:d': null,
        'group:e': chatPhoto,
      },
    });
    const m = normalizeManifest(raw);
    expect(m.default).toBeNull();
    expect(Object.keys(m.chats).sort()).toEqual(['group:d', 'group:e']);
    expect(m.chats['group:d']).toBeNull();
    expect(m.chats['group:e']).toEqual(chatPhoto);
  });

  it('round-trips a well-formed document', () => {
    const m = manifest({ default: defaultPhoto, chats: { 'group:x': chatPhoto, 'dm:y': null } });
    expect(normalizeManifest(JSON.stringify(m))).toEqual(m);
  });
});

describe('paths and names', () => {
  it('slugifies the scope key', () => {
    expect(wallpaperFileName('dm:9f3a-BC', 1756900000000)).toBe('dm-9f3a-bc-1756900000000.jpg');
    expect(wallpaperFileName('group:abc-123', 1756900000000)).toBe(
      'group-abc-123-1756900000000.jpg',
    );
    expect(wallpaperFileName('default', 1)).toBe('default-1.jpg');
  });

  it('produces a different name per call time', () => {
    expect(wallpaperFileName('group:x', 1)).not.toBe(wallpaperFileName('group:x', 2));
  });

  it('builds relative paths under the user folder', () => {
    expect(wallpaperRelativePath('u1', 'a.jpg')).toBe('chat-wallpapers/u1/a.jpg');
  });

  it('joins the document directory without doubling the slash', () => {
    expect(absoluteWallpaperUri(null, defaultPhoto)).toBeNull();
    expect(absoluteWallpaperUri('file:///docs/', null)).toBeNull();
    expect(absoluteWallpaperUri('file:///docs/', defaultPhoto)).toBe(
      'file:///docs/chat-wallpapers/u1/default-1.jpg',
    );
    expect(absoluteWallpaperUri('file:///docs', defaultPhoto)).toBe(
      'file:///docs/chat-wallpapers/u1/default-1.jpg',
    );
  });

  it('builds the scope and storage keys', () => {
    expect(groupWallpaperScopeKey('g1')).toBe('group:g1');
    expect(dmWallpaperScopeKey('t1')).toBe('dm:t1');
    expect(chatWallpaperStorageKey('u1')).toBe('lantern_chat_wallpaper:u1');
  });
});

describe('wallpaperScrimAlpha', () => {
  it('never reaches zero and rises with high contrast', () => {
    expect(wallpaperScrimAlpha({ isDark: false, highContrast: false })).toBe(0.45);
    expect(wallpaperScrimAlpha({ isDark: true, highContrast: false })).toBe(0.55);
    expect(wallpaperScrimAlpha({ isDark: false, highContrast: true })).toBe(0.72);
    expect(wallpaperScrimAlpha({ isDark: true, highContrast: true })).toBe(0.78);
  });
});

describe('manifestDocumentIsSweepable', () => {
  it('allows a sweep when there is genuinely no document', () => {
    expect(manifestDocumentIsSweepable(null)).toBe(true);
    expect(manifestDocumentIsSweepable(undefined)).toBe(true);
    expect(manifestDocumentIsSweepable('')).toBe(true);
  });

  it('allows a sweep against a document at the current version', () => {
    expect(manifestDocumentIsSweepable(JSON.stringify({ v: 1, default: null, chats: {} }))).toBe(
      true,
    );
  });

  it('refuses to sweep against a document it cannot understand', () => {
    // A future manifest version must not read as "this user has no wallpapers".
    expect(manifestDocumentIsSweepable(JSON.stringify({ v: 2, chats: {} }))).toBe(false);
    expect(manifestDocumentIsSweepable('{ not json')).toBe(false);
    expect(manifestDocumentIsSweepable('[]')).toBe(false);
    expect(manifestDocumentIsSweepable('null')).toBe(false);
  });
});
