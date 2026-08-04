import { createRequire } from 'module';
import { existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../utils/logger';
import { MAX_OCR_PDF_PAGES, PDF_OCR_TIMEOUT_MS } from './noteFiles';

const nodeRequire = createRequire(__filename);

export type PdfPageOcrResult = {
  text: string;
  pageCount: number;
  ocrPageCount: number;
  capped: boolean;
};

type PdfJsModule = {
  getDocument: (src: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    disableWorker?: boolean;
    isEvalSupported?: boolean;
  }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions?: { workerSrc: string };
};

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy?: () => Promise<void> | void;
};

type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: unknown;
    viewport: { width: number; height: number };
    canvas?: unknown;
  }) => { promise: Promise<void> };
};

async function loadPdfJs(): Promise<PdfJsModule> {
  // pdfjs-dist 5.x ships ESM-only under legacy/build.
  const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJsModule;
  if (mod.GlobalWorkerOptions) {
    try {
      const workerPath = nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    } catch {
      // disableWorker below still allows rendering in many environments.
    }
  }
  return mod;
}

/**
 * Directory holding eng.traineddata, which is committed and copied into the
 * Docker image. Resolved from this module rather than process.cwd(): compiled
 * output lives at apps/api-server/dist/services and the source at
 * apps/api-server/src/services, so '../..' is the package root either way. The
 * container's cwd is /app, so relying on the default lookup would miss the file
 * and silently fall back to downloading the model.
 */
const TESSERACT_LANG_PATH = path.resolve(__dirname, '../..');

async function createTesseractWorker() {
  const { createWorker } = nodeRequire('tesseract.js') as {
    createWorker: (
      langs?: string,
      oem?: number,
      options?: Record<string, unknown>
    ) => Promise<{
      recognize: (image: Buffer | string) => Promise<{ data: { text: string } }>;
      terminate: () => Promise<void>;
    }>;
  };
  // langPath makes tesseract.js load the bundled model instead of fetching it
  // from a CDN on every cold start; it still falls back to the network if the
  // file is missing, so this is an optimisation rather than a hard dependency.
  const hasLocalModel = existsSync(path.join(TESSERACT_LANG_PATH, 'eng.traineddata'));
  if (!hasLocalModel) {
    logger.warn('eng.traineddata not found; tesseract.js will download the model', {
      langPath: TESSERACT_LANG_PATH,
    });
  }
  return createWorker('eng', 1, {
    logger: () => {},
    ...(hasLocalModel ? { langPath: TESSERACT_LANG_PATH, cachePath: TESSERACT_LANG_PATH } : {}),
  });
}

/**
 * Rasterize PDF pages with pdfjs + @napi-rs/canvas, then OCR with tesseract.js.
 * officeparser only OCRs embedded image XObjects and often yields empty results on
 * Node for scanned pages — this path renders each page as a real bitmap.
 */
export async function ocrPdfPagesFromBuffer(
  buffer: Buffer,
  options?: { maxPages?: number; timeoutMs?: number; scale?: number }
): Promise<PdfPageOcrResult> {
  const maxPages = Math.max(1, options?.maxPages ?? MAX_OCR_PDF_PAGES);
  const timeoutMs = options?.timeoutMs ?? PDF_OCR_TIMEOUT_MS;
  const scale = options?.scale ?? 1.5;
  const startedAt = Date.now();

  const { createCanvas } = nodeRequire('@napi-rs/canvas') as {
    createCanvas: (
      width: number,
      height: number
    ) => {
      width: number;
      height: number;
      getContext: (type: '2d') => unknown;
      toBuffer: (mime?: string) => Buffer;
    };
  };

  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableWorker: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages || 1;
  const pagesToOcr = Math.min(pageCount, maxPages);
  const capped = pageCount > maxPages;

  const worker = await createTesseractWorker();
  const pageTexts: string[] = [];

  try {
    for (let pageNum = 1; pageNum <= pagesToOcr; pageNum++) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `OCR timed out after ${Math.round(timeoutMs / 1000)}s (capped at ${maxPages} pages).`
        );
      }

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const canvasContext = canvas.getContext('2d');

      await page.render({
        canvasContext,
        viewport,
        canvas,
      }).promise;

      const png = canvas.toBuffer('image/png');
      const {
        data: { text },
      } = await worker.recognize(png);
      const trimmed = (text || '').trim();
      if (trimmed) {
        pageTexts.push(trimmed);
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
    try {
      await pdf.destroy?.();
    } catch {
      // ignore
    }
  }

  const text = pageTexts.join('\n\n').trim();
  logger.info('PDF page OCR finished', {
    pageCount,
    ocrPageCount: pagesToOcr,
    capped,
    contentLength: text.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    text,
    pageCount,
    ocrPageCount: pagesToOcr,
    capped,
  };
}

/**
 * OCR a single image buffer (JPEG/PNG/WebP/GIF) with tesseract.js.
 */
export async function ocrImageBuffer(buffer: Buffer, timeoutMs = 60_000): Promise<string> {
  const startedAt = Date.now();
  const worker = await createTesseractWorker();
  try {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Image OCR timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return (text || '').trim();
  } finally {
    await worker.terminate().catch(() => {});
  }
}
