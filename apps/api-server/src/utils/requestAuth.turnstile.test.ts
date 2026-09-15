/**
 * `TURNSTILE_SECRET` / `TURNSTILE_HOSTNAMES` are absent from the production
 * secret gate, so a deploy with either unset booted happily and
 * `verifyTurnstileToken` returned `{ ok: true }` for every request — bot
 * protection disappearing silently, reported only by /health.
 *
 * F10 keeps them optional (challenging the auth endpoints is a product
 * decision, not a middleware change) but makes the boot say so. The
 * half-configured case gets the louder line: that deployment believes it is
 * protected and is not.
 */
jest.mock('./platformAdminAuth', () => ({ isLivePlatformAdmin: jest.fn(async () => false) }));

import { warnOnUnconfiguredTurnstile } from './requestAuth';

const originalSecret = process.env.TURNSTILE_SECRET;
const originalHostnames = process.env.TURNSTILE_HOSTNAMES;
let warnings: string[] = [];
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  warnings = [];
  warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(' '));
  });
  delete process.env.TURNSTILE_SECRET;
  delete process.env.TURNSTILE_HOSTNAMES;
});

afterEach(() => {
  warnSpy.mockRestore();
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET;
  else process.env.TURNSTILE_SECRET = originalSecret;
  if (originalHostnames === undefined) delete process.env.TURNSTILE_HOSTNAMES;
  else process.env.TURNSTILE_HOSTNAMES = originalHostnames;
});

describe('warnOnUnconfiguredTurnstile', () => {
  it('says nothing when both halves are configured', () => {
    process.env.TURNSTILE_SECRET = 'secret';
    process.env.TURNSTILE_HOSTNAMES = 'lanternstudy.com';
    warnOnUnconfiguredTurnstile();
    expect(warnings).toHaveLength(0);
  });

  it('warns once, naming both variables, when Turnstile is absent', () => {
    warnOnUnconfiguredTurnstile();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/TURNSTILE_SECRET/);
    expect(warnings[0]).toMatch(/TURNSTILE_HOSTNAMES/);
  });

  it('warns that verification is DISABLED when only one half is set', () => {
    process.env.TURNSTILE_SECRET = 'secret';
    warnOnUnconfiguredTurnstile();
    expect(warnings[0]).toMatch(/HALF configured/);
    expect(warnings[0]).toMatch(/DISABLED/);
    expect(warnings[0]).toMatch(/TURNSTILE_HOSTNAMES missing/);
  });

  it('treats a blank hostname list as missing, because that is what the middleware does', () => {
    process.env.TURNSTILE_SECRET = 'secret';
    process.env.TURNSTILE_HOSTNAMES = '   ';
    warnOnUnconfiguredTurnstile();
    expect(warnings[0]).toMatch(/HALF configured/);
  });

  it('never exits the process — a missing nice-to-have must not fail a deploy', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((() => undefined) as never));
    try {
      warnOnUnconfiguredTurnstile();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });
});
