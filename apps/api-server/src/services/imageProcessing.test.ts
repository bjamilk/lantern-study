import sharp from 'sharp';
import {
  IMAGE_BUDGETS,
  buildThumbBuffer,
  normalizeImageForStorage,
  processImageForUpload,
} from './imageProcessing';

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('imageProcessing', () => {
  it('normalizes oversized images to WebP within maxDimension', async () => {
    const input = await makeJpeg(2400, 1800);
    const result = await normalizeImageForStorage(input, IMAGE_BUDGETS.flashcard, {
      detectedMime: 'image/jpeg',
    });

    expect(result.contentType).toBe('image/webp');
    expect(result.ext).toBe('webp');
    expect(result.passthrough).toBe(false);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
      IMAGE_BUDGETS.flashcard.maxDimension,
    );
    expect(result.buffer.length).toBeLessThan(input.length);
  });

  it('does not enlarge small images', async () => {
    const input = await makeJpeg(120, 80);
    const result = await normalizeImageForStorage(input, IMAGE_BUDGETS.avatar, {
      detectedMime: 'image/jpeg',
    });
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
  });

  it('builds thumbs inside the requested size', async () => {
    const input = await makeJpeg(1600, 1200);
    const thumb = await buildThumbBuffer(input, 320);
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width || 0, meta.height || 0)).toBeLessThanOrEqual(320);
  });

  it('passes animated GIFs through untouched', async () => {
    // Minimal 2-frame animated GIF (1x1 pixels).
    const gif = Buffer.from(
      '47494638396101000100F00000FFFFFF00000021FF0B4E45545343415045322E30030100000021F90405000001002C000000000100010000020144003B21F90405000001002C000000000100010000020144003B',
      'hex',
    );
    const result = await normalizeImageForStorage(gif, IMAGE_BUDGETS.chat, {
      detectedMime: 'image/gif',
    });
    expect(result.passthrough).toBe(true);
    expect(result.contentType).toBe('image/gif');
    expect(result.ext).toBe('gif');
    expect(Buffer.compare(result.buffer, gif)).toBe(0);
  });

  it('processImageForUpload returns a thumb for budgets that request one', async () => {
    const input = await makeJpeg(800, 600);
    const { normalized, thumb, budget } = await processImageForUpload(input, 'marketplace', {
      detectedMime: 'image/jpeg',
    });
    expect(normalized.contentType).toBe('image/webp');
    expect(budget.thumb).toBe(320);
    expect(thumb).not.toBeNull();
    expect(thumb!.length).toBeGreaterThan(0);
  });

  it('rejects corrupt buffers', async () => {
    await expect(
      normalizeImageForStorage(Buffer.from('not-an-image'), IMAGE_BUDGETS.chat),
    ).rejects.toBeTruthy();
  });
});
