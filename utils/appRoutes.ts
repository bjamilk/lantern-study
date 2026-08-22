import { AppMode } from '../types';

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
    case AppMode.MARKETPLACE:
      return '/marketplace';
    case AppMode.MARKETPLACE_LISTING_DETAIL:
      return params.listingId
        ? `/marketplace/listing/${encodeURIComponent(params.listingId)}`
        : '/marketplace';
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
        : '/marketplace';
    case AppMode.CREATE_MARKETPLACE_LISTING:
      return '/marketplace/new';
    case AppMode.SELLER_CUSTOMERS:
      return '/marketplace/seller/customers';
    case AppMode.MARKETPLACE_JOBS:
      return '/marketplace/jobs';
    case AppMode.MARKETPLACE_JOB_DETAIL:
      return params.jobId
        ? `/marketplace/jobs/${encodeURIComponent(params.jobId)}`
        : '/marketplace/jobs';
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
        : '/marketplace/jobs';
    case AppMode.NOTES:
      return '/notes';
    case AppMode.LIBRARY:
      return '/library';
    case AppMode.STUDY_HUB:
      return '/study';
    case AppMode.AI_TOOLS:
      return '/ai-tools';
    case AppMode.NOTE_EDITOR:
      return params.noteId ? `/notes/${encodeURIComponent(params.noteId)}` : '/notes';
    case AppMode.BUDGET_TRACKER:
      return '/budget';
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
  if (path === '/dashboard') return { mode: AppMode.DASHBOARD, params: {} };
  if (path === '/chat') return { mode: AppMode.CHAT, params: {}, clearChat: true };
  if (path === '/groups/new') return { mode: AppMode.CREATE_GROUP, params: {} };
  if (path === '/flashcards') return { mode: AppMode.FLASHCARDS, params: {}, clearDeck: true };
  if (path === '/marketplace') return { mode: AppMode.MARKETPLACE, params: {} };
  if (path === '/marketplace/orders') return { mode: AppMode.MARKETPLACE_ORDERS, params: {} };
  if (path === '/marketplace/cart') return { mode: AppMode.MARKETPLACE_CART, params: {} };
  if (path === '/marketplace/my-listings') return { mode: AppMode.MY_LISTINGS, params: {} };
  if (path === '/marketplace/favorites') return { mode: AppMode.MARKETPLACE_FAVORITES, params: {} };
  if (path === '/marketplace/inquiries') return { mode: AppMode.MARKETPLACE_INQUIRIES, params: {} };
  if (path === '/marketplace/new') return { mode: AppMode.CREATE_MARKETPLACE_LISTING, params: {} };
  if (path === '/marketplace/seller/customers') return { mode: AppMode.SELLER_CUSTOMERS, params: {} };
  if (path === '/marketplace/jobs') return { mode: AppMode.MARKETPLACE_JOBS, params: {} };
  if (path === '/marketplace/jobs/new') return { mode: AppMode.CREATE_MARKETPLACE_JOB, params: {} };
  if (path === '/marketplace/my-jobs') return { mode: AppMode.MY_JOB_POSTINGS, params: {} };
  if (path === '/marketplace/applications') return { mode: AppMode.MY_JOB_APPLICATIONS, params: {} };
  if (path === '/marketplace/employer') return { mode: AppMode.JOB_EMPLOYER, params: {} };
  if (path === '/notes') return { mode: AppMode.NOTES, params: {} };
  if (path === '/library') return { mode: AppMode.LIBRARY, params: {} };
  if (path === '/study') return { mode: AppMode.STUDY_HUB, params: {} };
  if (path === '/ai-tools') return { mode: AppMode.AI_TOOLS, params: {} };
  if (path === '/budget') return { mode: AppMode.BUDGET_TRACKER, params: {} };
  if (path === '/offline') return { mode: AppMode.OFFLINE_MODE, params: {} };
  if (path === '/admin') return { mode: AppMode.ADMIN, params: {} };

  const inviteMatch = path.match(/^\/invite\/([^/]+)$/);
  if (inviteMatch) {
    return { mode: null, params: {}, inviteId: decodeURIComponent(inviteMatch[1]) };
  }

  const noteShareMatch = path.match(/^\/notes\/share\/([^/]+)$/);
  if (noteShareMatch) {
    return { mode: null, params: {}, shareToken: decodeURIComponent(noteShareMatch[1]) };
  }

  const chatGroup = path.match(/^\/chat\/group\/([^/]+)$/);
  if (chatGroup) {
    return { mode: AppMode.CHAT, params: { groupId: decodeURIComponent(chatGroup[1]) } };
  }

  const chatDm = path.match(/^\/chat\/dm\/([^/]+)$/);
  if (chatDm) {
    return { mode: AppMode.CHAT, params: { threadId: decodeURIComponent(chatDm[1]) } };
  }

  const deckMatch = path.match(/^\/flashcards\/deck\/([^/]+)$/);
  if (deckMatch) {
    return { mode: AppMode.DECK_DETAIL, params: { deckId: decodeURIComponent(deckMatch[1]) } };
  }

  const listingMatch = path.match(/^\/marketplace\/listing\/([^/]+)$/);
  if (listingMatch) {
    return {
      mode: AppMode.MARKETPLACE_LISTING_DETAIL,
      params: { listingId: decodeURIComponent(listingMatch[1]) },
    };
  }

  const employerJobMatch = path.match(/^\/marketplace\/employer\/jobs\/([^/]+)$/);
  if (employerJobMatch) {
    return {
      mode: AppMode.JOB_EMPLOYER_PIPELINE,
      params: { jobId: decodeURIComponent(employerJobMatch[1]) },
    };
  }

  const jobEditMatch = path.match(/^\/marketplace\/jobs\/([^/]+)\/edit$/);
  if (jobEditMatch && jobEditMatch[1] !== 'new') {
    return {
      mode: AppMode.CREATE_MARKETPLACE_JOB,
      params: { jobId: decodeURIComponent(jobEditMatch[1]) },
    };
  }

  const jobMatch = path.match(/^\/marketplace\/jobs\/([^/]+)$/);
  if (jobMatch && jobMatch[1] !== 'new') {
    return {
      mode: AppMode.MARKETPLACE_JOB_DETAIL,
      params: { jobId: decodeURIComponent(jobMatch[1]) },
    };
  }

  const orderMatch = path.match(/^\/marketplace\/orders\/([^/]+)$/);
  if (orderMatch) {
    return {
      mode: AppMode.MARKETPLACE_ORDER_DETAIL,
      params: { orderId: decodeURIComponent(orderMatch[1]) },
    };
  }

  const sellerMatch = path.match(/^\/marketplace\/seller\/([^/]+)$/);
  if (sellerMatch) {
    return {
      mode: AppMode.SELLER_PROFILE,
      params: { sellerId: decodeURIComponent(sellerMatch[1]) },
    };
  }

  const companyMatch = path.match(/^\/marketplace\/companies\/([^/]+)$/);
  if (companyMatch) {
    return {
      mode: AppMode.JOB_COMPANY,
      params: { companyId: decodeURIComponent(companyMatch[1]) },
    };
  }

  const noteMatch = path.match(/^\/notes\/([^/]+)$/);
  if (noteMatch) {
    return { mode: AppMode.NOTE_EDITOR, params: { noteId: decodeURIComponent(noteMatch[1]) } };
  }

  return { mode: null, params: {}, redirect: '/dashboard' };
}

export const EPHEMERAL_APP_MODES: ReadonlySet<AppMode> = new Set([
  AppMode.TEST_ACTIVE,
  AppMode.STUDY_ACTIVE,
  AppMode.GAME_ACTIVE,
  AppMode.GAME_RESULTS,
  AppMode.TEST_REVIEW,
  AppMode.FLASHCARD_REVIEW,
  AppMode.FLASHCARD_CRAM,
  AppMode.FLASHCARD_MATCH,
  AppMode.FLASHCARD_LEARN,
]);

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
  '/forgot-password',
  '/verify-email',
];

/** Public marketplace browse/detail/seller profile (read-only for guests). */
export function isPublicMarketplacePath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === '/marketplace') return true;
  if (path === '/marketplace/jobs') return true;
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
  if (isPublicMarketplacePath(path)) return true;
  return false;
}

export function isAuthAppPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return (
    path === '/login' ||
    path === '/signup' ||
    path === '/forgot-password' ||
    path === '/verify-email'
  );
}
