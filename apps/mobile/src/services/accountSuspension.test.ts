import {
  formatSuspendedUntil,
  isForbiddenError,
  parseSuspensionBody,
} from './accountSuspension';

describe('parseSuspensionBody', () => {
  it('reads the ACCOUNT_SUSPENDED 403 body the API sends', () => {
    expect(
      parseSuspensionBody({
        error: 'Forbidden',
        message: 'Account suspended until 5 September 2026',
        code: 'ACCOUNT_SUSPENDED',
        suspendedUntil: '2026-09-05T00:00:00.000Z',
      })
    ).toEqual({
      suspendedUntil: '2026-09-05T00:00:00.000Z',
      message: 'Account suspended until 5 September 2026',
    });
  });

  it('ignores every other 403 (banned, not-an-admin, plain Forbidden)', () => {
    expect(parseSuspensionBody({ error: 'Forbidden' })).toBeNull();
    expect(parseSuspensionBody({ code: 'ACCOUNT_BANNED', message: 'Banned' })).toBeNull();
    expect(parseSuspensionBody(null)).toBeNull();
    expect(parseSuspensionBody('ACCOUNT_SUSPENDED')).toBeNull();
  });

  it('tolerates a missing date or message', () => {
    expect(parseSuspensionBody({ code: 'ACCOUNT_SUSPENDED' })).toEqual({
      suspendedUntil: null,
      message: null,
    });
  });
});

describe('isForbiddenError', () => {
  it('matches the shared client error shape for a 403 only', () => {
    const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isForbiddenError(forbidden)).toBe(true);
    expect(isForbiddenError(Object.assign(new Error('Nope'), { status: 401 }))).toBe(false);
    expect(isForbiddenError(new Error('Network request failed'))).toBe(false);
    expect(isForbiddenError(null)).toBe(false);
  });
});

describe('formatSuspendedUntil', () => {
  it('formats a valid ISO date and passes junk through', () => {
    expect(formatSuspendedUntil('2026-09-05T12:00:00.000Z')).toMatch(/September 2026/);
    expect(formatSuspendedUntil('soon')).toBe('soon');
    expect(formatSuspendedUntil(null)).toBeNull();
  });
});
