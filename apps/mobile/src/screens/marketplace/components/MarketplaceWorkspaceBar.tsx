import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type MarketplaceWorkspaceSection =
  | 'discover'
  | 'browse'
  | 'jobs'
  | 'orders'
  | 'cart'
  | 'purchases'
  | 'studyProducts'
  | 'selling'
  | 'offers'
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
  /**
   * `full` — chip row for seller screens.
   * `toolbar` — More + Sell only, used when Discover tabs already sit above.
   */
  variant?: 'full' | 'toolbar';
}

type NavItem = {
  id: MarketplaceWorkspaceSection;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  screen: string;
};

const NAV: NavItem[] = [
  // Phase 3 L / decision D12: Discover is the hub the marketplace sits inside.
  { id: 'discover', label: 'Discover', icon: 'globe-outline', screen: 'Discover' },
  { id: 'browse', label: 'Goods', icon: 'search-outline', screen: 'MarketplaceHome' },
  // Jobs is its own bottom-tab stack now: navigating to JobsHome from inside
  // the Market stack reaches no navigator, so the chip targets the tab.
  { id: 'jobs', label: 'Jobs', icon: 'briefcase-outline', screen: 'JobsTab' },
  { id: 'orders', label: 'Orders', icon: 'receipt-outline', screen: 'Orders' },
  { id: 'cart', label: 'Cart', icon: 'cart-outline', screen: 'Cart' },
  { id: 'purchases', label: 'Library', icon: 'albums-outline', screen: 'Purchases' },
  { id: 'studyProducts', label: 'Products', icon: 'sparkles-outline', screen: 'StudyProductDrafts' },
  { id: 'selling', label: 'Selling', icon: 'storefront-outline', screen: 'MyListings' },
  // The "Offers" chip must reach OffersScreen; InquiriesScreen has no offers view.
  { id: 'offers', label: 'Offers', icon: 'pricetag-outline', screen: 'Offers' },
  { id: 'inquiries', label: 'Inquiries', icon: 'chatbubble-ellipses-outline', screen: 'Inquiries' },
];

const TOOLBAR_NAV = NAV.filter((item) => item.id !== 'discover' && item.id !== 'browse');

/** Sections from which "Orders" means the orders you are SELLING, not buying. */
const SELLER_SECTIONS: ReadonlySet<MarketplaceWorkspaceSection> = new Set([
  'selling',
  'offers',
  'inquiries',
  'studyProducts',
]);

/**
 * OrdersScreen defaults to the buyer's purchase history. Tapped from a seller
 * screen, that is the wrong list — a seller checking on sales landed on their
 * own purchases and had to notice the toggle. The bar knows which screen it is
 * on, so it can say which side of the order the tap means.
 */
function navParams(item: NavItem, active: MarketplaceWorkspaceSection): Record<string, unknown> | undefined {
  if (item.id === 'orders' && SELLER_SECTIONS.has(active)) return { role: 'seller' };
  return undefined;
}

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
  variant = 'full',
}: MarketplaceWorkspaceBarProps) {
  const insets = useSafeAreaInsets();
  const [showMore, setShowMore] = useState(false);
  // The chip row scrolls, but nothing said so — chips just clipped mid-word
  // ("Selli…") and the tail of the nav was undiscoverable. Show a chevron
  // while there is off-screen content to the right.
  const [showOverflowHint, setShowOverflowHint] = useState(false);
  const scrollMetrics = useRef({ container: 0, content: 0 });
  const syncOverflowHint = (scrollX?: number) => {
    const { container, content } = scrollMetrics.current;
    if (!container || !content) return;
    const atEnd = scrollX != null && scrollX >= content - container - 8;
    setShowOverflowHint(content > container + 8 && !atEnd);
  };

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

  const sheetItems: Array<{
    id: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onSelect: () => void;
  }> =
    variant === 'toolbar'
      ? [
          ...TOOLBAR_NAV.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            onSelect: () => onNavigate(item.screen, navParams(item, active)),
          })),
          ...(showFavorites
            ? [
                {
                  id: 'favorites',
                  label: 'Saved',
                  icon: 'heart-outline' as const,
                  onSelect: () => onNavigate('Favorites'),
                },
              ]
            : []),
          ...moreItems.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon || ('ellipse-outline' as const),
            onSelect: item.onSelect,
          })),
        ]
      : moreItems.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon || ('ellipse-outline' as const),
          onSelect: item.onSelect,
        }));

  const showMoreButton = variant === 'toolbar' || sheetItems.length > 0;

  return (
    <View className={`flex-row items-center gap-1.5 ${className}`}>
      {variant === 'full' ? (
      <View className="flex-1 flex-row items-center">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{ gap: 6, alignItems: 'center', paddingRight: 4 }}
        onLayout={e => {
          scrollMetrics.current.container = e.nativeEvent.layout.width;
          syncOverflowHint();
        }}
        onContentSizeChange={w => {
          scrollMetrics.current.content = w;
          syncOverflowHint();
        }}
        onScroll={e => syncOverflowHint(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={64}
      >
        {items.map(item => {
          const isActive = active === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => onNavigate(item.screen, navParams(item, active))}
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
      {showOverflowHint ? (
        <View pointerEvents="none" className="absolute right-0">
          <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
        </View>
      ) : null}
      </View>
      ) : null}

      {showMoreButton ? (
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
            <Text className="text-lg font-bold text-lantern-text px-5 pb-2">
              {variant === 'toolbar' ? 'Marketplace' : 'Seller tools'}
            </Text>
            <ScrollView className="px-3">
              {sheetItems.map(item => (
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
