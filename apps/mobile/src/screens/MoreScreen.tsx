// ===========================================
// Lantern Study Mobile - More Screen
// ===========================================

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  MarketplaceScreen,
  ListingDetailScreen,
  CreateListingScreen,
  MyListingsScreen,
  InquiriesScreen,
} from './marketplace';
import SettingsScreen from './settings/SettingsScreen';
import OfflineScreen from './settings/OfflineScreen';
import { useTheme } from '../theme';

// Types
type MoreStackParamList = {
  MoreHome: undefined;
  MarketplaceHome: undefined;
  ListingDetail: { listingId: string };
  CreateListing: undefined;
  MyListings: undefined;
  Inquiries: undefined;
  Settings: undefined;
  Offline: undefined;
};

const MoreStack = createNativeStackNavigator<MoreStackParamList>();

// Menu Item Component
interface MenuItemProps {
  icon: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  colors: any;
}

const MenuItem: React.FC<MenuItemProps> = ({ 
  icon, 
  iconColor = '#6366f1', 
  title, 
  subtitle,
  onPress,
  colors
}) => (
  <TouchableOpacity style={[styles.menuItem, { backgroundColor: colors.card, borderBottomColor: colors.border }]} onPress={onPress}>
    <View style={[styles.menuIconContainer, { backgroundColor: `${iconColor}20` }]}>
      <Ionicons name={icon as any} size={24} color={iconColor} />
    </View>
    <View style={styles.menuContent}>
      <Text style={[styles.menuTitle, { color: colors.text }]}>{title}</Text>
      {subtitle && <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
    </View>
    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
  </TouchableOpacity>
);

// More Home Screen
const MoreHomeScreen = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();

  const menuItems = [
    {
      icon: 'storefront',
      iconColor: '#10b981',
      title: 'Marketplace',
      subtitle: 'Buy and sell study materials',
      route: 'MarketplaceHome',
    },
    {
      icon: 'document-text',
      iconColor: '#f59e0b',
      title: 'My Listings',
      subtitle: 'Manage your listings',
      route: 'MyListings',
    },
    {
      icon: 'chatbubbles',
      iconColor: '#3b82f6',
      title: 'Inquiries',
      subtitle: 'Messages about listings',
      route: 'Inquiries',
    },
    {
      icon: 'settings',
      iconColor: '#64748b',
      title: 'Settings',
      subtitle: 'App preferences and account',
      route: 'Settings',
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>More</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Marketplace</Text>
          {menuItems.slice(0, 3).map((item) => (
            <MenuItem
              key={item.route}
              icon={item.icon}
              iconColor={item.iconColor}
              title={item.title}
              subtitle={item.subtitle}
              colors={colors}
              onPress={() => navigation.navigate(item.route)}
            />
          ))}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>App</Text>
          {menuItems.slice(3).map((item) => (
            <MenuItem
              key={item.route}
              icon={item.icon}
              iconColor={item.iconColor}
              title={item.title}
              subtitle={item.subtitle}
              colors={colors}
              onPress={() => navigation.navigate(item.route)}
            />
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>Lantern Study v1.0.0</Text>
          <Text style={[styles.footerSubtext, { color: colors.textTertiary }]}>Made with ❤️ for learners</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// More Navigator
export const MoreNavigator = () => (
  <MoreStack.Navigator screenOptions={{ headerShown: false }}>
    <MoreStack.Screen name="MoreHome" component={MoreHomeScreen} />
    <MoreStack.Screen name="MarketplaceHome" component={MarketplaceScreen} />
    <MoreStack.Screen name="ListingDetail" component={ListingDetailScreen} />
    <MoreStack.Screen 
      name="CreateListing" 
      component={CreateListingScreen}
      options={{ 
        presentation: 'modal',
        animation: 'slide_from_bottom',
      }}
    />
    <MoreStack.Screen name="MyListings" component={MyListingsScreen} />
    <MoreStack.Screen name="Inquiries" component={InquiriesScreen} />
    <MoreStack.Screen name="Settings" component={SettingsScreen} />
    <MoreStack.Screen name="Offline" component={OfflineScreen} />
  </MoreStack.Navigator>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  menuIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f8fafc',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
  },
});

export default MoreNavigator;
