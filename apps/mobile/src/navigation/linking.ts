import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';
import { parseDeepLink } from '@lantern/shared';
import type { RootStackParamList } from './types';

const prefixes = [
  Linking.createURL('/'),
  'lanternstudy://',
  'lanternstudy:/',
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
              SellerProfile: 'marketplace/seller/:sellerId',
              Inquiries: 'marketplace/inquiries',
              Offers: 'marketplace/offers',
              Favorites: 'marketplace/favorites',
              EditListing: 'marketplace/edit/:listingId',
              MyListings: 'marketplace/my-listings',
              Orders: 'marketplace/orders',
              OrderDetail: 'marketplace/orders/:orderId',
              CreateListing: 'marketplace/create',
              ShopBrowse: 'marketplace/browse',
              Cart: 'marketplace/cart',
              ShopAccount: 'marketplace/you',
              StudyProductDrafts: 'marketplace/products',
              SellerPayout: 'marketplace/payouts',
            },
          },
          // Jobs owns its own stack, so its links must resolve under JobsTab.
          // The paths keep their marketplace/ prefix: they are already in the
          // wild, in job alerts and shared postings.
          JobsTab: {
            screens: {
              JobsHome: 'marketplace/jobs',
              JobDetail: 'marketplace/jobs/:jobId',
              CreateJob: 'marketplace/jobs/new',
              MyJobPostings: 'marketplace/my-jobs',
              MyJobApplications: 'marketplace/applications',
              JobEmployer: 'marketplace/employer',
              JobApplicants: 'marketplace/employer/jobs/:jobId',
              JobCompany: 'marketplace/companies/:companyId',
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
      return { screen: 'ChatTab', params: { screen: 'GroupChat', params: { groupId: parsed.id }, initial: false } as any };
    case 'listing':
      return { screen: 'MarketTab', params: { screen: 'ListingDetail', params: { listingId: parsed.id } } as any };
    case 'flashcard':
      return parsed.extra?.deckId
        ? { screen: 'StudyTab', params: { screen: 'DeckDetail', params: { deckId: parsed.extra.deckId } } as any }
        : { screen: 'StudyTab', params: { screen: 'FlashcardsList' } as any };
    case 'profile':
      return { screen: 'EditProfile' } as any;
    case 'marketplace':
      // marketplace/orders/:orderId (Paystack return / notification deep links)
      if (parsed.id === 'orders' && parsed.extra?.orderId) {
        return {
          screen: 'MarketTab',
          params: {
            screen: 'OrderDetail',
            params: {
              orderId: parsed.extra.orderId,
              payment: parsed.extra.payment,
              reference: parsed.extra.reference || parsed.extra.trxref,
            },
          } as any,
        };
      }
      return { screen: 'MarketTab', params: { screen: 'MarketplaceHome' } as any };
    case 'budget':
      return { screen: 'BudgetTab', params: { screen: 'BudgetHome' } as any };
    case 'test':
      return { screen: 'StudyTab', params: { screen: 'TestsList' } as any };
    default:
      return null;
  }
}
