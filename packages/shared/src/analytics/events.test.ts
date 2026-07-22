import { isProductEventName, sanitizeEventProps } from './events';

describe('product event helpers', () => {
  it('allowlists known events', () => {
    expect(isProductEventName('page_view')).toBe(true);
    expect(isProductEventName('listing_view')).toBe(true);
    expect(isProductEventName('evil_event')).toBe(false);
  });

  it('strips PII-ish keys and truncates query', () => {
    const cleaned = sanitizeEventProps({
      query: 'a'.repeat(120),
      email: 'x@y.com',
      password: 'secret',
      listingId: 'abc',
      resultCount: 3,
    });
    expect(cleaned.email).toBeUndefined();
    expect(cleaned.password).toBeUndefined();
    expect(cleaned.listingId).toBe('abc');
    expect(cleaned.resultCount).toBe(3);
    expect(String(cleaned.query).length).toBe(80);
  });
});
