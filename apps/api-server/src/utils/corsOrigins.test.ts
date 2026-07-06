import { getAllowedCorsOrigins, isOriginAllowed } from './corsOrigins';

describe('corsOrigins', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows canonical production web origins in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;
    delete process.env.WEB_APP_URL;

    expect(isOriginAllowed('https://lanternstudy.com')).toBe(true);
    expect(isOriginAllowed('https://www.lanternstudy.com')).toBe(true);
    expect(isOriginAllowed('https://lantern-study.pages.dev')).toBe(true);
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
  });

  it('merges env and ALLOWED_ORIGINS', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://preview.example.com';
    process.env.ALLOWED_ORIGINS = 'https://extra.example.com';

    const origins = getAllowedCorsOrigins();
    expect(origins).toContain('https://lanternstudy.com');
    expect(origins).toContain('https://preview.example.com');
    expect(origins).toContain('https://extra.example.com');
  });
});
