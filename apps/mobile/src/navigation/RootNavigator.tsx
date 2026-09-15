/**
 * The whole mobile navigation tree, and the app-level work that hangs off it.
 *
 * Structure, outermost first: `RootNavigator` (the NavigationContainer, theme
 * and nav-state preservation) → `RootNavigatorInner` (the auth/onboarding/app
 * decision and the per-session bootstrap) → `MainTabs`/`MainTabsShell` (top
 * bar, the five-tab navigator, the chrome context) → one stack navigator per
 * tab (Home · Study · Chat · Campus · Me) → `CustomTabBar` (the bottom bar, the
 * contextual row above it, and the chrome publications the rest of the app
 * reads).
 *
 * Main export: `RootNavigator`. Everything else in this file is private.
 *
 * Touches:
 * - Stores: authStore, settingsStore, flashcardStore, groupStore,
 *   communityStore, testStore, notificationStore, companionStore,
 *   featureTipStore, marketplaceStore.
 * - Services: supabase (`profiles` select, `getAuthHeaders`), sentry,
 *   ai (`fetchAIUsage`), dataRefresh, pushNotifications, academic,
 *   pendingAcademicProfile, productAnalytics (lazy-imported per screen view).
 * - Native/Expo: expo-splash-screen, AsyncStorage (onboarding flag, the
 *   per-user academic-setup dismissal), React Native `AppState`.
 * - Pure planners next door: tabPressBehavior, stackNavigate, contextualBars
 *   (through ContextualBar), legacyTabs, types.
 *
 * Gotchas:
 * - FONT REMOUNT. Changing the in-app font size re-keys the View wrapping the
 *   app, which remounts this NavigationContainer. The three module-level
 *   caches below (`preservedNavState`, `onboardingCache`, `bootstrappedUserId`)
 *   exist for that: without them the student is dropped on Home, and the
 *   navigator must mount on the SAME COMMIT as the container or the restored
 *   `initialState` goes unconsumed. See each one's own note before changing the
 *   boot gate.
 * - Three timers run at boot (`SplashScreen.hideAsync` at 4 s, `bootTimedOut`
 *   at 10 s, `authGateTimedOut` at BOOT_GATE_MAX_MS) and they answer different
 *   questions. Only `resolveBootGate` may decide the AUTH route; the others
 *   only take a splash away.
 * - ONE-WAY PARAMS. `CustomTabBar` is the one component that knows the focused
 *   route; it publishes `{ activeTab, immersive, focusedRoute, focusedParams }`
 *   into the chrome context, and the contextual row is a pure read of that. The
 *   chrome must never write back into the route it derived those from — see
 *   navigation/segmentParamSync.ts for the update loop that causes.
 * - Retired tab names (`MarketTab`, `JobsTab`, `BudgetTab`, `MarketplaceHome`,
 *   `JobsHome`) stay registered as redirect screens. A navigate to a route that
 *   does not exist is silently dropped in release builds.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { AppState, View } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ONBOARDING_COMPLETE_STORAGE_KEY,
  isOnboardingCompleteFlag,
} from '@lantern/shared/settings';
import { isHiddenFromChatInbox } from '@lantern/shared/network';

import { CommonActions, StackActions, NavigationContainer, DefaultTheme, DarkTheme, getFocusedRouteNameFromRoute, useFocusEffect, type NavigationState } from '@react-navigation/native';
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

import { planTabPress, planTabRootReset, TAB_STACK_ROOT_ROUTE } from './tabPressBehavior';
import { planStackNavigate } from './stackNavigate';

import { BottomTabBar } from '../components/layout/BottomTabBar';
import { ContextualBar } from '../components/layout/ContextualBar';
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
import { resolveBootGate, BOOT_GATE_MAX_MS } from '../stores/sessionRestore';

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

import {
  NotesScreen,
  NoteEditorScreen,
  NoteShareAcceptScreen,
  WalkthroughScreen,
  NarrationScreen,
} from '../screens/notes';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { StudyHubScreen } from '../screens/study/StudyHubScreen';
import { CourseRoomScreen } from '../screens/study/CourseRoomScreen';
import { NotesStudioScreen } from '../screens/study/NotesStudioScreen';
import { AdaptiveQuizScreen } from '../screens/study/AdaptiveQuizScreen';
import { LectureStudioScreen } from '../screens/study/LectureStudioScreen';
import { LessonStudioScreen } from '../screens/study/LessonStudioScreen';
import { RecapStudioScreen } from '../screens/study/RecapStudioScreen';
import { StudyCalendarScreen } from '../screens/study/StudyCalendarScreen';
import { EssayStudioScreen } from '../screens/study/EssayStudioScreen';
import { PlayStudioScreen } from '../screens/study/PlayStudioScreen';
import { StudySetSettingsScreen } from '../screens/study/StudySetSettingsScreen';
import { StudySetUploadScreen } from '../screens/study/StudySetUploadScreen';
import { StudySetArtifactLibraryScreen } from '../screens/study/StudySetArtifactLibraryScreen';

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
  CheckoutScreen,
  AddressesScreen,

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
import {
  CommunityDetailScreen,
  CreateCommunityScreen,
  CommunityMembersScreen,
  CommunityManageScreen,
  CommunityChannelScreen,
  CommunityPostScreen,
  SavedPostsScreen,
  FeedScreen,
  MasteryScreen,
} from '../screens/discover';
import { StudyRoomScreen } from '../screens/study/StudyRoomScreen';

import { SettingsScreen, OfflineScreen, NotificationsScreen, EditProfileScreen, BlockedUsersScreen, AcademicSettingsScreen, InviteFriendsScreen, JoinClassScreen } from '../screens/settings';

import { CampusScreen } from '../screens/campus';
import { MeScreen, MeProgressScreen, UsageLimitsScreen } from '../screens/me';

import { TestScreen, TestBuilderScreen, TestTakingScreen, TestResultsScreen, TestAnalysisScreen } from '../screens/tests';

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

import { useProfileIdentity } from '../hooks/useProfileIdentity';

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

    <HomeStack.Navigator screenOptions={{ headerShown: false }} initialRouteName={TAB_STACK_ROOT_ROUTE.HomeTab}>

      <HomeStack.Screen name="Dashboard" component={DashboardScreen} />

      <HomeStack.Screen name="Leaderboard" component={LeaderboardScreen} />

      <HomeStack.Screen name="TestAnalysis" component={TestAnalysisScreen} />

    </HomeStack.Navigator>

  );

}



function StudyNavigator() {

  return (

    <StudyStack.Navigator screenOptions={{ headerShown: false }} initialRouteName={TAB_STACK_ROOT_ROUTE.StudyTab}>

      <StudyStack.Screen name="StudyHub" component={StudyHubScreen} />

      <StudyStack.Screen name="CourseRoom" component={CourseRoomScreen} />
      <StudyStack.Screen name="NotesStudio" component={NotesStudioScreen} />
      <StudyStack.Screen name="AdaptiveQuiz" component={AdaptiveQuizScreen} />
      <StudyStack.Screen name="LectureStudio" component={LectureStudioScreen} />
      <StudyStack.Screen name="LessonStudio" component={LessonStudioScreen} />
      <StudyStack.Screen name="RecapStudio" component={RecapStudioScreen} />
      <StudyStack.Screen name="StudyCalendar" component={StudyCalendarScreen} />
      <StudyStack.Screen name="EssayStudio" component={EssayStudioScreen} />
      <StudyStack.Screen name="PlayStudio" component={PlayStudioScreen} />
      <StudyStack.Screen name="StudySetSettings" component={StudySetSettingsScreen} />
      <StudyStack.Screen name="StudySetUpload" component={StudySetUploadScreen} />
      <StudyStack.Screen name="StudySetLibrary" component={StudySetArtifactLibraryScreen} />

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

      {/* Walk me through: a reading screen, pushed from the note. Not
          immersive on purpose — it keeps both bars, so the way out is the
          global bar rather than the pixel it was entered by. */}
      <StudyStack.Screen name="Walkthrough" component={WalkthroughScreen} />
      <StudyStack.Screen name="Narration" component={NarrationScreen} />

      <StudyStack.Screen name="TestsList" component={TestScreen} />

      {/* "+ New test": a real screen on this stack, replacing the temporary
          wiring that switched the global tab to Chat. */}
      <StudyStack.Screen name="TestBuilder" component={TestBuilderScreen} />

      <StudyStack.Screen name="TestTaking" component={TestTakingScreen} options={{ presentation: 'fullScreenModal' }} />

      <StudyStack.Screen name="TestResults" component={TestResultsScreen} options={{ presentation: 'fullScreenModal' }} />

      {/* Stack screen (not nested RN Modal) so charts work above TestResults. */}
      <StudyStack.Screen name="TestAnalysis" component={TestAnalysisScreen} options={{ presentation: 'fullScreenModal' }} />

    </StudyStack.Navigator>

  );

}



function ChatNavigator() {

  return (

    <ChatStack.Navigator screenOptions={{ headerShown: false }} initialRouteName={TAB_STACK_ROOT_ROUTE.ChatTab}>

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

    <CampusStack.Navigator screenOptions={{ headerShown: false }} initialRouteName={TAB_STACK_ROOT_ROUTE.CampusTab}>

      <CampusStack.Screen name="Campus" component={CampusScreen} />

      {/* The two retired home routes. Seven screens still call these names;
          each lands on the segment that replaced it. */}
      <CampusStack.Screen name="MarketplaceHome" component={ShopHomeRedirect} />

      <CampusStack.Screen name="JobsHome" component={JobsHomeRedirect} />

      <CampusStack.Screen name="ShopBrowse" component={ShopBrowseScreen} />
      <CampusStack.Screen name="CourseBrowse" component={CourseBrowseScreen} />
      <CampusStack.Screen name="CourseListings" component={CourseListingsScreen} />

      <CampusStack.Screen name="ShopAccount" component={ShopAccountScreen} />

      <CampusStack.Screen name="ListingDetail" component={ListingDetailScreen} />

      <CampusStack.Screen name="MyListings" component={MyListingsScreen} />

      <CampusStack.Screen name="Inquiries" component={InquiriesScreen} />

      <CampusStack.Screen name="CreateListing" component={CreateListingScreen} />

      <CampusStack.Screen name="EditListing" component={EditListingScreen} />

      <CampusStack.Screen name="MakeOffer" component={MakeOfferScreen} />

      <CampusStack.Screen name="SellerProfile" component={SellerProfileScreen} />

      <CampusStack.Screen name="Offers" component={OffersScreen} />

      <CampusStack.Screen name="Favorites" component={FavoritesScreen} />

      <CampusStack.Screen name="Orders" component={OrdersScreen} />

      <CampusStack.Screen name="Cart" component={CartScreen} />
      <CampusStack.Screen name="Checkout" component={CheckoutScreen} />
      <CampusStack.Screen name="Addresses" component={AddressesScreen} />

      <CampusStack.Screen name="Purchases" component={PurchasesScreen} />

      <CampusStack.Screen name="StudyProductDrafts" component={StudyProductDraftsScreen} />

      <CampusStack.Screen name="SemesterProducts" component={SemesterProductsScreen} />

      <CampusStack.Screen name="StudyRoom" component={StudyRoomScreen} />

      <CampusStack.Screen name="CreatorProfile" component={CreatorProfileScreen} />

      <CampusStack.Screen name="CommunityDetail" component={CommunityDetailScreen} />

      {/* Start a community. On this stack for the same reason the roster is:
          back returns to Campus → Communities, and the Campus tab stays lit. */}
      <CampusStack.Screen name="CreateCommunity" component={CreateCommunityScreen} />

      {/* Founder rule (spec §0a): a community's roster, channels and "new
          channel" flow stay on this stack so back returns to the community. */}
      <CampusStack.Screen name="CommunityMembers" component={CommunityMembersScreen} />

      {/* Roles, mutes and invite links. The screen itself re-asks the shared
          rules per row, so reaching it by name grants nothing. */}
      <CampusStack.Screen name="CommunityManage" component={CommunityManageScreen} />

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

      <CampusStack.Screen name="OrderDetail" component={OrderDetailScreen} />

      <CampusStack.Screen name="SellerCustomers" component={SellerCustomersScreen} />

      <CampusStack.Screen name="SellerPayout" component={SellerPayoutScreen} />

      <CampusStack.Screen name="JobDetail" component={JobDetailScreen} />

      <CampusStack.Screen name="CreateJob" component={CreateJobScreen} />

      <CampusStack.Screen name="MyJobPostings" component={MyJobPostingsScreen} />

      <CampusStack.Screen name="MyJobApplications" component={MyJobApplicationsScreen} />

      <CampusStack.Screen name="JobEmployer" component={JobEmployerScreen} />

      <CampusStack.Screen name="JobApplicants" component={JobApplicantsScreen} />

      <CampusStack.Screen name="JobCompany" component={JobCompanyScreen} />

    </CampusStack.Navigator>

  );

}

/**
 * Me — profile and academic details, Budget, Downloads, the two modes,
 * Settings and Log out. Budget is on this stack, not a tab of its own: it is
 * one student's ledger, so Back returns to Profile and the Profile tab stays lit.
 */
function MeNavigator() {

  return (

    <MeStack.Navigator screenOptions={{ headerShown: false }} initialRouteName={TAB_STACK_ROOT_ROUTE.MeTab}>

      <MeStack.Screen name="Me" component={MeScreen} />

      <MeStack.Screen name="MeProgress" component={MeProgressScreen} />

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

/**
 * The params of the deepest focused route inside a tab, or undefined.
 *
 * The contextual row's second half (spec v3 §7.2): the deck row's four modes
 * are modes of THIS deck and the note row's Test is a test of THIS note, but a
 * registry entry is a constant and cannot know which. The registry says which
 * keys an item inherits (`paramsFrom`), and this is where those keys come
 * from. Walks the same chain `getFocusedRouteNameFromRoute` reports the name
 * of, so the name and the params always describe the same screen; a tab whose
 * stack has no state yet is showing its declared root, which takes no params,
 * so the answer there is undefined rather than the TAB's own params.
 */
function focusedRouteParams(route: any): Record<string, unknown> | undefined {
  let current: any = route;
  let descended = false;
  while (current?.state?.routes?.length) {
    const nested = current.state;
    current = nested.routes[nested.index ?? nested.routes.length - 1];
    descended = true;
  }
  if (!descended) return undefined;
  return (current?.params as Record<string, unknown> | undefined) ?? undefined;
}

function CustomTabBar({ state, navigation }: { state: any; navigation: any }) {

  const { setTabState, contextual } = useChrome();

  /**
   * Which bottom row is actually drawn — reported by the contextual row itself.
   *
   * `replace` means the row is standing in the five tabs' slot (the set row), so
   * the tabs are not drawn. It cannot be read off the registry here: the row
   * also disappears while the soft keyboard is up, and hiding the tabs from the
   * registry alone would leave a student typing inside a set with no bottom
   * navigation at all.
   */
  const [contextualMode, setContextualMode] = useState<'above' | 'replace' | null>(null);

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
  /**
   * The focused route name, with the one gap `getFocusedRouteNameFromRoute`
   * leaves filled in.
   *
   * That helper returns `undefined` while a lazy tab's child navigator has no
   * state yet — which is exactly the first frame after you tap Study. `undefined`
   * means "no row" to the registry, so the strip would pop in a frame late on
   * every cold entry to the tab. A stack with no state is showing its declared
   * `initialRouteName` (TAB_STACK_ROOT_ROUTE feeds both), so that is the honest
   * answer for that frame rather than a guess.
   */
  const focusedRoute =
    focused ?? TAB_STACK_ROOT_ROUTE[currentRoute as keyof typeof TAB_STACK_ROOT_ROUTE];
  /** That route's own params — see `focusedRouteParams`. */
  const focusedParams = focusedRouteParams(route);

  useEffect(() => {
    // `focused` joins the publication: the contextual row (spec v3 §7.2) is a
    // property of the FOCUSED ROUTE, exactly as `immersive` is, and this is
    // still the one component in the app that knows what that route is. It
    // is a plain route name — the registry, not this component, decides
    // whether it carries a row.
    setTabState({ activeTab, immersive: hideBar, focusedRoute, focusedParams });
  }, [activeTab, hideBar, focusedRoute, focusedParams, setTabState]);

  // The two bottom-bar badges. Both are derived from store data on every
  // render rather than pushed by whoever changed it, so a card reviewed or a
  // thread read anywhere in the app clears its badge without telling the bar.
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

        (s, g) => (isHiddenFromChatInbox(g, knownLounges) ? s : s + (g.unreadCount || 0)),

        0

      ) +

      dmThreads.reduce((s, t) => s + (t.unreadCount || 0), 0),

    [groups, dmThreads, knownLounges]

  );

  /**
   * A bottom-bar press, with the half a custom `tabBar` does not get free.
   *
   * `navigate(routeName)` alone is a no-op on the tab you are already on, so
   * pressing Study while deep in Study -> Tests did nothing at all. The
   * `tabPress` EVENT is what the nested stacks are waiting for: native-stack
   * subscribes to it and pops itself to its root when it is focused and not
   * already there, and `useScrollToTop` uses it to send a list back to the
   * top. Emit it for every press, on the PRESSED tab's key -- an inactive
   * tab's listener checks focus itself, so its remembered stack is safe --
   * and navigate only when the tab is not already focused.
   *
   * The event alone is not the whole re-tap, though. native-stack pops to
   * `routes[0]`, which is only the tab's ROOT when the stack was entered
   * through it. A nested navigate — `navigate('StudyTab', { screen:
   * 'TestTaking' })` from Home, a group chat, the offline screen — builds the
   * child stack as `[TestTaking]` with the initial route DROPPED (see
   * planTabRootReset), so popToTop has nothing to pop and Study can never get
   * back to StudyHub. On a re-tap of a stack whose bottom is not its root, we
   * therefore RESET it. Stacks that are properly rooted (Campus, Chat, and
   * Study when entered from Study) plan no reset and keep the popToTop
   * behaviour unchanged.
   *
   * The decisions are in navigation/tabPressBehavior.ts, where they are tested.
   *
   * NOTE: this block describes `navigateTab`, further down — the bottom bar's
   * own press handler — not the `navigateWithinFocusedStack` immediately below.
   */
  /**
   * Navigate to a route INSIDE the currently focused tab's stack.
   *
   * Deliberately not `navigation.navigate('StudyTab', { screen })`: that is the
   * nested form `nestedNavigateLint` polices, and it rebuilds the child stack
   * from params (dropping the tab's own root) unless `initial: false` rides
   * along. Dispatching a plain `navigate` AT the child navigator — the same
   * `target` trick the re-tap repair above uses — pushes onto the stack that is
   * already there, root intact, so hardware Back keeps popping to StudyHub and
   * round-4 invariants 1 and 3 are untouched.
   *
   * A nested navigator's state does not reach its parent until something
   * inside it has navigated, so on a tab sitting at its own stack ROOT — the
   * Study hub, freshly opened — there is no key to aim at. That case was a
   * silent `return`: pressing Tests in the row did nothing on the hub while
   * the same press from Library worked. It now falls back to the nested form
   * with `initial: false` (`toTab`), which reaches the same screen and keeps
   * the tab's root beneath it. The decision is in navigation/stackNavigate.ts,
   * where it is tested.
   */
  const navigateWithinFocusedStack = useCallback(
    (route: string, params?: Record<string, unknown>) => {
      const focusedTab = state.routes[state.index];
      if (!focusedTab) return;
      const plan = planStackNavigate({
        childState: focusedTab.state as { key?: string } | undefined,
        tabRouteName: focusedTab.name,
        route,
        params,
      });
      if (plan.kind === 'dispatch') {
        navigation.dispatch({
          ...CommonActions.navigate({ name: plan.route, params: plan.params }),
          target: plan.target,
        });
        return;
      }
      navigation.navigate(plan.tabRouteName as never, plan.params as never);
    },
    [navigation, state]
  );

  // A press on one of the five. Three steps, in this order: emit `tabPress`
  // (which the nested stacks and useScrollToTop listen for), repair the
  // pressed tab's stack root if it needs it, then navigate — but only when
  // that tab is not already focused. See the block above for why each is
  // needed; the decisions themselves are in tabPressBehavior.ts.
  const navigateTab = (tab: BottomTabKey) => {

    const routeName = TAB_ROUTE_BY_KEY[tab];

    if (!routeName) return;

    const plan = planTabPress({ routes: state.routes, index: state.index, routeName });

    if (plan.emitTarget) {

      const event = navigation.emit({

        type: 'tabPress',

        target: plan.emitTarget,

        canPreventDefault: true,

      });

      if (event.defaultPrevented) return;

    }

    if (plan.alreadyFocused || plan.resetToRoot) {

      // Dispatched synchronously; native-stack runs its popToTop a frame
      // later, by which time this stack is already a single root route and
      // the pop is a no-op. Order between them does not matter.
      //
      // The stack this aims at is the PRESSED tab's, not the focused one's:
      // `Study` pressed from Home must land on the Study hub rather than the
      // studio it was left in (SF2 §6 #10), and native-stack's own listener
      // will not pop a stack it is not focused in. `always` is what widens the
      // repair from "the root is missing" to "the root is not the only thing
      // here" — see ALWAYS_ROOT_ON_TAB_PRESS.
      const pressed = state.routes.find((r: { name: string }) => r.name === routeName);
      const repair = planTabRootReset({
        childState: pressed?.state,
        initialRouteName: TAB_STACK_ROOT_ROUTE[routeName as keyof typeof TAB_STACK_ROOT_ROUTE],
        always: plan.resetToRoot,
      });

      if (repair.resetTo && repair.target) {
        navigation.dispatch({
          ...CommonActions.reset({ index: 0, routes: [{ name: repair.resetTo }] }),
          target: repair.target,
        });
      }

    }

    // Only when it is NOT already the focused tab: TabRouter matches by name
    // and just moves the index, so the tab reopens on the screen it was left
    // on. The re-tap case is handled entirely by the event above.
    if (plan.navigateTo) navigation.navigate(plan.navigateTo);

  };

  return (

    <>

      {!hideBar ? (

        <BottomTabBar

          activeTab={activeTab}

          onTabPress={navigateTab}

          dueCardsCount={dueCardsCount}

          unreadChatCount={unreadChatCount}

          above={
            <ContextualBar
              onNavigate={navigateWithinFocusedStack}
              onPresence={setContextualMode}
            />
          }
          hideTabs={contextualMode === 'replace'}

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
      {/* Not on the test player: its own header puts Submit exactly here, so
          the chip was drawn under it and clipped (device finding, build 172).
          That screen states its offline status in the page instead. */}
      {focused !== 'TestTaking' ? (
        <View
          pointerEvents="none"
          className="absolute right-3 z-40"
          style={{ top: (hideBar ? 0 : insets.top) + 48 }}
        >
          <SyncStatusIndicator compact />
        </View>
      ) : null}
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

  const openCompanion = useCompanionStore(s => s.open);

  const unreadNotificationCount = useNotificationStore(s => s.unreadCount);

  const { immersive, setProfile } = useChrome();

  const insets = useSafeAreaInsets();

  // The name and the face are resolved in ONE place — `useProfileIdentity` —
  // and published from here so the top bar, the Me tab, Settings and the
  // community board composer cannot show three different identities for the
  // same account (they did: "Benjamin Amadi", "User"/"NI", "YO").
  const { displayName, avatarUrl } = useProfileIdentity();

  useEffect(() => {
    setProfile({ name: displayName, avatarUri: avatarUrl, email: user?.email ?? null });
  }, [displayName, avatarUrl, user?.email, setProfile]);

  const goTab = (screen: keyof MainTabParamList, params?: object) => {
    navigateFromRoot('Main', { screen, params });
  };

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

  // If bootstrap (onboarding/profile fetch) never finishes, force past
  // BootLoadingScreen. This must NOT decide the auth route: see authGateTimedOut.
  const [bootTimedOut, setBootTimedOut] = useState(false);
  /**
   * Hard cap on the PENDING-restore splash, and nothing else. The auth route
   * is decided by `resolveBootGate`; this flag is only its last resort, sized
   * to outlast the store's own boot budget so it effectively never fires.
   */
  const [authGateTimedOut, setAuthGateTimedOut] = useState(false);



  // App-wide listeners, mounted once here because this component lives for the
  // whole session. Each owns its own subscriptions and teardown; none of them
  // renders anything.
  useChallengeNotificationHandler();
  useDeepLinkHandler();
  useDailyStudyReminder();
  usePresenceHeartbeat();
  useAutoSync(user?.id);

  // Identify crash reports. Keyed on the id alone, so an account switch
  // re-tags and a sign-out clears rather than leaving the previous user
  // attached to the next session's errors.
  useEffect(() => {
    setSentryUser(user ? { id: user.id, email: user.email } : null);
  }, [user?.id]);



  /**
   * Password-recovery deep link → the reset form.
   *
   * Polls because the flag can be set before the container is ready (the link
   * is what launched the app). The interval clears itself on the first
   * successful navigate; the effect's cleanup covers the case where recovery
   * ends first.
   */
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

  // Restore the persisted session. Everything below waits on the `user` and
  // `isInitialized` this sets.
  useEffect(() => {

    void initialize();

  }, [initialize]);



  /**
   * Per-account bootstrap, and the only place the signed-in stores are filled
   * on entry.
   *
   * Runs on sign-in, on account switch, and on sign-out (the early return,
   * which clears account-scoped state and re-arms the next bootstrap). Ordering
   * that matters:
   *
   * 1. `getAuthHeaders()` first. Fanning out before a Bearer token exists
   *    produced 401s right after login that used to trigger a hard sign-out.
   *    It rejects with OfflineAuthError when there is no token and the last
   *    refresh failed at the transport — the correct answer offline, caught and
   *    ignored so it is not an unhandled rejection.
   * 2. The fan-out is guarded by the module-level `bootstrappedUserId`, so a
   *    font-change remount does NOT re-fetch every store.
   * 3. Onboarding is answered from `onboardingCache` when it is this user's,
   *    and only otherwise from AsyncStorage — the same remount rule, and the
   *    reason the boot gate can render the navigator on the container's commit.
   *
   * The AppState listener is the refresh half: bootstrap runs once per login,
   * so without it the app keeps showing what it fetched then. `cancelled`
   * guards every async continuation; the listener is removed on cleanup.
   */
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



  /**
   * The profile-setup gate: does this account still need a username, or an
   * academic identity?
   *
   * Two modes, and they are not interchangeable — `username` cannot be skipped,
   * `academic` is offered once and remembered per user under
   * ACADEMIC_SETUP_DISMISSED_KEY. The rule that must not be relaxed: a FETCH
   * FAILURE IS NOT AN ANSWER. Only a definitive PGRST116 (no rows) may raise
   * the username gate, and a failed academic read never raises the academic
   * one; an offline cold boot used to trap the student behind a modal whose
   * Continue needs the network.
   *
   * Runs independently of the bootstrap above and may sit on top of onboarding
   * by design, so an OAuth student picks identity before the starter deck step.
   */
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



  /**
   * The three boot timers. They answer different questions and must not be
   * collapsed into one:
   *
   * - hide the native splash as soon as there is something real to show, and
   *   unconditionally after 4 s so a stall does not look like a broken install;
   * - `bootTimedOut` (10 s) forces past BootLoadingScreen when the bootstrap
   *   never finishes. It does NOT decide the auth route;
   * - `authGateTimedOut` (BOOT_GATE_MAX_MS) is the last resort for a PENDING
   *   session restore only, sized to outlast the store's own boot budget.
   */
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

  useEffect(() => {
    const timer = setTimeout(() => setAuthGateTimedOut(true), BOOT_GATE_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Splash vs sign-in vs app. A pending restore renders the boot screen — never
   * the sign-in form, which used to appear for 25-30 s on a cold start once
   * the 10 s `bootTimedOut` escape hatch dropped the splash while `user` was
   * still null. See stores/sessionRestore.resolveBootGate.
   */
  const bootGate = resolveBootGate({
    isInitialized,
    hasUser: !!user,
    gateTimedOut: authGateTimedOut,
  });

  if (
    bootGate === 'splash' ||
    (user && !onboardingChecked && !isPasswordRecovery && !bootTimedOut)
  ) {
    return <BootLoadingScreen />;
  }



  return (

    <>

      {/* Three mutually exclusive worlds, and only one set of screens is
          registered at a time: Auth (signed out, or mid password recovery),
          Onboarding, or the app. A route that is not registered cannot be
          navigated to, which is what keeps a deep link from landing inside the
          app while the student is still signed out. */}
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

            <RootStack.Screen name="JoinClass" component={JoinClassScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="UsageLimits" component={UsageLimitsScreen} options={{ presentation: 'modal' }} />

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



/**
 * The container: theme, deep-link config, and the nav-state preservation the
 * font-size remount depends on.
 *
 * `initialState={preservedNavState}` is read ONCE per mount, so it only helps
 * when `RootNavigatorInner` renders the navigator on this same commit — the
 * reason `onboardingCache` and `bootstrappedUserId` exist. `onStateChange` is
 * the writer, and it never clears: `state ?? preservedNavState` keeps the last
 * good state through the frames where the container reports none.
 *
 * Screen-view analytics ride the same callback, with productAnalytics imported
 * lazily so it is not on the boot path.
 */
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


