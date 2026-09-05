/**
 * Compatibility shims for the tab routes this wave retired.
 *
 * `MarketTab`, `JobsTab` and `BudgetTab` are gone as destinations — Shop and
 * Jobs are segments of Campus, and Budget is a row inside Me. But roughly
 * fifteen screens owned by other parts of the app still call
 * `navigate('MarketTab', { screen: 'ListingDetail', params })`, and a
 * `navigate` to a route that no longer exists does nothing at all (React
 * Navigation warns in dev and silently drops it in release). So the three
 * route names stay registered as one-frame redirect screens, and this file is
 * the pure translation from the old call to the new destination.
 *
 * Imports nothing but a type, so jest's node environment can test it.
 *
 * These shims are meant to be deleted once every call site names Campus/Me
 * directly — that is a mechanical edit across files this agent does not own.
 */

import type { CampusSegment } from '../screens/campus/campusSegments';

/**
 * What a nested `navigate('<Tab>', …)` delivers as the tab screen's params:
 * the child route to open, its params, and whether to skip the stack's
 * initial route.
 */
export interface NestedNavigateParams {
  screen?: string;
  params?: Record<string, unknown>;
  initial?: boolean;
}

export interface LegacyRedirect {
  /** The tab route to forward to. */
  tab: 'CampusTab' | 'MeTab';
  /** The nested params to hand that tab. */
  params: NestedNavigateParams;
}

/**
 * The two shop/jobs HOME routes are the ones that became segments rather than
 * screens. Every other route on the old Market and Jobs stacks still exists —
 * it just lives on CampusStack now — so it passes straight through.
 */
const HOME_ROUTE_TO_SEGMENT: Record<string, CampusSegment> = {
  MarketplaceHome: 'shop',
  JobsHome: 'jobs',
};

/**
 * Translate an old Market/Jobs tab navigation into a Campus one.
 *
 * `at` is passed in rather than read from the clock so this stays pure; the
 * Campus screen uses it to re-apply a segment it is already showing (the same
 * trick the Discover drawer row used).
 */
export function resolveCampusRedirect(
  params: NestedNavigateParams | undefined,
  fallbackSegment: CampusSegment,
  at: number
): LegacyRedirect {
  const screen = params?.screen;
  if (!screen) {
    return { tab: 'CampusTab', params: { screen: 'Campus', params: { segment: fallbackSegment, at } } };
  }
  const segment = HOME_ROUTE_TO_SEGMENT[screen];
  if (segment) {
    return { tab: 'CampusTab', params: { screen: 'Campus', params: { segment, at } } };
  }
  return {
    tab: 'CampusTab',
    params: {
      screen,
      ...(params?.params ? { params: params.params } : {}),
      // Campus must sit under a deep-linked detail screen, or Back leaves the
      // tab instead of returning to the segment the reader came from.
      initial: false,
    },
  };
}

/** Translate an old Budget tab navigation into a Me one. */
export function resolveMeRedirect(params: NestedNavigateParams | undefined): LegacyRedirect {
  const screen = params?.screen;
  if (!screen) {
    return { tab: 'MeTab', params: { screen: 'BudgetHome', initial: false } };
  }
  return {
    tab: 'MeTab',
    params: {
      screen,
      ...(params?.params ? { params: params.params } : {}),
      initial: false,
    },
  };
}
