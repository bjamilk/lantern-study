/**
 * Cart and You icons with live badges, mounted in the header of every Shop
 * screen that paints its own header.
 *
 * Exports: ShopHeaderActions.
 * Touches: useShopBadges for both counts; navigates to `Cart` and
 * `ShopAccount` through the `navigate` prop.
 *
 * Gotchas: this is a slot, not a navigator header, so a screen that forgets to
 * mount it is silently inconsistent and no test catches it. Pass `hide` for
 * the screen you are already on.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { Badge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useShopBadges } from '../../../hooks/useShopBadges';
import { AppIcon } from '../../../components/ui/AppIcon';

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
 * This is a slot, not a navigator header: a screen that forgets to mount it is
 * silently inconsistent and no test will catch it. Every Shop screen that
 * paints its own header mounts it — Cart, Favorites, Inquiries, ListingDetail,
 * MyListings, Offers, Orders, Purchases, OrderDetail, ShopAccount — and the
 * Shop home draws the same two icons inline.
 *
 * Both badges come from useShopBadges, so they agree with the home band and
 * the hub without any screen fetching anything of its own.
 */
export function ShopHeaderActions({ navigate, hide = [], size = 22 }: Props) {
  const { colors } = useTheme();
  const badges = useShopBadges();

  return (
    <View className="flex-row items-center">
      {hide.includes('cart') ? null : (
        <Pressable
          onPress={() => navigate('Cart')}
          accessibilityRole="button"
          accessibilityLabel={badges.cartCount > 0 ? `Cart, ${badges.cartCount} items` : 'Cart'}
          hitSlop={6}
          className="p-2"
        >
          <AppIcon name="cart" size={size} color={colors.textSecondary} />
          <Badge count={badges.cartCount} />
        </Pressable>
      )}
      {hide.includes('you') ? null : (
        <Pressable
          onPress={() => navigate('ShopAccount')}
          accessibilityRole="button"
          accessibilityLabel={
            badges.needsYou > 0
              ? `Your orders, saved items and selling, ${badges.needsYou} need you`
              : 'Your orders, saved items and selling'
          }
          hitSlop={6}
          className="p-2"
        >
          <AppIcon name="person-circle" size={size} color={colors.textSecondary} />
          <Badge count={badges.needsYou} />
        </Pressable>
      )}
    </View>
  );
}
