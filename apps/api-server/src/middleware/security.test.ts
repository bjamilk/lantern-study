import fs from 'fs';
import path from 'path';
import {
  sanitizeObject,
  sanitizeInput,
  sanitizationMiddleware,
  shouldSkipBodySanitization,
  shouldPreserveBodyText,
  MAX_SANITIZE_SCAN_BYTES,
} from './security';

describe('sanitizeObject binary payloads', () => {
  it('does not truncate base64Data upload fields', () => {
    const payload = 'A'.repeat(120_000);
    const result = sanitizeObject({
      fileName: 'slides.pptx',
      base64Data: payload,
      title: 'x'.repeat(60_000),
    });

    expect(result.base64Data).toHaveLength(120_000);
    expect(result.title).toHaveLength(50_000);
  });
});

describe('sanitizeInput performance', () => {
  // Regression guard for the catastrophically backtracking `<script>` pattern.
  // The old regex ran BEFORE truncation: 128 KB of repeated `<script>` took ~3.7 s
  // on an unauthenticated route, and the cost was quadratic in body size.
  it('sanitizes a 256 KB <script> body in well under 50ms', () => {
    const hostile = '<script>'.repeat((256 * 1024) / 8);
    const start = process.hrtime.bigint();
    sanitizeInput(hostile, { maxLength: 256 * 1024 });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    expect(elapsedMs).toBeLessThan(50);
  });

  it('still strips script tags, javascript: urls and inline handlers', () => {
    expect(sanitizeInput('a<script>alert(1)</script>b')).toBe('ab');
    expect(sanitizeInput('<a href="javascript:x">')).toBe('<a href="x">');
    expect(sanitizeInput('<div onclick="x">')).toBe('<div "x">');
  });

  it('caps the bytes a single request may have regex-scanned', () => {
    const budget = { remaining: 16 };
    // First call consumes the budget.
    expect(sanitizeInput('<script>a</script>'.repeat(2), { budget })).toBe('');
    // Subsequent strings are truncated/trimmed but not scanned.
    const after = sanitizeInput('<script>a</script>', { budget });
    expect(after).toBe('<script>a</script>');
    expect(MAX_SANITIZE_SCAN_BYTES).toBe(256 * 1024);
  });
});

describe('prototype pollution', () => {
  it('leaves Object.prototype untouched for a __proto__ body', () => {
    const body = JSON.parse('{"__proto__":{"admin":true},"title":"hi"}');
    const result = sanitizeObject(body);

    expect(({} as any).admin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'admin')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    expect(result.title).toBe('hi');
  });

  it('drops constructor/prototype keys too', () => {
    const body = JSON.parse('{"constructor":{"prototype":{"admin":true}},"ok":1}');
    const result = sanitizeObject(body);

    expect(({} as any).admin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
    expect(result.ok).toBe(1);
  });

  it('strips __proto__ from query objects in place', () => {
    const req: any = {
      body: undefined,
      originalUrl: '/api/v1/users',
      query: JSON.parse('{"__proto__":{"admin":true},"q":"x"}'),
      params: {},
    };
    sanitizationMiddleware(req, {} as any, () => undefined);

    expect(({} as any).admin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(req.query, '__proto__')).toBe(false);
    expect(req.query.q).toBe('x');
  });
});

describe('large-payload route skipping', () => {
  it('skips the exact large routes and nothing adjacent', () => {
    expect(shouldSkipBodySanitization('/api/v1/offline-bundles')).toBe(true);
    expect(shouldSkipBodySanitization('/api/v1/marketplace/study-packs/abc')).toBe(true);
    expect(shouldSkipBodySanitization('/api/v1/notes/upload-pdf')).toBe(true);
    expect(shouldSkipBodySanitization('/api/v1/messages/x/upload')).toBe(true);

    expect(shouldSkipBodySanitization('/api/v1/notes')).toBe(false);
    expect(shouldSkipBodySanitization('/api/v1/messages')).toBe(false);
    expect(shouldSkipBodySanitization('/api/v1/marketplace/listings')).toBe(false);
    // The old loose substring check would have matched this.
    expect(shouldSkipBodySanitization('/api/v1/offline-bundles-evil.example.com')).toBe(false);
  });

  it('leaves the body untouched on a skipped route', () => {
    const body = { note: '<script>x</script>' };
    const req: any = { body, originalUrl: '/api/v1/offline-bundles', query: {}, params: {} };
    sanitizationMiddleware(req, {} as any, () => undefined);

    expect(req.body.note).toBe('<script>x</script>');
  });
});

describe('middleware order', () => {
  // The sanitiser and body-shape validator walk the entire parsed body, so they
  // must never run ahead of the rate limiter on an unauthenticated request.
  it('mounts sanitizationMiddleware after anonymousIpRateLimit in server.ts', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
    const limiterAt = source.indexOf('anonymousIpRateLimit(req, res, next)');
    const sanitizerAt = source.indexOf('app.use(sanitizationMiddleware)');
    const validatorAt = source.indexOf('app.use(validateBodyShape())');

    expect(limiterAt).toBeGreaterThan(-1);
    expect(sanitizerAt).toBeGreaterThan(limiterAt);
    expect(validatorAt).toBeGreaterThan(limiterAt);
  });
});


describe('study material is stored raw (F7b)', () => {
  const run = (originalUrl: string, body: any) => {
    const req: any = { body, originalUrl, query: {}, params: {} };
    sanitizationMiddleware(req, {} as any, () => undefined);
    return req.body;
  };

  it('matches the authored-text routes and nothing adjacent', () => {
    expect(shouldPreserveBodyText('/api/v1/notes')).toBe(true);
    expect(shouldPreserveBodyText('/api/v1/notes/abc/blocks')).toBe(true);
    expect(shouldPreserveBodyText('/api/v1/ai/companion/message')).toBe(true);
    expect(shouldPreserveBodyText('/api/v1/decks/abc/cards')).toBe(true);
    expect(shouldPreserveBodyText('/api/v1/flashcards')).toBe(true);
    expect(shouldPreserveBodyText('/api/v1/tests/drafts')).toBe(true);
    expect(shouldPreserveBodyText('/api/v1/users/me/study-sets')).toBe(true);

    expect(shouldPreserveBodyText('/api/v1/marketplace/listings')).toBe(false);
    expect(shouldPreserveBodyText('/api/v1/users')).toBe(false);
    // Anchored, not substring: a lookalike host/path must not opt in.
    expect(shouldPreserveBodyText('/api/v1/notes-evil.example.com')).toBe(false);
    expect(shouldPreserveBodyText('/api/v1/aisomething')).toBe(false);
  });

  it('round-trips a note body containing <script> and friends intact', () => {
    const content =
      'XSS lecture 3: an attacker injects <script>alert(1)</script>, or uses ' +
      '<a href="javascript:steal()"> and <div onclick="x">. Never trust input.';
    const body = run('/api/v1/notes/abc', { title: 'Web security', content });

    expect(body.content).toBe(content);
    expect(body.title).toBe('Web security');
  });

  it('does not truncate a long note at 50,000 characters', () => {
    const content = 'a'.repeat(120_000);
    expect(run('/api/v1/notes', { content }).content).toHaveLength(120_000);
  });

  it('keeps a flashcard answer and a companion prompt verbatim', () => {
    const answer = '</script><img onerror=alert(1)>';
    expect(run('/api/v1/flashcards', { back: answer }).back).toBe(answer);

    const prompt = 'what does javascript: in an href actually do?';
    expect(run('/api/v1/ai/companion/message', { message: prompt }).message).toBe(prompt);
  });

  it('still rejects __proto__ on a text-preserving route', () => {
    const body = run(
      '/api/v1/notes',
      JSON.parse('{"__proto__":{"admin":true},"content":"<script>x</script>","blocks":[{"__proto__":{"admin":true},"text":"<b>keep</b>"}]}')
    );

    expect(({} as any).admin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body.blocks[0], '__proto__')).toBe(false);
    expect(body.content).toBe('<script>x</script>');
    expect(body.blocks[0].text).toBe('<b>keep</b>');
  });

  it('also rejects __proto__ on a large-payload route that used to skip the body', () => {
    const body = run(
      '/api/v1/offline-bundles',
      JSON.parse('{"__proto__":{"admin":true},"constructor":{"x":1},"note":"<script>x</script>"}')
    );

    expect(({} as any).admin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'constructor')).toBe(false);
    expect(body.note).toBe('<script>x</script>');
  });

  it('still strips on a route that is not authored study material', () => {
    expect(run('/api/v1/marketplace/listings', { title: 'a<script>x</script>b' }).title).toBe('ab');
  });
});
