import { describe, expect, it } from 'vitest';
import { AppMode } from '../../../types';
import {
  CAMPUS_SEGMENTS,
  EPHEMERAL_APP_MODES,
  ME_PATH,
  SHOP_COURSES_PATH,
  SHOP_PATH,
  SHOP_SELL_PATH,
  STUDY_PRODUCTS_PATH,
  buildAppPath,
  campusSegmentMode,
  campusSegmentPath,
  isEphemeralAppMode,
  isPublicMarketplacePath,
  isRoutableAppMode,
  parseAppRoute,
  parseShopRoute,
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

  it('gives a course workspace a url under Study', () => {
    expect(parseAppRoute('/study/courses/bio-201')).toEqual({
      mode: AppMode.COURSE_WORKSPACE,
      params: { courseId: 'bio-201' },
    });
    expect(parseAppRoute('/study/courses/c%201').params.courseId).toBe('c 1');
    expect(buildAppPath(AppMode.COURSE_WORKSPACE, { courseId: 'bio-201' })).toBe(
      '/study/courses/bio-201'
    );
    expect(buildAppPath(AppMode.COURSE_WORKSPACE)).toBe('/study');
    expect(isRoutableAppMode(AppMode.COURSE_WORKSPACE)).toBe(true);
    expect(parseAppRoute('/study/sets/set-1')).toEqual({
      mode: AppMode.STUDY_SET_WORKSPACE,
      params: { studySetId: 'set-1', workspaceActivity: 'home' },
    });
    expect(buildAppPath(AppMode.STUDY_SET_WORKSPACE, { studySetId: 'set-1' })).toBe(
      '/study/sets/set-1'
    );
    expect(isRoutableAppMode(AppMode.STUDY_SET_WORKSPACE)).toBe(true);
    expect(resolveActiveDestination(AppMode.STUDY_SET_WORKSPACE, '/study/sets/set-1')).toBe(
      'study'
    );
    expect(resolveActiveDestination(AppMode.COURSE_WORKSPACE, '/study/courses/bio-201')).toBe(
      'study'
    );
    expect(resolveActiveDestination(AppMode.DASHBOARD, '/study/courses/bio-201')).toBe('study');
    expect(parseAppRoute('/campus/shop/courses/c1').mode).toBe(AppMode.MARKETPLACE);
    expect(parseAppRoute('/study/tests/abc-123').standalone).toBe('test-detail');
    expect(parseAppRoute('/study/session').mode).toBe(AppMode.STUDY_ACTIVE);
  });
});

describe('the five destinations own every screen', () => {
  it('files a screen under the section it is inside', () => {
    expect(resolveActiveDestination(AppMode.DASHBOARD, '/dashboard')).toBe('home');
    expect(resolveActiveDestination(AppMode.TEST_ACTIVE, '/tests/active')).toBe('study');
    expect(resolveActiveDestination(AppMode.NOTE_EDITOR, '/notes/n1')).toBe('study');
    expect(resolveActiveDestination(AppMode.COURSE_WORKSPACE, '/study/courses/c1')).toBe('study');
    expect(resolveActiveDestination(AppMode.STUDY_SET_WORKSPACE, '/study/sets/s1')).toBe('study');
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

describe('no legacy path lands on the dashboard', () => {
  // Every one of these used to fall into the catch-all, which reads to a
  // student as "that section does not exist" — `/jobs` is the obvious spelling
  // of a section literally called Jobs.
  const redirects: Array<[string, string]> = [
    ['/jobs', '/campus/jobs'],
    ['/discover/jobs', '/campus/jobs'],
    ['/shop', SHOP_PATH],
    ['/goods', SHOP_PATH],
    ['/marketplace/goods', SHOP_PATH],
    ['/marketplace/shop', SHOP_PATH],
    ['/discover/shop', SHOP_PATH],
    ['/discover/goods', SHOP_PATH],
    ['/communities', '/campus'],
    ['/discover/communities', '/campus'],
    ['/discover/c', '/campus'],
    ['/campus/communities', '/campus'],
    ['/marketplace/sell', SHOP_SELL_PATH],
    ['/marketplace/new', SHOP_SELL_PATH],
    ['/marketplace/courses', SHOP_COURSES_PATH],
    ['/marketplace/study-products', STUDY_PRODUCTS_PATH],
    ['/campus/shop/study-products', STUDY_PRODUCTS_PATH],
    ['/study-products', STUDY_PRODUCTS_PATH],
    ['/downloads', '/offline'],
    ['/campus-pocket', '/budget'],
    ['/pocket', '/budget'],
  ];

  it.each(redirects)('%s redirects to %s', (from, to) => {
    const parsed = parseAppRoute(from);
    expect(parsed.redirect).toBe(to);
    // Never the dashboard bounce, and never a redirect that disagrees with the
    // screen behind it: a client that does not reload (or a guest, who never
    // follows the redirect at all) must still land on the right mode.
    expect(parsed.redirect).not.toBe('/dashboard');
    expect(parsed.mode).toBe(parseAppRoute(to).mode);
    expect(parsed.params).toEqual(parseAppRoute(to).params);
  });

  it('redirects with a trailing slash too', () => {
    expect(parseAppRoute('/jobs/').redirect).toBe('/campus/jobs');
    expect(parseAppRoute('/marketplace/goods/').redirect).toBe(SHOP_PATH);
  });

  it('sends a mistyped sub-path to its segment, not to a campus page', () => {
    // `/campus/shop/anything` used to parse as the public page of an
    // institution whose slug is "shop" — a wrong screen, not a missing one.
    expect(parseAppRoute('/campus/shop/nonsense')).toEqual({
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop' },
      redirect: SHOP_PATH,
    });
    expect(parseAppRoute('/campus/jobs/nonsense')).toEqual({
      mode: AppMode.MARKETPLACE_JOBS,
      params: { campusSegment: 'jobs' },
      redirect: '/campus/jobs',
    });
    // A real institution slug is untouched.
    expect(parseAppRoute('/campus/unilag/medicine').redirect).toBeUndefined();
  });
});

describe('the Shop sub-states are places with urls', () => {
  it('gives the By-course tab and one course their own paths', () => {
    expect(parseAppRoute(SHOP_COURSES_PATH)).toEqual({
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop', shopView: 'courses' },
    });
    expect(parseAppRoute('/campus/shop/courses/c1')).toEqual({
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop', shopView: 'courses', courseId: 'c1' },
    });
    expect(buildAppPath(AppMode.MARKETPLACE, { shopView: 'courses' })).toBe(SHOP_COURSES_PATH);
    expect(buildAppPath(AppMode.MARKETPLACE, { courseId: 'c 1' })).toBe(
      '/campus/shop/courses/c%201'
    );
    // Tapping the Campus > Shop tab still lands on plain browse.
    expect(buildAppPath(AppMode.MARKETPLACE)).toBe(SHOP_PATH);
  });

  it('gives the Sell sheet a url under the Shop it opens over', () => {
    expect(parseAppRoute(SHOP_SELL_PATH)).toEqual({
      mode: AppMode.CREATE_MARKETPLACE_LISTING,
      params: { campusSegment: 'shop' },
    });
    expect(buildAppPath(AppMode.CREATE_MARKETPLACE_LISTING)).toBe(SHOP_SELL_PATH);
    expect(isRoutableAppMode(AppMode.CREATE_MARKETPLACE_LISTING)).toBe(true);
  });

  it('gives Study products a url under Study, where the shell files it', () => {
    expect(parseAppRoute(STUDY_PRODUCTS_PATH)).toEqual({
      mode: AppMode.STUDY_PRODUCT_DRAFTS,
      params: {},
    });
    expect(buildAppPath(AppMode.STUDY_PRODUCT_DRAFTS)).toBe(STUDY_PRODUCTS_PATH);
    expect(resolveActiveDestination(AppMode.STUDY_PRODUCT_DRAFTS, STUDY_PRODUCTS_PATH)).toBe(
      'study'
    );
    // …and does not collide with the Study hub or a running session.
    expect(parseAppRoute('/study').mode).toBe(AppMode.STUDY_HUB);
    expect(parseAppRoute('/study/session').mode).toBe(AppMode.STUDY_ACTIVE);
  });

  it('keeps nested study-set tools on STUDY_SET_WORKSPACE', () => {
    expect(parseAppRoute('/study/sets/set-a/quiz')).toEqual({
      mode: AppMode.STUDY_SET_WORKSPACE,
      params: { studySetId: 'set-a', workspaceActivity: 'quiz' },
    });
    expect(parseAppRoute('/study/sets/set-a/cards/deck-1/review')).toEqual({
      mode: AppMode.STUDY_SET_WORKSPACE,
      params: {
        studySetId: 'set-a',
        workspaceActivity: 'cards',
        deckId: 'deck-1',
        cardSession: 'review',
      },
    });
    expect(parseAppRoute('/study/sets/set-a/play/match')).toEqual({
      mode: AppMode.STUDY_SET_WORKSPACE,
      params: {
        studySetId: 'set-a',
        workspaceActivity: 'play',
        playSession: 'match',
      },
    });
    expect(
      buildAppPath(AppMode.STUDY_SET_WORKSPACE, {
        studySetId: 'set-a',
        workspaceActivity: 'test',
        createNew: true,
      })
    ).toBe('/study/sets/set-a/test/new');
    expect(parseAppRoute('/study/materials')).toEqual({
      mode: AppMode.STUDY_HUB,
      params: { studyMaterials: true },
    });
    expect(resolveActiveDestination(AppMode.STUDY_SET_WORKSPACE, '/study/sets/set-a/quiz')).toBe(
      'study'
    );
  });

  it('reads the open sub-state straight off the path', () => {
    expect(parseShopRoute(SHOP_PATH)).toEqual({ view: 'browse', courseId: null });
    expect(parseShopRoute(SHOP_COURSES_PATH)).toEqual({ view: 'courses', courseId: null });
    expect(parseShopRoute('/campus/shop/courses/c1')).toEqual({
      view: 'courses',
      courseId: 'c1',
    });
    expect(parseShopRoute('/campus/shop/courses/c%201').courseId).toBe('c 1');
    expect(parseShopRoute(SHOP_SELL_PATH)).toEqual({ view: 'sell', courseId: null });
    // Anywhere else in the app is not a Shop sub-state.
    expect(parseShopRoute('/dashboard')).toEqual({ view: 'browse', courseId: null });
  });

  it('keeps every Shop sub-state inside the Campus tab', () => {
    for (const path of [SHOP_PATH, SHOP_COURSES_PATH, '/campus/shop/courses/c1']) {
      expect(resolveActiveDestination(parseAppRoute(path).mode!, path)).toBe('campus');
    }
    expect(resolveActiveDestination(AppMode.CREATE_MARKETPLACE_LISTING, SHOP_SELL_PATH)).toBe(
      'campus'
    );
  });
});
