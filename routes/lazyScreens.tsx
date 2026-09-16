/**
 * Every lazily-loaded screen in the web app, and the fallback shown while one
 * of them is in flight.
 *
 * Exports: one `lazyWithRetry` component per heavy screen, plus
 *  `AppContentLoadingFallback` — the spinner every `<Suspense>` in the shell
 *  uses. They live together because a lazy screen is never rendered without it.
 * Touches: nothing but `utils/lazyWithRetry` and the screen modules themselves.
 * Gotchas:
 *  - A `React.lazy` component's IDENTITY is what React keys the loaded chunk
 *    to. These must be created ONCE, at module scope, and imported — creating
 *    a second copy (a second `lazyWithRetry` call for the same screen in
 *    another module) remounts the screen and throws away its state. That is
 *    why App.tsx and routes/screenRegistry.tsx both import from here rather
 *    than declaring their own.
 *  - Moved out of App.tsx verbatim (M7); the paths are relative to the repo
 *    root, one level up from this directory.
 */
import React from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';

// Heavy screens — loaded on demand to reduce initial bundle size
export const FlashcardsScreen = lazyWithRetry(() => import('../components/FlashcardsScreen'));
export const DeckDetailScreen = lazyWithRetry(() => import('../components/DeckDetailScreen'));
export const FlashcardReviewScreen = lazyWithRetry(() => import('../components/FlashcardReviewScreen'));
export const CramSessionScreen = lazyWithRetry(() => import('../components/CramSessionScreen'));
export const MatchStudyScreen = lazyWithRetry(() => import('../components/MatchStudyScreen'));
export const LearnStudyScreen = lazyWithRetry(() => import('../components/LearnStudyScreen'));
export const ImportAndStudyModal = lazyWithRetry(() => import('../components/ImportAndStudyModal'));
export const OnboardingFlow = lazyWithRetry(() => import('../components/OnboardingFlow'));
export const DailyQuestsWidget = lazyWithRetry(() => import('../components/DailyQuestsWidget'));
export const GameScreen = lazyWithRetry(() => import('../components/GameScreen').then(m => ({ default: m.GameScreen })));
export const GameResultScreen = lazyWithRetry(() => import('../components/GameResultScreen'));
export const TestTakingScreen = lazyWithRetry(() => import('../components/TestTakingScreen').then(m => ({ default: m.TestTakingScreen })));
export const TestReviewScreen = lazyWithRetry(() => import('../components/TestReviewScreen'));
export const BudgetTrackerScreen = lazyWithRetry(() => import('../components/BudgetTrackerScreen'));
export const MarketplaceScreen = lazyWithRetry(() => import('../components/MarketplaceScreen'));
export const MarketplaceListingDetailScreen = lazyWithRetry(() => import('../components/MarketplaceListingDetailScreen'));
export const MyListingsScreen = lazyWithRetry(() => import('../components/MyListingsScreen'));
export const MarketplacePurchasesScreen = lazyWithRetry(() => import('../components/MarketplacePurchasesScreen'));
export const StudyProductDraftsScreen = lazyWithRetry(() => import('../components/StudyProductDraftsScreen'));
export const SemesterProductsScreen = lazyWithRetry(() => import('../components/SemesterProductsScreen'));
export const StudyRoomScreen = lazyWithRetry(() => import('../components/StudyRoomScreen'));
export const CreatorProfileScreen = lazyWithRetry(() => import('../components/CreatorProfileScreen'));
export const DiscoverScreen = lazyWithRetry(() => import('../components/DiscoverScreen'));
export const InviteFriendsScreen = lazyWithRetry(() => import('../components/InviteFriendsScreen'));
export const CampusScreen = lazyWithRetry(() => import('../components/CampusScreen'));
export const CommunityDetailScreen = lazyWithRetry(() => import('../components/CommunityDetailScreen'));
export const CommunityChannelPane = lazyWithRetry(() => import('../components/community/CommunityChannelPane'));
export const MarketplaceFavoritesScreen = lazyWithRetry(() => import('../components/MarketplaceFavoritesScreen'));
export const MarketplaceInquiriesScreen = lazyWithRetry(() => import('../components/MarketplaceInquiriesScreen'));
export const MarketplaceOrdersScreen = lazyWithRetry(() => import('../components/MarketplaceOrdersScreen'));
export const MarketplaceCartScreen = lazyWithRetry(() => import('../components/MarketplaceCartScreen'));
export const MarketplaceCheckoutScreen = lazyWithRetry(() => import('../components/MarketplaceCheckoutScreen'));
export const ShopAccountScreen = lazyWithRetry(() => import('../components/ShopAccountScreen'));
export const MarketplaceAddressesScreen = lazyWithRetry(() => import('../components/MarketplaceAddressesScreen'));
export const MarketplaceOrderDetailScreen = lazyWithRetry(() => import('../components/MarketplaceOrderDetailScreen'));
export const SellerCustomersScreen = lazyWithRetry(() => import('../components/SellerCustomersScreen'));
export const SellerProfileScreen = lazyWithRetry(() => import('../components/SellerProfileScreen'));
export const JobsBoardScreen = lazyWithRetry(() => import('../components/JobsBoardScreen'));
export const JobDetailScreen = lazyWithRetry(() => import('../components/JobDetailScreen'));
export const CreateJobScreen = lazyWithRetry(() => import('../components/CreateJobScreen'));
export const MyJobPostingsScreen = lazyWithRetry(() => import('../components/MyJobPostingsScreen'));
export const MyJobApplicationsScreen = lazyWithRetry(() => import('../components/MyJobApplicationsScreen'));
export const JobEmployerScreen = lazyWithRetry(() => import('../components/JobEmployerScreen'));
export const JobEmployerPipelineScreen = lazyWithRetry(() => import('../components/JobEmployerPipelineScreen'));
export const JobCompanyScreen = lazyWithRetry(() => import('../components/JobCompanyScreen'));
export const AdminScreen = lazyWithRetry(() => import('../components/AdminScreen'));
export const TeachApp = lazyWithRetry(() => import('../components/teach/TeachApp'));
export const JoinClassPage = lazyWithRetry(() => import('../components/teach/JoinClassPage'));
export const NotesScreen = lazyWithRetry(() => import('../components/NotesScreen'));
export const LibraryScreen = lazyWithRetry(() => import('../components/LibraryScreen'));
export const StudyHubScreen = lazyWithRetry(() => import('../components/StudyHubScreen'));
export const CourseWorkspace = lazyWithRetry(() => import('../components/study/CourseWorkspace'));
export const TestsHomeScreen = lazyWithRetry(() => import('../components/TestsHomeScreen'));
export const TestBuilderScreen = lazyWithRetry(() => import('../components/TestBuilderScreen'));
export const AIToolsHub = lazyWithRetry(() => import('../components/AIToolsHub'));
export const LandingPage = lazyWithRetry(() => import('../components/marketing/LandingPage'));
export const TeachLandingPage = lazyWithRetry(() => import('../components/marketing/TeachLandingPage'));

export const AppContentLoadingFallback: React.FC = () => (
    <div
        className="flex-1 min-h-0 flex items-center justify-center bg-lantern-background"
        role="status"
        aria-label="Loading page"
    >
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-lantern-primary/30 border-t-lantern-primary" />
        <span className="sr-only">Loading page</span>
    </div>
);
