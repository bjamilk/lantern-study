import { AppMode, Deck } from '../types';
import { BreadcrumbItem } from '../components/layout/Breadcrumb';

interface BreadcrumbContext {
  appMode: AppMode;
  selectedDeck: Deck | null;
  setAppMode: (mode: AppMode) => void;
  setSelectedDeck: (deck: Deck | null) => void;
  setActiveTestResult: (result: any) => void;
}

export function getBreadcrumbs(ctx: BreadcrumbContext): BreadcrumbItem[] {
  const { appMode, selectedDeck, setAppMode, setSelectedDeck, setActiveTestResult } = ctx;

  switch (appMode) {
    case AppMode.DECK_DETAIL:
      return [
        { label: 'Flashcards', onClick: () => { setAppMode(AppMode.FLASHCARDS); setSelectedDeck(null); } },
        { label: selectedDeck?.name || 'Deck' },
      ];
    case AppMode.FLASHCARD_REVIEW:
      return [
        { label: 'Flashcards', onClick: () => { setAppMode(AppMode.FLASHCARDS); setSelectedDeck(null); } },
        { label: selectedDeck?.name || 'Deck', onClick: () => setAppMode(AppMode.DECK_DETAIL) },
        { label: 'Review' },
      ];
    case AppMode.FLASHCARD_CRAM:
      return [
        { label: 'Flashcards', onClick: () => { setAppMode(AppMode.FLASHCARDS); setSelectedDeck(null); } },
        { label: selectedDeck?.name || 'Deck', onClick: () => setAppMode(AppMode.DECK_DETAIL) },
        { label: 'Cram Session' },
      ];
    case AppMode.MARKETPLACE_LISTING_DETAIL:
      return [
        { label: 'Marketplace', onClick: () => setAppMode(AppMode.MARKETPLACE) },
        { label: 'Listing Details' },
      ];
    case AppMode.MY_LISTINGS:
      return [
        { label: 'Marketplace', onClick: () => setAppMode(AppMode.MARKETPLACE) },
        { label: 'My Listings' },
      ];
    case AppMode.MARKETPLACE_INQUIRIES:
      return [
        { label: 'Marketplace', onClick: () => setAppMode(AppMode.MARKETPLACE) },
        { label: 'Inquiries' },
      ];
    case AppMode.MARKETPLACE_ORDERS:
      return [
        { label: 'Marketplace', onClick: () => setAppMode(AppMode.MARKETPLACE) },
        { label: 'Orders' },
      ];
    case AppMode.MARKETPLACE_ORDER_DETAIL:
      return [
        { label: 'Marketplace', onClick: () => setAppMode(AppMode.MARKETPLACE) },
        { label: 'Orders', onClick: () => setAppMode(AppMode.MARKETPLACE_ORDERS) },
        { label: 'Order Details' },
      ];
    case AppMode.SELLER_CUSTOMERS:
      return [
        { label: 'Marketplace', onClick: () => setAppMode(AppMode.MARKETPLACE) },
        { label: 'My Listings', onClick: () => setAppMode(AppMode.MY_LISTINGS) },
        { label: 'Customers' },
      ];
    case AppMode.CREATE_MARKETPLACE_LISTING:
      return [
        { label: 'Marketplace', onClick: () => setAppMode(AppMode.MARKETPLACE) },
        { label: 'New Listing' },
      ];
    case AppMode.TEST_REVIEW:
      return [
        { label: 'Dashboard', onClick: () => { setActiveTestResult(null); setAppMode(AppMode.DASHBOARD); } },
        { label: 'Test Review' },
      ];
    case AppMode.CREATE_GROUP:
      return [
        { label: 'Chat', onClick: () => setAppMode(AppMode.CHAT) },
        { label: 'Create Group' },
      ];
    case AppMode.NOTE_EDITOR:
      return [
        { label: 'Notes', onClick: () => setAppMode(AppMode.NOTES) },
        { label: 'Editor' },
      ];
    default:
      return [];
  }
}
