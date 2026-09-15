/**
 * F7a: bytes that pass the size cap can still be expensive. A small file can
 * declare enormous dimensions (a decompression bomb) and a small GIF can declare
 * thousands of frames — both spend server memory on a decode the resize was
 * supposed to prevent. These pin the pixel limit and the frame cap, and pin that
 * ordinary images and ordinary animated GIFs still behave exactly as before.
 */
import sharp from 'sharp';
import {
  GIF_TOO_MANY_FRAMES_MESSAGE,
  IMAGE_BUDGETS,
  IMAGE_TOO_LARGE_MESSAGE,
  MAX_GIF_FRAMES,
  MAX_INPUT_PIXELS,
  normalizeImageForStorage,
} from './imageProcessing';

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 10, b: 10 } },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * N-frame GIF built from a known-good 2-frame file: split it at the first
 * frame, then repeat that frame block. Tiny bytes, arbitrary frame count —
 * which is exactly the shape a byte-size cap cannot see.
 */
const TWO_FRAME_GIF_HEX =
  '47494638396101000100F00000FFFFFF00000021FF0B4E45545343415045322E30030100000021F90405000001002C000000000100010000020144003B21F90405000001002C000000000100010000020144003B';

function gifWithFrames(frames: number): Buffer {
  const firstFrame = TWO_FRAME_GIF_HEX.indexOf('21F90405');
  const prefix = TWO_FRAME_GIF_HEX.slice(0, firstFrame);
  // Each frame block in the source ends with a trailer byte; only the last one
  // in a real file has it, and libvips stops counting frames at the first.
  const frameHex = TWO_FRAME_GIF_HEX.slice(
    firstFrame,
    firstFrame + (TWO_FRAME_GIF_HEX.length - firstFrame) / 2,
  ).replace(/3B$/, '');
  return Buffer.from(prefix + frameHex.repeat(frames) + '3B', 'hex');
}

describe('decompression-bomb guard', () => {
  it('exposes a pixel limit that is generous for photos and finite for bombs', () => {
    expect(MAX_INPUT_PIXELS).toBeGreaterThan(4000 * 4000);
    expect(Number.isFinite(MAX_INPUT_PIXELS)).toBe(true);
  });

  it('refuses an image whose declared dimensions exceed the pixel limit', async () => {
    // A highly compressible PNG is a few KB on disk and enormous once decoded —
    // the shape the byte-size cap cannot see. The limit is lowered here rather
    // than materialising a 100-megapixel file in CI; the code path is identical.
    const smallLimit = 40_000; // 200x200
    await jest.isolateModulesAsync(async () => {
      process.env.IMAGE_MAX_INPUT_PIXELS = String(smallLimit);
      const mod = await import('./imageProcessing');
      const bomb = await makePng(600, 600);
      await expect(
        mod.normalizeImageForStorage(bomb, mod.IMAGE_BUDGETS.notePhoto, {
          detectedMime: 'image/png',
        }),
      ).rejects.toThrow(mod.IMAGE_TOO_LARGE_MESSAGE);
      delete process.env.IMAGE_MAX_INPUT_PIXELS;
    });
  });

  it('still normalizes an ordinary photo', async () => {
    const input = await makePng(2400, 1800);
    const result = await normalizeImageForStorage(input, IMAGE_BUDGETS.notePhoto, {
      detectedMime: 'image/png',
    });
    expect(result.contentType).toBe('image/webp');
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
      IMAGE_BUDGETS.notePhoto.maxDimension,
    );
  });
});

describe('GIF frame cap', () => {
  const smallAnimatedGif = Buffer.from(
    '47494638396101000100F00000FFFFFF00000021FF0B4E45545343415045322E30030100000021F90405000001002C000000000100010000020144003B21F90405000001002C000000000100010000020144003B',
    'hex',
  );

  it('keeps the passthrough behaviour for a normal animated GIF', async () => {
    const result = await normalizeImageForStorage(smallAnimatedGif, IMAGE_BUDGETS.chat, {
      detectedMime: 'image/gif',
    });
    expect(result.passthrough).toBe(true);
    expect(result.contentType).toBe('image/gif');
    expect(result.buffer).toBe(smallAnimatedGif);
  });

  it('refuses a GIF with more frames than the cap', async () => {
    const gif = gifWithFrames(MAX_GIF_FRAMES + 5);
    await expect(
      normalizeImageForStorage(gif, IMAGE_BUDGETS.chat, { detectedMime: 'image/gif' }),
    ).rejects.toThrow(GIF_TOO_MANY_FRAMES_MESSAGE);
  });

  it('accepts a GIF at the cap', async () => {
    const gif = gifWithFrames(MAX_GIF_FRAMES);
    const result = await normalizeImageForStorage(gif, IMAGE_BUDGETS.chat, {
      detectedMime: 'image/gif',
    });
    expect(result.passthrough).toBe(true);
  });
});
