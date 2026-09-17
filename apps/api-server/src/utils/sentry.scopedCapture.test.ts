/**
 * `captureScopedException` — the fingerprint-and-tags reporting path the
 * money-moved write class uses (#108).
 *
 * The two things worth pinning are the two that would make the report useless
 * or unsafe: a fingerprint that is not stable (one issue becomes thousands),
 * and a tag carrying something that should never be indexed. Tags are searched
 * and stored differently from `extra`, and this is called from the money path.
 */
const mockCaptureException = jest.fn();

jest.mock('@sentry/node', () => ({ captureException: (...args: unknown[]) => mockCaptureException(...args) }), {
  virtual: true,
});

import { captureScopedException } from './sentry';

const ORIGINAL_DSN = process.env.SENTRY_DSN;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SENTRY_DSN = 'https://example.invalid/1';
});

afterAll(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = ORIGINAL_DSN;
});

it('does nothing at all without a DSN, so tests and local runs report nowhere', () => {
  delete process.env.SENTRY_DSN;
  captureScopedException(new Error('x'), { fingerprint: ['a'] });
  expect(mockCaptureException).not.toHaveBeenCalled();
});

it('passes the fingerprint and error level through unchanged', () => {
  captureScopedException(new Error('x'), {
    fingerprint: ['money-moved-write-failed:marketplace_payments:update'],
  });
  const [, scope] = mockCaptureException.mock.calls[0];
  expect(scope.level).toBe('error');
  expect(scope.fingerprint).toEqual(['money-moved-write-failed:marketplace_payments:update']);
});

it('drops an empty or absent tag rather than sending the string "undefined"', () => {
  captureScopedException(new Error('x'), {
    tags: { orderId: 'ord_1', paymentId: undefined, checkoutId: null, note: '' },
  });
  expect(mockCaptureException.mock.calls[0][1].tags).toEqual({ orderId: 'ord_1' });
});

it('refuses a tag value that looks like an address', () => {
  captureScopedException(new Error('x'), {
    tags: { orderId: 'ord_1', buyer: 'buyer@example.com' },
  });
  expect(mockCaptureException.mock.calls[0][1].tags).toEqual({ orderId: 'ord_1' });
});

it('truncates a long tag value instead of sending it whole', () => {
  captureScopedException(new Error('x'), { tags: { note: 'x'.repeat(5_000) } });
  expect(mockCaptureException.mock.calls[0][1].tags.note.length).toBe(200);
});

it('omits the tags key entirely when nothing survives, so no empty object is sent', () => {
  captureScopedException(new Error('x'), { tags: { buyer: 'buyer@example.com' } });
  expect(mockCaptureException.mock.calls[0][1]).not.toHaveProperty('tags');
});

it('never lets a reporting failure escape into the money path', () => {
  mockCaptureException.mockImplementation(() => {
    throw new Error('sentry is down');
  });
  expect(() => captureScopedException(new Error('x'), { fingerprint: ['a'] })).not.toThrow();
});
