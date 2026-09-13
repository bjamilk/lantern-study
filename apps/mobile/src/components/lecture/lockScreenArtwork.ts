import { sanitizeLockScreenArtworkUrl } from '../../services/lectureAudioEngine';

/**
 * The app mark shown beside the transport on the lock screen and in the shade.
 *
 * `Image.resolveAssetSource(require('icon.png')).uri` looks like the obvious
 * answer and is the bug: in a release build it answers the bundled-asset KEY
 * (`assets_icon`), and Android's `Metadata.artworkUrl` is a `java.net.URL`, so
 * `setActiveForLockScreen` threw `MalformedURLException: no protocol:
 * assets_icon` and took the whole recording down with it (Round 2c, check 3).
 *
 * `expo-asset` is the API that actually unpacks a bundled asset onto disk:
 * `downloadAsync()` then gives a `file://` `localUri`, which a JVM parses. It
 * is resolved once, lazily, off the render path — artwork is cosmetic, so
 * every failure here answers `undefined` rather than propagating.
 */
export type LockScreenArtworkLoader = () => Promise<string | undefined>;

let cached: string | undefined;
let inflight: Promise<string | undefined> | null = null;

const defaultLoader: LockScreenArtworkLoader = async () => {
  // Imported lazily so this module stays importable under plain ts-jest, and
  // so a binary without the native asset module cannot break app boot.
  const { Asset } = await import('expo-asset');
  const asset = Asset.fromModule(require('../../../assets/icon.png'));
  await asset.downloadAsync();
  return asset.localUri || asset.uri || undefined;
};

/** The resolved mark, or `undefined` while it is still being unpacked. */
export function peekLockScreenArtworkUrl(): string | undefined {
  return cached;
}

/** Resolve once per process; concurrent callers share the one attempt. */
export function resolveLockScreenArtworkUrl(
  loader: LockScreenArtworkLoader = defaultLoader
): Promise<string | undefined> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = (async () => {
      try {
        // Sanitised here too: a loader that answers a bare asset key must never
        // reach the native metadata, whatever the platform does next.
        cached = sanitizeLockScreenArtworkUrl(await loader());
      } catch {
        cached = undefined;
      } finally {
        inflight = null;
      }
      return cached;
    })();
  }
  return inflight;
}

/** Test seam only. */
export function __resetLockScreenArtwork(): void {
  cached = undefined;
  inflight = null;
}
