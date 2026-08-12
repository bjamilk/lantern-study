import { MONTH_YEAR_RE, currentMonthYear } from './users';

/**
 * `GET`/`PUT /users/:userId/budget` were called by the mobile client from the
 * day it shipped, but no route ever served them: both answered 404, and both
 * client helpers swallow the failure (fetch catches to null, save only warns).
 * The result was silent — a budget set on the web never reached mobile, and a
 * budget set on mobile never left the device.
 *
 * Nothing about that was visible from the client side, so guard the routes'
 * existence here, where a missing registration fails loudly.
 */
describe('users router: monthly budget routes are registered', () => {
  const router = require('./users').default;

  const registered = (method: 'get' | 'put') =>
    router.stack
      .filter((layer: any) => layer.route?.methods?.[method])
      .map((layer: any) => layer.route.path);

  it('serves GET /:userId/budget', () => {
    expect(registered('get')).toContain('/:userId/budget');
  });

  it('serves PUT /:userId/budget', () => {
    expect(registered('put')).toContain('/:userId/budget');
  });
});

describe('month-year validation', () => {
  it('accepts a well-formed month', () => {
    for (const value of ['2026-01', '2026-08', '2026-12', '1999-10']) {
      expect(MONTH_YEAR_RE.test(value)).toBe(true);
    }
  });

  it('rejects an out-of-range or malformed month', () => {
    for (const value of ['2026-00', '2026-13', '2026-8', '26-08', '2026/08', '2026-08-01', '']) {
      expect(MONTH_YEAR_RE.test(value)).toBe(false);
    }
  });

  it('formats the current month with a padded two-digit month', () => {
    expect(currentMonthYear(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01');
    expect(currentMonthYear(new Date(Date.UTC(2026, 11, 1)))).toBe('2026-12');
  });
});
