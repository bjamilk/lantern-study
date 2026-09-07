import { createRequire } from 'module';
import { existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../utils/logger';
import { MAX_OCR_PDF_PAGES, PDF_OCR_SCALE, PDF_OCR_TIMEOUT_MS } from './noteFiles';

const nodeRequire = createRequire(__filename);

/** One page as OCR read it. `pageIndex` is 0-based; `text` may be empty. */
export type PdfOcrPage = {
  pageIndex: number;
  text: string;
};

export type PdfPageOcrResult = {
  text: string;
  pageCount: number;
  ocrPageCount: number;
  capped: boolean;
  /**
   * Per-page text, in page order, for every page actually read. The joined
   * `text` above is unchanged and stays the input to Smart Notes / quiz — this
   * is the same content with the page boundaries kept instead of discarded.
   */
  pages: PdfOcrPage[];
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
  const scale = options?.scale ?? PDF_OCR_SCALE;
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
  const pages: PdfOcrPage[] = [];
  let pagesRead = 0;
  let timedOut = false;

  try {
    for (let pageNum = 1; pageNum <= pagesToOcr; pageNum++) {
      if (Date.now() - startedAt > timeoutMs) {
        // Keep whatever has already been recognized. Rendering at a legible DPI
        // costs real time per page, so a long PDF can exhaust the budget partway
        // — and partial text is far more useful than discarding every page read
        // so far. Only fail outright when nothing was recovered at all.
        if (!pageTexts.length) {
          throw new Error(
            `OCR timed out after ${Math.round(timeoutMs / 1000)}s before any page could be read.`
          );
        }
        timedOut = true;
        logger.warn('PDF page OCR timed out; returning partial text', {
          pagesRead,
          pagesRequested: pagesToOcr,
          timeoutMs,
        });
        break;
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
      pagesRead += 1;
      const trimmed = (text || '').trim();
      // The joined blob keeps skipping empty pages (unchanged behaviour); the
      // per-page list keeps them, because "page 4 is blank" is a fact the
      // walk-through needs and a hole in the numbering would be a bug.
      pages.push({ pageIndex: pageNum - 1, text: trimmed });
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
    ocrPageCount: pagesRead,
    capped: capped || timedOut,
    timedOut,
    scale,
    contentLength: text.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    text,
    pageCount,
    ocrPageCount: pagesRead,
    capped: capped || timedOut,
    pages,
  };
}

/**
 * Rasterize PDF pages to WebP-ready PNG buffers, without OCR.
 *
 * Same pdfjs + @napi-rs/canvas path the OCR reader uses, split out so the page
 * model can render a picture of page N on demand. Rendering is the expensive
 * half of OCR, so this is bounded twice: `maxPages` and a wall-clock budget.
 * Whatever finished inside the budget is returned — a partial set of page
 * images is useful (the walk-through shows the pages it has and renders the
 * rest on the next call), an exception is not.
 */
export async function renderPdfPageImages(
  buffer: Buffer,
  options?: {
    /** 0-based page indexes to render. Omit for "from the start". */
    pageIndexes?: number[];
    maxPages?: number;
    timeoutMs?: number;
    scale?: number;
  }
): Promise<{ images: Array<{ pageIndex: number; png: Buffer }>; pageCount: number }> {
  const maxPages = Math.max(1, options?.maxPages ?? MAX_OCR_PDF_PAGES);
  const timeoutMs = options?.timeoutMs ?? PDF_OCR_TIMEOUT_MS;
  // Page images are read on a phone, not fed to Tesseract, so they do not need
  // the 2.0 OCR scale. 1.5 (~108 DPI) is legible when zoomed and roughly half
  // the render cost and canvas memory.
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
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableWorker: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages || 1;

  const requested = (options?.pageIndexes ?? Array.from({ length: pageCount }, (_, i) => i))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount)
    .sort((a, b) => a - b)
    .slice(0, maxPages);

  const images: Array<{ pageIndex: number; png: Buffer }> = [];
  try {
    for (const pageIndex of requested) {
      if (Date.now() - startedAt > timeoutMs) {
        logger.warn('PDF page render budget exhausted; returning what rendered', {
          rendered: images.length,
          requested: requested.length,
          timeoutMs,
        });
        break;
      }
      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const canvasContext = canvas.getContext('2d');
      await page.render({ canvasContext, viewport, canvas }).promise;
      images.push({ pageIndex, png: canvas.toBuffer('image/png') });
    }
  } finally {
    try {
      await pdf.destroy?.();
    } catch {
      // ignore
    }
  }

  return { images, pageCount };
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
