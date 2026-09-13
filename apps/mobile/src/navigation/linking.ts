import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';
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
          // Campus owns Shop, Jobs and every community screen, so every
          // link that used to resolve under MarketTab or JobsTab resolves
          // here. The PATHS are unchanged: they are already in the wild, in
          // push notifications, job alerts, shared postings and board links.
          CampusTab: {
            // A cold link straight to Cart/Payouts/a board must have Campus
            // beneath it, or Back exits the tab instead of returning to the
            // segment.
            initialRouteName: 'Campus',
            screens: {
              Campus: 'campus',
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
              // Jobs kept its marketplace/ prefixed paths for the same reason.
              JobsHome: 'marketplace/jobs',
              JobDetail: 'marketplace/jobs/:jobId',
              CreateJob: 'marketplace/jobs/new',
              MyJobPostings: 'marketplace/my-jobs',
              MyJobApplications: 'marketplace/applications',
              JobEmployer: 'marketplace/employer',
              JobApplicants: 'marketplace/employer/jobs/:jobId',
              JobCompany: 'marketplace/companies/:companyId',
              // Community server view (spec §4.1) — same paths as the web app.
              CommunityDetail: 'discover/c/:slug',
              CommunityMembers: 'discover/c/:slug/members',
              // The path param is named for the screen's own param, or a deep
              // link would arrive with `slug` and leave the community context
              // (name, back link) undefined.
              CommunityChannel: 'discover/c/:communitySlug/ch/:groupId',
              CommunityPost: 'discover/c/:communitySlug/ch/:groupId/p/:rootId',
              // "Saved posts" spans every board, so it hangs off /discover
              // rather than under one community's slug (§7.5).
              SavedPosts: 'discover/saved',
            },
          },
          NotificationsTab: 'notifications',
          // Budget is a row inside Me now, so its links resolve on MeTab.
          // The `budget/*` paths are unchanged.
          MeTab: {
            initialRouteName: 'Me',
            screens: {
              Me: 'me',
              MeProgress: 'me/progress',
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
      JoinClass: 'join/:code?',
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

/**
 * The routing table itself lives in `deepLinkTargets.ts`, which imports
 * nothing from expo: it is the rule that decides where a link lands, and it is
 * worth testing in node rather than only on a device. Re-exported here so
 * every existing caller keeps its import.
 */
export { resolveDeepLinkNavigation } from './deepLinkTargets';
