import type { NavigateFunction } from 'react-router-dom';
import { AppMode } from '../types';
import { useUIStore } from '../stores/uiStore';
import {
  AppRouteParams,
  buildAppPath,
  isEphemeralAppMode,
  isRoutableAppMode,
} from './appRoutes';

export const POST_LOGIN_REDIRECT_KEY = 'lantern_post_login_redirect';

let registeredNavigate: NavigateFunction | null = null;

export function registerAppNavigator(navigate: NavigateFunction): void {
  registeredNavigate = navigate;
}

export function unregisterAppNavigator(): void {
  registeredNavigate = null;
}

export function appNavigate(path: string, options?: { replace?: boolean }): void {
  if (registeredNavigate) {
    registeredNavigate(path, { replace: options?.replace ?? false });
  } else if (typeof window !== 'undefined') {
    if (options?.replace) {
      window.history.replaceState({}, '', path);
    } else {
      window.history.pushState({}, '', path);
    }
  }
}

export function storePostLoginRedirect(path: string): void {
  try {
    sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path);
  } catch {
    // sessionStorage may be unavailable
  }
}

export function consumePostLoginRedirect(): string | null {
  try {
    const path = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    if (path) sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://') || path.includes('\\')) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export function buildParamsFromState(mode: AppMode): AppRouteParams {
  const state = useUIStore.getState();
  switch (mode) {
    case AppMode.CHAT:
      if (state.selectedChat?.chatType === 'group') return { groupId: state.selectedChat.id };
      if (state.selectedChat?.chatType === 'dm') return { threadId: state.selectedChat.id };
      return {};
    case AppMode.DECK_DETAIL:
      return state.selectedDeck ? { deckId: state.selectedDeck.id } : {};
    case AppMode.MARKETPLACE_LISTING_DETAIL:
      return state.selectedMarketplaceListingId
        ? { listingId: state.selectedMarketplaceListingId }
        : {};
    case AppMode.MARKETPLACE_ORDER_DETAIL:
      return state.selectedMarketplaceOrderId
        ? { orderId: state.selectedMarketplaceOrderId }
        : {};
    case AppMode.SELLER_PROFILE:
      return state.selectedSellerId ? { sellerId: state.selectedSellerId } : {};
    case AppMode.JOB_COMPANY:
      return state.selectedCompanyId
        ? { companyId: state.selectedCompanyId }
        : {};
    case AppMode.MARKETPLACE_JOB_DETAIL:
    case AppMode.JOB_EMPLOYER_PIPELINE:
      return state.selectedJobId ? { jobId: state.selectedJobId } : {};
    case AppMode.NOTE_EDITOR:
      return state.selectedNote ? { noteId: state.selectedNote.id } : {};
    case AppMode.LIBRARY:
      return { libraryTab: state.libraryTab };
    case AppMode.STUDY_ROOM:
      return state.selectedStudyRoomId ? { roomId: state.selectedStudyRoomId } : {};
    case AppMode.COMMUNITY_DETAIL:
      // Without a slug the path collapses to /discover, which then hydrates as
      // the hub — so a bare setAppMode(COMMUNITY_DETAIL) follows the column.
      return state.activeCommunity ? { slug: state.activeCommunity.slug } : {};
    default:
      return {};
  }
}

export function applyPreNavigationEffects(mode: AppMode, params?: AppRouteParams): void {
  const ui = useUIStore.getState();
  if (mode === AppMode.CHAT && !params?.groupId && !params?.threadId) {
    ui.setSelectedChat(null);
  }
  if (mode === AppMode.FLASHCARDS && !params?.deckId) {
    ui.setSelectedDeck(null);
  }
  if (mode === AppMode.MARKETPLACE_LISTING_DETAIL && params?.listingId) {
    ui.setSelectedMarketplaceListingId(params.listingId);
  }
  if (mode === AppMode.MARKETPLACE_ORDER_DETAIL && params?.orderId) {
    ui.setSelectedMarketplaceOrderId(params.orderId);
  }
  if (mode === AppMode.SELLER_PROFILE && params?.sellerId) {
    ui.setSelectedSellerId(params.sellerId);
  }
  if (mode === AppMode.JOB_COMPANY && params?.companyId) {
    ui.setSelectedCompanyId(params.companyId);
  }
  if (
    (mode === AppMode.MARKETPLACE_JOB_DETAIL || mode === AppMode.JOB_EMPLOYER_PIPELINE) &&
    params?.jobId
  ) {
    ui.setSelectedJobId(params.jobId);
  }
  if (mode === AppMode.LIBRARY && params?.libraryTab) {
    // A caller that names the tab is asking for that tab, so the store follows
    // the request. Callers that omit it keep whatever tab is already stored.
    ui.setLibraryTab(params.libraryTab);
  }
  if (mode === AppMode.BUDGET_TRACKER) {
    if (params?.budgetTab === 'wallet') {
      ui.setBudgetTab('wallet');
    } else if (ui.budgetTab === 'wallet') {
      ui.setBudgetTab('overview');
    }
  }
  if (mode === AppMode.CREATE_MARKETPLACE_JOB) {
    // Clear when absent, or a previously viewed job would open the form in
    // edit mode instead of starting a new post.
    ui.setSelectedJobId(params?.jobId ?? null);
  }
  if (mode === AppMode.STUDY_ROOM && params?.roomId) {
    ui.setSelectedStudyRoomId(params.roomId);
  }
  if (mode === AppMode.COMMUNITY_DETAIL && !params?.groupId) {
    // Back from a channel to the community home deselects it, exactly as the
    // chat screen's back does — otherwise realtime would keep treating that
    // channel as "being viewed" and never badge it.
    ui.setSelectedChat(null);
  }
}

export function navigateForAppMode(
  mode: AppMode,
  params?: AppRouteParams,
  options?: { replace?: boolean }
): void {
  if (isEphemeralAppMode(mode)) {
    useUIStore.getState().setAppModeDirect(mode);
    return;
  }
  if (!isRoutableAppMode(mode)) {
    useUIStore.getState().setAppModeDirect(mode);
    return;
  }

  const resolvedParams = params ?? buildParamsFromState(mode);
  applyPreNavigationEffects(mode, resolvedParams);
  const path = buildAppPath(mode, resolvedParams);
  if (!path) {
    useUIStore.getState().setAppModeDirect(mode);
    return;
  }
  appNavigate(path, options);
  useUIStore.getState().setAppModeDirect(mode);
}

export function navigateToPath(path: string, options?: { replace?: boolean }): void {
  appNavigate(path, options);
}
