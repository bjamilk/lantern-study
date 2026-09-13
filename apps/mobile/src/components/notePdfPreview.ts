/**
 * What the phone should do with a note's PDF attachment — the decision, on its
 * own, so it can be tested without a WebView.
 *
 * The bug this replaces: Android embedded
 * `https://docs.google.com/gview?embedded=true&url=<signed url>`. Google's
 * viewer is a SERVER-side render, so Google's machines have to fetch the file —
 * and our URLs are short-lived signed links to a private bucket that only the
 * student's session is meant to reach. The fetch fails, and the WebView then
 * shows GOOGLE's page: "You may be offline or with limited connectivity", on a
 * device that is demonstrably online (Round 2c, check 3). We never saw a
 * WebView error, so our own honest-reason work never got a chance to run.
 *
 * The rule now: a signed URL is only ever given to something that carries the
 * student's own request.
 *
 * - iOS: WKWebView renders PDFs natively, so the signed URL goes straight in.
 * - Android: WebView has no PDF renderer at all and cannot load app-cache
 *   `file://` PDFs (net::ERR_ACCESS_DENIED), so there is no in-app render to
 *   be had without shipping a new native dependency. The student gets a card
 *   naming the file, and Open hands the download to the system viewer.
 */
export type PdfPreviewPlan =
  | { kind: 'webview'; uri: string }
  | { kind: 'external'; url: string };

export function planPdfPreview(signedUrl: string, platform: string): PdfPreviewPlan {
  const url = (signedUrl || '').trim();
  if (platform === 'android') return { kind: 'external', url };
  return { kind: 'webview', uri: url };
}

/** Always false for a Google Docs viewer URL — the regression guard. */
export function isThirdPartyViewerUrl(url: string): boolean {
  return /docs\.google\.com\/(gview|viewer)/i.test(url || '');
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

/** Human file size, or null when the row never recorded one. */
export function formatFileSize(bytes?: number | null): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${SIZE_UNITS[unit]}`;
}

/** Attachment rows have carried the byte count under several keys over time. */
export function attachmentSizeBytes(metadata?: Record<string, unknown> | null): number | undefined {
  if (!metadata) return undefined;
  for (const key of ['size', 'fileSize', 'sizeBytes', 'byteSize', 'contentLength']) {
    const raw = metadata[key];
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/**
 * The byte count off a response, whatever case the header came back in.
 *
 * The attachment row is the FIRST source, but Round 2d showed the card reading
 * a bare "PDF": rows uploaded before the size was recorded carry no byte count
 * at all, and there is no backfill. The signed URL's own `Content-Length` is
 * the second source — it is the same object the student is about to open, so
 * it cannot disagree with the file, and a HEAD costs no download.
 *
 * `headers` is deliberately loose: `fetch` answers a `Headers`, while
 * `FileSystem.downloadAsync` answers a plain object.
 */
export function contentLengthBytes(
  headers?: { get?: (name: string) => string | null } | Record<string, unknown> | null,
): number | undefined {
  if (!headers) return undefined;
  const getter = (headers as { get?: (name: string) => string | null }).get;
  const raw =
    typeof getter === 'function'
      ? getter.call(headers, 'content-length')
      : Object.entries(headers as Record<string, unknown>).find(
          ([key]) => key.toLowerCase() === 'content-length',
        )?.[1];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * OUR sentence for a failed open, carrying whatever the failing hop said.
 * Never a guess about connectivity, and never a third party's page.
 */
export function describePdfOpenFailure(detail: { status?: number; message?: string }): string {
  const message = (detail.message || '').trim();
  const status = typeof detail.status === 'number' ? detail.status : undefined;
  if (!message) {
    return status
      ? `This PDF could not be opened (${status}).`
      : 'This PDF could not be opened on this device.';
  }
  return status ? `${message} (${status})` : message;
}

/** A safe cache file name for the downloaded copy. */
export function cachedPdfFileName(fileName: string | undefined, attachmentId: string): string {
  // Leading dots and separators go too: the name is concatenated onto the
  // cache directory, so nothing that reads as a path fragment may survive.
  const base = (fileName || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '');
  const stem = base.replace(/\.pdf$/i, '').slice(0, 60) || `document-${attachmentId.slice(0, 8)}`;
  return `${stem}.pdf`;
}
