/**
 * The page model for uploaded documents (`note_attachment_pages`).
 *
 * A note attachment stores its whole text as one blob on
 * `note_attachments.extracted_text`, and that stays exactly as it is — Smart
 * Notes, quiz generation and the companion all keep reading it. This module
 * adds the page boundaries BESIDE it, so a walk-through can say "you are on
 * page 7" and scope an explanation or a quiz to that page alone.
 *
 * Three writers, in order of quality:
 *   1. OCR (`noteOcr` → `pdfPageOcr`) — already reads a PDF page by page.
 *   2. The presentation preview job — the Gotenberg PDF, after conversion.
 *   3. `ensurePages` — a lazy backfill on first open, for every document
 *      uploaded before any of this existed.
 *
 * Every call feature-detects the 20260907180000 migration. Until it is applied
 * the reader returns `available: false` with no pages and every writer is a
 * no-op, so the walk-through says the document has not been split into pages
 * yet rather than inventing them. One warn log says so, once.
 */
import type { DataLayer } from './data';
import { logger } from '../utils/logger';
import {
  MAX_OCR_PDF_PAGES,
  extractPdfPageTextsFromBuffer,
  mergeExtractionTexts,
} from './noteFiles';
import { renderPdfPageImages } from './pdfPageOcr';
import { normalizeImageForStorage } from './imageProcessing';

const TABLE = 'note_attachment_pages';

/** Upsert chunk. Keeps a 40-page backfill to one round trip per chunk. */
const WRITE_CHUNK = 50;

/** Rendered page images are read on a phone, not fed to OCR. */
const PAGE_IMAGE_BUDGET = { maxDimension: 1600, quality: 78, thumb: null as number | null };
/**
 * Wall-clock budget for an on-demand image render inside an HTTP request.
 * Render's proxy gives up around 100s, so this must finish well inside it and
 * return whatever rendered — the next call continues where this one stopped.
 */
const PAGE_IMAGE_RENDER_BUDGET_MS = 45_000;

export interface NotePageRecord {
  attachmentId: string;
  /** 0-based. */
  pageIndex: number;
  text: string;
  charCount: number;
  /** Storage path in the private `note-files` bucket; never a URL. */
  imagePath: string | null;
  createdAt?: string;
}

/** Why a page list is empty. `ok` means the pages below are the real answer. */
export type NotePagesReason =
  | 'ok'
  /** The 20260907180000 migration has not been hand-applied yet. */
  | 'schema_missing'
  /** This kind of attachment has no pages (a photo, an audio clip, a video). */
  | 'unsupported'
  /** The source file is gone from storage. */
  | 'source_missing'
  /** A presentation whose Gotenberg PDF has not been produced yet. */
  | 'preview_pending'
  /** A file that could be downloaded but not split — corrupt or unreadable. */
  | 'unreadable';

export interface NotePagesResult {
  available: boolean;
  reason: NotePagesReason;
  pages: NotePageRecord[];
}

let warnedSchemaMissing = false;

/**
 * "The migration is not applied yet" — a missing table or PostgREST's cached
 * view of one. Anything else is a real fault and must surface: a broken table
 * must not read as a document with no pages.
 */
export function isMissingPagesSchema(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  const code = error.code || '';
  if (code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204') {
    return true;
  }
  return /note_attachment_pages/i.test(error.message || '')
    ? /does not exist|could not find/i.test(error.message || '')
    : false;
}

function warnSchemaOnce(operation: string, error: unknown): void {
  if (warnedSchemaMissing) return;
  warnedSchemaMissing = true;
  logger.warn(
    'note_attachment_pages is unavailable (migration 20260907180000 not applied); page model degrades to no pages',
    { operation, error }
  );
}

/** Test seam: the warn-once latch is process-wide. */
export function __resetNotePagesWarningForTests(): void {
  warnedSchemaMissing = false;
}

function mapRow(row: Record<string, unknown>): NotePageRecord {
  const text = typeof row.text === 'string' ? row.text : '';
  return {
    attachmentId: String(row.attachment_id),
    pageIndex: Number(row.page_index) || 0,
    text,
    charCount:
      typeof row.char_count === 'number' && row.char_count >= 0 ? row.char_count : text.length,
    imagePath: typeof row.image_path === 'string' && row.image_path ? row.image_path : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
  };
}

/** Read the stored pages for one attachment, in page order. */
export async function getPages(
  layer: DataLayer,
  attachmentId: string
): Promise<NotePagesResult> {
  if (!attachmentId) return { available: false, reason: 'unsupported', pages: [] };
  const { data, error } = await layer
    .getClient()
    .from(TABLE)
    .select('attachment_id, page_index, text, image_path, char_count, created_at')
    .eq('attachment_id', attachmentId)
    .order('page_index', { ascending: true });

  if (error) {
    if (isMissingPagesSchema(error)) {
      warnSchemaOnce('getPages', error);
      return { available: false, reason: 'schema_missing', pages: [] };
    }
    throw error;
  }

  return {
    available: true,
    reason: 'ok',
    pages: (data || []).map((row) => mapRow(row as Record<string, unknown>)),
  };
}

export interface PageWrite {
  pageIndex: number;
  text: string;
  /** Omit to leave any existing image_path alone. */
  imagePath?: string | null;
}

/**
 * Write pages for an attachment. Upserts on (attachment_id, page_index), so a
 * re-extraction replaces a page instead of duplicating it, and running OCR
 * after a text-layer backfill upgrades the same rows.
 *
 * Returns `available: false` (and writes nothing) when the migration is not
 * applied — callers treat that as "fine, carry on", never as a failure, because
 * every writer here is a side effect of a job whose real work already succeeded.
 */
export async function savePages(
  layer: DataLayer,
  attachmentId: string,
  pages: PageWrite[]
): Promise<{ available: boolean; saved: number }> {
  if (!attachmentId || !pages.length) return { available: true, saved: 0 };

  const rows = pages
    .filter((page) => Number.isInteger(page.pageIndex) && page.pageIndex >= 0)
    .map((page) => {
      const text = (page.text || '').trim();
      const row: Record<string, unknown> = {
        attachment_id: attachmentId,
        page_index: page.pageIndex,
        text,
        char_count: text.length,
      };
      // `undefined` is omitted from the upsert so an image rendered earlier is
      // not wiped by a later text-only pass.
      if (page.imagePath !== undefined) row.image_path = page.imagePath;
      return row;
    });

  let saved = 0;
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const { error } = await layer
      .getClient()
      .from(TABLE)
      .upsert(chunk, { onConflict: 'attachment_id,page_index' });
    if (error) {
      if (isMissingPagesSchema(error)) {
        warnSchemaOnce('savePages', error);
        return { available: false, saved: 0 };
      }
      throw error;
    }
    saved += chunk.length;
  }

  return { available: true, saved };
}

type AttachmentLike = {
  id: string;
  type?: string;
  fileName?: string;
  metadata?: Record<string, unknown> | null;
};

/**
 * Which stored file can be split into pages.
 *
 * A presentation is only paginable through its Gotenberg preview PDF — the raw
 * .pptx has no page geometry we can read here — so a deck whose preview has not
 * been produced reports `preview_pending` instead of pretending it has no pages.
 */
export function resolvePaginableSource(attachment: AttachmentLike): {
  storagePath: string | null;
  reason: NotePagesReason;
} {
  const meta = (attachment.metadata || {}) as Record<string, unknown>;
  const storagePath = typeof meta.storagePath === 'string' ? meta.storagePath : null;
  const previewPath =
    typeof meta.previewStoragePath === 'string' ? meta.previewStoragePath : null;

  if (attachment.type === 'presentation') {
    if (previewPath) return { storagePath: previewPath, reason: 'ok' };
    return { storagePath: null, reason: 'preview_pending' };
  }
  if (attachment.type === 'pdf') {
    // A PDF note may also have gone through a preview conversion; the original
    // is the right source either way.
    if (storagePath) return { storagePath, reason: 'ok' };
    return { storagePath: null, reason: 'source_missing' };
  }
  return { storagePath: null, reason: 'unsupported' };
}

/**
 * Read the pages for an attachment, backfilling them from the stored file the
 * first time anyone asks.
 *
 * The backfill is the pdfjs text-layer pass, capped at MAX_OCR_PDF_PAGES. A
 * scanned document has no text layer, so its pages are written with empty text
 * — that is honest (the plan panel shows "Page 4" with no title and says the
 * page has no text) and it is what lets a later OCR run upgrade the same rows
 * rather than start from nothing.
 */
export async function ensurePages(
  layer: DataLayer,
  params: { noteId: string; attachmentId: string }
): Promise<NotePagesResult & { backfilled: number }> {
  const existing = await getPages(layer, params.attachmentId);
  if (!existing.available) return { ...existing, backfilled: 0 };
  if (existing.pages.length > 0) return { ...existing, backfilled: 0 };

  const attachment = await layer.notes.getNoteAttachment(params.noteId, params.attachmentId);
  if (!attachment) {
    return { available: true, reason: 'source_missing', pages: [], backfilled: 0 };
  }

  const { storagePath, reason } = resolvePaginableSource(attachment as AttachmentLike);
  if (!storagePath) {
    return { available: true, reason, pages: [], backfilled: 0 };
  }

  let buffer: Buffer;
  try {
    const downloaded = await layer.notes.downloadNoteFile(storagePath);
    buffer = downloaded.buffer;
  } catch (err) {
    logger.warn('Page backfill could not download the source file', {
      attachmentId: params.attachmentId,
      storagePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: true, reason: 'source_missing', pages: [], backfilled: 0 };
  }

  const { pages } = await extractPdfPageTextsFromBuffer(buffer, { maxPages: MAX_OCR_PDF_PAGES });
  if (!pages.length) {
    return { available: true, reason: 'unreadable', pages: [], backfilled: 0 };
  }

  const write = await savePages(layer, params.attachmentId, pages);
  if (!write.available) {
    return { available: false, reason: 'schema_missing', pages: [], backfilled: 0 };
  }

  logger.info('Backfilled note attachment pages', {
    attachmentId: params.attachmentId,
    pageCount: write.saved,
    source: storagePath,
  });

  const refreshed = await getPages(layer, params.attachmentId);
  return { ...refreshed, backfilled: write.saved };
}

/** One page's text, and why there is none when there is none. */
export interface NotePageTextResult {
  available: boolean;
  /** `page_missing` is its own answer: the document HAS pages, just not this one. */
  reason: NotePagesReason | 'page_missing';
  /** '' whenever `reason` is not 'ok', and also for a real blank page. */
  text: string;
  pageCount: number;
}

/**
 * The text of one page, for the callers that scope AI work to it.
 *
 * The single seam the walk-through's two AI doors share — "quiz me on this
 * page" and an explanation scoped to this page — so they can never disagree
 * about what page 7 says. It backfills like the HTTP route does, and it
 * separates the three ways there can be no text: the migration is not applied
 * (`schema_missing`), the page does not exist (`page_missing`), or the page is
 * genuinely blank (`ok` with an empty string). The last one matters most: a
 * blank page must read as blank, not as an error and not as the rest of the
 * document, because that is what makes the companion's grounding badge honest
 * and what tells the quiz door to stay disabled.
 */
export async function getPageText(
  layer: DataLayer,
  params: { noteId: string; attachmentId: string; pageIndex: number }
): Promise<NotePageTextResult> {
  const pageIndex = Math.floor(Number(params.pageIndex));
  if (!Number.isFinite(pageIndex) || pageIndex < 0) {
    return { available: true, reason: 'page_missing', text: '', pageCount: 0 };
  }

  // The attachment must belong to THIS note. `getPages` is keyed by
  // attachment alone, so without this check a caller could pass a note it owns
  // and an attachment it does not, and read someone else's pages back.
  const attachment = await layer.notes.getNoteAttachment(params.noteId, params.attachmentId);
  if (!attachment) {
    return { available: true, reason: 'page_missing', text: '', pageCount: 0 };
  }

  const result = await ensurePages(layer, {
    noteId: params.noteId,
    attachmentId: params.attachmentId,
  });
  if (!result.available || result.reason !== 'ok') {
    return {
      available: result.available,
      reason: result.reason,
      text: '',
      pageCount: result.pages.length,
    };
  }

  const page = result.pages.find((row) => row.pageIndex === pageIndex);
  if (!page) {
    return { available: true, reason: 'page_missing', text: '', pageCount: result.pages.length };
  }
  return {
    available: true,
    reason: 'ok',
    text: typeof page.text === 'string' ? page.text : '',
    pageCount: result.pages.length,
  };
}

/**
 * Render and store a picture of each page that does not have one yet.
 *
 * Opt-in, because rendering is the expensive half of OCR: the caller asks for
 * it (the walk-through page viewer does; a plan panel does not). Bounded by
 * MAX_OCR_PDF_PAGES and a wall-clock budget, and it returns whatever finished —
 * a later call continues with the pages still missing an image.
 */
export async function ensurePageImages(
  layer: DataLayer,
  params: { noteId: string; attachmentId: string; maxPages?: number }
): Promise<{ available: boolean; rendered: number }> {
  const existing = await getPages(layer, params.attachmentId);
  if (!existing.available) return { available: false, rendered: 0 };

  const missing = existing.pages.filter((page) => !page.imagePath).map((page) => page.pageIndex);
  if (!missing.length) return { available: true, rendered: 0 };

  const attachment = await layer.notes.getNoteAttachment(params.noteId, params.attachmentId);
  if (!attachment) return { available: true, rendered: 0 };
  const { storagePath } = resolvePaginableSource(attachment as AttachmentLike);
  if (!storagePath) return { available: true, rendered: 0 };

  let buffer: Buffer;
  try {
    const downloaded = await layer.notes.downloadNoteFile(storagePath);
    buffer = downloaded.buffer;
  } catch (err) {
    logger.warn('Page image render could not download the source file', {
      attachmentId: params.attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: true, rendered: 0 };
  }

  const maxPages = Math.max(1, Math.min(params.maxPages ?? MAX_OCR_PDF_PAGES, MAX_OCR_PDF_PAGES));
  const { images } = await renderPdfPageImages(buffer, {
    pageIndexes: missing,
    maxPages,
    timeoutMs: PAGE_IMAGE_RENDER_BUDGET_MS,
  });

  const writes: PageWrite[] = [];
  for (const image of images) {
    try {
      const normalized = await normalizeImageForStorage(image.png, PAGE_IMAGE_BUDGET);
      // Path is derived from the source file so deleting the note's folder
      // still takes the page images with it.
      const imagePath = `${storagePath.replace(/\.[^./]+$/, '')}-page-${image.pageIndex}.${normalized.ext}`;
      await layer.notes.uploadNoteFile({
        storagePath: imagePath,
        buffer: normalized.buffer,
        contentType: normalized.contentType,
        upsert: true,
      });
      const page = existing.pages.find((p) => p.pageIndex === image.pageIndex);
      writes.push({ pageIndex: image.pageIndex, text: page?.text || '', imagePath });
    } catch (err) {
      logger.warn('Failed to store a rendered page image', {
        attachmentId: params.attachmentId,
        pageIndex: image.pageIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!writes.length) return { available: true, rendered: 0 };
  const saved = await savePages(layer, params.attachmentId, writes);
  return { available: saved.available, rendered: saved.available ? writes.length : 0 };
}

/**
 * Persist pages from a PDF's text layer alone. Used by the presentation
 * preview job the moment Gotenberg hands back a PDF of the deck.
 *
 * Best effort by contract: the preview and the extracted text are the job's
 * real output, and a page-model failure must never fail or retry that job.
 */
export async function persistPagesFromPdfBuffer(
  layer: DataLayer,
  attachmentId: string,
  buffer: Buffer,
  context?: { noteId?: string; source?: string }
): Promise<{ available: boolean; saved: number }> {
  try {
    const { pages } = await extractPdfPageTextsFromBuffer(buffer, { maxPages: MAX_OCR_PDF_PAGES });
    if (!pages.length) return { available: true, saved: 0 };
    const result = await savePages(layer, attachmentId, pages);
    if (result.saved > 0) {
      logger.info('Stored note attachment pages', {
        ...context,
        attachmentId,
        pageCount: result.saved,
      });
    }
    return result;
  } catch (err) {
    logger.warn('Storing note attachment pages failed', {
      ...context,
      attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: false, saved: 0 };
  }
}

/**
 * Persist pages after a PDF OCR run, combining what OCR read off each page
 * raster with that page's own text layer.
 *
 * Both are per-page views of the same page, and each catches what the other
 * misses: the text layer is exact where it exists, OCR is the only source on a
 * scan. `mergeExtractionTexts` is the same reconciliation the whole-document
 * path already uses, applied one page at a time — so a page can never end up
 * with less text than the blob already credits it with.
 */
export async function persistPagesAfterPdfOcr(
  layer: DataLayer,
  attachmentId: string,
  buffer: Buffer,
  ocrPages: Array<{ pageIndex: number; text: string }>,
  context?: { noteId?: string }
): Promise<{ available: boolean; saved: number }> {
  try {
    const { pages: layerPages } = await extractPdfPageTextsFromBuffer(buffer, {
      maxPages: MAX_OCR_PDF_PAGES,
    });
    const layerByIndex = new Map(layerPages.map((page) => [page.pageIndex, page.text]));
    const indexes = new Set<number>([
      ...ocrPages.map((page) => page.pageIndex),
      ...layerPages.map((page) => page.pageIndex),
    ]);
    if (!indexes.size) return { available: true, saved: 0 };

    const ocrByIndex = new Map(ocrPages.map((page) => [page.pageIndex, page.text]));
    const merged: PageWrite[] = [...indexes]
      .sort((a, b) => a - b)
      .map((pageIndex) => ({
        pageIndex,
        text: mergeExtractionTexts(layerByIndex.get(pageIndex) || '', ocrByIndex.get(pageIndex) || ''),
      }));

    const result = await savePages(layer, attachmentId, merged);
    if (result.saved > 0) {
      logger.info('Stored note attachment pages from OCR', {
        ...context,
        attachmentId,
        pageCount: result.saved,
      });
    }
    return result;
  } catch (err) {
    logger.warn('Storing note attachment pages after OCR failed', {
      ...context,
      attachmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: false, saved: 0 };
  }
}

/**
 * Sign the stored page images for display, in one batched call per bucket.
 *
 * Signed URLs expire, which is why `image_path` is what the table stores: every
 * read mints a fresh URL rather than handing back one that worked yesterday.
 */
export async function signPageImages(
  layer: DataLayer,
  pages: NotePageRecord[],
  options?: { expiresInSeconds?: number }
): Promise<Map<number, string>> {
  const refs = pages
    .map((page, index) =>
      page.imagePath ? { bucket: 'note-files', path: page.imagePath, index } : null
    )
    .filter(Boolean) as Array<{ bucket: string; path: string; index: number }>;
  if (!refs.length) return new Map();

  const signedByIndex = await layer.storageAcl.signStorageDisplayUrls(refs, {
    expiresInSeconds: options?.expiresInSeconds ?? 60 * 60 * 24,
  });

  const byPageIndex = new Map<number, string>();
  for (const [arrayIndex, url] of signedByIndex) {
    const page = pages[arrayIndex];
    if (page) byPageIndex.set(page.pageIndex, url);
  }
  return byPageIndex;
}
