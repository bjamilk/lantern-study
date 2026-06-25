import { sanitizeObject } from './security';

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
