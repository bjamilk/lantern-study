import { createHmac } from 'crypto';

describe('paystack webhook signature', () => {
  const original = process.env.PAYSTACK_SECRET_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = original;
    jest.resetModules();
  });

  it('accepts a valid HMAC SHA512 signature', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    const { verifyPaystackSignature } = await import('./paystack');
    const body = '{"event":"charge.success","data":{"reference":"abc"}}';
    const sig = createHmac('sha512', 'sk_test_unit').update(body).digest('hex');
    expect(verifyPaystackSignature(body, sig)).toBe(true);
    expect(verifyPaystackSignature(body, 'deadbeef')).toBe(false);
    expect(verifyPaystackSignature(body, undefined)).toBe(false);
  });
});
