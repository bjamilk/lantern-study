import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { AppState, View } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ONBOARDING_COMPLETE_STORAGE_KEY,
  isOnboardingCompleteFlag,
} from '@lantern/shared/settings';
import { isCommunityBoardGroupIn } from '@lantern/shared/network';

import { NavigationContainer, DefaultTheme, DarkTheme, getFocusedRouteNameFromRoute, useFocusEffect, type NavigationState } from '@react-navigation/native';
import { navigationRef, navigate as navigateFromRoot } from './navigationRef';

/**
 * Changing the in-app font size re-keys the View wrapping the whole app
 * (see ThemeProvider) — the only way the patched Text picks up a new scale —
 * which remounts this NavigationContainer. Without restoring state, that
 * dropped the user on Home the moment they picked a font size in Settings.
 *
 * Module-level on purpose: it survives the in-process remount but not an app
 * restart, so cold starts still boot on the initial route and deep links
 * behave normally.
 */
let preservedNavState: NavigationState | undefined;

/**
 * Same lifetime rationale as preservedNavState. The font-size remount also
 * resets RootNavigatorInner's local state, which re-armed the boot gate: the
 * boot screen flashed and — because the navigator then mounted a commit later
 * than NavigationContainer — the container's initialState went unconsumed and
 * the user landed on Home anyway. Caching the onboarding answer and the
 * bootstrapped user lets a remount render the navigator immediately (same
 * commit as the container) and skip re-fetching every store on a font change.
 */
let onboardingCache: { userId: string; showOnboarding: boolean } | null = null;
let bootstrappedUserId: string | null = null;

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useAppTheme, useTheme } from '../theme';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabBar } from '../components/layout/BottomTabBar';
import {
  TAB_ROUTE_BY_KEY,
  resolveActiveTab,
  type BottomTabKey,
  type TabKey,
} from '../components/layout/tabRouting';

import { TopBar } from '../components/layout/TopBar';
import { ChromeProvider, useChrome } from '../components/layout/ChromeContext';
import { ToastHost, ConfirmSheetHost } from '../components/ui';
import { LectureRecordingBanner } from '../components/LectureRecordingBanner';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';

import { AICompanionPanel } from '../components/AICompanionPanel';

import { FeatureTipsHost } from '../components/featureTips/FeatureTipsHost';

import { BootLoadingScreen } from '../components/BootLoadingScreen';

import * as SplashScreen from 'expo-splash-screen';

import { useAuthStore } from '../stores/authStore';
import { useFeatureTipStore } from '../stores/featureTipStore';
import { setSentryUser } from '../services/sentry';
import { fetchAIUsage } from '../services/ai';
import { refreshUserData, resetDataRefresh } from '../services/dataRefresh';

import { useFlashcardStore } from '../stores/flashcardStore';

import { useGroupStore } from '../stores/groupStore';
import { collectKnownLounges, useCommunityStore } from '../stores/communityStore';

import { useSettingsStore } from '../stores/settingsStore';

import { useTestStore } from '../stores/testStore';

import { useCompanionStore } from '../stores/companionStore';
import { useNotificationStore } from '../stores/notificationStore';

import { useChallengeNotificationHandler } from '../hooks/useChallengeNotificationHandler';
import { useDeepLinkHandler } from '../hooks/useDeepLinkHandler';
import { useDailyStudyReminder } from '../hooks/useDailyStudyReminder';
import { usePresenceHeartbeat } from '../hooks/usePresenceHeartbeat';
import { useAutoSync } from '../hooks/useSync';

import {

  shouldHideTabBar,

  RootStackParamList,

  AuthStackParamList,

  HomeStackParamList,

  StudyStackParamList,

  ChatStackParamList,

  CampusStackParamList,

  MeStackParamList,

  MainTabParamList,

} from './types';
import { resolveCampusRedirect, resolveMeRedirect, type NestedNavigateParams } from './legacyTabs';

import { LoginScreen, SignUpScreen, VerifyEmailScreen, ForgotPasswordScreen, ResetPasswordScreen } from '../screens/auth';
import LegalDocumentScreen from '../screens/legal/LegalDocumentScreen';

import { DashboardScreen } from '../screens/dashboard/DashboardScreen';

import { LeaderboardScreen } from '../screens/dashboard/LeaderboardScreen';

import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';

import {

  FlashcardsScreen,

  DeckDetailScreen,

  FlashcardReviewScreen,

  CramSessionScreen,

  MatchStudyScreen,

  LearnStudyScreen,

} from '../screens/flashcards';

import { NotesScreen, NoteEditorScreen, NoteShareAcceptScreen } from '../screens/notes';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { StudyHubScreen } from '../screens/study/StudyHubScreen';

import { GroupsScreen, GroupChatScreen, DirectMessageScreen, CreateGroupScreen } from '../screens/groups';

import {

  ShopBrowseScreen,
  CourseBrowseScreen,
  CourseListingsScreen,

  ShopAccountScreen,

  ListingDetailScreen,

  MyListingsScreen,

  InquiriesScreen,

  CreateListingScreen,

  EditListingScreen,

  MakeOfferScreen,

  SellerProfileScreen,

  OffersScreen,

  FavoritesScreen,

  OrdersScreen,

  CartScreen,

  PurchasesScreen,

  StudyProductDraftsScreen,
  SemesterProductsScreen,

  CreatorProfileScreen,

  OrderDetailScreen,

  SellerCustomersScreen,
  SellerPayoutScreen,

  JobDetailScreen,

  CreateJobScreen,

  MyJobPostingsScreen,

  MyJobApplicationsScreen,

  JobEmployerScreen,

  JobApplicantsScreen,

  JobCompanyScreen,

} from '../screens/marketplace';
import { withMarketplaceGate } from '../screens/marketplace/MarketplaceGate';
import { useMarketplaceStore } from '../stores/marketplaceStore';

// Marketplace private pilot: commerce screens render only for allowlisted
// accounts (the API 403s everyone else regardless — see MarketplaceGate).
// Network screens on the same stack (Discover, CommunityDetail, Feed,
// StudyRoom, CreatorProfile, Mastery) are deliberately NOT gated.
// Module scope so each wrapped component keeps a stable identity. The Shop
// and Jobs HOME screens are gated inside CampusScreen instead: they are
// segments now, not routes.
const GatedShopBrowse = withMarketplaceGate(ShopBrowseScreen);
// "Browse by course" reads the same gated marketplace endpoints as the rest of
// the shop, so it wears the same gate rather than 403-ing inside the screen.
const GatedCourseBrowse = withMarketplaceGate(CourseBrowseScreen);
const GatedCourseListings = withMarketplaceGate(CourseListingsScreen);
const GatedShopAccount = withMarketplaceGate(ShopAccountScreen);
// Jobs joins the private pilot: hiding the drawer row is not a gate, since a
// deep link, a job notification or the marketplace workspace bar all reach
// these screens directly.
const GatedJobDetail = withMarketplaceGate(JobDetailScreen, 'jobs');
const GatedCreateJob = withMarketplaceGate(CreateJobScreen, 'jobs');
const GatedMyJobPostings = withMarketplaceGate(MyJobPostingsScreen, 'jobs');
const GatedMyJobApplications = withMarketplaceGate(MyJobApplicationsScreen, 'jobs');
const GatedJobEmployer = withMarketplaceGate(JobEmployerScreen, 'jobs');
const GatedJobApplicants = withMarketplaceGate(JobApplicantsScreen, 'jobs');
const GatedJobCompany = withMarketplaceGate(JobCompanyScreen, 'jobs');
const GatedListingDetail = withMarketplaceGate(ListingDetailScreen);
const GatedMyListings = withMarketplaceGate(MyListingsScreen);
const GatedInquiries = withMarketplaceGate(InquiriesScreen);
const GatedCreateListing = withMarketplaceGate(CreateListingScreen);
const GatedEditListing = withMarketplaceGate(EditListingScreen);
const GatedMakeOffer = withMarketplaceGate(MakeOfferScreen);
const GatedSellerProfile = withMarketplaceGate(SellerProfileScreen);
const GatedOffers = withMarketplaceGate(OffersScreen);
const GatedMarketFavorites = withMarketplaceGate(FavoritesScreen);
const GatedOrders = withMarketplaceGate(OrdersScreen);
const GatedCart = withMarketplaceGate(CartScreen);
const GatedPurchases = withMarketplaceGate(PurchasesScreen);
const GatedStudyProductDrafts = withMarketplaceGate(StudyProductDraftsScreen);
const GatedSemesterProducts = withMarketplaceGate(SemesterProductsScreen);
const GatedOrderDetail = withMarketplaceGate(OrderDetailScreen);
const GatedSellerCustomers = withMarketplaceGate(SellerCustomersScreen);
const GatedSellerPayout = withMarketplaceGate(SellerPayoutScreen);
import {
  CommunityDetailScreen,
  CommunityMembersScreen,
  CommunityChannelScreen,
  CommunityPostScreen,
  SavedPostsScreen,
  FeedScreen,
  MasteryScreen,
} from '../screens/discover';
import { StudyRoomScreen } from '../screens/study/StudyRoomScreen';

import { SettingsScreen, OfflineScreen, NotificationsScreen, EditProfileScreen, BlockedUsersScreen, AcademicSettingsScreen, InviteFriendsScreen } from '../screens/settings';

import { CampusScreen } from '../screens/campus';
import { MeScreen } from '../screens/me';

import { TestScreen, TestTakingScreen, TestResultsScreen, TestAnalysisScreen } from '../screens/tests';

import { GameScreen, GameResultScreen, ChallengesInboxScreen } from '../screens/games';

import {

  BudgetScreen,

  AddExpenseScreen,

  AddIncomeScreen,

  SetBudgetScreen,

  SavingsGoalsScreen,

  WalletScreen,

  ExpenseSplitScreen,
  RecurringScreen,

  SetCategoryBudgetScreen,

  FinancialToolkitScreen,

  AddInvestmentScreen,

} from '../screens/budget';

import { isRunningInExpoGo } from 'expo';

import { linkingConfig } from './linking';

import { registerForPushNotifications, uploadPushToken } from '../services/pushNotifications';

import { fetchUserProfile } from '../services/api';

import UsernameRequiredModal from '../components/UsernameRequiredModal';
import { AccountSuspendedBanner } from '../components/moderation/AccountSuspendedBanner';

import { getAuthHeaders, supabase } from '../services/supabase';
import { applyPendingAcademicProfile } from '../services/pendingAcademicProfile';
import { loadAcademicProfile } from '../services/academic';
import { hasAcademicIdentity } from '../utils/academicProfile';

/** Set when the user skips the academic-profile prompt; never re-raised after that. */
const ACADEMIC_SETUP_DISMISSED_KEY = 'lantern_academic_setup_dismissed';



const RootStack = createNativeStackNavigator<RootStackParamList>();

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

const HomeStack = createNativeStackNavigator<HomeStackParamList>();

const StudyStack = createNativeStackNavigator<StudyStackParamList>();

const ChatStack = createNativeStackNavigator<ChatStackParamList>();

const CampusStack = createNativeStackNavigator<CampusStackParamList>();

const MeStack = createNativeStackNavigator<MeStackParamList>();

const Tab = createBottomTabNavigator<MainTabParamList>();



function AuthNavigator() {

  return (

  <AuthStack.Navigator screenOptions={{ headerShown: false }}>

    <AuthStack.Screen name="Login" component={LoginScreen} />

    <AuthStack.Screen name="SignUp" component={SignUpScreen} />

    <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />

    <AuthStack.Screen name="VerifyEmail" component={VerifyEmailScreen} />

    <AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} />

    <AuthStack.Screen name="LegalDocument" component={LegalDocumentScreen} options={{ presentation: 'modal' }} />

  </AuthStack.Navigator>

  );

}



function HomeNavigator() {

  return (

    <HomeStack.Navigator screenOptions={{ headerShown: false }}>

      <HomeStack.Screen name="Dashboard" component={DashboardScreen} />

      <HomeStack.Screen name="Leaderboard" component={LeaderboardScreen} />

      <HomeStack.Screen name="TestAnalysis" component={TestAnalysisScreen} />

    </HomeStack.Navigator>

  );

}



function StudyNavigator() {

  return (

    <StudyStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="StudyHub">

      <StudyStack.Screen name="StudyHub" component={StudyHubScreen} />

      <StudyStack.Screen name="Library" component={LibraryScreen} />

      <StudyStack.Screen name="FlashcardsList" component={FlashcardsScreen} />

      <StudyStack.Screen name="DeckDetail" component={DeckDetailScreen} />

      <StudyStack.Screen name="FlashcardReview" component={FlashcardReviewScreen} options={{ presentation: 'fullScreenModal' }} />

      <StudyStack.Screen name="CramSession" component={CramSessionScreen} options={{ presentation: 'fullScreenModal' }} />

      <StudyStack.Screen name="MatchStudy" component={MatchStudyScreen} options={{ presentation: 'fullScreenModal' }} />

      <StudyStack.Screen name="LearnStudy" component={LearnStudyScreen} options={{ presentation: 'fullScreenModal' }} />

      <StudyStack.Screen name="NotesList" component={NotesScreen} />

      <StudyStack.Screen name="NoteEditor" component={NoteEditorScreen} />

      <StudyStack.Screen name="NoteShareAccept" component={NoteShareAcceptScreen} />

      <StudyStack.Screen name="TestsList" component={TestScreen} />

      <StudyStack.Screen name="TestTaking" component={TestTakingScreen} options={{ presentation: 'fullScreenModal' }} />

      <StudyStack.Screen name="TestResults" component={TestResultsScreen} options={{ presentation: 'fullScreenModal' }} />

      {/* Stack screen (not nested RN Modal) so charts work above TestResults. */}
      <StudyStack.Screen name="TestAnalysis" component={TestAnalysisScreen} options={{ presentation: 'fullScreenModal' }} />

    </StudyStack.Navigator>

  );

}



function ChatNavigator() {

  return (

    <ChatStack.Navigator screenOptions={{ headerShown: false }}>

      <ChatStack.Screen name="GroupsList" component={GroupsScreen} />

      <ChatStack.Screen name="CreateGroup" component={CreateGroupScreen} />

      <ChatStack.Screen name="GroupChat" component={GroupChatScreen} />

      <ChatStack.Screen name="DirectMessage" component={DirectMessageScreen} />

      <ChatStack.Screen name="GameScreen" component={GameScreen} options={{ presentation: 'fullScreenModal' }} />

      <ChatStack.Screen name="ChallengesInbox" component={ChallengesInboxScreen} />

      <ChatStack.Screen name="GameResult" component={GameResultScreen} options={{ presentation: 'fullScreenModal' }} />

    </ChatStack.Navigator>

  );

}



/**
 * Campus — one destination, three segments, and every screen those segments
 * lead into.
 *
 * The Market and Jobs stacks were merged into this one so a listing, a job, a
 * board, a post or a roster keeps the Campus tab lit; community screens in
 * particular used to sit on the Market stack, which lit Shop while a student
 * read a community board.
 */
function CampusNavigator() {

  return (

    <CampusStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Campus">

      <CampusStack.Screen name="Campus" component={CampusScreen} />

      {/* The two retired home routes. Seven screens still call these names;
          each lands on the segment that replaced it. */}
      <CampusStack.Screen name="MarketplaceHome" component={ShopHomeRedirect} />

      <CampusStack.Screen name="JobsHome" component={JobsHomeRedirect} />

      <CampusStack.Screen name="ShopBrowse" component={GatedShopBrowse} />
      <CampusStack.Screen name="CourseBrowse" component={GatedCourseBrowse} />
      <CampusStack.Screen name="CourseListings" component={GatedCourseListings} />

      <CampusStack.Screen name="ShopAccount" component={GatedShopAccount} />

      <CampusStack.Screen name="ListingDetail" component={GatedListingDetail} />

      <CampusStack.Screen name="MyListings" component={GatedMyListings} />

      <CampusStack.Screen name="Inquiries" component={GatedInquiries} />

      <CampusStack.Screen name="CreateListing" component={GatedCreateListing} />

      <CampusStack.Screen name="EditListing" component={GatedEditListing} />

      <CampusStack.Screen name="MakeOffer" component={GatedMakeOffer} />

      <CampusStack.Screen name="SellerProfile" component={GatedSellerProfile} />

      <CampusStack.Screen name="Offers" component={GatedOffers} />

      <CampusStack.Screen name="Favorites" component={GatedMarketFavorites} />

      <CampusStack.Screen name="Orders" component={GatedOrders} />

      <CampusStack.Screen name="Cart" component={GatedCart} />

      <CampusStack.Screen name="Purchases" component={GatedPurchases} />

      <CampusStack.Screen name="StudyProductDrafts" component={GatedStudyProductDrafts} />

      <CampusStack.Screen name="SemesterProducts" component={GatedSemesterProducts} />

      <CampusStack.Screen name="StudyRoom" component={StudyRoomScreen} />

      <CampusStack.Screen name="CreatorProfile" component={CreatorProfileScreen} />

      <CampusStack.Screen name="CommunityDetail" component={CommunityDetailScreen} />

      {/* Founder rule (spec §0a): a community's roster, channels and "new
          channel" flow stay on this stack so back returns to the community. */}
      <CampusStack.Screen name="CommunityMembers" component={CommunityMembersScreen} />

      <CampusStack.Screen name="CommunityChannel" component={CommunityChannelScreen} />

      {/* A board post and its comments (spec §4.1). */}
      <CampusStack.Screen name="CommunityPost" component={CommunityPostScreen} />

      {/* Bookmarks across every board (§7.5). Deliberately NOT gated behind
          canAccessDiscoverHub: the board screen carries no such gate, so
          gating this would hide saved posts from the pilot cohort that has
          them. */}
      <CampusStack.Screen name="SavedPosts" component={SavedPostsScreen} />

      <CampusStack.Screen name="CreateGroup" component={CreateGroupScreen} />

      <CampusStack.Screen name="Feed" component={FeedScreen} />

      <CampusStack.Screen name="Mastery" component={MasteryScreen} />

      <CampusStack.Screen name="OrderDetail" component={GatedOrderDetail} />

      <CampusStack.Screen name="SellerCustomers" component={GatedSellerCustomers} />

      <CampusStack.Screen name="SellerPayout" component={GatedSellerPayout} />

      <CampusStack.Screen name="JobDetail" component={GatedJobDetail} />

      <CampusStack.Screen name="CreateJob" component={GatedCreateJob} />

      <CampusStack.Screen name="MyJobPostings" component={GatedMyJobPostings} />

      <CampusStack.Screen name="MyJobApplications" component={GatedMyJobApplications} />

      <CampusStack.Screen name="JobEmployer" component={GatedJobEmployer} />

      <CampusStack.Screen name="JobApplicants" component={GatedJobApplicants} />

      <CampusStack.Screen name="JobCompany" component={GatedJobCompany} />

    </CampusStack.Navigator>

  );

}

/**
 * Me — profile and academic details, Budget, Downloads, the two modes,
 * Settings and Log out. Budget is on this stack, not a tab of its own: it is
 * one student's ledger, so Back returns to Me and the Me tab stays lit.
 */
function MeNavigator() {

  return (

    <MeStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Me">

      <MeStack.Screen name="Me" component={MeScreen} />

      <MeStack.Screen name="BudgetHome" component={BudgetScreen} />

      <MeStack.Screen name="AddExpense" component={AddExpenseScreen} />

      <MeStack.Screen name="AddIncome" component={AddIncomeScreen} />

      <MeStack.Screen name="SetBudget" component={SetBudgetScreen} />

      <MeStack.Screen name="SavingsGoals" component={SavingsGoalsScreen} />

      <MeStack.Screen name="Wallet" component={WalletScreen} />

      <MeStack.Screen name="ExpenseSplit" component={ExpenseSplitScreen} />

      <MeStack.Screen name="Recurring" component={RecurringScreen} />

      <MeStack.Screen name="SetCategoryBudget" component={SetCategoryBudgetScreen} />

      <MeStack.Screen name="FinancialToolkit" component={FinancialToolkitScreen} />

      <MeStack.Screen name="AddInvestment" component={AddInvestmentScreen} />

    </MeStack.Navigator>

  );

}

/**
 * COMPATIBILITY SHIMS
 * ===================
 * Roughly fifteen screens this wave does not own still say
 * `navigate('MarketTab', …)`, `navigate('JobsTab', …)`, `navigate('BudgetTab')`,
 * `navigate('MarketplaceHome')` or `navigate('JobsHome')`. A navigate to a
 * route that no longer exists warns in dev and is SILENTLY DROPPED in release
 * builds, so every one of those names stays registered and forwards to the
 * destination that replaced it. The translation itself is pure and tested in
 * legacyTabs.test.ts.
 *
 * They render a plain background for the one frame they are mounted, and they
 * are meant to be deleted once every call site names Campus or Me directly.
 */
function RedirectSurface() {
  return <View className="flex-1 bg-lantern-background" />;
}

/**
 * The redirect fires on FOCUS, never on mount.
 *
 * A tab screen and a stack screen both stay mounted after you navigate away
 * from them, and `navigate('MarketTab')` twice in a row delivers the same
 * (usually undefined) params — so a mount-time or params-keyed effect would
 * run once and then leave the reader parked on a blank screen the second
 * time. Focus happens on every arrival.
 */
function useRedirectOnFocus(run: () => void) {
  useFocusEffect(
    useCallback(() => {
      run();
      // `run` is rebuilt per render by design; the caller memoises what matters.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run])
  );
}

function ShopHomeRedirect({ navigation }: { navigation: any }) {
  // Campus is this stack's initial route, so navigating to it pops back to it
  // rather than pushing a second copy.
  useRedirectOnFocus(
    useCallback(
      () => navigation.navigate('Campus', { segment: 'shop', at: Date.now() }),
      [navigation]
    )
  );
  return <RedirectSurface />;
}

function JobsHomeRedirect({ navigation }: { navigation: any }) {
  useRedirectOnFocus(
    useCallback(
      () => navigation.navigate('Campus', { segment: 'jobs', at: Date.now() }),
      [navigation]
    )
  );
  return <RedirectSurface />;
}

function LegacyMarketTab({ navigation, route }: { navigation: any; route: any }) {
  const params = route?.params as NestedNavigateParams | undefined;
  useRedirectOnFocus(
    useCallback(() => {
      const { tab, params: next } = resolveCampusRedirect(params, 'shop', Date.now());
      navigation.navigate(tab, next);
    }, [navigation, params])
  );
  return <RedirectSurface />;
}

function LegacyJobsTab({ navigation, route }: { navigation: any; route: any }) {
  const params = route?.params as NestedNavigateParams | undefined;
  useRedirectOnFocus(
    useCallback(() => {
      const { tab, params: next } = resolveCampusRedirect(params, 'jobs', Date.now());
      navigation.navigate(tab, next);
    }, [navigation, params])
  );
  return <RedirectSurface />;
}

function LegacyBudgetTab({ navigation, route }: { navigation: any; route: any }) {
  const params = route?.params as NestedNavigateParams | undefined;
  useRedirectOnFocus(
    useCallback(() => {
      const { tab, params: next } = resolveMeRedirect(params);
      navigation.navigate(tab, next);
    }, [navigation, params])
  );
  return <RedirectSurface />;
}

function CustomTabBar({ state, navigation }: { state: any; navigation: any }) {

  const { setTabState } = useChrome();

  const insets = useSafeAreaInsets();

  const openCompanion = useCompanionStore(s => s.open);

  const companionOpen = useCompanionStore(s => s.isOpen);
  const onboardingComplete = useFeatureTipStore(s => s.onboardingComplete);

  const decks = useFlashcardStore(s => s.decks);

  const flashcards = useFlashcardStore(s => s.flashcards);

  const groups = useGroupStore(s => s.groups);

  const dmThreads = useGroupStore(s => s.dmThreads);

  const communityDetailBySlug = useCommunityStore(s => s.detailBySlug);

  const communityChannelsById = useCommunityStore(s => s.channelsById);

  const myCommunities = useCommunityStore(s => s.myCommunities);

  const route = state.routes[state.index];

  const focused = getFocusedRouteNameFromRoute(route);

  const hideBar = shouldHideTabBar(focused);

  const currentRoute = state.routes[state.index]?.name as string | undefined;

  // Which of the five is lit. The arithmetic lives in tabRouting.ts so it can
  // be unit-tested; this component only knows the focused route.
  const activeTab: TabKey = useMemo(
    () => resolveActiveTab({ tabRouteName: currentRoute, companionOpen }),
    [currentRoute, companionOpen]
  );

  // The top bar lives outside the tab navigator; this is the one place that
  // knows the focused route, so publish it into the chrome context.
  useEffect(() => {
    setTabState({ activeTab, immersive: hideBar });
  }, [activeTab, hideBar, setTabState]);

  const dueCardsCount = useMemo(

    () => decks.reduce((sum, d) => sum + (d.due_count || 0), 0),

    [decks, flashcards]

  );

  // A board's unread signal is the badge on the community page (§3.9), and
  // boards are not in the chat list at all — counting them here would show a
  // Chat badge with no row anywhere that could clear it. Web filters the same
  // way before summing.

  const knownLounges = useMemo(

    () => collectKnownLounges(communityDetailBySlug, communityChannelsById, myCommunities),

    [communityDetailBySlug, communityChannelsById, myCommunities]

  );

  const unreadChatCount = useMemo(

    () =>

      groups.reduce(

        (s, g) => (isCommunityBoardGroupIn(g, knownLounges) ? s : s + (g.unreadCount || 0)),

        0

      ) +

      dmThreads.reduce((s, t) => s + (t.unreadCount || 0), 0),

    [groups, dmThreads, knownLounges]

  );

  const navigateTab = (tab: BottomTabKey) => {

    const routeName = TAB_ROUTE_BY_KEY[tab];

    if (routeName) navigation.navigate(routeName);

  };

  return (

    <>

      {!hideBar ? (

        <BottomTabBar

          activeTab={activeTab}

          onTabPress={navigateTab}

          dueCardsCount={dueCardsCount}

          unreadChatCount={unreadChatCount}

        />

      ) : null}

      <AICompanionPanel />
      <FeatureTipsHost
        onboardingComplete={onboardingComplete}
        activeTab={activeTab}
        isGroupChat={focused === 'GroupChat'}
        isLibrary={
          focused === 'Library' ||
          focused === 'NotesList' ||
          focused === 'NoteEditor' ||
          activeTab === 'Study'
        }
        moreOpen={false}
        companionOpen={companionOpen}
      />
      {/* The navigator is pulled up by insets.top (see MainTabsShell); add it
          back so the chip keeps sitting just below the top bar. */}
      {/* Informational only (no onPress): pointerEvents none so it can never
          swallow taps meant for the screen under it — it was eating the unpin
          button on the chat's pinned-message banner. */}
      <View
        pointerEvents="none"
        className="absolute right-3 z-40"
        style={{ top: (hideBar ? 0 : insets.top) + 48 }}
      >
        <SyncStatusIndicator compact />
      </View>
      <ToastHost />
      <ConfirmSheetHost />

    </>

  );

}



/**
 * The signed-in shell.
 *
 * Five destinations, in this order: Home · Study · Chat · Campus · Me. Home is
 * what a student sees on launch. The top bar carries the avatar (a second door
 * to Me), the name of where you are, and the only two surfaces that follow you
 * around — Lantern AI, with the AI-credit count docked on its sparkle, and
 * Notifications. Nothing in this chrome moves: not on scroll, not when the
 * keyboard opens, not when a search box takes focus.
 */
function MainTabs() {

  return (

    <ChromeProvider>

      <MainTabsShell />

    </ChromeProvider>

  );

}



function MainTabsShell() {

  const user = useAuthStore(s => s.user);

  const profileName = useAuthStore(s => s.profileName);

  const openCompanion = useCompanionStore(s => s.open);

  const unreadNotificationCount = useNotificationStore(s => s.unreadCount);

  const { immersive, setProfile } = useChrome();

  const insets = useSafeAreaInsets();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Same avatar resolution as SettingsScreen: profile row first, then the
  // auth metadata copy EditProfile keeps in sync.
  useEffect(() => {
    if (!user?.id) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    void fetchUserProfile(user.id)
      .then((profile) => {
        if (cancelled) return;
        const url =
          (profile as { avatar_url?: string; avatarUrl?: string }).avatar_url ||
          (profile as { avatarUrl?: string }).avatarUrl ||
          (user.user_metadata?.avatar_url as string | undefined) ||
          null;
        setAvatarUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setAvatarUrl((user.user_metadata?.avatar_url as string | undefined) || null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.user_metadata?.avatar_url]);

  const displayName =
    profileName || (user?.user_metadata?.name as string | undefined) || 'Your profile';

  // Published once, read by the top bar's avatar AND by the Me tab, so the two
  // show the same face without fetching the profile twice.
  useEffect(() => {
    setProfile({ name: displayName, avatarUri: avatarUrl, email: user?.email ?? null });
  }, [displayName, avatarUrl, user?.email, setProfile]);

  const goTab = (screen: keyof MainTabParamList, params?: object) => {
    navigateFromRoot('Main', { screen, params });
  };

  // Private pilot: warm the access answer as soon as the shell mounts, so the
  // Campus segments settle before the first tap.
  const checkMarketplaceAccess = useMarketplaceStore(s => s.checkMarketplaceAccess);
  useEffect(() => {
    void checkMarketplaceAccess();
  }, [checkMarketplaceAccess]);

  return (

    <View className="flex-1 bg-lantern-background dark:bg-lantern-background">

      {/* Above the navigator in flow so it shifts screens down rather than
          covering their headers — a recording used to hide the back button. */}
      <LectureRecordingBanner />

      <TopBar
        unreadNotificationCount={unreadNotificationCount}
        onOpenMe={() => goTab('MeTab')}
        onNotifications={() => goTab('NotificationsTab')}
        onAI={openCompanion}
      />

      {/* Every screen still pads itself insets.top for a status bar the top
          bar now covers, which left a dead band below the bar. Pull the
          navigator up by exactly that inset so content starts flush at the
          bottom edge of the bar. Immersive screens render with no top bar
          and need their own padding intact. */}
      <View className="flex-1" style={{ marginTop: immersive ? 0 : -insets.top }}>

      <Tab.Navigator
        initialRouteName="HomeTab"
        tabBar={props => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false, lazy: true }}
      >

        <Tab.Screen name="HomeTab" component={HomeNavigator} />

        <Tab.Screen name="StudyTab" component={StudyNavigator} />

        <Tab.Screen name="ChatTab" component={ChatNavigator} />

        <Tab.Screen name="CampusTab" component={CampusNavigator} />

        <Tab.Screen name="MeTab" component={MeNavigator} />

        {/* Follows the reader from the top bar; not one of the five places. */}
        <Tab.Screen name="NotificationsTab" component={NotificationsScreen} />

        {/* Compatibility shims — see the block above CampusNavigator. */}
        <Tab.Screen name="MarketTab" component={LegacyMarketTab} />

        <Tab.Screen name="JobsTab" component={LegacyJobsTab} />

        <Tab.Screen name="BudgetTab" component={LegacyBudgetTab} />

      </Tab.Navigator>

      </View>

    </View>

  );

}




function RootNavigatorInner() {

  const { user, isInitialized, initialize, isPasswordRecovery } = useAuthStore();

  const fetchDecks = useFlashcardStore(s => s.fetchDecks);

  const fetchGroups = useGroupStore(s => s.fetchGroups);

  const fetchDmThreads = useGroupStore(s => s.fetchDmThreads);

  const loadUnreadCount = useNotificationStore(s => s.loadUnreadCount);

  const loadSettings = useSettingsStore(s => s.loadSettings);
  const syncSettings = useSettingsStore(s => s.syncSettings);
  const pushEnabled = useSettingsStore(s => s.settings.notifications.pushEnabled);
  const loadTestPresets = useTestStore(s => s.loadTestPresets);
  const clearTestPresets = useTestStore(s => s.clearTestPresets);

  const [onboardingChecked, setOnboardingChecked] = useState(
    () => !!user?.id && onboardingCache?.userId === user.id
  );

  const [showOnboarding, setShowOnboarding] = useState(() =>
    user?.id && onboardingCache?.userId === user.id ? onboardingCache.showOnboarding : false
  );

  const [userProfile, setUserProfile] = useState<{
    username?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
  } | null>(null);

  const [showUsernameModal, setShowUsernameModal] = useState(false);
  /**
   * 'username': legacy/OAuth gate (no username yet — cannot be skipped).
   * 'academic': username exists but no institution yet — offered once, skippable.
   */
  const [profileSetupMode, setProfileSetupMode] = useState<'username' | 'academic'>('username');

  // If auth/bootstrap never finishes, force past BootLoadingScreen (looks like splash).
  const [bootTimedOut, setBootTimedOut] = useState(false);



  useChallengeNotificationHandler();
  useDeepLinkHandler();
  useDailyStudyReminder();
  usePresenceHeartbeat();
  useAutoSync(user?.id);

  useEffect(() => {
    setSentryUser(user ? { id: user.id, email: user.email } : null);
  }, [user?.id]);



  useEffect(() => {
    if (!isPasswordRecovery) return;
    const timer = setInterval(() => {
      if (navigationRef.isReady()) {
        navigationRef.navigate('Auth', { screen: 'ResetPassword' });
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [isPasswordRecovery]);

  useEffect(() => {

    void initialize();

  }, [initialize]);



  useEffect(() => {

    if (!user?.id) {

      clearTestPresets();

      resetDataRefresh();

      setOnboardingChecked(true);

      setShowOnboarding(false);

      // Next sign-in must bootstrap from scratch (stores are cleared on logout).
      bootstrappedUserId = null;

      return;

    }

    let cancelled = false;
    const userId = user.id;

    const bootstrapAuthenticatedData = async () => {
      // Wait until Bearer token is available before fan-out; avoids race 401s
      // right after login that previously triggered hard sign-out.
      const headers = await getAuthHeaders();
      if (cancelled || !headers.Authorization) return;

      if (bootstrappedUserId !== userId) {
        bootstrappedUserId = userId;
        void loadSettings(userId).then(() => {
          const { hasUnsyncedChanges } = useSettingsStore.getState();
          if (!cancelled && hasUnsyncedChanges) {
            void syncSettings(userId, { force: true });
          }
        });
        // Hydrate account-scoped test presets on bootstrap (not only when opening TestConfig).
        void loadTestPresets(userId);
        void fetchDecks(userId);
        void fetchGroups(userId);
        void fetchDmThreads(userId);
        void loadUnreadCount(userId);
        void fetchAIUsage(userId);
      }

      if (!isRunningInExpoGo() && pushEnabled) {
        void registerForPushNotifications().then(token => {
          if (token && !cancelled) void uploadPushToken(token);
        });
      }
    };

    // getAuthHeaders now rejects with OfflineAuthError when there is no token
    // and the last refresh was a transport failure (services/supabase.ts).
    // That is the correct answer — do nothing, the session is saved — but it
    // must not surface as an unhandled rejection.
    void bootstrapAuthenticatedData().catch(() => {});

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || cancelled) return;
      const { hasUnsyncedChanges } = useSettingsStore.getState();
      if (hasUnsyncedChanges) {
        void syncSettings(userId, { force: true });
      }
      // Bootstrap runs once per login, so without this the app shows whatever
      // it fetched then: notifications read on the web stay unread here and
      // cards reviewed elsewhere stay due until the app is force-quit.
      void refreshUserData(userId);
    });

    if (onboardingCache?.userId === userId) {
      setShowOnboarding(onboardingCache.showOnboarding);
      setOnboardingChecked(true);
    } else {
      void AsyncStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY).then(v => {
        if (cancelled) return;
        const complete = isOnboardingCompleteFlag(v);
        onboardingCache = { userId, showOnboarding: !complete };
        setShowOnboarding(!complete);
        setOnboardingChecked(true);
        useFeatureTipStore.getState().setOnboardingComplete(complete);
      });
    }

    return () => {
      cancelled = true;
      appStateSub.remove();
    };

  }, [user?.id, pushEnabled, loadSettings, syncSettings, loadTestPresets, clearTestPresets, fetchDecks, fetchGroups, fetchDmThreads, loadUnreadCount]);



  useEffect(() => {

    if (!user?.id) {

      setUserProfile(null);

      setShowUsernameModal(false);

      return;

    }

    // The profile-setup modal may sit on top of onboarding: an OAuth student
    // picks username + university + programme + courses first, so the starter
    // deck step can pre-seed from them.
    let cancelled = false;
    const userId = user.id;
    const userEmail = user.email;

    void supabase
      .from('profiles')
      .select('username, first_name, last_name, name')
      .eq('id', userId)
      .single()
      .then(async ({ data: profile, error }) => {
        if (cancelled) return;
        if (error || !profile) {
          // A fetch failure is NOT "no username". Offline cold boots landed
          // here and trapped the user behind a modal whose Continue needs the
          // network (back is disabled), locking them out of their downloaded
          // offline tests. Only a definitive empty result (PGRST116: no rows)
          // may re-raise the gate; transient/network errors never do.
          setUserProfile({ name: user.user_metadata?.name || 'User' });
          setProfileSetupMode('username');
          setShowUsernameModal(error?.code === 'PGRST116');
          return;
        }

        const nextProfile = {
          username: profile.username || undefined,
          firstName: profile.first_name || undefined,
          lastName: profile.last_name || undefined,
          name: profile.name || user.user_metadata?.name || 'User',
        };

        setUserProfile(nextProfile);
        if (!nextProfile.username) {
          setProfileSetupMode('username');
          setShowUsernameModal(true);
          return;
        }

        // Username present: offer the academic profile once (skippable) when
        // no institution is set yet. Best-effort — a failed API call never
        // raises the gate, and a sign-up stash is replayed first.
        try {
          // The stash is the single writer that runs before this check: when it
          // just applied the sign-up academic fields we KNOW the student has an
          // identity, so the modal is skipped without trusting a stale read.
          const pendingApplied = await applyPendingAcademicProfile(userId, userEmail);
          const dismissed = await AsyncStorage.getItem(`${ACADEMIC_SETUP_DISMISSED_KEY}:${userId}`);
          if (cancelled) return;
          if (dismissed === 'true') {
            setShowUsernameModal(false);
            return;
          }
          // Always reload — never trust the cached copy. A fresh email signup
          // leaves academicProfile as a NON-null EMPTY row (the initial
          // /users/:id fetched before the academic PUT landed); the old `??`
          // short-circuit then popped this modal on top of onboarding even
          // though the student had just entered their institution + level.
          const academic = await loadAcademicProfile(userId).catch(
            () => useAuthStore.getState().academicProfile
          );
          if (cancelled) return;
          if (pendingApplied || hasAcademicIdentity(academic)) {
            setShowUsernameModal(false);
          } else {
            setProfileSetupMode('academic');
            setShowUsernameModal(true);
          }
        } catch {
          if (!cancelled) setShowUsernameModal(false);
        }
      });

    return () => {
      cancelled = true;
    };

  }, [user?.id]);



  useEffect(() => {
    if (isInitialized && (!user || onboardingChecked)) {
      void SplashScreen.hideAsync();
    }
  }, [isInitialized, user, onboardingChecked]);

  // Never leave the native splash forever if auth/bootstrap stalls (looks like a broken install).
  useEffect(() => {
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync();
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setBootTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, []);

  if (
    (!isInitialized && !bootTimedOut) ||
    (user && !onboardingChecked && !isPasswordRecovery && !bootTimedOut)
  ) {
    return <BootLoadingScreen />;
  }



  return (

    <>

      <RootStack.Navigator screenOptions={{ headerShown: false }}>

        {!user || isPasswordRecovery ? (

          <RootStack.Screen name="Auth" component={AuthNavigator} />

        ) : showOnboarding ? (

          <RootStack.Screen name="Onboarding">
            {() => (
              <OnboardingScreen
                onComplete={() => {
                  if (user?.id) onboardingCache = { userId: user.id, showOnboarding: false };
                  setShowOnboarding(false);
                  useFeatureTipStore.getState().setOnboardingComplete(true);
                }}
              />
            )}
          </RootStack.Screen>

        ) : (

          <>

            <RootStack.Screen name="Main" component={MainTabs} />

            <RootStack.Screen name="Settings" component={SettingsScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="EditProfile" component={EditProfileScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="AcademicSettings" component={AcademicSettingsScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="InviteFriends" component={InviteFriendsScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="Offline" component={OfflineScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="LegalDocument" component={LegalDocumentScreen} options={{ presentation: 'modal' }} />

          </>

        )}

      </RootStack.Navigator>

      {user ? (
        <UsernameRequiredModal
          visible={showUsernameModal}
          mode={profileSetupMode}
          onClose={() => {}}
          currentUser={{
            id: user.id,
            name: userProfile?.name || user.user_metadata?.name || 'User',
            email: user.email,
            username: userProfile?.username,
            firstName: userProfile?.firstName,
            lastName: userProfile?.lastName,
          }}
          onSuccess={(username, firstName, lastName) => {
            setUserProfile({ username, firstName, lastName, name: `${firstName} ${lastName}` });
            setShowUsernameModal(false);
          }}
          onSkip={
            profileSetupMode === 'academic'
              ? () => {
                  void AsyncStorage.setItem(`${ACADEMIC_SETUP_DISMISSED_KEY}:${user.id}`, 'true').catch(() => {});
                  setShowUsernameModal(false);
                }
              : undefined
          }
        />
      ) : null}

      {/* Phase 1 · E: blocking notice while the API answers ACCOUNT_SUSPENDED (no sign-out). */}
      {user ? <AccountSuspendedBanner /> : null}

    </>

  );

}



export function RootNavigator() {
  const colorScheme = useAppTheme();
  const { colors } = useTheme();

  const navigationTheme = useMemo(
    () => ({
      ...(colorScheme === 'dark' ? DarkTheme : DefaultTheme),
      colors: {
        ...(colorScheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.error,
      },
    }),
    [colorScheme, colors]
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linkingConfig}
      theme={navigationTheme}
      initialState={preservedNavState}
      onStateChange={(state) => {
        preservedNavState = state ?? preservedNavState;
        const route = navigationRef.getCurrentRoute();
        if (route?.name) {
          void import('../services/productAnalytics').then(({ trackScreenView }) => {
            trackScreenView(route.name);
          });
        }
      }}
    >
      <RootNavigatorInner />
    </NavigationContainer>
  );
}


