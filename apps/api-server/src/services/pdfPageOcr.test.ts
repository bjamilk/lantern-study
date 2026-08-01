import { createCanvas } from '@napi-rs/canvas';
import { ocrImageBuffer } from './pdfPageOcr';

describe('pdfPageOcr', () => {
  jest.setTimeout(90_000);

  it('OCRs an image raster with non-empty text (tesseract path)', async () => {
    const canvas = createCanvas(480, 96);
    const ctx = canvas.getContext('2d') as {
      fillStyle: string;
      font: string;
      fillRect: (x: number, y: number, w: number, h: number) => void;
      fillText: (text: string, x: number, y: number) => void;
    };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 480, 96);
    ctx.fillStyle = '#000000';
    ctx.font = '32px sans-serif';
    ctx.fillText('OCR Probe Text PDF', 24, 58);
    const png = canvas.toBuffer('image/png');

    const text = await ocrImageBuffer(png);
    expect(text.toLowerCase()).toMatch(/ocr|probe|text|pdf/);
  });
});
