import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useMarketplaceStore } from '../../../stores/marketplaceStore';

interface Props {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  /** Leave the icon for the screen you are already on off its own header. */
  hide?: Array<'cart' | 'you'>;
  size?: number;
}

/**
 * Cart and You, one tap away on every Shop screen — the thing that makes the
 * Amazon app feel like Amazon. Shop home had these; the product page, the
 * order list and the saved list did not, so a buyer deep in a listing had to
 * back all the way out to reach either.
 *
 * Both badges read the shared summary, so they agree with the home band and
 * the hub without any screen fetching anything of its own.
 */
export function ShopHeaderActions({ navigate, hide = [], size = 22 }: Props) {
  const { colors } = useTheme();
  const summary = useMarketplaceStore(s => s.shopSummary);
  const needsYou =
    summary.buyerActionOrders +
    summary.sellerActionOrders +
    summary.pendingOffersReceived +
    summary.openInquiries;

  return (
    <View className="flex-row items-center">
      {hide.includes('cart') ? null : (
        <Pressable
          onPress={() => navigate('Cart')}
          accessibilityRole="button"
          accessibilityLabel={summary.cartCount > 0 ? `Cart, ${summary.cartCount} items` : 'Cart'}
          hitSlop={6}
          className="p-2"
        >
          <Ionicons name="cart-outline" size={size} color={colors.textSecondary} />
          <Badge count={summary.cartCount} />
        </Pressable>
      )}
      {hide.includes('you') ? null : (
        <Pressable
          onPress={() => navigate('ShopAccount')}
          accessibilityRole="button"
          accessibilityLabel="Your orders, saved items and selling"
          hitSlop={6}
          className="p-2"
        >
          <Ionicons name="person-circle-outline" size={size} color={colors.textSecondary} />
          <Badge count={needsYou} />
        </Pressable>
      )}
    </View>
  );
}
