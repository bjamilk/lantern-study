/**
 * Contract test for the per-user "has ever opened" record behind the Home
 * onboarding checklist (issue #68).
 *
 * What it pins:
 *  - which app modes count as which checklist surface;
 *  - `markSurfaceVisited` records under the signed-in user id only, and is
 *    monotonic — nothing in the app ever un-visits a surface;
 *  - one student's visits never tick another account's checklist;
 *  - the checklist derivation the screen registry uses (`hasVisitedSurface`)
 *    reads exactly those flags.
 *
 * Surviving a reload is `uiStore`'s `partialize` (the field is listed there);
 * the persist middleware has no storage under the web suite's plain-Node
 * environment, so it is not assertable here.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { AppMode } from '../types';
import { hasVisitedSurface, useUIStore, visitedSurfaceForMode } from './uiStore';

beforeEach(() => {
  useUIStore.setState({ visitedSurfaces: {} });
});

const mark = (userId: string | null | undefined, mode: AppMode) =>
  useUIStore.getState().markSurfaceVisited(userId, mode);

const visited = () => useUIStore.getState().visitedSurfaces;

describe('visitedSurfaceForMode', () => {
  it('maps the library, shop and offline modes to their checklist surface', () => {
    expect(visitedSurfaceForMode(AppMode.LIBRARY)).toBe('library');
    expect(visitedSurfaceForMode(AppMode.NOTES)).toBe('library');
    expect(visitedSurfaceForMode(AppMode.FLASHCARDS)).toBe('library');
    expect(visitedSurfaceForMode(AppMode.MARKETPLACE)).toBe('marketplace');
    expect(visitedSurfaceForMode(AppMode.MARKETPLACE_LISTING_DETAIL)).toBe('marketplace');
    expect(visitedSurfaceForMode(AppMode.OFFLINE_MODE)).toBe('offline');
  });

  it('maps every other mode to no surface', () => {
    expect(visitedSurfaceForMode(AppMode.DASHBOARD)).toBeNull();
    expect(visitedSurfaceForMode(AppMode.CHAT)).toBeNull();
    expect(visitedSurfaceForMode(AppMode.MARKETPLACE_CART)).toBeNull();
  });
});

describe('markSurfaceVisited', () => {
  it('records the surface under the signed-in user id', () => {
    mark('user-1', AppMode.FLASHCARDS);
    expect(visited()).toEqual({ 'user-1': { library: true } });
  });

  it('accumulates all three surfaces for one student', () => {
    mark('user-1', AppMode.LIBRARY);
    mark('user-1', AppMode.MARKETPLACE);
    mark('user-1', AppMode.OFFLINE_MODE);
    expect(visited()['user-1']).toEqual({ library: true, marketplace: true, offline: true });
  });

  it('never records for a signed-out visitor or an untracked mode', () => {
    mark(null, AppMode.LIBRARY);
    mark(undefined, AppMode.LIBRARY);
    mark('user-1', AppMode.DASHBOARD);
    expect(visited()).toEqual({});
  });

  it('keeps each account’s record to itself', () => {
    mark('user-1', AppMode.LIBRARY);
    mark('user-2', AppMode.OFFLINE_MODE);
    expect(hasVisitedSurface(visited(), 'user-1', 'library')).toBe(true);
    expect(hasVisitedSurface(visited(), 'user-2', 'library')).toBe(false);
    expect(hasVisitedSurface(visited(), 'user-1', 'offline')).toBe(false);
  });

  it('is a no-op once the surface is already recorded, so the object identity holds', () => {
    mark('user-1', AppMode.LIBRARY);
    const first = visited();
    mark('user-1', AppMode.NOTES);
    expect(visited()).toBe(first);
  });
});

describe('hasVisitedSurface: the checklist derivation', () => {
  it('ticks each checklist item only after that surface has ever been opened', () => {
    const record = visited();
    // Exactly the three derivations the DASHBOARD screen-registry entry makes.
    const checklist = (userId: string | null) => ({
      hasOpenedLibrary: hasVisitedSurface(useUIStore.getState().visitedSurfaces, userId, 'library'),
      hasExploredMarketplace: hasVisitedSurface(
        useUIStore.getState().visitedSurfaces,
        userId,
        'marketplace'
      ),
      hasTriedOffline: hasVisitedSurface(useUIStore.getState().visitedSurfaces, userId, 'offline'),
    });
    expect(record).toEqual({});
    expect(checklist('user-1')).toEqual({
      hasOpenedLibrary: false,
      hasExploredMarketplace: false,
      hasTriedOffline: false,
    });

    mark('user-1', AppMode.LIBRARY);
    mark('user-1', AppMode.MARKETPLACE_LISTING_DETAIL);
    mark('user-1', AppMode.OFFLINE_MODE);

    expect(checklist('user-1')).toEqual({
      hasOpenedLibrary: true,
      hasExploredMarketplace: true,
      hasTriedOffline: true,
    });
    // A visitor with no id ticks nothing.
    expect(checklist(null)).toEqual({
      hasOpenedLibrary: false,
      hasExploredMarketplace: false,
      hasTriedOffline: false,
    });
  });

  it('survives the record being absent entirely', () => {
    expect(hasVisitedSurface(undefined, 'user-1', 'library')).toBe(false);
  });
});
