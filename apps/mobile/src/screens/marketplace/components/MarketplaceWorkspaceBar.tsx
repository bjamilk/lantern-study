import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type MarketplaceWorkspaceSection =
  | 'browse'
  | 'orders'
  | 'selling'
  | 'inquiries'
  | 'favorites';

export interface MarketplaceWorkspaceBarProps {
  active: MarketplaceWorkspaceSection;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onSell?: () => void;
  moreItems?: Array<{
    id: string;
    label: string;
    onSelect: () => void;
    icon?: keyof typeof Ionicons.glyphMap;
  }>;
  primaryLabel?: string;
  showFavorites?: boolean;
  className?: string;
}

type NavItem = {
  id: MarketplaceWorkspaceSection;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  screen: string;
};

const NAV: NavItem[] = [
  { id: 'browse', label: 'Browse', icon: 'search-outline', screen: 'MarketplaceHome' },
  { id: 'orders', label: 'Orders', icon: 'receipt-outline', screen: 'Orders' },
  { id: 'selling', label: 'Selling', icon: 'storefront-outline', screen: 'MyListings' },
  { id: 'inquiries', label: 'Offers', icon: 'chatbubble-ellipses-outline', screen: 'Inquiries' },
];

/**
 * Compact CRM-style workspace nav for marketplace buyer/seller screens.
 */
export function MarketplaceWorkspaceBar({
  active,
  onNavigate,
  onSell,
  moreItems = [],
  primaryLabel = 'Sell',
  showFavorites = false,
  className = '',
}: MarketplaceWorkspaceBarProps) {
  const insets = useSafeAreaInsets();
  const [showMore, setShowMore] = useState(false);

  const items = showFavorites
    ? [
        ...NAV,
        {
          id: 'favorites' as const,
          label: 'Saved',
          icon: 'heart-outline' as const,
          screen: 'Favorites',
        },
      ]
    : NAV;

  return (
    <View className={`flex-row items-center gap-1.5 ${className}`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{ gap: 6, alignItems: 'center', paddingRight: 4 }}
      >
        {items.map(item => {
          const isActive = active === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => onNavigate(item.screen)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
              className={`flex-row items-center gap-1 px-2.5 h-9 rounded-lg min-w-[44px] ${
                isActive ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
              }`}
            >
              <Ionicons
                name={item.icon}
                size={15}
                color={isActive ? '#fff' : '#64748b'}
              />
              <Text
                className={`text-xs font-medium ${
                  isActive ? 'text-white' : 'text-lantern-text-secondary'
                }`}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {moreItems.length > 0 ? (
        <Pressable
          onPress={() => setShowMore(true)}
          accessibilityRole="button"
          accessibilityLabel="More marketplace tools"
          className="h-9 w-9 items-center justify-center rounded-lg border border-lantern-border bg-lantern-surface"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color="#64748b" />
        </Pressable>
      ) : null}

      {onSell ? (
        <Pressable
          onPress={onSell}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          className="h-9 px-2.5 rounded-lg bg-lantern-primary flex-row items-center gap-1 min-w-[44px]"
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text className="text-xs font-semibold text-white">{primaryLabel}</Text>
        </Pressable>
      ) : null}

      <Modal visible={showMore} transparent animationType="slide" onRequestClose={() => setShowMore(false)}>
        <View className="flex-1 justify-end">
          <Pressable className="flex-1 bg-black/40" onPress={() => setShowMore(false)} />
          <View
            style={{ paddingBottom: insets.bottom + 12 }}
            className="bg-lantern-surface rounded-t-3xl border-t border-lantern-border max-h-[70%]"
          >
            <View className="w-10 h-1 rounded-full bg-lantern-border self-center mt-3 mb-2" />
            <Text className="text-lg font-bold text-lantern-text px-5 pb-2">Seller tools</Text>
            <ScrollView className="px-3">
              {moreItems.map(item => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setShowMore(false);
                    item.onSelect();
                  }}
                  className="flex-row items-center gap-3 px-3 py-3.5 rounded-xl active:bg-lantern-background-secondary"
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <Ionicons name={item.icon || 'ellipse-outline'} size={20} color="#6366f1" />
                  <Text className="flex-1 text-base font-medium text-lantern-text">{item.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default MarketplaceWorkspaceBar;
