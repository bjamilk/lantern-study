import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useMarketplaceStore,
  useAuthStore,
  getCategoryInfo,
  type MarketplaceListing,
} from '../../stores';
import { Avatar, Button, Card } from '../../components/ui';
import { formatPrice, isOwnListing, ListingImage } from './marketplaceHelpers';
import { addRecentlyViewedListing } from './marketplaceRecentlyViewed';
import { SaleCountdown } from './SaleCountdown';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import {
  fetchPickupNudge,
  validateMarketplaceCoupon,
  fetchListingOffersHistory,
} from '../../services/api';
import type { MarketplacePickupNudge } from '@lantern/shared/types';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (name: string, params?: Record<string, unknown>) => void } | undefined;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { listingId?: string; quantity?: number } };
}

const REPORT_REASONS = [
  'spam',
  'inappropriate',
  'scam',
  'wrong_category',
  'prohibited_item',
  'other',
] as const;

function StarRow({ rating }: { rating: number }) {
  return (
    <View className="flex-row gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={i <= rating ? 'star' : 'star-outline'}
          size={14}
          color={i <= rating ? '#f59e0b' : '#94a3b8'}
        />
      ))}
    </View>
  );
}

export function ListingDetailScreen({ navigation, route }: Props) {
  const listingId = route.params?.listingId ?? '';
  const initialQuantity = route.params?.quantity;
  const { user } = useAuthStore();
  const {
    currentListing,
    reviews,
    similarListings,
    isLoading,
    favorites,
    fetchListing,
    fetchListingReviews,
    fetchSimilar,
    sendInquiry,
    toggleFavorite,
    addReview,
    reportListing,
    buyNowListing,
    addToCart,
    boostListing,
    updateListing,
    deleteListing,
  } = useMarketplaceStore();

  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [showContact, setShowContact] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reportReason, setReportReason] = useState<(typeof REPORT_REASONS)[number]>('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pickupNudge, setPickupNudge] = useState<MarketplacePickupNudge | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponPreview, setCouponPreview] = useState<{ discountAmount: number; finalAmount: number } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [negotiationHistory, setNegotiationHistory] = useState<Array<{ id: string; amount?: number; status?: string }>>([]);

  const load = useCallback(async () => {
    if (!listingId) return;
    await fetchListing(listingId);
    await Promise.all([fetchListingReviews(listingId), fetchSimilar(listingId)]);
    await addRecentlyViewedListing(listingId);
    const listing = useMarketplaceStore.getState().currentListing;
    if (listing) {
      if (listing.quantity == null) {
        setSelectedQuantity(1);
      } else {
        const stock = Math.max(1, Number(listing.quantity) || 1);
        const pref = Math.max(1, Math.floor(Number(initialQuantity) || 1));
        setSelectedQuantity(Math.min(pref, stock));
      }
      const sellerId = listing.seller_id || listing.user_id;
      if (sellerId && sellerId !== user?.id) {
        try {
          setPickupNudge(await fetchPickupNudge(sellerId));
        } catch {
          setPickupNudge(null);
        }
      } else {
        setPickupNudge(null);
      }
      if (sellerId === user?.id) {
        try {
          setNegotiationHistory(await fetchListingOffersHistory(listingId));
        } catch {
          setNegotiationHistory([]);
        }
      }
    }
  }, [listingId, fetchListing, fetchListingReviews, fetchSimilar, user?.id, initialQuantity]);

  useEffect(() => {
    void load();
    if (listingId) {
      void import('../../services/productAnalytics').then(({ trackListingView }) => {
        trackListingView(listingId);
      });
    }
  }, [load, listingId]);

  const listing = currentListing;
  const category = listing ? getCategoryInfo(listing.category) : null;
  const own = listing ? isOwnListing(listing, user?.id) : false;
  const favorited = listing ? favorites.has(listing.id) : false;
  const images = listing?.images?.length ? listing.images : [];

  const openDm = (threadId: string, recipientId: string, recipientName?: string) => {
    navigation.getParent?.()?.navigate('ChatTab', {
      screen: 'DirectMessage',
      params: { threadId, recipientId, recipientName },
    });
  };

  const handleContact = async () => {
    if (!listing || !contactMessage.trim() || !user?.id) return;
    setSending(true);
    try {
      const result = await sendInquiry(listing.id, contactMessage.trim());
      void import('../../services/productAnalytics').then(({ trackInquiryStarted }) => {
        trackInquiryStarted(listing.id);
      });
      setShowContact(false);
      setContactMessage('');
      Alert.alert('Message sent', 'Opening chat with the seller.');
      const sellerId = result.sellerId || listing.seller_id || listing.user_id;
      const threadId =
        result.threadId ||
        (sellerId && user?.id ? [user.id, sellerId].sort().join('-') : undefined);
      if (threadId && sellerId) {
        openDm(threadId, sellerId, listing.seller?.name);
      }
    } catch (e: unknown) {
      Alert.alert(
        'Error',
        e instanceof Error ? e.message : 'Failed to send message. Please try again.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleShare = async () => {
    if (!listing) return;
    try {
      await Share.share({
        message: `${listing.title}${listing.price ? ` - ${formatPrice(listing.price)}` : ''}`,
      });
    } catch {
      // user cancelled
    }
  };

  const handleBuyNow = () => {
    if (!listing || !user?.id || !listing.price) return;
    const pricing = resolveListingDisplayPrice(listing);
    const qty = listing.quantity == null ? 1 : selectedQuantity;
    const unitPay = couponPreview?.finalAmount ?? pricing.effective;
    const itemTotal = Math.round(unitPay * qty * 100) / 100;
    const serviceFee = Math.round(itemTotal * 0.05 * 100) / 100;
    const payAmount = Math.round((itemTotal + serviceFee) * 100) / 100;
    Alert.alert(
      'Buy Now',
      `Purchase "${listing.title}"${qty > 1 ? ` ×${qty}` : ''}?\n\nItem: ${formatPrice(itemTotal)}\nService charge (5%): ${formatPrice(serviceFee)}\nTotal: ${formatPrice(payAmount)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay now',
          onPress: async () => {
            setActionLoading(true);
            void import('../../services/productAnalytics').then(({ trackCheckoutStarted }) => {
              trackCheckoutStarted(listing.id);
            });
            try {
              const result = await buyNowListing(
                listing.id,
                user.id,
                couponPreview ? couponCode.trim() : undefined,
                qty
              );
              const authUrl = (result as { authorizationUrl?: string })?.authorizationUrl;
              const orderId = result?.order?.id;
              if (authUrl) {
                await WebBrowser.openBrowserAsync(authUrl);
                if (orderId) {
                  navigation.navigate('OrderDetail', { orderId, paymentReturn: true });
                }
                return;
              }
              if (orderId) {
                navigation.navigate('OrderDetail', { orderId });
              } else {
                await load();
              }
              Alert.alert(
                'Order placed',
                'Arrange pickup or delivery with the seller.'
              );
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Purchase failed');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleAddToCart = async () => {
    if (!listing || !user?.id || !listing.price) return;
    const qty = listing.quantity == null ? 1 : selectedQuantity;
    setActionLoading(true);
    try {
      await addToCart(listing.id, qty);
      Alert.alert('Added to cart', qty > 1 ? `${qty} items added.` : 'Item added to cart.');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not add to cart');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApplyCoupon = async () => {
    if (!listing || !couponCode.trim()) return;
    setValidatingCoupon(true);
    try {
      const result = await validateMarketplaceCoupon(couponCode.trim(), listing.id);
      setCouponPreview({ discountAmount: result.discountAmount, finalAmount: result.finalAmount });
      Alert.alert('Coupon applied', `${formatPrice(result.discountAmount)} off`);
    } catch (e: unknown) {
      setCouponPreview(null);
      Alert.alert('Invalid coupon', e instanceof Error ? e.message : 'Could not apply coupon');
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleBoost = () => {
    if (!listing || !user?.id) return;
    Alert.alert('Boost listing', 'Boost this listing for 72 hours?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Boost',
        onPress: async () => {
          setActionLoading(true);
          try {
            await boostListing(listing.id, user.id);
            await load();
            Alert.alert('Boosted', 'Your listing is now boosted for 72 hours.');
          } catch (e: unknown) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Boost failed');
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  const handleSubmitReview = async () => {
    if (!listing || !user?.id) return;
    setSending(true);
    try {
      await addReview(listing.id, reviewRating, reviewComment.trim() || undefined);
      setShowReview(false);
      setReviewComment('');
      setReviewRating(5);
      Alert.alert('Thanks', 'Your review was submitted.');
    } catch {
      Alert.alert('Error', 'Failed to submit review.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!listing) return;
    setSending(true);
    try {
      await reportListing(listing.id, reportReason, reportDetails.trim() || undefined);
      setShowReport(false);
      setReportDetails('');
      Alert.alert('Report submitted', 'Thank you for helping keep the marketplace safe.');
    } catch {
      Alert.alert('Error', 'Failed to submit report.');
    } finally {
      setSending(false);
    }
  };

  const handleMarkSold = () => {
    if (!listing || !user?.id) return;
    Alert.alert('Mark as sold', 'Mark this listing as sold?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark sold',
        onPress: async () => {
          await updateListing(listing.id, { status: 'sold' }, user.id);
          await load();
        },
      },
    ]);
  };

  const handleDelete = () => {
    if (!listing || !user?.id) return;
    Alert.alert('Delete listing', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteListing(listing.id, user.id);
          navigation.goBack();
        },
      },
    ]);
  };

  if (isLoading && !listing) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center" edges={['top']}>
        <ActivityIndicator size="large" color="#6366f1" />
      </SafeAreaView>
    );
  }

  if (!listing) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center px-6" edges={['top']}>
        <Text className="text-lg font-semibold text-lantern-text mb-4">Listing not found</Text>
        <Button onPress={() => navigation.goBack()}>Go Back</Button>
      </SafeAreaView>
    );
  }

  const avgRating =
    reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
  const pricing = listing ? resolveListingDisplayPrice(listing) : null;

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-2 flex-row items-center justify-between">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <View className="flex-row items-center gap-1">
          {!own && user?.id ? (
            <Pressable onPress={() => void toggleFavorite(listing.id, user.id)} className="p-2">
              <Ionicons
                name={favorited ? 'heart' : 'heart-outline'}
                size={22}
                color={favorited ? '#ef4444' : '#64748b'}
              />
            </Pressable>
          ) : null}
          <Pressable onPress={handleShare} className="p-2">
            <Ionicons name="share-outline" size={22} color="#64748b" />
          </Pressable>
          {!own ? (
            <Pressable onPress={() => setShowReport(true)} className="p-2">
              <Ionicons name="flag-outline" size={22} color="#64748b" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }}>
        <View className="aspect-[16/10] bg-lantern-background-secondary mx-4 rounded-2xl overflow-hidden">
          {images.length ? (
            <>
              <ListingImage uri={images[imageIndex]} className="w-full h-full" />
              {images.length > 1 ? (
                <View className="absolute bottom-3 left-0 right-0 flex-row justify-center gap-1.5">
                  {images.map((_, i) => (
                    <Pressable
                      key={i}
                      onPress={() => setImageIndex(i)}
                      className={`w-2 h-2 rounded-full ${i === imageIndex ? 'bg-lantern-surface' : 'bg-lantern-surface/50'}`}
                    />
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <ListingImage className="w-full h-full" />
          )}
        </View>

        <View className="px-4 pt-4">
          {category ? (
            <Text className="text-xs font-medium text-lantern-primary mb-1">
              {category.name}
            </Text>
          ) : null}
          <Text className="text-2xl font-bold text-lantern-text">{listing.title}</Text>
          {listing.promo_label ? (
            <Text className="text-xs font-semibold text-amber-600 mt-1">{listing.promo_label}</Text>
          ) : null}
          <View className="flex-row items-center flex-wrap gap-2 mt-2">
            {pricing?.onSale && listing.price ? (
              <Text className="text-lg text-lantern-text-tertiary line-through">{formatPrice(listing.price)}</Text>
            ) : null}
            <Text className="text-2xl font-bold text-lantern-primary">
              {formatPrice(pricing?.effective ?? listing.price)}
            </Text>
            {listing.quantity != null ? (
              <View className={`px-2 py-0.5 rounded-lg ${listing.quantity > 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
                <Text className={`text-xs font-medium ${listing.quantity > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {listing.quantity > 0 ? `${listing.quantity} left` : 'Sold out'}
                </Text>
              </View>
            ) : null}
          </View>
          {listing.sale_ends_at && pricing?.onSale ? (
            <View className="mt-2">
              <SaleCountdown saleEndsAt={listing.sale_ends_at} />
            </View>
          ) : null}
          {listing.status !== 'active' ? (
            <Text className="text-sm font-semibold text-amber-600 mt-2 capitalize">{listing.status}</Text>
          ) : null}

          {listing.location ? (
            <View className="flex-row items-center gap-1.5 mt-3">
              <Ionicons name="location-outline" size={16} color="#64748b" />
              <Text className="text-sm text-lantern-text-secondary">{listing.location}</Text>
            </View>
          ) : null}

          {pickupNudge?.message && !own ? (
            <View className="mt-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40">
              <Text className="text-sm text-emerald-800 dark:text-emerald-200">{pickupNudge.message}</Text>
            </View>
          ) : null}

          {listing.listing_kind === 'bundle' && listing.bundle_items && listing.bundle_items.length > 0 ? (
            <View className="mt-3 p-3 rounded-xl bg-lantern-primary-background dark:bg-lantern-primary-background border border-lantern-primary/30 dark:border-lantern-primary/30">
              <Text className="text-sm font-semibold text-lantern-primary-dark dark:text-lantern-primary-light mb-2">Bundle includes</Text>
              {listing.bundle_items.map((item, idx) => (
                <Text key={item.listing_id || idx} className="text-sm text-lantern-primary-dark dark:text-lantern-primary-light">
                  • {item.title}
                  {item.price != null ? ` (${formatPrice(Number(item.price))})` : ''}
                </Text>
              ))}
            </View>
          ) : null}

          {own && negotiationHistory.length > 0 ? (
            <Card className="mt-3">
              <Text className="text-sm font-semibold text-lantern-text mb-2">Offer activity</Text>
              {negotiationHistory.slice(0, 5).map(event => (
                <Text key={event.id} className="text-xs text-lantern-text-secondary mb-1">
                  {event.status || 'offer'}
                  {event.amount != null ? ` · ${formatPrice(event.amount)}` : ''}
                </Text>
              ))}
            </Card>
          ) : null}

          <Pressable
            onPress={() =>
              navigation.navigate('SellerProfile', {
                sellerId: listing.seller_id || listing.user_id,
              })
            }
            className="flex-row items-center gap-3 mt-4 p-3 rounded-2xl bg-lantern-surface border border-lantern-border"
          >
            <Avatar name={listing.seller?.name || 'Anonymous Seller'} size={44} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-lantern-text">
                {listing.seller?.name || 'Anonymous Seller'}
              </Text>
              <Text className="text-xs text-lantern-text-secondary">
                {reviews.length > 0
                  ? `${avgRating.toFixed(1)} · ${reviews.length} review${reviews.length === 1 ? '' : 's'}`
                  : 'View seller profile'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </Pressable>

          <Card className="mt-4">
            <Text className="text-sm font-semibold text-lantern-text mb-2">Description</Text>
            <Text className="text-sm text-lantern-text-secondary leading-5">
              {listing.description?.trim() || 'No description provided.'}
            </Text>
          </Card>

          <Card className="mt-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm font-semibold text-lantern-text">Reviews</Text>
              {!own && user?.id && listing.status === 'active' ? (
                <Pressable onPress={() => setShowReview(true)}>
                  <Text className="text-sm font-semibold text-lantern-primary">Write review</Text>
                </Pressable>
              ) : null}
            </View>
            {reviews.length === 0 ? (
              <Text className="text-sm text-lantern-text-secondary">No reviews yet.</Text>
            ) : (
              reviews.map(review => (
                <View
                  key={review.id}
                  className="py-3 border-t border-lantern-border first:border-t-0 first:pt-0"
                >
                  <View className="flex-row items-center justify-between mb-1">
                    <Text className="text-sm font-medium text-lantern-text">
                      {review.reviewer?.name || review.reviewer?.username || 'User'}
                    </Text>
                    <StarRow rating={review.rating} />
                  </View>
                  {review.comment ? (
                    <Text className="text-sm text-lantern-text-secondary">{review.comment}</Text>
                  ) : null}
                </View>
              ))
            )}
          </Card>

          {similarListings.length > 0 ? (
            <View className="mt-4">
              <Text className="text-sm font-semibold text-lantern-text mb-3">
                You might also like
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {similarListings.map(item => (
                  <Pressable
                    key={item.id}
                    onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
                    className="w-40 mr-3 rounded-xl overflow-hidden bg-lantern-surface border border-lantern-border"
                  >
                    <ListingImage uri={item.images?.[0]} className="w-full h-24" />
                    <View className="p-2">
                      <Text numberOfLines={2} className="text-xs font-medium text-lantern-text">
                        {item.title}
                      </Text>
                      <Text className="text-xs font-semibold text-lantern-primary mt-1">
                        {formatPrice(item.price)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View className="flex-row gap-4 mt-4">
            {listing.views_count != null ? (
              <Text className="text-xs text-lantern-text-secondary">{listing.views_count} views</Text>
            ) : null}
            {listing.favorites_count != null ? (
              <Text className="text-xs text-lantern-text-secondary">
                {listing.favorites_count} favorites
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {!own && listing.status === 'active' ? (
        <View className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-lantern-surface border-t border-lantern-border">
          {listing.price && listing.price > 0 && listing.quantity != null && listing.quantity > 0 ? (
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs text-lantern-text-secondary">
                Qty · {listing.quantity} available
              </Text>
              <View className="flex-row items-center rounded-lg border border-lantern-border overflow-hidden">
                <Pressable
                  className="px-3 py-2"
                  onPress={() => setSelectedQuantity((q) => Math.max(1, q - 1))}
                >
                  <Text className="text-lantern-text">−</Text>
                </Pressable>
                <Text className="px-3 py-2 font-semibold text-lantern-text">{selectedQuantity}</Text>
                <Pressable
                  className="px-3 py-2"
                  onPress={() =>
                    setSelectedQuantity((q) => Math.min(Number(listing.quantity), q + 1))
                  }
                >
                  <Text className="text-lantern-text">+</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {listing.price && listing.price > 0 ? (
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={couponCode}
                onChangeText={setCouponCode}
                placeholder="Coupon code"
                autoCapitalize="characters"
                className="flex-1 px-3 py-2 rounded-xl border border-lantern-border text-lantern-text text-sm"
                placeholderTextColor="#94a3b8"
              />
              <Button
                variant="secondary"
                loading={validatingCoupon}
                onPress={() => void handleApplyCoupon()}
              >
                Apply
              </Button>
            </View>
          ) : null}
          {couponPreview ? (
            <Text className="text-xs text-emerald-600 mb-2">
              Coupon applied —{' '}
              {formatPrice(
                couponPreview.discountAmount *
                  (listing.quantity == null ? 1 : selectedQuantity)
              )}{' '}
              off
            </Text>
          ) : null}
          <View className="flex-row gap-2 mb-2">
            <Button variant="secondary" className="flex-1" onPress={() => setShowContact(true)}>
              Contact
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onPress={() => navigation.navigate('MakeOffer', { listingId: listing.id })}
            >
              Offer
            </Button>
          </View>
          {listing.price ? (
            <View className="flex-row gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                loading={actionLoading}
                onPress={() => void handleAddToCart()}
              >
                Cart
              </Button>
              <Button className="flex-1" loading={actionLoading} onPress={handleBuyNow}>
                Buy Now
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}

      {own && listing.status === 'active' ? (
        <View className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-lantern-surface border-t border-lantern-border">
          <View className="flex-row gap-2 mb-2">
            <Button
              variant="secondary"
              className="flex-1"
              onPress={() => navigation.navigate('EditListing', { listingId: listing.id })}
            >
              Edit
            </Button>
            <Button variant="secondary" className="flex-1" loading={actionLoading} onPress={handleBoost}>
              Boost
            </Button>
          </View>
          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={handleMarkSold}>
              Mark sold
            </Button>
            <Button variant="secondary" className="flex-1" onPress={handleDelete}>
              Delete
            </Button>
          </View>
        </View>
      ) : null}

      <Modal visible={showContact} transparent animationType="slide" onRequestClose={() => setShowContact(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-lantern-surface rounded-t-3xl p-5">
            <Text className="text-lg font-bold text-lantern-text mb-3">Contact Seller</Text>
            <TextInput
              value={contactMessage}
              onChangeText={setContactMessage}
              placeholder="Hi, is this still available?"
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={4}
              className="min-h-[100px] p-3 rounded-xl border border-lantern-border text-lantern-text mb-4"
              textAlignVertical="top"
            />
            <View className="flex-row gap-3">
              <Button variant="secondary" className="flex-1" onPress={() => setShowContact(false)}>
                Cancel
              </Button>
              <Button className="flex-1" loading={sending} onPress={handleContact}>
                Send & Chat
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showReview} transparent animationType="slide" onRequestClose={() => setShowReview(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-lantern-surface rounded-t-3xl p-5">
            <Text className="text-lg font-bold text-lantern-text mb-3">Write a review</Text>
            <View className="flex-row gap-2 mb-4">
              {[1, 2, 3, 4, 5].map(i => (
                <Pressable key={i} onPress={() => setReviewRating(i)}>
                  <Ionicons name={i <= reviewRating ? 'star' : 'star-outline'} size={28} color="#f59e0b" />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Share your experience (optional)"
              placeholderTextColor="#94a3b8"
              multiline
              className="min-h-[80px] p-3 rounded-xl border border-lantern-border text-lantern-text mb-4"
              textAlignVertical="top"
            />
            <View className="flex-row gap-3">
              <Button variant="secondary" className="flex-1" onPress={() => setShowReview(false)}>
                Cancel
              </Button>
              <Button className="flex-1" loading={sending} onPress={handleSubmitReview}>
                Submit
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showReport} transparent animationType="slide" onRequestClose={() => setShowReport(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-lantern-surface rounded-t-3xl p-5">
            <Text className="text-lg font-bold text-lantern-text mb-3">Report listing</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {REPORT_REASONS.map(reason => (
                <Pressable
                  key={reason}
                  onPress={() => setReportReason(reason)}
                  className={`px-3 py-1.5 rounded-full border ${
                    reportReason === reason
                      ? 'bg-red-600 border-red-600'
                      : 'border-lantern-border'
                  }`}
                >
                  <Text className={`text-xs capitalize ${reportReason === reason ? 'text-white' : 'text-lantern-text-secondary'}`}>
                    {reason.replace(/_/g, ' ')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder="Additional details (optional)"
              placeholderTextColor="#94a3b8"
              multiline
              className="min-h-[80px] p-3 rounded-xl border border-lantern-border text-lantern-text mb-4"
              textAlignVertical="top"
            />
            <View className="flex-row gap-3">
              <Button variant="secondary" className="flex-1" onPress={() => setShowReport(false)}>
                Cancel
              </Button>
              <Button className="flex-1" loading={sending} onPress={handleSubmitReport}>
                Submit report
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
