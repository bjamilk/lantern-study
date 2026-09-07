import {
  pagesUnavailableCopy,
  shouldRetryPages,
  walkthroughUnavailableCopy,
  type WalkthroughReason,
} from './walkthroughCopy';

/** A throw shaped the way both clients' fetch layers now shape one. */
function requestError(message: string, status?: number, body?: unknown): Error {
  const error = new Error(message) as Error & { status?: number; body?: unknown };
  if (status !== undefined) error.status = status;
  if (body !== undefined) error.body = body;
  return error;
}

const RAW_404 =
  'Not found - /api/v1/notes/2f1c9a0e-1111-4b6a-9d3f-000000000001/attachments/8b7d6c5e-2222-4a1b-8c9d-000000000002/pages?images=1';

describe('pagesUnavailableCopy', () => {
  it('never shows the server sentence, the endpoint path or a UUID', () => {
    const copy = pagesUnavailableCopy(requestError(RAW_404, 404));
    const shown = `${copy.title} ${copy.detail} ${copy.retryLabel ?? ''}`;
    expect(shown).not.toContain('/api/');
    expect(shown).not.toContain('pages?images=1');
    expect(shown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(shown).not.toContain('Not found -');
  });

  it('reads a 404 on this route as "not split into pages yet", with no retry', () => {
    const copy = pagesUnavailableCopy(requestError(RAW_404, 404));
    expect(copy).toEqual(walkthroughUnavailableCopy('schema_missing'));
    expect(copy.retryable).toBe(false);
    expect(copy.retryLabel).toBeNull();
  });

  it('says the same thing whether the server refused or answered schema_missing', () => {
    expect(pagesUnavailableCopy({ available: false, reason: 'schema_missing' })).toEqual(
      pagesUnavailableCopy(requestError(RAW_404, 404))
    );
  });

  it('reads a NOT_FOUND code with no status the same way', () => {
    const error = Object.assign(new Error(RAW_404), { code: 'NOT_FOUND' });
    expect(pagesUnavailableCopy(error).detail).toBe(
      walkthroughUnavailableCopy('schema_missing').detail
    );
  });

  it('takes the reason from a payload carried on the thrown error', () => {
    const copy = pagesUnavailableCopy(requestError('anything', 409, { reason: 'preview_pending' }));
    expect(copy).toEqual(walkthroughUnavailableCopy('preview_pending'));
    expect(copy.retryable).toBe(true);
  });

  it('offers a retry when the browser is offline', () => {
    const copy = pagesUnavailableCopy(new Error('Failed to fetch'));
    expect(copy.retryable).toBe(true);
    expect(copy.detail).not.toContain('fetch');
  });

  it('falls back to a generic, retryable sentence for a server fault', () => {
    const copy = pagesUnavailableCopy(requestError('column pages.text does not exist', 500));
    expect(copy.retryable).toBe(true);
    expect(copy.detail).not.toContain('pages.text');
  });

  it('treats nothing at all as "no pages in it"', () => {
    expect(pagesUnavailableCopy(null)).toEqual(walkthroughUnavailableCopy('ok'));
  });

  it('ignores a reason the contract does not name', () => {
    const copy = pagesUnavailableCopy({ available: false, reason: 'quantum_flux' });
    expect(copy.detail).not.toContain('quantum_flux');
  });
});

describe('walkthroughUnavailableCopy', () => {
  const reasons: WalkthroughReason[] = [
    'ok',
    'schema_missing',
    'unsupported',
    'source_missing',
    'preview_pending',
    'unreadable',
  ];

  it('gives every reason a sentence, and a label only when a retry can help', () => {
    for (const reason of reasons) {
      const copy = walkthroughUnavailableCopy(reason);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
      expect(copy.retryLabel === null).toBe(copy.retryable === false);
    }
  });
});

describe('shouldRetryPages', () => {
  it('polls only the deck that is still converting', () => {
    expect(shouldRetryPages('preview_pending')).toBe(true);
    expect(shouldRetryPages('schema_missing')).toBe(false);
    expect(shouldRetryPages('source_missing')).toBe(false);
    expect(shouldRetryPages('ok')).toBe(false);
  });
});
