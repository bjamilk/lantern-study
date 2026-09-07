import { describe, expect, it } from 'vitest';
import { AppMode } from '../types';
import { buildAppPath, parseAppRoute } from './appRoutes';
import { resolveActiveDestination } from '../components/layout/destinations';

describe('Tests home route (/tests)', () => {
  it('parses /tests as the Tests home', () => {
    expect(parseAppRoute('/tests')).toEqual({ mode: AppMode.TESTS_HOME, params: {} });
  });

  it('builds /tests from the mode', () => {
    expect(buildAppPath(AppMode.TESTS_HOME)).toBe('/tests');
  });

  it('leaves the two existing test routes alone', () => {
    // `/tests` must not swallow its own children: the home is an exact match,
    // never a prefix branch.
    expect(parseAppRoute('/tests/active')).toEqual({ mode: AppMode.TEST_ACTIVE, params: {} });
    expect(parseAppRoute('/tests/review')).toEqual({ mode: AppMode.TEST_REVIEW, params: {} });
  });

  it('round-trips', () => {
    const path = buildAppPath(AppMode.TESTS_HOME)!;
    expect(parseAppRoute(path).mode).toBe(AppMode.TESTS_HOME);
  });

  it('lights the Study destination, like every other screen under Study', () => {
    expect(resolveActiveDestination(AppMode.TESTS_HOME, '/tests')).toBe('study');
  });
});
