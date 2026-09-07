import { describe, expect, it } from 'vitest';
import { AppMode } from '../types';
import {
  TEST_BUILDER_PATH,
  buildAppPath,
  buildTestDetailPath,
  parseAppRoute,
} from './appRoutes';
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

describe('the two Tests routes under Study', () => {
  it('parses the builder as a standalone route with no mode behind it', () => {
    // Same shape as `/me`: it renders from the path and leaves the mode the
    // student came from alone, so Back returns them to the screen they left.
    expect(parseAppRoute(TEST_BUILDER_PATH)).toEqual({
      mode: null,
      params: {},
      standalone: 'test-builder',
    });
  });

  it('parses one test by id', () => {
    expect(parseAppRoute('/study/tests/abc-123')).toEqual({
      mode: null,
      params: { testId: 'abc-123' },
      standalone: 'test-detail',
    });
  });

  it('never lets a test id shadow the page that creates tests', () => {
    expect(parseAppRoute(TEST_BUILDER_PATH).standalone).toBe('test-builder');
    expect(parseAppRoute(TEST_BUILDER_PATH).params.testId).toBeUndefined();
  });

  it('round-trips an id that needs encoding', () => {
    const path = buildTestDetailPath('a b/c');
    expect(path).toBe('/study/tests/a%20b%2Fc');
    expect(parseAppRoute(path).params.testId).toBe('a b/c');
  });

  it('keeps the older `/tests` spellings working', () => {
    expect(parseAppRoute('/tests').mode).toBe(AppMode.TESTS_HOME);
    expect(parseAppRoute('/tests/active').mode).toBe(AppMode.TEST_ACTIVE);
    expect(parseAppRoute('/tests/review').mode).toBe(AppMode.TEST_REVIEW);
  });

  it('redirects the guessable spellings rather than dropping them on the dashboard', () => {
    expect(parseAppRoute('/tests/new')).toMatchObject({
      redirect: TEST_BUILDER_PATH,
      standalone: 'test-builder',
    });
    expect(parseAppRoute('/study/tests')).toMatchObject({
      redirect: '/tests',
      mode: AppMode.TESTS_HOME,
    });
  });

  it('lights Study from the path, since neither route has a mode to read', () => {
    // The mode underneath is whatever the student came from — Chat, say — so
    // the path is the only truthful signal for these two.
    expect(resolveActiveDestination(AppMode.CHAT, TEST_BUILDER_PATH)).toBe('study');
    expect(resolveActiveDestination(AppMode.CHAT, '/study/tests/abc-123')).toBe('study');
  });
});
