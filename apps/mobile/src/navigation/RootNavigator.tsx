// ===========================================
// Lantern Study Mobile - Root Navigator
// ===========================================

import React, { useEffect, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider, useTheme } from '../theme';

// Import screens
import {
  LoginScreen,
  SignUpScreen,
  DashboardScreen,
  FlashcardsScreen,
  DeckDetailScreen,
  FlashcardReviewScreen,
  GroupsScreen,
  TestScreen,
  TestTakingScreen,
  TestResultsScreen,
} from '../screens';
import { GameScreen, GameResultScreen } from '../screens/games';
import CramSessionScreen from '../screens/flashcards/CramSessionScreen';
import GroupChatScreen from '../screens/groups/GroupChatScreen';
import DirectMessageScreen from '../screens/groups/DirectMessageScreen';
import {
  BudgetScreen,
  AddExpenseScreen,
  AddIncomeScreen,
  SetBudgetScreen,
} from '../screens/budget';
import { MoreNavigator } from '../screens/MoreScreen';

// Import linking configuration
import { linkingConfig } from './linking';

// Import auth store
import { useAuthStore } from '../stores/authStore';

// Import realtime subscriptions
import { useRealtimeSubscriptions, Notification } from '../hooks';
import { Message, useGroupStore } from '../stores/groupStore';
import NetInfo from '@react-native-community/netinfo';
import { useFlashcardStore } from '../stores/flashcardStore';

// Types
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Flashcards: undefined;
  Tests: undefined;
  Groups: undefined;
  Budget: undefined;
  More: undefined;
};

export type FlashcardsStackParamList = {
  FlashcardsList: undefined;
  DeckDetail: { deckId: string; deckName: string };
  FlashcardReview: { deckId: string; deckName: string; mode: 'review' | 'cram' };
  CramSession: { deckId: string; deckName: string; cards: any[] };
};

export type GamesStackParamList = {
  GameScreen: { session: any };
  GameResult: { session: any; currentUser: any };
};

export type GroupsStackParamList = {
  GroupsList: undefined;
  GroupChat: { groupId: string; groupName: string };
  DirectMessage: { recipientId: string; recipientName: string };
  GameScreen: { session: any };
  GameResult: { session: any; currentUser: any };
};

export type TestsStackParamList = {
  TestsList: undefined;
  TestTaking: { testId: string; testName: string };
  TestResults: { attemptId: string };
};

export type MarketplaceStackParamList = {
  MarketplaceHome: undefined;
  ListingDetail: { listingId: string };
  CreateListing: undefined;
  MyListings: undefined;
  Inquiries: undefined;
};

export type BudgetStackParamList = {
  BudgetHome: undefined;
  AddExpense: undefined;
  AddIncome: undefined;
  SetBudget: undefined;
};

// Create navigators
const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const FlashcardsStack = createNativeStackNavigator<FlashcardsStackParamList>();
const GroupsStack = createNativeStackNavigator<GroupsStackParamList>();
const TestsStack = createNativeStackNavigator<TestsStackParamList>();
const BudgetStack = createNativeStackNavigator<BudgetStackParamList>();

// Loading Screen
const LoadingScreen = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#6366f1" />
  </View>
);

// Auth Stack Navigator
const AuthNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="SignUp" component={SignUpScreen} />
  </AuthStack.Navigator>
);

// Flashcards Stack Navigator
const FlashcardsNavigator = () => (
  <FlashcardsStack.Navigator screenOptions={{ headerShown: false }}>
    <FlashcardsStack.Screen 
      name="FlashcardsList" 
      component={FlashcardsScreen}
    />
    <FlashcardsStack.Screen 
      name="DeckDetail" 
      component={DeckDetailScreen}
    />
    <FlashcardsStack.Screen 
      name="FlashcardReview" 
      component={FlashcardReviewScreen}
      options={{ 
        presentation: 'fullScreenModal',
        animation: 'slide_from_bottom',
      }}
    />
    <FlashcardsStack.Screen 
      name="CramSession" 
      component={CramSessionScreen}
      options={{ 
        presentation: 'fullScreenModal',
        animation: 'slide_from_bottom',
      }}
    />
  </FlashcardsStack.Navigator>
);

// Groups Stack Navigator
const GroupsNavigator = () => (
  <GroupsStack.Navigator screenOptions={{ headerShown: false }}>
    <GroupsStack.Screen 
      name="GroupsList" 
      component={GroupsScreen}
    />
    <GroupsStack.Screen 
      name="GroupChat" 
      component={GroupChatScreen}
    />
    <GroupsStack.Screen 
      name="DirectMessage" 
      component={DirectMessageScreen}
    />
    <GroupsStack.Screen 
      name="GameScreen" 
      component={GameScreen}
      options={{ 
        presentation: 'fullScreenModal',
        animation: 'slide_from_bottom',
        gestureEnabled: false,
      }}
    />
    <GroupsStack.Screen 
      name="GameResult" 
      component={GameResultScreen}
      options={{ 
        presentation: 'fullScreenModal',
        animation: 'fade',
        gestureEnabled: false,
      }}
    />
  </GroupsStack.Navigator>
);

// Tests Stack Navigator
const TestsNavigator = () => (
  <TestsStack.Navigator screenOptions={{ headerShown: false }}>
    <TestsStack.Screen 
      name="TestsList" 
      component={TestScreen}
    />
    <TestsStack.Screen 
      name="TestTaking" 
      component={TestTakingScreen}
      options={{ 
        presentation: 'fullScreenModal',
        animation: 'slide_from_bottom',
        gestureEnabled: false,
      }}
    />
    <TestsStack.Screen 
      name="TestResults" 
      component={TestResultsScreen}
    />
  </TestsStack.Navigator>
);

// Budget Stack Navigator
const BudgetNavigator = () => (
  <BudgetStack.Navigator screenOptions={{ headerShown: false }}>
    <BudgetStack.Screen 
      name="BudgetHome" 
      component={BudgetScreen}
    />
    <BudgetStack.Screen 
      name="AddExpense" 
      component={AddExpenseScreen}
      options={{ 
        presentation: 'modal',
        animation: 'slide_from_bottom',
      }}
    />
    <BudgetStack.Screen 
      name="AddIncome" 
      component={AddIncomeScreen}
      options={{ 
        presentation: 'modal',
        animation: 'slide_from_bottom',
      }}
    />
    <BudgetStack.Screen 
      name="SetBudget" 
      component={SetBudgetScreen}
      options={{ 
        presentation: 'modal',
        animation: 'slide_from_bottom',
      }}
    />
  </BudgetStack.Navigator>
);

// Tab Bar Icon component
const TabBarIcon = ({ name, focused, color }: { name: string; focused: boolean; color: string }) => (
  <Ionicons 
    name={name as any} 
    size={24} 
    color={color} 
  />
);

// Main Tab Navigator
const MainNavigator = () => {
  const { colors, isDark } = useTheme();
  
  return (
    <MainTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 8,
          height: 70,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      }}
    >
      <MainTab.Screen 
        name="Dashboard" 
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon name={focused ? 'home' : 'home-outline'} focused={focused} color={color} />
          ),
        }}
      />
      <MainTab.Screen 
        name="Flashcards" 
        component={FlashcardsNavigator}
        options={{
          tabBarLabel: 'Cards',
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon name={focused ? 'albums' : 'albums-outline'} focused={focused} color={color} />
          ),
        }}
      />
      <MainTab.Screen 
        name="Tests" 
        component={TestsNavigator}
        options={{
          tabBarLabel: 'Tests',
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon name={focused ? 'document-text' : 'document-text-outline'} focused={focused} color={color} />
          ),
        }}
      />
      <MainTab.Screen 
        name="Groups" 
        component={GroupsNavigator}
        options={{
          tabBarLabel: 'Groups',
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon name={focused ? 'people' : 'people-outline'} focused={focused} color={color} />
          ),
        }}
      />
      <MainTab.Screen 
        name="Budget" 
        component={BudgetNavigator}
        options={{
          tabBarLabel: 'Budget',
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon name={focused ? 'wallet' : 'wallet-outline'} focused={focused} color={color} />
          ),
        }}
      />
      <MainTab.Screen 
        name="More" 
        component={MoreNavigator}
        options={{
          tabBarLabel: 'More',
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon name={focused ? 'grid' : 'grid-outline'} focused={focused} color={color} />
          ),
        }}
      />
    </MainTab.Navigator>
  );
};

// Inner Root Navigator (needs theme context)
const RootNavigatorInner = () => {
  const { user, isLoading, isInitialized, initialize } = useAuthStore();
  const { colors, isDark } = useTheme();
  const { fetchGroups, fetchMessages, currentGroup } = useGroupStore();
  
  // Initialize auth on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Handle incoming notifications
  const handleNotification = useCallback((notification: Notification) => {
    console.log('[RootNavigator] Received notification:', notification.type);
    
    // Show an alert for important notifications (could be replaced with a custom toast)
    if (notification.type === 'group_invite') {
      Alert.alert(
        notification.title,
        notification.body,
        [
          { text: 'Dismiss', style: 'cancel' },
          { text: 'View', onPress: () => {
            // Could navigate to groups screen
            console.log('[RootNavigator] View group invite');
          }},
        ]
      );
    }
  }, []);

  // Handle incoming group messages
  const handleMessage = useCallback((message: Message) => {
    console.log('[RootNavigator] Received message in group:', message.groupId);
    
    // If we're viewing this group, refresh messages
    if (currentGroup?.id === message.groupId) {
      fetchMessages(message.groupId, { refresh: true });
    }
    
    // Could also update unread count, show notification, etc.
  }, [currentGroup?.id, fetchMessages]);

  // Handle settings updates from other devices
  const handleSettingsUpdate = useCallback((settings: Record<string, unknown>) => {
    console.log('[RootNavigator] Settings synced from another device');
    // Settings store handles the actual update via loadFromRemote
  }, []);

  // Initialize realtime subscriptions when authenticated
  const { isSubscribed, channelCount } = useRealtimeSubscriptions({
    onNotification: handleNotification,
    onMessage: handleMessage,
    onSettingsUpdate: handleSettingsUpdate,
    autoSubscribe: true,
  });

  // Log subscription status for debugging
  useEffect(() => {
    if (user) {
      console.log(`[RootNavigator] Realtime status: subscribed=${isSubscribed}, channels=${channelCount}`);
    }
  }, [user, isSubscribed, channelCount]);

  // refresh offline decks when network connectivity comes back
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && user?.id) {
        useFlashcardStore.getState().refreshOfflineDecks(user.id).catch(() => {});
      }
    });
    return () => unsubscribe();
  }, [user?.id]);

  // Custom navigation theme
  const navigationTheme = {
    dark: isDark,
    colors: {
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      notification: colors.error,
    },
    fonts: {
      regular: {
        fontFamily: 'System',
        fontWeight: '400' as const,
      },
      medium: {
        fontFamily: 'System',
        fontWeight: '500' as const,
      },
      bold: {
        fontFamily: 'System',
        fontWeight: '700' as const,
      },
      heavy: {
        fontFamily: 'System',
        fontWeight: '900' as const,
      },
    },
  };

  // Show loading screen while initializing
  if (!isInitialized || isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isAuthenticated = !!user;

  return (
    <NavigationContainer linking={linkingConfig} theme={navigationTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <RootStack.Screen name="Main" component={MainNavigator} />
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};

// Root Navigator with Theme Provider
export const RootNavigator = () => {
  return (
    <ThemeProvider>
      <RootNavigatorInner />
    </ThemeProvider>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default RootNavigator;
