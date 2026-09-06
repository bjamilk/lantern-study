/**
 * Marketplace private pilot (2026-08-29): the goods marketplace is available
 * only to allowlisted accounts while it is piloted. The API enforces the gate
 * with 403s (code MARKETPLACE_PRIVATE); this wrapper renders the honest
 * explanation instead of broken screens for everyone else. Network screens on
 * the same stack (Discover, communities, feed, study rooms, creator profiles)
 * are NOT wrapped and stay open.
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMarketplaceStore, useAuthStore } from '../../stores';
import { AppIcon, type AppIconName } from '../../components/ui/AppIcon';

/** Which private-pilot surface a gated screen belongs to. */
export type PilotSurface = 'marketplace' | 'jobs';

const PILOT_COPY: Record<
  PilotSurface,
  { title: string; body: string; icon: AppIconName }
> = {
  marketplace: {
    title: 'The marketplace is in a private pilot',
    body:
      'Buying and selling study materials is being tested with a small group ' +
      'right now. It will open up campus by campus — you’ll see it here the ' +
      'moment it’s available on your account. Everything else in Lantern is ' +
      'yours to use in the meantime.',
    icon: 'storefront',
  },
  jobs: {
    title: 'Jobs is in a private pilot',
    body:
      'The jobs board is being tested with a small group right now. It will ' +
      'open up campus by campus — you’ll see it here the moment it’s ' +
      'available on your account. Everything else in Lantern is yours to use ' +
      'in the meantime.',
    icon: 'briefcase',
  },
};

function MarketplacePrivatePilotScreen({ surface }: { surface: PilotSurface }) {
  const navigation = useNavigation();
  const copy = PILOT_COPY[surface];

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2">
        <Pressable hitSlop={10}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : undefined)}
          className="p-2 -ml-2 self-start"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
      </View>
      <View className="flex-1 items-center justify-center px-8 -mt-10">
        <View className="w-16 h-16 rounded-2xl bg-lantern-primary-background dark:bg-lantern-primary-dark/30 items-center justify-center mb-5">
          <AppIcon name={copy.icon} size={30} color="#6366f1" />
        </View>
        <Text className="text-lg font-bold text-lantern-text text-center mb-2">
          {copy.title}
        </Text>
        <Text className="text-sm text-lantern-text-secondary text-center mb-6">
          {copy.body}
        </Text>
        <Pressable
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : undefined)}
          className="px-5 py-2.5 rounded-xl bg-lantern-primary-fill"
          accessibilityRole="button"
        >
          <Text className="text-sm font-semibold text-white">Go back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function MarketplaceUnavailableScreen({ onRetry }: { onRetry: () => void }) {
  const navigation = useNavigation();

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2">
        <Pressable
          hitSlop={10}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : undefined)}
          className="p-2 -ml-2 self-start"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
      </View>
      <View className="flex-1 items-center justify-center px-8 -mt-10">
        <View className="w-16 h-16 rounded-2xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary items-center justify-center mb-5">
          <AppIcon name="cloud-offline" size={30} color="#64748b" />
        </View>
        <Text className="text-lg font-bold text-lantern-text text-center mb-2">
          Couldn’t check the marketplace
        </Text>
        <Text className="text-sm text-lantern-text-secondary text-center mb-6">
          We couldn’t reach Lantern to confirm your access. This is a connection
          problem, not something about your account.
        </Text>
        <Pressable
          onPress={onRetry}
          className="px-5 py-2.5 rounded-xl bg-lantern-primary-fill"
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text className="text-sm font-semibold text-white">Try again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * Wrap a marketplace-commerce screen so it only renders for allowlisted
 * accounts. Use at MODULE scope only (a stable component identity), e.g.
 * `const GatedCart = withMarketplaceGate(CartScreen)`.
 */
export function withMarketplaceGate<P extends object>(
  Screen: React.ComponentType<P>,
  surface: PilotSurface = 'marketplace',
): React.FC<P> {
  function GatedScreen(props: P) {
    const marketplaceAccess = useMarketplaceStore(s => s.marketplaceAccess);
    const unavailable = useMarketplaceStore(s => s.marketplaceAccessUnavailable);
    const checkMarketplaceAccess = useMarketplaceStore(s => s.checkMarketplaceAccess);
    const userId = useAuthStore(s => s.user?.id);

    // Re-verify on every mount and on account switches — a cached answer from
    // another account must never decide what this one sees. The cached value
    // still renders immediately; the refetch corrects it if it changed.
    useEffect(() => {
      void checkMarketplaceAccess();
    }, [userId, checkMarketplaceAccess]);

    if (marketplaceAccess === true) return <Screen {...props} />;
    if (marketplaceAccess === false) return <MarketplacePrivatePilotScreen surface={surface} />;
    // Unknown. Only say "private pilot" when the server actually said so —
    // otherwise an outage reads as an accusation, and because MarketTab stays
    // mounted for the session, it used to stick until the app was restarted.
    if (unavailable) {
      return <MarketplaceUnavailableScreen onRetry={() => void checkMarketplaceAccess()} />;
    }
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center" edges={['top']}>
        <ActivityIndicator size="large" color="#6366f1" />
      </SafeAreaView>
    );
  }
  GatedScreen.displayName = `withMarketplaceGate(${Screen.displayName || Screen.name || 'Screen'})`;
  return GatedScreen;
}
