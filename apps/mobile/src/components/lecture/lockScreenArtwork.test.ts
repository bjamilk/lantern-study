import {
  __resetLockScreenArtwork,
  peekLockScreenArtworkUrl,
  resolveLockScreenArtworkUrl,
} from './lockScreenArtwork';

describe('resolveLockScreenArtworkUrl', () => {
  beforeEach(() => __resetLockScreenArtwork());

  it('answers the unpacked file:// copy of the bundled mark', async () => {
    await expect(
      resolveLockScreenArtworkUrl(async () => 'file:///data/cache/ExponentAsset-icon.png')
    ).resolves.toBe('file:///data/cache/ExponentAsset-icon.png');
    expect(peekLockScreenArtworkUrl()).toBe('file:///data/cache/ExponentAsset-icon.png');
  });

  it('drops a bare bundled-asset key rather than passing it to the native metadata', async () => {
    // What Image.resolveAssetSource answers in a release build, and the exact
    // value that killed playback in Round 2c.
    await expect(resolveLockScreenArtworkUrl(async () => 'assets_icon')).resolves.toBeUndefined();
  });

  it('swallows a loader failure — artwork must never cost the recording', async () => {
    await expect(
      resolveLockScreenArtworkUrl(async () => {
        throw new Error('ExpoAsset unavailable');
      })
    ).resolves.toBeUndefined();
  });

  it('resolves once and shares the attempt with concurrent callers', async () => {
    const loader = jest.fn(async () => 'https://cdn.test/mark.png');
    const [a, b] = await Promise.all([
      resolveLockScreenArtworkUrl(loader),
      resolveLockScreenArtworkUrl(loader),
    ]);
    expect(a).toBe('https://cdn.test/mark.png');
    expect(b).toBe('https://cdn.test/mark.png');
    await resolveLockScreenArtworkUrl(loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
