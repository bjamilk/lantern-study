import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';
import { parseDeepLink } from '@lantern/shared';
import type { RootStackParamList } from './types';

const prefixes = [
  Linking.createURL('/'),
  'lanternstudy://',
  'lanternstudy:/',
  'https://lanternstudy.app',
  'https://lanternstudy.com',
];

export const linkingConfig: LinkingOptions<RootStackParamList> = {
  prefixes,
  config: {
    screens: {
      Auth: {
        screens: {
          Login: 'login',
          SignUp: 'signup',
          ForgotPassword: 'forgot-password',
          VerifyEmail: 'verify-email',
          ResetPassword: 'reset-password',
        },
      },
      Main: {
        screens: {
          HomeTab: { screens: { Dashboard: 'dashboard' } },
          StudyTab: {
            screens: {
              FlashcardsList: 'flashcards',
              DeckDetail: 'deck/:deckId',
              NotesList: 'notes',
              NoteEditor: 'note/:noteId',
              NoteShareAccept: 'notes/share/:token',
              TestsList: 'tests',
            },
          },
          ChatTab: {
            screens: {
              GroupsList: 'groups',
              CreateGroup: 'groups/new',
              GroupChat: 'group/:groupId',
              ChallengesInbox: 'challenges',
            },
          },
          MarketTab: {
            screens: {
              MarketplaceHome: 'marketplace',
              ListingDetail: 'listing/:listingId',
              Inquiries: 'marketplace/inquiries',
              Offers: 'marketplace/offers',
              Favorites: 'marketplace/favorites',
              EditListing: 'marketplace/edit/:listingId',
              MyListings: 'marketplace/my-listings',
              CreateListing: 'marketplace/create',
              JobsHome: 'marketplace/jobs',
              JobDetail: 'marketplace/jobs/:jobId',
              CreateJob: 'marketplace/jobs/new',
              MyJobPostings: 'marketplace/my-jobs',
              MyJobApplications: 'marketplace/applications',
              JobEmployer: 'marketplace/employer',
              JobApplicants: 'marketplace/employer/jobs/:jobId',
            },
          },
          NotificationsTab: 'notifications',
          BudgetTab: {
            screens: {
              BudgetHome: 'budget',
              SavingsGoals: 'budget/savings',
              Wallet: 'budget/wallet',
              AddExpense: 'budget/expense',
              AddIncome: 'budget/income',
              FinancialToolkit: 'budget/toolkit',
            },
          },
        },
      },
      Settings: 'settings',
      EditProfile: 'profile/edit',
      Offline: 'offline',
    },
  },
  async getInitialURL() {
    return Linking.getInitialURL();
  },
  subscribe(listener) {
    const sub = Linking.addEventListener('url', ({ url }) => listener(url));
    return () => sub.remove();
  },
};

/** Map legacy / notification links into navigation state. */
export function resolveDeepLinkNavigation(url: string): { screen: string; params?: Record<string, string> } | null {
  const parsed = parseDeepLink(url);
  if (!parsed) return null;
  switch (parsed.type) {
    case 'deck':
      return { screen: 'StudyTab', params: { screen: 'DeckDetail', params: { deckId: parsed.id } } as any };
    case 'group':
      return { screen: 'ChatTab', params: { screen: 'GroupChat', params: { groupId: parsed.id } } as any };
    case 'listing':
      return { screen: 'MarketTab', params: { screen: 'ListingDetail', params: { listingId: parsed.id } } as any };
    case 'flashcard':
      return parsed.extra?.deckId
        ? { screen: 'StudyTab', params: { screen: 'DeckDetail', params: { deckId: parsed.extra.deckId } } as any }
        : { screen: 'StudyTab', params: { screen: 'FlashcardsList' } as any };
    case 'profile':
      return { screen: 'EditProfile' } as any;
    case 'marketplace':
      return { screen: 'MarketTab', params: { screen: 'MarketplaceHome' } as any };
    case 'budget':
      return { screen: 'BudgetTab', params: { screen: 'BudgetHome' } as any };
    case 'test':
      return { screen: 'StudyTab', params: { screen: 'TestsList' } as any };
    default:
      return null;
  }
}
