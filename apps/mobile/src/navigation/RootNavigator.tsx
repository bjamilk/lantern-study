import React, { useEffect, useMemo, useState } from 'react';

import { View } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { NavigationContainer, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { navigationRef } from './navigationRef';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { ThemeProvider, useAppTheme } from '../theme';

import { BottomTabBar, TabKey } from '../components/layout/BottomTabBar';

import { MoreSheet } from '../components/layout/MoreSheet';

import { AICompanionPanel } from '../components/AICompanionPanel';

import { AIUsageFloatingBadge } from '../components/AIUsageFloatingBadge';

import { BootLoadingScreen } from '../components/BootLoadingScreen';

import * as SplashScreen from 'expo-splash-screen';

import { useAuthStore } from '../stores/authStore';
import { setSentryUser } from '../services/sentry';
import { fetchAIUsage } from '../services/ai';

import { useFlashcardStore } from '../stores/flashcardStore';

import { useGroupStore } from '../stores/groupStore';

import { useSettingsStore } from '../stores/settingsStore';

import { useCompanionStore } from '../stores/companionStore';
import { useNotificationStore } from '../stores/notificationStore';

import { useChallengeNotificationHandler } from '../hooks/useChallengeNotificationHandler';
import { useDeepLinkHandler } from '../hooks/useDeepLinkHandler';
import { useDailyStudyReminder } from '../hooks/useDailyStudyReminder';
import { usePresenceHeartbeat } from '../hooks/usePresenceHeartbeat';

import {

  shouldHideTabBar,

  RootStackParamList,

  AuthStackParamList,

  HomeStackParamList,

  StudyStackParamList,

  ChatStackParamList,

  MarketStackParamList,

  MainTabParamList,

  BudgetStackParamList,

} from './types';

import { LoginScreen, SignUpScreen, VerifyEmailScreen, ForgotPasswordScreen, ResetPasswordScreen } from '../screens/auth';
import LegalDocumentScreen from '../screens/legal/LegalDocumentScreen';

import { DashboardScreen } from '../screens/dashboard/DashboardScreen';

import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';

import {

  FlashcardsScreen,

  DeckDetailScreen,

  FlashcardReviewScreen,

  CramSessionScreen,

  MatchStudyScreen,

  LearnStudyScreen,

} from '../screens/flashcards';

import { NotesScreen, NoteEditorScreen } from '../screens/notes';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { StudyHubScreen } from '../screens/study/StudyHubScreen';

import { GroupsScreen, GroupChatScreen, DirectMessageScreen, CreateGroupScreen } from '../screens/groups';

import {

  MarketplaceScreen,

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

  OrderDetailScreen,

  SellerCustomersScreen,

} from '../screens/marketplace';

import { SettingsScreen, OfflineScreen, NotificationsScreen, EditProfileScreen } from '../screens/settings';

import { TestScreen, TestTakingScreen, TestResultsScreen } from '../screens/tests';

import { GameScreen, GameResultScreen, ChallengesInboxScreen } from '../screens/games';

import {

  BudgetScreen,

  AddExpenseScreen,

  AddIncomeScreen,

  SetBudgetScreen,

  SavingsGoalsScreen,

  WalletScreen,

  ExpenseSplitScreen,

  SetCategoryBudgetScreen,

  FinancialToolkitScreen,

  AddInvestmentScreen,

} from '../screens/budget';

import { isRunningInExpoGo } from 'expo';

import { linkingConfig } from './linking';

import { registerForPushNotifications, uploadPushToken } from '../services/pushNotifications';

import { useLowDataMode } from '../hooks/useLowDataMode';

import UsernameRequiredModal from '../components/UsernameRequiredModal';

import { supabase } from '../services/supabase';



const RootStack = createNativeStackNavigator<RootStackParamList>();

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

const HomeStack = createNativeStackNavigator<HomeStackParamList>();

const StudyStack = createNativeStackNavigator<StudyStackParamList>();

const ChatStack = createNativeStackNavigator<ChatStackParamList>();

const MarketStack = createNativeStackNavigator<MarketStackParamList>();

const BudgetStack = createNativeStackNavigator<BudgetStackParamList>();

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

      <StudyStack.Screen name="TestsList" component={TestScreen} />

      <StudyStack.Screen name="TestTaking" component={TestTakingScreen} options={{ presentation: 'fullScreenModal' }} />

      <StudyStack.Screen name="TestResults" component={TestResultsScreen} options={{ presentation: 'fullScreenModal' }} />

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



function MarketNavigator() {

  return (

    <MarketStack.Navigator screenOptions={{ headerShown: false }}>

      <MarketStack.Screen name="MarketplaceHome" component={MarketplaceScreen} />

      <MarketStack.Screen name="ListingDetail" component={ListingDetailScreen} />

      <MarketStack.Screen name="MyListings" component={MyListingsScreen} />

      <MarketStack.Screen name="Inquiries" component={InquiriesScreen} />

      <MarketStack.Screen name="CreateListing" component={CreateListingScreen} />

      <MarketStack.Screen name="EditListing" component={EditListingScreen} />

      <MarketStack.Screen name="MakeOffer" component={MakeOfferScreen} />

      <MarketStack.Screen name="SellerProfile" component={SellerProfileScreen} />

      <MarketStack.Screen name="Offers" component={OffersScreen} />

      <MarketStack.Screen name="Favorites" component={FavoritesScreen} />

      <MarketStack.Screen name="Orders" component={OrdersScreen} />

      <MarketStack.Screen name="OrderDetail" component={OrderDetailScreen} />

      <MarketStack.Screen name="SellerCustomers" component={SellerCustomersScreen} />

    </MarketStack.Navigator>

  );

}



function BudgetNavigator() {

  return (

    <BudgetStack.Navigator screenOptions={{ headerShown: false }}>

      <BudgetStack.Screen name="BudgetHome" component={BudgetScreen} />

      <BudgetStack.Screen name="AddExpense" component={AddExpenseScreen} />

      <BudgetStack.Screen name="AddIncome" component={AddIncomeScreen} />

      <BudgetStack.Screen name="SetBudget" component={SetBudgetScreen} />

      <BudgetStack.Screen name="SavingsGoals" component={SavingsGoalsScreen} />

      <BudgetStack.Screen name="Wallet" component={WalletScreen} />

      <BudgetStack.Screen name="ExpenseSplit" component={ExpenseSplitScreen} />

      <BudgetStack.Screen name="SetCategoryBudget" component={SetCategoryBudgetScreen} />

      <BudgetStack.Screen name="FinancialToolkit" component={FinancialToolkitScreen} />

      <BudgetStack.Screen name="AddInvestment" component={AddInvestmentScreen} />

    </BudgetStack.Navigator>

  );

}



function CustomTabBar({ state, navigation }: { state: any; navigation: any }) {

  const [moreOpen, setMoreOpen] = useState(false);

  const theme = useAppTheme();

  const { updateSettings } = useSettingsStore();

  const { lowDataMode, toggleLowDataMode } = useLowDataMode();

  const signOut = useAuthStore(s => s.signOut);

  const openCompanion = useCompanionStore(s => s.open);

  const companionOpen = useCompanionStore(s => s.isOpen);

  const decks = useFlashcardStore(s => s.decks);

  const flashcards = useFlashcardStore(s => s.flashcards);

  const groups = useGroupStore(s => s.groups);

  const dmThreads = useGroupStore(s => s.dmThreads);



  const rootNav = navigation.getParent();



  const tabKeyMap: Record<TabKey, string | null> = {

    Home: 'HomeTab',

    Library: 'StudyTab',

    Study: 'StudyTab',

    Chat: 'ChatTab',

    Notifications: 'NotificationsTab',

    Budget: 'BudgetTab',

    Marketplace: 'MarketTab',

    AI: null,

    Notes: null,

    Offline: null,

    More: null,

  };



  const routeNameToTabKey: Record<string, TabKey> = {

    HomeTab: 'Home',

    StudyTab: 'Study',

    ChatTab: 'Chat',

    NotificationsTab: 'Notifications',

    BudgetTab: 'Budget',

    MarketTab: 'Marketplace',

  };



  const route = state.routes[state.index];

  const focused = getFocusedRouteNameFromRoute(route);

  const hideBar = shouldHideTabBar(focused);



  const activeTab: TabKey = useMemo(() => {

    if (companionOpen) return 'AI';

    const currentRoute = state.routes[state.index]?.name as string | undefined;

    if (currentRoute === 'MarketTab') return 'Marketplace';

    if (currentRoute === 'StudyTab' && focused) {
      if (focused === 'Library' || focused === 'NotesList' || focused === 'NoteEditor') return 'Library';
      if (focused === 'StudyHub') return 'Study';
    }

    return routeNameToTabKey[currentRoute ?? ''] ?? 'Home';

  }, [companionOpen, state.routes, state.index, focused]);



  const unreadNotificationCount = useNotificationStore(s => s.unreadCount);



  const dueCardsCount = useMemo(

    () => decks.reduce((sum, d) => sum + (d.due_count || 0), 0),

    [decks, flashcards]

  );

  const unreadChatCount = useMemo(

    () =>

      groups.reduce((s, g) => s + (g.unreadCount || 0), 0) +

      dmThreads.reduce((s, t) => s + (t.unreadCount || 0), 0),

    [groups, dmThreads]

  );



  const navigateTab = (tab: TabKey) => {

    if (tab === 'More') {

      setMoreOpen(true);

      return;

    }

    setMoreOpen(false);

    if (tab === 'AI') {

      openCompanion();

      return;

    }

    if (tab === 'Library') {
      navigation.navigate('StudyTab', { screen: 'Library' });
      return;
    }

    if (tab === 'Study') {
      navigation.navigate('StudyTab', { screen: 'StudyHub' });
      return;
    }

    if (tab === 'Notes') {

      jumpStudyNotes();

      return;

    }

    if (tab === 'Offline') {

      navigateRoot('Offline');

      return;

    }

    const routeName = tabKeyMap[tab];

    if (routeName) navigation.navigate(routeName);

  };



  const jumpStudyNotes = () => {

    navigation.navigate('StudyTab', { screen: 'NotesList' });

  };



  const navigateRoot = (screen: keyof RootStackParamList) => {

    rootNav?.navigate(screen);

  };



  const toggleTheme = () => {

    const next = theme === 'dark' ? 'light' : 'dark';

    void updateSettings('appearance', { theme: next });

  };


  
  return (

    <>

      {!hideBar ? (

        <BottomTabBar

          activeTab={activeTab}

          onTabPress={navigateTab}

          dueCardsCount={dueCardsCount}

          unreadChatCount={unreadChatCount}

          unreadNotificationCount={unreadNotificationCount}

          isMoreActive={moreOpen}

        />

      ) : null}

      {!hideBar ? (
        <AIUsageFloatingBadge
          activeTab={activeTab}
          focusedRoute={focused}
          hidden={moreOpen || companionOpen || activeTab === 'AI'}
        />
      ) : null}

      <MoreSheet

        visible={moreOpen}

        onClose={() => setMoreOpen(false)}

        theme={theme}

        onToggleTheme={toggleTheme}

        lowDataMode={lowDataMode}

        onToggleLowData={toggleLowDataMode}

        items={[

          { id: 'settings', label: 'Settings', icon: 'settings-outline', onPress: () => navigateRoot('Settings') },

          { id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: () => void signOut(), destructive: true },

        ]}

      />

      <AICompanionPanel />

    </>

  );

}



function MainTabs() {

  return (

    <View className="flex-1 bg-lantern-background dark:bg-slate-900">

      <Tab.Navigator
        tabBar={props => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false, lazy: true }}
      >

        <Tab.Screen name="HomeTab" component={HomeNavigator} />

        <Tab.Screen name="StudyTab" component={StudyNavigator} />

        <Tab.Screen name="ChatTab" component={ChatNavigator} />

        <Tab.Screen name="NotificationsTab" component={NotificationsScreen} />

        <Tab.Screen name="BudgetTab" component={BudgetNavigator} />

        <Tab.Screen name="MarketTab" component={MarketNavigator} options={{ tabBarButton: () => null }} />

      </Tab.Navigator>

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
  const pushEnabled = useSettingsStore(s => s.settings.notifications.pushEnabled);

  const [onboardingChecked, setOnboardingChecked] = useState(false);

  const [showOnboarding, setShowOnboarding] = useState(false);

  const [userProfile, setUserProfile] = useState<{
    username?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
  } | null>(null);

  const [showUsernameModal, setShowUsernameModal] = useState(false);



  useChallengeNotificationHandler();
  useDeepLinkHandler();
  useDailyStudyReminder();
  usePresenceHeartbeat();

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

      setOnboardingChecked(true);

      setShowOnboarding(false);

      return;

    }

    void loadSettings(user.id);

    void fetchDecks(user.id);

    void fetchGroups(user.id);

    void fetchDmThreads(user.id);

    void loadUnreadCount(user.id);
    void fetchAIUsage(user.id);

    if (!isRunningInExpoGo() && pushEnabled) {
      void registerForPushNotifications().then(token => {
        if (token && user?.id) void uploadPushToken(token);
      });
    }

    AsyncStorage.getItem('lantern_onboarding_complete').then(v => {

      setShowOnboarding(v !== 'true');

      setOnboardingChecked(true);

    });

  }, [user?.id, pushEnabled, loadSettings, fetchDecks, fetchGroups, fetchDmThreads, loadUnreadCount]);



  useEffect(() => {

    if (!user?.id || showOnboarding) {

      setUserProfile(null);

      setShowUsernameModal(false);

      return;

    }

    void supabase
      .from('profiles')
      .select('username, first_name, last_name, name')
      .eq('id', user.id)
      .single()
      .then(({ data: profile, error }) => {
        if (error || !profile) {
          setUserProfile({ name: user.user_metadata?.name || 'User' });
          setShowUsernameModal(true);
          return;
        }

        const nextProfile = {
          username: profile.username || undefined,
          firstName: profile.first_name || undefined,
          lastName: profile.last_name || undefined,
          name: profile.name || user.user_metadata?.name || 'User',
        };

        setUserProfile(nextProfile);
        setShowUsernameModal(!nextProfile.username);
      });

  }, [user?.id, showOnboarding]);



  useEffect(() => {
    if (isInitialized && (!user || onboardingChecked)) {
      void SplashScreen.hideAsync();
    }
  }, [isInitialized, user, onboardingChecked]);



  if (!isInitialized || (user && !onboardingChecked && !isPasswordRecovery)) {
    return <BootLoadingScreen />;
  }



  return (

    <>

      <RootStack.Navigator screenOptions={{ headerShown: false }}>

        {!user || isPasswordRecovery ? (

          <RootStack.Screen name="Auth" component={AuthNavigator} />

        ) : showOnboarding ? (

          <RootStack.Screen name="Onboarding">
            {() => <OnboardingScreen onComplete={() => setShowOnboarding(false)} />}
          </RootStack.Screen>

        ) : (

          <>

            <RootStack.Screen name="Main" component={MainTabs} />

            <RootStack.Screen name="Settings" component={SettingsScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="EditProfile" component={EditProfileScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="Offline" component={OfflineScreen} options={{ presentation: 'modal' }} />

            <RootStack.Screen name="LegalDocument" component={LegalDocumentScreen} options={{ presentation: 'modal' }} />

          </>

        )}

      </RootStack.Navigator>

      {user && !showOnboarding ? (
        <UsernameRequiredModal
          visible={showUsernameModal}
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
        />
      ) : null}

    </>

  );

}



export function RootNavigator() {

  return (

    <ThemeProvider>

      <NavigationContainer ref={navigationRef} linking={linkingConfig}>

      <RootNavigatorInner />

      </NavigationContainer>

    </ThemeProvider>

  );

}


