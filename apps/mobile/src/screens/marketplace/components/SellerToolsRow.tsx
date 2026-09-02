/**
 * Seller tools chip row for Your Listings.
 *
 * Replaces the MarketplaceWorkspaceBar mount: that bar was a buyer/seller
 * workspace nav whose seller tools hid behind a "..." sheet, so Coupons,
 * Bundles and Campaign were two taps away and invisible. Every seller
 * destination is now a visible chip in one scrolling row, and the seller-side
 * screens (Orders, Offers, Inquiries) are opened with the seller params so
 * they never land on the buyer tab. The primary "New" button keeps its place
 * at the end of the row.
 */
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type SellerTool = 'coupons' | 'bundles' | 'campaign' | 'insights';

export interface SellerToolsRowProps {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  /** Coupons, Bundles, Campaign and Insights are modals owned by the screen. */
  onOpenTool: (tool: SellerTool) => void;
  onNew: () => void;
  newLabel?: string;
  className?: string;
}

type Chip = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

export function SellerToolsRow({
  onNavigate,
  onOpenTool,
  onNew,
  newLabel = 'New',
  className = '',
}: SellerToolsRowProps) {
  const chips: Chip[] = [
    { id: 'orders', label: 'Orders', icon: 'receipt-outline', onPress: () => onNavigate('Orders', { role: 'seller' }) },
    { id: 'offers', label: 'Offers', icon: 'pricetag-outline', onPress: () => onNavigate('Offers', { tab: 'seller' }) },
    {
      id: 'inquiries',
      label: 'Inquiries',
      icon: 'chatbubble-ellipses-outline',
      onPress: () => onNavigate('Inquiries', { tab: 'seller' }),
    },
    { id: 'customers', label: 'Customers', icon: 'people-outline', onPress: () => onNavigate('SellerCustomers') },
    { id: 'coupons', label: 'Coupons', icon: 'ticket-outline', onPress: () => onOpenTool('coupons') },
    { id: 'bundles', label: 'Bundles', icon: 'layers-outline', onPress: () => onOpenTool('bundles') },
    { id: 'campaign', label: 'Campaign', icon: 'megaphone-outline', onPress: () => onOpenTool('campaign') },
    { id: 'insights', label: 'Insights', icon: 'stats-chart-outline', onPress: () => onOpenTool('insights') },
  ];

  return (
    <View className={`flex-row items-center gap-1.5 ${className}`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{ gap: 6, alignItems: 'center', paddingRight: 4 }}
      >
        {chips.map((chip) => (
          <Pressable
            key={chip.id}
            onPress={chip.onPress}
            accessibilityRole="button"
            accessibilityLabel={chip.label}
            className="h-9 px-3 rounded-lg border border-lantern-border bg-lantern-surface flex-row items-center gap-1.5 min-w-[44px]"
          >
            <Ionicons name={chip.icon} size={15} color="#64748b" />
            <Text className="text-xs font-medium text-lantern-text-secondary">{chip.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        onPress={onNew}
        accessibilityRole="button"
        accessibilityLabel={newLabel}
        className="h-9 px-2.5 rounded-lg bg-lantern-primary flex-row items-center gap-1 min-w-[44px]"
      >
        <Ionicons name="add" size={16} color="#fff" />
        <Text className="text-xs font-semibold text-white">{newLabel}</Text>
      </Pressable>
    </View>
  );
}

export default SellerToolsRow;
