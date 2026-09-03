/**
 * Chat wallpaper store — the only place that touches disk or the picker.
 *
 * The image never leaves the phone. It is downscaled, copied into the app's
 * document directory and remembered by a RELATIVE path; nothing is uploaded,
 * so setting a wallpaper costs a student zero data.
 *
 * DELIBERATE: signing out does NOT delete the manifest. `authStore.signOut`
 * already spares `lantern_starred_msgs:*` and `lantern_pinned_msg:*` for the
 * same reason — the key is user-id scoped, so a second account on a shared
 * handset cannot read it, and a student signing back in expects their chats to
 * look the way they left them.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
// The legacy entry point: SDK 54's new expo-file-system API dropped the
// synchronous-style helpers this file uses. prepareImage.ts does the same.
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { prepareImageForUpload } from '../utils/prepareImage';
import {
  CHAT_WALLPAPER_DIR,
  EMPTY_MANIFEST,
  chatWallpaperStorageKey,
  forgetWallpaperPath,
  manifestDocumentIsSweepable,
  normalizeManifest,
  orphanedWallpaperFiles,
  referencedWallpaperPaths,
  wallpaperFileName,
  wallpaperRelativePath,
  withChatInheritDefault,
  withChatWallpaper,
  withChatWallpaperNone,
  withDefaultWallpaper,
  type ChatWallpaperManifest,
  type WallpaperPhoto,
} from '../utils/chatWallpaper';

export type WallpaperPickResult = 'applied' | 'cancelled' | 'denied' | 'failed' | 'busy';

interface ChatWallpaperState {
  userId: string | null;
  manifest: ChatWallpaperManifest;
  hydrated: boolean;
  busy: boolean;
  hydrate: (userId: string | null) => Promise<void>;
  pickAndApply: (scope: 'default' | string) => Promise<WallpaperPickResult>;
  setNone: (scope: 'default' | string) => Promise<void>;
  inheritDefault: (scopeKey: string) => Promise<void>;
  forgetMissing: (path: string) => void;
  /** Drop everything held in memory. Called on sign-out; touches no files. */
  reset: () => void;
}

function emptyManifest(): ChatWallpaperManifest {
  return { ...EMPTY_MANIFEST, chats: {} };
}

function userDir(userId: string): string {
  return `${FileSystem.documentDirectory ?? ''}${CHAT_WALLPAPER_DIR}/${userId}/`;
}

async function persist(userId: string, manifest: ChatWallpaperManifest): Promise<void> {
  try {
    await AsyncStorage.setItem(chatWallpaperStorageKey(userId), JSON.stringify(manifest));
  } catch {
    /* A full disk must not take the chat down with it. */
  }
}

/** Delete every file in the user's folder the manifest no longer references. */
async function sweepOrphans(userId: string, manifest: ChatWallpaperManifest): Promise<void> {
  const dir = userDir(userId);
  let names: string[] = [];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return; // The folder has never been created — nothing to sweep.
  }
  for (const name of orphanedWallpaperFiles(manifest, userId, names)) {
    try {
      await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Paths already dropped in this session. Without this a broken URI would call
 * forgetMissing on every render of every row, and the resulting state-write
 * loop reads to a student as a hang.
 */
const forgotten = new Set<string>();

interface ManifestAccess {
  readManifest: () => ChatWallpaperManifest;
  writeManifest: (manifest: ChatWallpaperManifest) => void;
}

/** The picker + prepare + copy pipeline. Runs only under the `busy` guard. */
async function runPickAndApply(
  userId: string,
  scope: 'default' | string,
  access: ManifestAccess,
): Promise<WallpaperPickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return 'denied';

  // allowsEditing is off on purpose: Android's crop UI is 1:1-biased and
  // mangles a portrait wallpaper. exif is off so GPS never lands in app
  // storage; quality is 1 because prepareImageForUpload does the compression.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    base64: false,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return 'cancelled';
  const asset = result.assets[0];

  try {
    const prepared = await prepareImageForUpload(asset.uri, 'chatWallpaper', {
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    });

    const dir = userDir(userId);
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const fileName = wallpaperFileName(scope === 'default' ? 'default' : scope, Date.now());

    // COPY, never keep prepared.uri: it points inside expo-image-manipulator's
    // CACHE directory, which Android reclaims under storage pressure — and on
    // failure prepareImageForUpload hands back the ORIGINAL picker uri, a
    // content:// grant that dies with the activity.
    await FileSystem.copyAsync({ from: prepared.uri, to: `${dir}${fileName}` });

    // File first, verified, THEN the preference: the reverse order can leave
    // a live reference to a file that never existed.
    const info = await FileSystem.getInfoAsync(`${dir}${fileName}`);
    if (!info.exists) throw new Error('Wallpaper file was not written');

    const photo: WallpaperPhoto = {
      path: wallpaperRelativePath(userId, fileName),
      savedAt: Date.now(),
    };
    const manifest =
      scope === 'default'
        ? withDefaultWallpaper(access.readManifest(), photo)
        : withChatWallpaper(access.readManifest(), scope, photo);
    await persist(userId, manifest);
    access.writeManifest(manifest);
    // The replaced file is now unreferenced. Never overwrite a name in place:
    // React Native's image cache is keyed by URI and would keep showing the
    // OLD bitmap until the screen remounts, which reads as "it ignored me".
    await sweepOrphans(userId, manifest);
    return 'applied';
  } catch {
    return 'failed';
  }
}

export const useChatWallpaperStore = create<ChatWallpaperState>((set, get) => ({
  userId: null,
  manifest: emptyManifest(),
  hydrated: false,
  busy: false,

  hydrate: async (userId) => {
    if (get().userId !== userId) forgotten.clear();
    if (!userId) {
      set({ userId: null, manifest: emptyManifest(), hydrated: true });
      return;
    }
    const state = get();
    if (state.userId === userId && state.hydrated) return;

    // The read is separated from the parse so a FAILED read can be told apart
    // from an EMPTY one. They are not the same thing: AsyncStorage rejects on a
    // busy or full SQLite database (exactly the cheap Android this is for), and
    // answering that with "the student has no wallpapers" would hand an empty
    // manifest to sweepOrphans, which deletes every file the manifest does not
    // reference — i.e. all of them. A transient read error must never delete.
    let raw: string | null = null;
    let readOk = true;
    try {
      raw = await AsyncStorage.getItem(chatWallpaperStorageKey(userId));
    } catch {
      readOk = false;
    }
    let manifest = readOk ? normalizeManifest(raw) : emptyManifest();
    const maySweep = readOk && manifestDocumentIsSweepable(raw);

    // Drop references to files that are gone (storage cleaner, "clear data",
    // a restored backup that carried AsyncStorage but not the documents).
    if (readOk) {
      let changed = false;
      const base = FileSystem.documentDirectory ?? '';
      for (const path of referencedWallpaperPaths(manifest)) {
        try {
          const info = await FileSystem.getInfoAsync(`${base}${path}`);
          if (!info.exists) {
            manifest = forgetWallpaperPath(manifest, path);
            changed = true;
          }
        } catch {
          manifest = forgetWallpaperPath(manifest, path);
          changed = true;
        }
      }
      if (changed) await persist(userId, manifest);
    }
    if (maySweep) await sweepOrphans(userId, manifest);

    // `hydrated` stays false after a failed read, so the next screen that mounts
    // retries instead of the session being stuck on a manifest we never read.
    set({ userId, manifest, hydrated: readOk });
  },

  pickAndApply: async (scope) => {
    const userId = get().userId;
    if (!userId) return 'failed';
    // Re-entrancy guard. Preparing a 12 MP photo takes seconds on the target
    // hardware, and a second run would race the first: the LAST pipeline to
    // finish rebuilds the manifest from `get().manifest` and then sweeps, so an
    // abandoned first pick could overwrite — and delete — the photo the student
    // actually chose second.
    if (get().busy) return 'busy';

    // `busy` covers the whole operation, picker included, so the sheet's
    // "Choose a photo" row is disabled for as long as anything is in flight.
    set({ busy: true });
    try {
      return await runPickAndApply(userId, scope, {
        readManifest: () => get().manifest,
        writeManifest: (manifest) => set({ manifest }),
      });
    } finally {
      set({ busy: false });
    }
  },

  setNone: async (scope) => {
    const userId = get().userId;
    if (!userId) return;
    const manifest =
      scope === 'default'
        ? withDefaultWallpaper(get().manifest, null)
        : withChatWallpaperNone(get().manifest, scope);
    await persist(userId, manifest);
    set({ manifest });
    await sweepOrphans(userId, manifest);
  },

  inheritDefault: async (scopeKey) => {
    const userId = get().userId;
    if (!userId) return;
    const manifest = withChatInheritDefault(get().manifest, scopeKey);
    await persist(userId, manifest);
    set({ manifest });
    await sweepOrphans(userId, manifest);
  },

  /**
   * Called when the Image layer fails to render a wallpaper. It CONFIRMS the
   * file is really gone before touching the preference.
   *
   * RN's `onError` is a generic load failure — on Android it is Fresco's
   * `onFailure`, which covers a decode error and bitmap-pool exhaustion just as
   * much as a missing file. Trusting it meant one transient OOM on a 2 GB
   * handset silently deleted the student's chosen background, and the next
   * hydrate then swept the file itself. So: verify, then forget.
   */
  forgetMissing: (path) => {
    if (forgotten.has(path)) return;
    forgotten.add(path);
    void (async () => {
      const base = FileSystem.documentDirectory ?? '';
      try {
        const info = await FileSystem.getInfoAsync(`${base}${path}`);
        // The file is fine — this was a transient decode failure. Keep the
        // preference; the layer will paint again on the next mount.
        if (info.exists) {
          forgotten.delete(path);
          return;
        }
      } catch {
        forgotten.delete(path);
        return; // Could not check: assume nothing, delete nothing.
      }
      const { userId, manifest } = get();
      const next = forgetWallpaperPath(manifest, path);
      set({ manifest: next });
      if (userId) void persist(userId, next);
    })();
  },

  reset: () => {
    forgotten.clear();
    set({ userId: null, manifest: emptyManifest(), hydrated: false, busy: false });
  },
}));
