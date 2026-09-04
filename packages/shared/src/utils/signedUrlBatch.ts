/**
 * Coalesce per-image signed-URL requests into ONE batch call.
 *
 * Why this exists: signed storage URLs are minted with a 24h ceiling
 * (`STORAGE_SIGNED_URL_MAX_TTL`) and the URL that got frozen into
 * `messages.text` at upload time is dead a day later. The fix is to re-sign on
 * READ — but a board post screen mounts a root photo plus one photo per
 * comment, and a naive per-image call turns one screen into twenty round
 * trips on a Nigerian mobile connection.
 *
 * `POST /api/v1/storage/signed-urls` already accepts up to 40 references per
 * request, so every resolve that lands in the same tick is queued, de-duped by
 * (bucket, path, variant), chunked to `maxBatch`, and answered from one
 * response. Callers keep their simple `await resolve(url)` shape.
 *
 * Deliberately transport-free: web and mobile pass their own `sign`, so both
 * platforms send the SAME payload and read the SAME response shape, and this
 * file stays unit-testable with no fetch, no auth and no React.
 */

export type StorageVariant = 'thumb' | 'original';

export interface SignedUrlRequest {
  bucket: string;
  path: string;
  variant: StorageVariant;
}

/** One entry of the `data.items` array returned by POST /storage/signed-urls. */
export interface SignedUrlBatchResult {
  bucket?: string;
  path?: string;
  variant?: string;
  signedUrl?: string | null;
  error?: string;
}

export interface SignedUrlBatcherOptions {
  /**
   * Sends one batch. Must resolve results POSITIONALLY — result[i] answers
   * items[i] — which is what the route does (it `Promise.all`s over `items`).
   */
  sign: (
    items: SignedUrlRequest[],
    expiresInSeconds: number
  ) => Promise<SignedUrlBatchResult[]>;
  /** The route's hard cap. Never raise past it: 41 items is a 400. */
  maxBatch?: number;
  /** Injected in tests; production flushes on the microtask after this tick. */
  schedule?: (flush: () => void) => void;
}

export interface SignedUrlBatcher {
  request(item: SignedUrlRequest, expiresInSeconds: number): Promise<string>;
  /** Pending (not yet flushed) request count — tests only. */
  pendingCount(): number;
}

/** The dedupe key. Identical to the client-side cache key, on purpose. */
export function signedUrlRequestKey(item: SignedUrlRequest): string {
  return `${item.bucket}:${item.path}:${item.variant}`;
}

export const SIGNED_URL_BATCH_MAX = 40;

type Waiter = { resolve: (url: string) => void; reject: (error: Error) => void };

type QueueEntry = {
  item: SignedUrlRequest;
  expiresInSeconds: number;
  waiters: Waiter[];
};

export function createSignedUrlBatcher(
  options: SignedUrlBatcherOptions
): SignedUrlBatcher {
  const maxBatch = Math.max(1, Math.min(options.maxBatch ?? SIGNED_URL_BATCH_MAX, SIGNED_URL_BATCH_MAX));
  const schedule =
    options.schedule ?? ((flush: () => void) => void Promise.resolve().then(flush));

  let queue = new Map<string, QueueEntry>();
  let scheduled = false;

  const settle = (entry: QueueEntry, result: SignedUrlBatchResult | undefined) => {
    const url = result?.signedUrl;
    if (typeof url === 'string' && url) {
      for (const waiter of entry.waiters) waiter.resolve(url);
      return;
    }
    // An honest failure, not a silent pass-through: the caller renders a
    // "Photo unavailable" chip rather than a dead <img>.
    const message = result?.error || 'Failed to sign storage URL';
    for (const waiter of entry.waiters) waiter.reject(new Error(message));
  };

  const flush = () => {
    scheduled = false;
    const entries = [...queue.values()];
    queue = new Map();
    if (entries.length === 0) return;

    for (let start = 0; start < entries.length; start += maxBatch) {
      const chunk = entries.slice(start, start + maxBatch);
      // One TTL per request: take the smallest asked for in the chunk so no
      // caller is handed a URL that dies before it expected.
      const ttl = chunk.reduce(
        (min, entry) => Math.min(min, entry.expiresInSeconds),
        chunk[0]!.expiresInSeconds
      );
      void options
        .sign(
          chunk.map((entry) => entry.item),
          ttl
        )
        .then((results) => {
          chunk.forEach((entry, index) => settle(entry, results?.[index]));
        })
        .catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error));
          for (const entry of chunk) {
            for (const waiter of entry.waiters) waiter.reject(err);
          }
        });
    }
  };

  return {
    request(item, expiresInSeconds) {
      return new Promise<string>((resolve, reject) => {
        const key = signedUrlRequestKey(item);
        const existing = queue.get(key);
        if (existing) {
          existing.expiresInSeconds = Math.min(existing.expiresInSeconds, expiresInSeconds);
          existing.waiters.push({ resolve, reject });
        } else {
          queue.set(key, { item, expiresInSeconds, waiters: [{ resolve, reject }] });
        }
        if (!scheduled) {
          scheduled = true;
          schedule(flush);
        }
      });
    },
    pendingCount() {
      return queue.size;
    },
  };
}
