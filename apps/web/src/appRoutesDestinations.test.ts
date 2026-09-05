import { describe, expect, it } from 'vitest';
import { AppMode } from '../../../types';
import {
  CAMPUS_SEGMENTS,
  EPHEMERAL_APP_MODES,
  ME_PATH,
  buildAppPath,
  campusSegmentMode,
  campusSegmentPath,
  isEphemeralAppMode,
  isPublicMarketplacePath,
  isRoutableAppMode,
  parseAppRoute,
} from '../../../utils/appRoutes';
import { resolveActiveDestination } from '../../../components/layout/destinations';
import { visibleCampusSegments } from '../../../components/campus/CampusHubScreen';
import {
  isSideColumnPinned,
  resolveShellSideColumn,
} from '../../../components/layout/shellSideColumn';

describe('Campus: one destination, three segments', () => {
  it('gives each segment its own url', () => {
    expect(campusSegmentPath('communities')).toBe('/campus');
    expect(campusSegmentPath('shop')).toBe('/campus/shop');
    expect(campusSegmentPath('jobs')).toBe('/campus/jobs');
  });

  it('parses each segment to the screen that renders it', () => {
    expect(parseAppRoute('/campus')).toEqual({
      mode: AppMode.DISCOVER,
      params: { campusSegment: 'communities' },
    });
    expect(parseAppRoute('/campus/shop')).toEqual({
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop' },
    });
    expect(parseAppRoute('/campus/jobs')).toEqual({
      mode: AppMode.MARKETPLACE_JOBS,
      params: { campusSegment: 'jobs' },
    });
  });

  it('round-trips every segment through its mode', () => {
    for (const segment of CAMPUS_SEGMENTS) {
      const path = campusSegmentPath(segment);
      expect(parseAppRoute(path).mode).toBe(campusSegmentMode(segment));
      expect(buildAppPath(campusSegmentMode(segment))).toBe(path);
    }
  });

  it('keeps the public campus page on /campus/:slug', () => {
    expect(parseAppRoute('/campus/unilag')).toEqual({
      mode: AppMode.CAMPUS_PAGE,
      params: { slug: 'unilag' },
    });
    expect(parseAppRoute('/campus/unilag/medicine')).toEqual({
      mode: AppMode.CAMPUS_PAGE,
      params: { slug: 'unilag', programme: 'medicine' },
    });
  });

  it('redirects the three old entry points, and only the entry points', () => {
    expect(parseAppRoute('/discover').redirect).toBe('/campus');
    expect(parseAppRoute('/marketplace').redirect).toBe('/campus/shop');
    expect(parseAppRoute('/marketplace/jobs').redirect).toBe('/campus/jobs');

    // Detail screens are reached FROM a segment; every link already minted
    // points at them, so they keep their urls.
    for (const path of [
      '/marketplace/listing/l1',
      '/marketplace/orders',
      '/marketplace/cart',
      '/marketplace/jobs/j1',
      '/discover/c/unilag-med',
    ]) {
      expect(parseAppRoute(path).redirect).toBeUndefined();
    }
  });

  it('still renders an old entry point for a guest, who never sees the redirect', () => {
    // `useRouteSync` only follows `redirect` for a signed-in user, so the mode
    // has to be right on the redirecting route too.
    expect(parseAppRoute('/marketplace').mode).toBe(AppMode.MARKETPLACE);
    expect(parseAppRoute('/marketplace/jobs').mode).toBe(AppMode.MARKETPLACE_JOBS);
    expect(parseAppRoute('/discover').mode).toBe(AppMode.DISCOVER);
    // …and both spellings have to reach the guest shell.
    expect(isPublicMarketplacePath('/marketplace')).toBe(true);
    expect(isPublicMarketplacePath('/campus/shop')).toBe(true);
    expect(isPublicMarketplacePath('/campus/jobs')).toBe(true);
    // /campus itself is a member destination, not public browse.
    expect(isPublicMarketplacePath('/campus')).toBe(false);
  });

  it('hides a segment whose gate is closed, and never leaves none', () => {
    expect(visibleCampusSegments({ communitiesOpen: true, shopOpen: true })).toEqual([
      'communities',
      'shop',
      'jobs',
    ]);
    expect(visibleCampusSegments({ communitiesOpen: false, shopOpen: false })).toEqual(['jobs']);
    // Still checking is not the same as denied: the tab stays up.
    expect(visibleCampusSegments({ communitiesOpen: false, shopOpen: null })).toEqual([
      'shop',
      'jobs',
    ]);
  });
});

describe('Me', () => {
  it('is a standalone route with no mode behind it', () => {
    expect(parseAppRoute(ME_PATH)).toEqual({ mode: null, params: {}, standalone: 'me' });
    // Not the dashboard bounce an unknown path gets.
    expect(parseAppRoute('/nope')).toEqual({ mode: null, params: {}, redirect: '/dashboard' });
  });

  it('lights the Me tab from the path, whatever mode is underneath', () => {
    expect(resolveActiveDestination(AppMode.DASHBOARD, ME_PATH)).toBe('me');
    expect(resolveActiveDestination(AppMode.DASHBOARD, '/me/')).toBe('me');
    expect(resolveActiveDestination(AppMode.DASHBOARD, '/dashboard')).toBe('home');
  });
});

describe('tests, results and flashcard review modes have real urls', () => {
  const modes: Array<[AppMode, string]> = [
    [AppMode.TEST_ACTIVE, '/tests/active'],
    [AppMode.TEST_REVIEW, '/tests/review'],
    [AppMode.STUDY_ACTIVE, '/study/session'],
    [AppMode.GAME_ACTIVE, '/game'],
    [AppMode.GAME_RESULTS, '/game/results'],
    [AppMode.FLASHCARD_REVIEW, '/flashcards/review'],
    [AppMode.FLASHCARD_CRAM, '/flashcards/cram'],
    [AppMode.FLASHCARD_MATCH, '/flashcards/match'],
    [AppMode.FLASHCARD_LEARN, '/flashcards/learn'],
  ];

  it.each(modes)('%s round-trips through its path', (mode, path) => {
    expect(buildAppPath(mode)).toBe(path);
    expect(parseAppRoute(path)).toEqual({ mode, params: {} });
    expect(isRoutableAppMode(mode)).toBe(true);
    expect(isEphemeralAppMode(mode)).toBe(false);
  });

  it('leaves nothing ephemeral', () => {
    expect(EPHEMERAL_APP_MODES.size).toBe(0);
  });

  it('does not collide with the deck path', () => {
    expect(parseAppRoute('/flashcards/deck/d1')).toEqual({
      mode: AppMode.DECK_DETAIL,
      params: { deckId: 'd1' },
    });
    expect(parseAppRoute('/study')).toEqual({ mode: AppMode.STUDY_HUB, params: {} });
  });
});

describe('the five destinations own every screen', () => {
  it('files a screen under the section it is inside', () => {
    expect(resolveActiveDestination(AppMode.DASHBOARD, '/dashboard')).toBe('home');
    expect(resolveActiveDestination(AppMode.TEST_ACTIVE, '/tests/active')).toBe('study');
    expect(resolveActiveDestination(AppMode.NOTE_EDITOR, '/notes/n1')).toBe('study');
    expect(resolveActiveDestination(AppMode.CHAT, '/chat')).toBe('chat');
    expect(resolveActiveDestination(AppMode.CREATE_GROUP, '/groups/new')).toBe('chat');
    // A community and a listing are both Campus — Chat never lights for a
    // community channel (the community owns its chat).
    expect(resolveActiveDestination(AppMode.COMMUNITY_DETAIL, '/discover/c/x')).toBe('campus');
    expect(resolveActiveDestination(AppMode.MARKETPLACE_LISTING_DETAIL, '/marketplace/listing/l1')).toBe('campus');
    expect(resolveActiveDestination(AppMode.MARKETPLACE_JOBS, '/campus/jobs')).toBe('campus');
    // Budget and Downloads are Me, not places of their own.
    expect(resolveActiveDestination(AppMode.BUDGET_TRACKER, '/budget')).toBe('me');
    expect(resolveActiveDestination(AppMode.OFFLINE_MODE, '/offline')).toBe('me');
  });
});

describe('the chat screen renders its conversation column', () => {
  const community = { slug: 'unilag-med' };

  it('opens the column on Chat whatever the persisted toggle says', () => {
    // The bug: the base predicate suppressed the flyout on AppMode.CHAT because
    // ChatWindow renders its own list — but only on mobile. On a desktop `/chat`
    // showed a 0px aside beside a placeholder telling the reader to pick a
    // conversation from a sidebar that had none.
    expect(
      resolveShellSideColumn({ isChatsSectionExpanded: false, appMode: AppMode.CHAT, activeCommunity: null }),
    ).toBe('chats');
    expect(
      resolveShellSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.CHAT, activeCommunity: null }),
    ).toBe('chats');
    expect(isSideColumnPinned(AppMode.CHAT, 'chats')).toBe(true);
  });

  it('still yields to a community, and still respects the toggle elsewhere', () => {
    expect(
      resolveShellSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.COMMUNITY_DETAIL, activeCommunity: community }),
    ).toBe('community');
    expect(
      resolveShellSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.DASHBOARD, activeCommunity: null }),
    ).toBe('chats');
    expect(
      resolveShellSideColumn({ isChatsSectionExpanded: false, appMode: AppMode.DASHBOARD, activeCommunity: null }),
    ).toBeNull();
    expect(isSideColumnPinned(AppMode.DASHBOARD, 'chats')).toBe(false);
  });
});
