import { canonicalizeJoinCode } from '@lantern/shared/academic';
import {
  buildStudySetPath,
  parseStudySetPath,
  type StudySetCardSession,
  type StudySetPathActivity,
  type StudySetPlaySession,
} from '@lantern/shared/learning';
import { AppMode } from '../types';

export type LibraryTabParam = 'notes' | 'flashcards';

/**
 * The only two tabs `/library/:tab` accepts.
 *
 * Both the parser and the bare-`/library` rewrite validate through this. They
 * have to agree: the rewrite reads the PERSISTED tab out of localStorage, which
 * is user-writable and survives across versions, so a stale or hand-edited value
 * would otherwise be pasted straight into a path the parser then refuses —
 * `/library` redirects to `/library/<junk>`, the parser returns no tab, and
 * hydration redirects to `/library/<junk>` again. An infinite loop, not a bad
 * screen.
 */
export const isLibraryTabParam = (value: unknown): value is LibraryTabParam =>
  value === 'notes' || value === 'flashcards';

export type BudgetTabParam = 'overview' | 'transactions' | 'goals' | 'wallet';

export const isBudgetTabParam = (value: unknown): value is BudgetTabParam =>
  value === 'overview' || value === 'transactions' || value === 'goals' || value === 'wallet';

/**
 * Campus is ONE destination with three segments. Each segment keeps its own
 * URL (a segment is a place you can link to and go Back to) and its own
 * AppMode, because the three are rendered by three different screens.
 *
 * The old entry points — `/discover`, `/marketplace`, `/marketplace/jobs` —
 * redirect here. Their sub-paths (`/marketplace/listing/:id`, `/discover/c/:slug`,
 * `/marketplace/jobs/:id`, …) are NOT entry points and keep their URLs: they
 * are detail screens reached from a segment, and every link already minted
 * points at them.
 */
export type CampusSegment = 'communities' | 'shop' | 'jobs';

export const CAMPUS_SEGMENTS: readonly CampusSegment[] = ['communities', 'shop', 'jobs'];

export const isCampusSegment = (value: unknown): value is CampusSegment =>
  value === 'communities' || value === 'shop' || value === 'jobs';

/**
 * `/campus` is the Communities segment, not a fourth landing page: a
 * destination that shows nothing until you pick a tab is a menu, not a place.
 */
export function campusSegmentPath(segment: CampusSegment): string {
  if (segment === 'shop') return '/campus/shop';
  if (segment === 'jobs') return '/campus/jobs';
  return '/campus';
}

export function campusSegmentMode(segment: CampusSegment): AppMode {
  if (segment === 'shop') return AppMode.MARKETPLACE;
  if (segment === 'jobs') return AppMode.MARKETPLACE_JOBS;
  return AppMode.DISCOVER;
}

/** The Profile destination has no AppMode: it is a route App.tsx renders directly. */
export const ME_PATH = '/me';
/** Progress peer section — still the Profile destination, not a sixth tab. */
export const ME_PROGRESS_PATH = '/me/progress';

/**
 * Shop sub-destinations that own a URL.
 *
 * The Shop segment is a place; browsing it by course, opening one course and
 * listing something for sale are places INSIDE it — each is linkable, survives
 * a refresh and is what Back leaves. They are sub-paths of `/campus/shop`
 * rather than modes, so the Campus tab stays lit the whole way down.
 *
 * Lantern AI is deliberately absent: it is the overlay that FOLLOWS you across
 * every screen, not somewhere you went, so it has no URL by design.
 */
export const SHOP_PATH = '/campus/shop';
export const SHOP_COURSES_PATH = '/campus/shop/courses';
export const SHOP_SELL_PATH = '/campus/shop/sell';
/**
 * Study products is filed under Study (see `destinations.ts`) and its Back goes
 * to the Library, so its URL sits under Study too — a path that said
 * `/campus/shop/...` while the Study tab is lit would contradict the shell.
 * The Shop spelling redirects here.
 */
export const STUDY_PRODUCTS_PATH = '/study/products';

/**
 * Tests live under Study, and so do their URLs.
 *
 * `/tests`, `/tests/active` and `/tests/review` are older spellings that
 * already exist in bookmarks and in the shell's own links, so they stay. The
 * two NEW places a student can be — building a test, and one particular test —
 * are minted under `/study/tests`, where the section they belong to is in the
 * path. `/tests/new` redirects here.
 *
 * `/study/tests/:testId` is what makes a personal test linkable at all: before
 * it, a generated test had nowhere to land, so the job runner's "Open" and
 * every push notification could only drop the student on the list and leave
 * them to find it.
 */
export const TEST_BUILDER_PATH = '/study/tests/new';

export function buildTestDetailPath(testId: string): string {
  return `/study/tests/${encodeURIComponent(testId)}`;
}

export type ShopView = 'browse' | 'courses' | 'sell';

export interface ShopRoute {
  view: ShopView;
  /** The open course on `/campus/shop/courses/:courseId`. */
  courseId: string | null;
}

/**
 * What the Shop screen should be showing, read straight off the path.
 *
 * The URL is the authority for these sub-states — the same rule the Library
 * tabs follow — so a reload, a Back step and a pasted link all agree.
 */
export function parseShopRoute(pathname: string): ShopRoute {
  const path = normalizePath(pathname);
  if (path === SHOP_SELL_PATH) return { view: 'sell', courseId: null };
  if (path === SHOP_COURSES_PATH) return { view: 'courses', courseId: null };
  const courseId = segment(path, /^\/campus\/shop\/courses\/([^/]+)$/);
  if (courseId) return { view: 'courses', courseId };
  return { view: 'browse', courseId: null };
}

/**
 * Paths from the old four-shelf navigation, plus the spellings the shell's own
 * labels invite ("Jobs" → `/jobs`, "Downloads" → `/downloads`).
 *
 * Every one of these used to fall into the catch-all and land on the dashboard,
 * which reads as "that section does not exist". A legacy path must always name
 * the place that replaced it. The target is canonical, so the parser resolves
 * the mode and params by parsing it — the redirect can never disagree with the
 * screen it points at.
 */
const LEGACY_PATH_REDIRECTS: Readonly<Record<string, string>> = {
  '/jobs': '/campus/jobs',
  '/discover/jobs': '/campus/jobs',
  '/shop': SHOP_PATH,
  '/goods': SHOP_PATH,
  '/marketplace/goods': SHOP_PATH,
  '/marketplace/shop': SHOP_PATH,
  '/discover/shop': SHOP_PATH,
  '/discover/goods': SHOP_PATH,
  '/communities': '/campus',
  '/discover/communities': '/campus',
  '/discover/c': '/campus',
  '/campus/communities': '/campus',
  '/marketplace/sell': SHOP_SELL_PATH,
  '/marketplace/new': SHOP_SELL_PATH,
  '/marketplace/courses': SHOP_COURSES_PATH,
  '/marketplace/study-products': STUDY_PRODUCTS_PATH,
  '/campus/shop/study-products': STUDY_PRODUCTS_PATH,
  '/study-products': STUDY_PRODUCTS_PATH,
  '/downloads': '/offline',
  // Tests moved under Study; `/study/tests` is the list, which already has a URL.
  '/tests/new': TEST_BUILDER_PATH,
  '/study/tests': '/tests',
  // Budget was Campus Pocket before the rename.
  '/campus-pocket': '/budget',
  '/pocket': '/budget',
};

export interface AppRouteParams {
  groupId?: string;
  threadId?: string;
  deckId?: string;
  listingId?: string;
  orderId?: string;
  sellerId?: string;
  noteId?: string;
  inviteId?: string;
  shareToken?: string;
  jobId?: string;
  companyId?: string;
  /** Campus page: `/campus/:slug/:programme`, and community `/discover/c/:slug`. */
  slug?: string;
  /**
   * One board post: `/discover/c/:slug/ch/:groupId/p/:postId` — the link a
   * student pastes into WhatsApp (`boardPostShareUrl`). Mobile already routes
   * this shape (linking.ts), so without it here a shared link is unopenable on
   * web. It is a sub-path of the channel, not its own AppMode: the board
   * renders and opens that post's comments.
   */
  postId?: string;
  programme?: string;
  roomId?: string;
  /**
   * `/discover/new` (start a community) and `/discover/join/:code` (join with
   * an invite link) — two modals on the Communities surface that are worth a
   * URL, because both are things one student sends another. They resolve to
   * `AppMode.DISCOVER` and open over it; the code is the community slug the
   * invite link carries (see components/community/joinByCode.ts).
   */
  communityAction?: 'create' | 'join';
  communityCode?: string;
  /** Which Library tab `/library/:libraryTab` names. Absent on bare `/library`. */
  libraryTab?: LibraryTabParam;
  /** Budget Wallet tab — `/budget/wallet`. Other budget tabs stay on `/budget`. */
  budgetTab?: BudgetTabParam;
  /** Which Campus segment `/campus`, `/campus/shop` or `/campus/jobs` names. */
  campusSegment?: CampusSegment;
  /** `courses` when the path is `/campus/shop/courses[/:courseId]`. */
  shopView?: Exclude<ShopView, 'browse' | 'sell'>;
  /** The course open on `/campus/shop/courses/:courseId`. */
  courseId?: string;
  /** One personal study set: `/study/sets/:studySetId`. */
  studySetId?: string;
  /** Nested tool under `/study/sets/:id/:activity`. */
  workspaceActivity?: StudySetPathActivity;
  createNew?: boolean;
  cardSession?: StudySetCardSession;
  playSession?: StudySetPlaySession;
  quizId?: string;
  /** One personal test: `/study/tests/:testId`. */
  testId?: string;
  /** Join-class code on `/join/:code`. */
  joinCode?: string;
}

export interface ParsedAppRoute {
  mode: AppMode | null;
  params: AppRouteParams;
  /** Server-side redirect target (e.g. `/` → `/dashboard` when authed) */
  redirect?: string;
  inviteId?: string;
  shareToken?: string;
  clearChat?: boolean;
  clearDeck?: boolean;
  /**
   * A signed-in route App.tsx renders straight from the path, with no AppMode
   * behind it — the same shape `/invite/:id` and `/notes/share/:token` already
   * use. `useRouteSync` must leave these alone: they are neither a mode to
   * hydrate nor an unknown path to bounce to the dashboard.
   */
  standalone?: 'me' | 'test-builder' | 'test-detail' | 'teach' | 'join';
}

/** The single capture group of `pattern`, decoded — `null` when it is absent. */
function segment(path: string, pattern: RegExp): string | null {
  const raw = path.match(pattern)?.[1];
  return raw ? decodeURIComponent(raw) : null;
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/$/, '');
  return trimmed || '/';
}

export function buildNoteSharePath(token: string): string {
  return `/notes/share/${encodeURIComponent(token)}`;
}

export function buildAppPath(mode: AppMode, params: AppRouteParams = {}): string | null {
  switch (mode) {
    case AppMode.DASHBOARD:
      return '/dashboard';
    case AppMode.CHAT:
      if (params.groupId) return `/chat/group/${encodeURIComponent(params.groupId)}`;
      if (params.threadId) return `/chat/dm/${encodeURIComponent(params.threadId)}`;
      return '/chat';
    case AppMode.CREATE_GROUP:
      return '/groups/new';
    case AppMode.FLASHCARDS:
      return '/flashcards';
    case AppMode.DECK_DETAIL:
      return params.deckId ? `/flashcards/deck/${encodeURIComponent(params.deckId)}` : '/flashcards';
    case AppMode.CAMPUS_PAGE:
      return params.slug
        ? `/campus/${encodeURIComponent(params.slug)}${params.programme ? `/${encodeURIComponent(params.programme)}` : ''}`
        : '/campus';
    case AppMode.TESTS_HOME:
      return '/tests';
    case AppMode.TEST_ACTIVE:
      return '/tests/active';
    case AppMode.TEST_REVIEW:
      return '/tests/review';
    case AppMode.STUDY_ACTIVE:
      return '/study/session';
    case AppMode.GAME_ACTIVE:
      return '/game';
    case AppMode.GAME_RESULTS:
      return '/game/results';
    case AppMode.FLASHCARD_REVIEW:
      return '/flashcards/review';
    case AppMode.FLASHCARD_CRAM:
      return '/flashcards/cram';
    case AppMode.FLASHCARD_MATCH:
      return '/flashcards/match';
    case AppMode.FLASHCARD_LEARN:
      return '/flashcards/learn';
    case AppMode.INVITE_FRIENDS:
      return '/invite';
    case AppMode.SEMESTER_PRODUCTS:
      return '/semester-products';
    case AppMode.STUDY_ROOM:
      return params.roomId
        ? `/study-room/${encodeURIComponent(params.roomId)}`
        : '/study-room';
    // Campus, three segments. `/discover`, `/marketplace` and
    // `/marketplace/jobs` still parse (and redirect here) so old links live.
    case AppMode.DISCOVER:
      // The two community modals keep their own URLs so an invite link and a
      // "start a community" link can be sent to someone.
      if (params.communityAction === 'create') return '/discover/new';
      if (params.communityAction === 'join') {
        return params.communityCode
          ? `/discover/join/${encodeURIComponent(params.communityCode)}`
          : '/discover/join';
      }
      return '/campus';
    case AppMode.COMMUNITY_DETAIL:
      // A channel opened from the community stays on the community's own
      // path (founder rule: the community owns its chat), so it reloads
      // with the column out rather than on the chat screen.
      if (!params.slug) return '/campus';
      if (!params.groupId) return `/discover/c/${encodeURIComponent(params.slug)}`;
      const channel = `/discover/c/${encodeURIComponent(params.slug)}/ch/${encodeURIComponent(params.groupId)}`;
      // A post is a sub-path of its board, so Back from an open post lands on
      // the board rather than leaving the community.
      return params.postId ? `${channel}/p/${encodeURIComponent(params.postId)}` : channel;
    case AppMode.MARKETPLACE:
      // The Shop's own sub-destinations. Without params this is plain browse,
      // so tapping the Campus > Shop tab still lands on `/campus/shop`.
      if (params.courseId) {
        return `${SHOP_COURSES_PATH}/${encodeURIComponent(params.courseId)}`;
      }
      if (params.shopView === 'courses') return SHOP_COURSES_PATH;
      return SHOP_PATH;
    case AppMode.MARKETPLACE_LISTING_DETAIL:
      return params.listingId
        ? `/marketplace/listing/${encodeURIComponent(params.listingId)}`
        : '/campus/shop';
    case AppMode.MARKETPLACE_ORDERS:
      return '/marketplace/orders';
    case AppMode.MARKETPLACE_CART:
      return '/marketplace/cart';
    case AppMode.MARKETPLACE_ORDER_DETAIL:
      return params.orderId
        ? `/marketplace/orders/${encodeURIComponent(params.orderId)}`
        : '/marketplace/orders';
    case AppMode.MY_LISTINGS:
      return '/marketplace/my-listings';
    case AppMode.MARKETPLACE_FAVORITES:
      return '/marketplace/favorites';
    case AppMode.MARKETPLACE_INQUIRIES:
      return '/marketplace/inquiries';
    case AppMode.SELLER_PROFILE:
      return params.sellerId
        ? `/marketplace/seller/${encodeURIComponent(params.sellerId)}`
        : '/campus/shop';
    case AppMode.CREATE_MARKETPLACE_LISTING:
      // The Sell sheet opens over the Shop, so its url is a sub-path of the
      // Shop. `/marketplace/new` redirects here.
      return SHOP_SELL_PATH;
    case AppMode.STUDY_PRODUCT_DRAFTS:
      return STUDY_PRODUCTS_PATH;
    case AppMode.SELLER_CUSTOMERS:
      return '/marketplace/seller/customers';
    case AppMode.MARKETPLACE_JOBS:
      return '/campus/jobs';
    case AppMode.MARKETPLACE_JOB_DETAIL:
      return params.jobId
        ? `/marketplace/jobs/${encodeURIComponent(params.jobId)}`
        : '/campus/jobs';
    case AppMode.CREATE_MARKETPLACE_JOB:
      // The same screen handles creating and editing; the id decides which.
      return params.jobId
        ? `/marketplace/jobs/${encodeURIComponent(params.jobId)}/edit`
        : '/marketplace/jobs/new';
    case AppMode.MY_JOB_POSTINGS:
      return '/marketplace/my-jobs';
    case AppMode.MY_JOB_APPLICATIONS:
      return '/marketplace/applications';
    case AppMode.JOB_EMPLOYER:
      return '/marketplace/employer';
    case AppMode.JOB_EMPLOYER_PIPELINE:
      return params.jobId
        ? `/marketplace/employer/jobs/${encodeURIComponent(params.jobId)}`
        : '/marketplace/employer';
    case AppMode.JOB_COMPANY:
      return params.companyId
        ? `/marketplace/companies/${encodeURIComponent(params.companyId)}`
        : '/campus/jobs';
    // Notes and Flashcards each have two routes on purpose, and they are not
    // duplicates: `/library/notes` is the Library with its Notes tab open (the
    // screen renders embedded, inside the Library's course rail and scope row),
    // while `/notes` is the same screen standalone and full-bleed — App.tsx
    // feeds both from one `renderNotesScreen(embedded)`. `/library/:tab` is the
    // canonical destination for navigation; `/notes` and `/flashcards` are kept
    // for the deep links that already point at them (note editor "back",
    // deck detail "back", existing bookmarks).
    case AppMode.NOTES:
      return '/notes';
    case AppMode.LIBRARY:
      // The tab sub-paths are canonical: a Library tab is a place you can link
      // to, bookmark and go Back to. Bare `/library` stays emittable so
      // `isRoutableAppMode` (which calls this with no params) still says yes,
      // and so older links keep working — hydration rewrites it to the tab.
      return params.libraryTab ? `/library/${params.libraryTab}` : '/library';
    case AppMode.STUDY_HUB:
      return '/study';
    case AppMode.COURSE_WORKSPACE:
      return params.courseId
        ? `/study/courses/${encodeURIComponent(params.courseId)}`
        : '/study';
    case AppMode.STUDY_SET_WORKSPACE:
      if (!params.studySetId) return '/study';
      return buildStudySetPath({
        studySetId: params.studySetId,
        activity: params.workspaceActivity ?? 'home',
        noteId: params.noteId,
        deckId: params.deckId,
        testId: params.testId,
        quizId: params.quizId,
        createNew: params.createNew,
        cardSession: params.cardSession,
        playSession: params.playSession,
      });
    case AppMode.AI_TOOLS:
      return '/ai-tools';
    case AppMode.NOTE_EDITOR:
      return params.noteId ? `/notes/${encodeURIComponent(params.noteId)}` : '/notes';
    case AppMode.BUDGET_TRACKER:
      return params.budgetTab === 'wallet' ? '/budget/wallet' : '/budget';
    case AppMode.OFFLINE_MODE:
      return '/offline';
    case AppMode.ADMIN:
      return '/admin';
    default:
      return null;
  }
}

export function parseAppRoute(pathname: string): ParsedAppRoute {
  const path = normalizePath(pathname);

  if (path === '/') {
    return { mode: null, params: {} };
  }
  if (path === '/welcome') return { mode: null, params: {} };
  // Legacy and guessable spellings, before anything else so a prefix branch
  // below can never claim one (`/campus/communities` would otherwise parse as
  // an institution page for a campus called "communities").
  const legacyTarget = LEGACY_PATH_REDIRECTS[path];
  if (legacyTarget) {
    return { ...parseAppRoute(legacyTarget), redirect: legacyTarget };
  }
  if (path === '/dashboard') return { mode: AppMode.DASHBOARD, params: {} };
  if (path === '/chat') return { mode: AppMode.CHAT, params: {}, clearChat: true };
  if (path === '/groups/new') return { mode: AppMode.CREATE_GROUP, params: {} };
  if (path === '/flashcards') return { mode: AppMode.FLASHCARDS, params: {}, clearDeck: true };
  if (path === '/flashcards/review') return { mode: AppMode.FLASHCARD_REVIEW, params: {} };
  if (path === '/flashcards/cram') return { mode: AppMode.FLASHCARD_CRAM, params: {} };
  if (path === '/flashcards/match') return { mode: AppMode.FLASHCARD_MATCH, params: {} };
  if (path === '/flashcards/learn') return { mode: AppMode.FLASHCARD_LEARN, params: {} };
  // The specific routes first: `/tests` is the home, not a prefix of them.
  if (path === '/tests') return { mode: AppMode.TESTS_HOME, params: {} };
  if (path === '/tests/active') return { mode: AppMode.TEST_ACTIVE, params: {} };
  if (path === '/tests/review') return { mode: AppMode.TEST_REVIEW, params: {} };
  // `/study/tests/...`: the builder, then one test by id. `new` is a reserved
  // word in this namespace and is matched first, so a test can never be
  // addressed by an id that would shadow the page that creates tests.
  if (path === TEST_BUILDER_PATH) {
    return { mode: null, params: {}, standalone: 'test-builder' };
  }
  const testId = segment(path, /^\/study\/tests\/([^/]+)$/);
  if (testId) {
    return { mode: null, params: { testId }, standalone: 'test-detail' };
  }
  if (path === '/study/session') return { mode: AppMode.STUDY_ACTIVE, params: {} };
  if (path === '/game') return { mode: AppMode.GAME_ACTIVE, params: {} };
  if (path === '/game/results') return { mode: AppMode.GAME_RESULTS, params: {} };
  if (path === ME_PATH || path === ME_PROGRESS_PATH) {
    return { mode: null, params: {}, standalone: 'me' };
  }
  if (path.startsWith(`${ME_PATH}/`)) {
    return { mode: null, params: {}, redirect: ME_PATH };
  }
  // Lecturer portal and class join are real destinations with no AppMode —
  // App.tsx renders them outside the student shell. useRouteSync must not
  // bounce them to the dashboard.
  if (path === '/teach' || path.startsWith('/teach/')) {
    return { mode: null, params: {}, standalone: 'teach' };
  }
  const joinCode = segment(path, /^\/join\/([^/]+)$/);
  if (joinCode) {
    return {
      mode: null,
      params: { joinCode: canonicalizeJoinCode(joinCode) },
      standalone: 'join',
    };
  }
  // Campus segments come before the `/campus/:slug` SEO page: `shop` and `jobs`
  // are reserved words in this namespace, never institution slugs.
  if (path === '/campus') {
    return { mode: AppMode.DISCOVER, params: { campusSegment: 'communities' } };
  }
  if (path === '/campus/shop') {
    return { mode: AppMode.MARKETPLACE, params: { campusSegment: 'shop' } };
  }
  if (path === '/campus/jobs') {
    return { mode: AppMode.MARKETPLACE_JOBS, params: { campusSegment: 'jobs' } };
  }
  // The Shop's sub-destinations. They sit above the `/campus/:slug` page for
  // the same reason `shop` and `jobs` do: these are reserved words in this
  // namespace, never institution slugs.
  if (path === SHOP_SELL_PATH) {
    return { mode: AppMode.CREATE_MARKETPLACE_LISTING, params: { campusSegment: 'shop' } };
  }
  if (path === SHOP_COURSES_PATH) {
    return {
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop', shopView: 'courses' },
    };
  }
  const shopCourseId = segment(path, /^\/campus\/shop\/courses\/([^/]+)$/);
  if (shopCourseId) {
    return {
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop', shopView: 'courses', courseId: shopCourseId },
    };
  }
  // A mistyped sub-path of a reserved segment belongs to that segment. Falling
  // through would route it to the public campus page for an institution named
  // "shop" or "jobs", which is a wrong screen rather than a missing one.
  if (path.startsWith('/campus/shop/')) {
    return {
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop' },
      redirect: SHOP_PATH,
    };
  }
  if (path.startsWith('/campus/jobs/')) {
    return {
      mode: AppMode.MARKETPLACE_JOBS,
      params: { campusSegment: 'jobs' },
      redirect: '/campus/jobs',
    };
  }
  if (path.startsWith('/campus/')) {
    const rest = path.slice('/campus/'.length).split('/').filter(Boolean);
    const slug = decodeURIComponent(rest[0] || '');
    if (slug) {
      return {
        mode: AppMode.CAMPUS_PAGE,
        params: { slug, ...(rest[1] ? { programme: decodeURIComponent(rest[1]) } : {}) },
      };
    }
  }
  if (path === '/invite') return { mode: AppMode.INVITE_FRIENDS, params: {} };
  if (path === '/semester-products') return { mode: AppMode.SEMESTER_PRODUCTS, params: {} };
  if (path === '/study-room') return { mode: AppMode.STUDY_ROOM, params: {} };
  if (path.startsWith('/study-room/')) {
    const roomId = decodeURIComponent(path.slice('/study-room/'.length));
    return roomId ? { mode: AppMode.STUDY_ROOM, params: { roomId } } : { mode: AppMode.STUDY_ROOM, params: {} };
  }
  // Old entry points. They still PARSE (so a guest, or a client that never
  // reloads, lands somewhere real) and carry a redirect to the Campus segment
  // that replaced them.
  // Registered before `/discover` and `/discover/c/`: both are more specific
  // than the bare hub and neither can be a community slug.
  if (path === '/discover/new') {
    return {
      mode: AppMode.DISCOVER,
      params: { campusSegment: 'communities', communityAction: 'create' },
    };
  }
  if (path === '/discover/join' || path.startsWith('/discover/join/')) {
    const code = decodeURIComponent(path.slice('/discover/join/'.length).split('/')[0] || '');
    return {
      mode: AppMode.DISCOVER,
      params: {
        campusSegment: 'communities',
        communityAction: 'join',
        // An empty code still opens the box — the reader can paste the link
        // there, which is better than bouncing them to a hub with no
        // explanation of why their link did nothing.
        ...(code ? { communityCode: code } : {}),
      },
    };
  }
  if (path === '/discover') {
    return {
      mode: AppMode.DISCOVER,
      params: { campusSegment: 'communities' },
      redirect: '/campus',
    };
  }
  if (path.startsWith('/discover/c/')) {
    const rest = path.slice('/discover/c/'.length).split('/').filter(Boolean);
    const slug = decodeURIComponent(rest[0] || '');
    if (!slug) return { mode: AppMode.DISCOVER, params: {} };
    // `/discover/c/:slug/ch/:groupId` — a channel inside the community, and
    // `/discover/c/:slug/ch/:groupId/p/:postId` — one post on its board, the
    // shape `boardPostShareUrl` mints and mobile already routes. An
    // unrecognised deeper segment falls back to the channel rather than the
    // community, so a mangled link still lands somewhere the reader can use.
    if (rest[1] === 'ch' && rest[2]) {
      const groupId = decodeURIComponent(rest[2]);
      if (rest[3] === 'p' && rest[4]) {
        return {
          mode: AppMode.COMMUNITY_DETAIL,
          params: { slug, groupId, postId: decodeURIComponent(rest[4]) },
        };
      }
      return {
        mode: AppMode.COMMUNITY_DETAIL,
        params: { slug, groupId },
      };
    }
    return { mode: AppMode.COMMUNITY_DETAIL, params: { slug } };
  }
  if (path === '/marketplace') {
    return {
      mode: AppMode.MARKETPLACE,
      params: { campusSegment: 'shop' },
      redirect: '/campus/shop',
    };
  }
  if (path === '/marketplace/orders') return { mode: AppMode.MARKETPLACE_ORDERS, params: {} };
  if (path === '/marketplace/cart') return { mode: AppMode.MARKETPLACE_CART, params: {} };
  if (path === '/marketplace/my-listings') return { mode: AppMode.MY_LISTINGS, params: {} };
  if (path === '/marketplace/favorites') return { mode: AppMode.MARKETPLACE_FAVORITES, params: {} };
  if (path === '/marketplace/inquiries') return { mode: AppMode.MARKETPLACE_INQUIRIES, params: {} };
  if (path === '/marketplace/seller/customers') return { mode: AppMode.SELLER_CUSTOMERS, params: {} };
  if (path === '/marketplace/jobs') {
    return {
      mode: AppMode.MARKETPLACE_JOBS,
      params: { campusSegment: 'jobs' },
      redirect: '/campus/jobs',
    };
  }
  if (path === '/marketplace/jobs/new') return { mode: AppMode.CREATE_MARKETPLACE_JOB, params: {} };
  if (path === '/marketplace/my-jobs') return { mode: AppMode.MY_JOB_POSTINGS, params: {} };
  if (path === '/marketplace/applications') return { mode: AppMode.MY_JOB_APPLICATIONS, params: {} };
  if (path === '/marketplace/employer') return { mode: AppMode.JOB_EMPLOYER, params: {} };
  if (path === '/notes') return { mode: AppMode.NOTES, params: {} };
  // `/library`, `/library/notes`, `/library/flashcards`. An unrecognised tab
  // segment resolves to the Library with no tab rather than falling through to
  // the dashboard redirect below — hydration then canonicalises the URL, which
  // is the same path bare `/library` takes.
  const libraryMatch = path.match(/^\/library(?:\/([^/]+))?$/);
  if (libraryMatch) {
    const tab = libraryMatch[1];
    if (isLibraryTabParam(tab)) {
      return { mode: AppMode.LIBRARY, params: { libraryTab: tab } };
    }
    return { mode: AppMode.LIBRARY, params: {} };
  }
  if (path === '/study') return { mode: AppMode.STUDY_HUB, params: {} };
  // The archive used to hide under Study as `/study/materials`. It is now
  // Library, the peer tab next to Study.
  if (path === '/study/materials') {
    return { mode: AppMode.LIBRARY, params: { libraryTab: 'notes' }, redirect: '/library/notes' };
  }
  const nestedSet = parseStudySetPath(path);
  if (nestedSet) {
    return {
      mode: AppMode.STUDY_SET_WORKSPACE,
      params: {
        studySetId: nestedSet.studySetId,
        workspaceActivity: nestedSet.activity,
        ...(nestedSet.noteId ? { noteId: nestedSet.noteId } : {}),
        ...(nestedSet.deckId ? { deckId: nestedSet.deckId } : {}),
        ...(nestedSet.testId ? { testId: nestedSet.testId } : {}),
        ...(nestedSet.quizId ? { quizId: nestedSet.quizId } : {}),
        ...(nestedSet.createNew ? { createNew: true } : {}),
        ...(nestedSet.cardSession ? { cardSession: nestedSet.cardSession } : {}),
        ...(nestedSet.playSession ? { playSession: nestedSet.playSession } : {}),
      },
    };
  }
  const studyCourseId = segment(path, /^\/study\/courses\/([^/]+)$/);
  if (studyCourseId) {
    return { mode: AppMode.COURSE_WORKSPACE, params: { courseId: studyCourseId } };
  }
  if (path === STUDY_PRODUCTS_PATH) return { mode: AppMode.STUDY_PRODUCT_DRAFTS, params: {} };
  if (path === '/ai-tools') return { mode: AppMode.AI_TOOLS, params: {} };
  if (path === '/wallet') {
    return { mode: AppMode.BUDGET_TRACKER, params: { budgetTab: 'wallet' }, redirect: '/budget/wallet' };
  }
  const budgetMatch = path.match(/^\/budget(?:\/([^/]+))?$/);
  if (budgetMatch) {
    const tab = budgetMatch[1];
    if (!tab) return { mode: AppMode.BUDGET_TRACKER, params: {} };
    if (tab === 'wallet') return { mode: AppMode.BUDGET_TRACKER, params: { budgetTab: 'wallet' } };
    return { mode: AppMode.BUDGET_TRACKER, params: {}, redirect: '/budget' };
  }
  if (path === '/offline') return { mode: AppMode.OFFLINE_MODE, params: {} };
  if (path === '/admin') return { mode: AppMode.ADMIN, params: {} };

  // Every remaining route is "one path segment, captured". `segment` reads
  // that capture and decodes it, so a path that matched but somehow captured
  // nothing falls through to the dashboard rather than routing to `undefined`.
  const inviteId = segment(path, /^\/invite\/([^/]+)$/);
  if (inviteId) return { mode: null, params: {}, inviteId };

  const shareToken = segment(path, /^\/notes\/share\/([^/]+)$/);
  if (shareToken) return { mode: null, params: {}, shareToken };

  const groupId = segment(path, /^\/chat\/group\/([^/]+)$/);
  if (groupId) return { mode: AppMode.CHAT, params: { groupId } };

  const threadId = segment(path, /^\/chat\/dm\/([^/]+)$/);
  if (threadId) return { mode: AppMode.CHAT, params: { threadId } };

  const deckId = segment(path, /^\/flashcards\/deck\/([^/]+)$/);
  if (deckId) return { mode: AppMode.DECK_DETAIL, params: { deckId } };

  const listingId = segment(path, /^\/marketplace\/listing\/([^/]+)$/);
  if (listingId) return { mode: AppMode.MARKETPLACE_LISTING_DETAIL, params: { listingId } };

  const pipelineJobId = segment(path, /^\/marketplace\/employer\/jobs\/([^/]+)$/);
  if (pipelineJobId) {
    return { mode: AppMode.JOB_EMPLOYER_PIPELINE, params: { jobId: pipelineJobId } };
  }

  const editJobId = segment(path, /^\/marketplace\/jobs\/([^/]+)\/edit$/);
  if (editJobId && editJobId !== 'new') {
    return { mode: AppMode.CREATE_MARKETPLACE_JOB, params: { jobId: editJobId } };
  }

  const jobId = segment(path, /^\/marketplace\/jobs\/([^/]+)$/);
  if (jobId && jobId !== 'new') {
    return { mode: AppMode.MARKETPLACE_JOB_DETAIL, params: { jobId } };
  }

  const orderId = segment(path, /^\/marketplace\/orders\/([^/]+)$/);
  if (orderId) return { mode: AppMode.MARKETPLACE_ORDER_DETAIL, params: { orderId } };

  const sellerId = segment(path, /^\/marketplace\/seller\/([^/]+)$/);
  if (sellerId) return { mode: AppMode.SELLER_PROFILE, params: { sellerId } };

  const companyId = segment(path, /^\/marketplace\/companies\/([^/]+)$/);
  if (companyId) return { mode: AppMode.JOB_COMPANY, params: { companyId } };

  const noteId = segment(path, /^\/notes\/([^/]+)$/);
  if (noteId) return { mode: AppMode.NOTE_EDITOR, params: { noteId } };

  return { mode: null, params: {}, redirect: '/dashboard' };
}

/**
 * Modes with no URL of their own.
 *
 * Empty on purpose. A test, its results and every flashcard review mode used
 * to live here, which meant the browser's address bar and Back button lied
 * about where the student was: Back from a running test left the whole
 * section instead of the test. They now have real paths above, and the screens
 * behind them re-derive their session on arrival (App.tsx bounces a mode whose
 * session is gone back to its list). The set and `isEphemeralAppMode` stay as
 * the escape hatch for a future mode that genuinely cannot be linked to.
 */
export const EPHEMERAL_APP_MODES: ReadonlySet<AppMode> = new Set<AppMode>([]);

export function isEphemeralAppMode(mode: AppMode): boolean {
  return EPHEMERAL_APP_MODES.has(mode);
}

export function isRoutableAppMode(mode: AppMode): boolean {
  return buildAppPath(mode) !== null;
}

export const PUBLIC_PATH_PREFIXES = [
  '/privacy',
  '/terms',
  '/cookies',
  '/legal/prohibited',
  '/legal/seller-terms',
  '/reset-password',
  '/welcome',
  '/login',
  '/signup',
  '/signup/teach',
  '/forgot-password',
  '/verify-email',
];

/** Public marketplace browse/detail/seller profile (read-only for guests). */
export function isPublicMarketplacePath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === '/marketplace') return true;
  if (path === '/marketplace/jobs') return true;
  // The Campus segments that replaced them. A guest never gets the signed-in
  // redirect (useRouteSync only follows `redirect` for a signed-in user), so
  // both spellings have to reach the guest shell.
  if (path === '/campus/shop') return true;
  if (path === '/campus/jobs') return true;
  if (/^\/marketplace\/listing\/[^/]+$/.test(path)) return true;
  if (/^\/marketplace\/jobs\/[^/]+$/.test(path) && path !== '/marketplace/jobs/new') return true;
  if (/^\/marketplace\/seller\/[^/]+$/.test(path)) return true;
  if (/^\/marketplace\/companies\/[^/]+$/.test(path)) return true;
  return false;
}

export function isPublicAppPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (PUBLIC_PATH_PREFIXES.includes(path)) return true;
  if (path === '/' || path.startsWith('/invite/') || path.startsWith('/notes/share/')) return true;
  // Guest instructor landing only — /teach/new still requires sign-in.
  if (path === '/teach') return true;
  // Phase 4 R: campus pages are the SEO surface — they MUST render for a
  // logged-out visitor, or the crawler's link goes to a login wall.
  if (path.startsWith('/campus/')) return true;
  if (isPublicMarketplacePath(path)) return true;
  return false;
}

export function isAuthAppPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return (
    path === '/login' ||
    path === '/signup' ||
    path === '/signup/teach' ||
    path === '/forgot-password' ||
    path === '/verify-email'
  );
}
