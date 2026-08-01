import { AppMode, Deck } from '../types';
import { BreadcrumbItem } from '../components/layout/Breadcrumb';
import { AppRouteParams } from './appRoutes';

interface BreadcrumbContext {
  appMode: AppMode;
  selectedDeck: Deck | null;
  navigateTo: (mode: AppMode, params?: AppRouteParams) => void;
  setActiveTestResult: (result: any) => void;
}

export function getBreadcrumbs(ctx: BreadcrumbContext): BreadcrumbItem[] {
  const { appMode, selectedDeck, navigateTo, setActiveTestResult } = ctx;

  switch (appMode) {
    case AppMode.LIBRARY:
      return [{ label: 'Library' }];
    case AppMode.STUDY_HUB:
      return [{ label: 'Study' }];
    case AppMode.AI_TOOLS:
      return [
        { label: 'Study', onClick: () => navigateTo(AppMode.STUDY_HUB) },
        { label: 'AI Tools' },
      ];
    case AppMode.NOTES:
      return [
        { label: 'Library', onClick: () => navigateTo(AppMode.LIBRARY) },
        { label: 'Notes' },
      ];
    case AppMode.FLASHCARDS:
      return [
        { label: 'Library', onClick: () => navigateTo(AppMode.LIBRARY) },
        { label: 'Flashcards' },
      ];
    case AppMode.DECK_DETAIL:
      return [
        { label: 'Flashcards', onClick: () => navigateTo(AppMode.FLASHCARDS) },
        { label: selectedDeck?.name || 'Deck' },
      ];
    case AppMode.FLASHCARD_REVIEW:
      return [
        { label: 'Library', onClick: () => navigateTo(AppMode.LIBRARY) },
        { label: 'Flashcards', onClick: () => navigateTo(AppMode.FLASHCARDS) },
        {
          label: selectedDeck?.name || 'Deck',
          onClick: () => selectedDeck && navigateTo(AppMode.DECK_DETAIL, { deckId: selectedDeck.id }),
        },
        { label: 'Review' },
      ];
    case AppMode.FLASHCARD_CRAM:
      return [
        { label: 'Flashcards', onClick: () => navigateTo(AppMode.FLASHCARDS) },
        {
          label: selectedDeck?.name || 'Deck',
          onClick: () => selectedDeck && navigateTo(AppMode.DECK_DETAIL, { deckId: selectedDeck.id }),
        },
        { label: 'Cram Session' },
      ];
    case AppMode.MARKETPLACE_LISTING_DETAIL:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'Listing Details' },
      ];
    case AppMode.MY_LISTINGS:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'My Listings' },
      ];
    case AppMode.MARKETPLACE_INQUIRIES:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'Inquiries' },
      ];
    case AppMode.MARKETPLACE_ORDERS:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'Purchase history' },
      ];
    case AppMode.MARKETPLACE_CART:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'Cart' },
      ];
    case AppMode.MARKETPLACE_ORDER_DETAIL:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'Orders', onClick: () => navigateTo(AppMode.MARKETPLACE_ORDERS) },
        { label: 'Order Details' },
      ];
    case AppMode.SELLER_CUSTOMERS:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'My Listings', onClick: () => navigateTo(AppMode.MY_LISTINGS) },
        { label: 'Customers' },
      ];
    case AppMode.CREATE_MARKETPLACE_LISTING:
      return [
        { label: 'Marketplace', onClick: () => navigateTo(AppMode.MARKETPLACE) },
        { label: 'New Listing' },
      ];
    case AppMode.TEST_REVIEW:
      return [
        { label: 'Dashboard', onClick: () => { setActiveTestResult(null); navigateTo(AppMode.DASHBOARD); } },
        { label: 'Test Review' },
      ];
    case AppMode.CREATE_GROUP:
      return [
        { label: 'Chat', onClick: () => navigateTo(AppMode.CHAT) },
        { label: 'Create Group' },
      ];
    case AppMode.NOTE_EDITOR:
      return [
        { label: 'Library', onClick: () => navigateTo(AppMode.LIBRARY) },
        { label: 'Notes', onClick: () => navigateTo(AppMode.NOTES) },
        { label: 'Editor' },
      ];
    default:
      return [];
  }
}
