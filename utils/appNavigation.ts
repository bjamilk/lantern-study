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
    if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
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
    case AppMode.MARKETPLACE_JOB_DETAIL:
    case AppMode.JOB_EMPLOYER_PIPELINE:
      return state.selectedJobId ? { jobId: state.selectedJobId } : {};
    case AppMode.NOTE_EDITOR:
      return state.selectedNote ? { noteId: state.selectedNote.id } : {};
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
  if (
    (mode === AppMode.MARKETPLACE_JOB_DETAIL || mode === AppMode.JOB_EMPLOYER_PIPELINE) &&
    params?.jobId
  ) {
    ui.setSelectedJobId(params.jobId);
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
