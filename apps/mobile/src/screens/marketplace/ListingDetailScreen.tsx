import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import * as WebBrowser from 'expo-web-browser';
import {
  SCREEN_KEYBOARD_BEHAVIOR,
  Screen,
  useScreenBottomPadding,
  useScreenInsets,
} from '../../components/layout';
import {
  useMarketplaceStore,
  useAuthStore,
  getCategoryInfo,
  type MarketplaceListing,
} from '../../stores';
import { Avatar, Button, Card, FeatureDisc } from '../../components/ui';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { StickyActionBar } from './components/StickyActionBar';
import { scrollClearanceForActionBar } from './components/keyboardSafeLayout';
import { formatPrice, isOwnListing, ListingImage } from './marketplaceHelpers';
import { addRecentlyViewedListing } from './marketplaceRecentlyViewed';
import { SaleCountdown } from './SaleCountdown';
import { resolveListingDisplayPrice } from '@lantern/shared/utils';
import {
  isMarketplaceListingModerated,
  isDigitalListingKind,
  summarizeStudyPackCounts,
  MARKETPLACE_LISTING_STATUS_LABELS,
  listingBreadcrumb,
  listingSpecRows,
  listingTypeLabel,
  computeMarketplaceReviewSummary,
  reviewHistogramPercentages,
  sortMarketplaceReviews,
  filterReviewsByStar,
  REVIEW_SORT_LABELS,
  fulfillmentChipLabels,
  type ReviewSortOption,
} from '@lantern/shared/marketplace';
import {
  fetchPickupNudge,
  validateMarketplaceCoupon,
  fetchListingOffersHistory,
  downloadQuestionBank,
  fetchQuestionBankPreview,
  downloadStudyPack,
  fetchStudyPackPreview,
  fetchMarketplaceListingReviewEligibility,
  fetchSellerFulfillment,
} from '../../services/api';
import type { MarketplacePickupNudge, MarketplaceSellerFulfillment } from '@lantern/shared/types';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import { ListingTakedownNotice } from '../../components/moderation/ListingTakedownNotice';
import { shouldShowTrustChip, trustLabel } from '@lantern/shared/network';

import { useMarketplacePaymentsConfig } from '../../hooks/useMarketplacePaymentsConfig';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';
type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (name: string, params?: Record<string, unknown>) => void } | undefined;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { listingId?: string; quantity?: number } };
}

function StarRow({ rating }: { rating: number }) {
  return (
    <View className="flex-row gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <AppIcon
          key={i}
          name="star"
          filled={i <= rating}
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
  const insets = useScreenInsets();
  // This route is immersive (no bottom tab bar), so 'auto' resolves to the
  // plain system inset — the floor the page needs when no action bar renders.
  const baseBottomPadding = useScreenBottomPadding({ bottomExtra: 24 });
  /*
   * The action bar below is conditionally one or two rows tall — Contact/Offer
   * and Cart/Buy Now. (It used to be up to four: the quantity stepper and the
   * coupon field sat in it too, which took roughly a third of the screen away
   * from the listing itself and cut the description mid-sentence. Those two
   * are read-time choices, so they now render beside the price.)
   * The page used to reserve a hard-coded 140px for the bar,
   * so roughly 140px of the listing (the tail of the description, the seller
   * block, the favourites line) could never be scrolled into view. Measuring
   * the bar is the only thing that tracks a bar whose height depends on price,
   * quantity, coupon eligibility and ownership.
   */
  const [actionBarHeight, setActionBarHeight] = useState(0);
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
    buyNowListing,
    addToCart,
    boostListing,
    updateListing,
    deleteListing,
    toggleReviewHelpful,
  } = useMarketplaceStore();

  const paymentsConfig = useMarketplacePaymentsConfig();
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [showContact, setShowContact] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [canReview, setCanReview] = useState(false);
  // 'top' sorts by helpful votes with a recency tiebreak, so before any votes
  // exist (or pre-migration) it reads as most-recent.
  const [reviewSort, setReviewSort] = useState<ReviewSortOption>('top');
  const [reviewStarFilter, setReviewStarFilter] = useState<number | null>(null);
  const [votingReviewId, setVotingReviewId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pickupNudge, setPickupNudge] = useState<MarketplacePickupNudge | null>(null);
  const [sellerFulfillment, setSellerFulfillment] = useState<MarketplaceSellerFulfillment | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponPreview, setCouponPreview] = useState<{ discountAmount: number; finalAmount: number } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [negotiationHistory, setNegotiationHistory] = useState<Array<{ id: string; amount?: number; status?: string }>>([]);
  const [bankPreview, setBankPreview] = useState<{
    questionCount: number;
    previewCount: number;
    owned?: boolean;
    questions: Array<{
      id?: string;
      questionStem?: string;
      text?: string;
      options?: Array<{ id: string; text: string }>;
    }>;
  } | null>(null);
  const [bankOwned, setBankOwned] = useState(false);
  const [studyPackPreview, setStudyPackPreview] =
    useState<Awaited<ReturnType<typeof fetchStudyPackPreview>> | null>(null);
  const [downloadingBank, setDownloadingBank] = useState(false);

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
        try {
          setSellerFulfillment(await fetchSellerFulfillment(sellerId));
        } catch {
          setSellerFulfillment(null);
        }
      } else {
        setPickupNudge(null);
        setSellerFulfillment(null);
      }
      // Real review eligibility (verified purchase) gates the "Write review"
      // button; the server rejects non-buyers, so don't show it to them.
      if (user?.id && sellerId !== user?.id) {
        try {
          const eligibility = await fetchMarketplaceListingReviewEligibility(listingId);
          setCanReview(!!eligibility.canReview);
        } catch {
          setCanReview(false);
        }
      } else {
        setCanReview(false);
      }
      if (sellerId === user?.id) {
        try {
          setNegotiationHistory(await fetchListingOffersHistory(listingId));
        } catch {
          setNegotiationHistory([]);
        }
      }
      // Digital products: sample + ownership in one public request.
      if (listing.listing_kind === 'question_bank') {
        try {
          const preview = await fetchQuestionBankPreview(listingId);
          setBankPreview(preview);
          setBankOwned(!!preview.owned);
        } catch {
          setBankPreview(null);
        }
        setStudyPackPreview(null);
      } else if (listing.listing_kind === 'study_pack') {
        try {
          const preview = await fetchStudyPackPreview(listingId);
          setStudyPackPreview(preview);
          setBankOwned(!!preview.owned);
        } catch {
          setStudyPackPreview(null);
        }
        setBankPreview(null);
      } else {
        setBankPreview(null);
        setStudyPackPreview(null);
        setBankOwned(false);
      }
    }
  }, [listingId, fetchListing, fetchListingReviews, fetchSimilar, user?.id, initialQuantity]);

  const handleDownloadBank = async () => {
    if (!listingId || !listing) return;
    setDownloadingBank(true);
    try {
      if (listing.listing_kind === 'study_pack') {
        await downloadStudyPack(listingId);
        setBankOwned(true);
        appAlert(
          'Added to your Library',
          'This study pack — notes, flashcards and questions — is now on all your devices.'
        );
      } else {
        await downloadQuestionBank(listingId);
        setBankOwned(true);
        appAlert(
          'Added to Offline Mode',
          'This question bank is now available offline on all your devices.'
        );
      }
    } catch (e: unknown) {
      appAlert('Error', e instanceof Error ? e.message : 'Could not download this item');
    } finally {
      setDownloadingBank(false);
    }
  };

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
    // initial:false so the chat list sits under this DM — see InquiriesScreen.
    navigation.getParent?.()?.navigate('ChatTab', {
      screen: 'DirectMessage',
      params: { threadId, recipientId, recipientName },
      initial: false,
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
      appAlert('Message sent', 'Opening chat with the seller.');
      const sellerId = result.sellerId || listing.seller_id || listing.user_id;
      const threadId =
        result.threadId ||
        (sellerId && user?.id ? [user.id, sellerId].sort().join('-') : undefined);
      if (threadId && sellerId) {
        openDm(threadId, sellerId, listing.seller?.name);
      }
    } catch (e: unknown) {
      appAlert(
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
    // Every kind charges the list price; Lantern's cut comes out of the seller's
    // payout (5% hand-over, 15% digital). A buyer-side surcharge exists only if
    // the server's rate is non-zero (it defaults to 0), and applies to hand-over
    // items alone — mirrors resolveMarketplaceFees on the server.
    const digital = isDigitalListingKind(listing.listing_kind);
    const surchargeBps = digital ? 0 : paymentsConfig?.serviceFeeBps ?? 0;
    const surcharge = Math.round(itemTotal * surchargeBps) / 10_000;
    const payAmount = Math.round((itemTotal + surcharge) * 100) / 100;
    const quote = `${surcharge > 0 ? `Item: ${formatPrice(itemTotal)}\nService charge (${surchargeBps / 100}%): ${formatPrice(surcharge)}\n` : ''}Total: ${formatPrice(payAmount)}`;
    appAlert(
      'Buy Now',
      digital
        ? `Purchase "${listing.title}"?\n\n${quote}`
        : `Purchase "${listing.title}"${qty > 1 ? ` ×${qty}` : ''}?\n\n${quote}`,
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
              appAlert(
                'Order placed',
                'Arrange pickup or delivery with the seller.'
              );
            } catch (e: unknown) {
              appAlert('Error', e instanceof Error ? e.message : 'Purchase failed');
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
      // Alert, not toast: toastStore's showToast(message, type?) has no action
      // slot, so a toast cannot offer "View cart" — and that tap is the whole
      // point of confirming (Amazon's add-to-cart sheet does the same).
      appAlert('Added to cart', qty > 1 ? `${qty} items added.` : 'Item added to cart.', [
        { text: 'Keep shopping', style: 'cancel' },
        { text: 'View cart', onPress: () => navigation.navigate('Cart') },
      ]);
    } catch (e: unknown) {
      appAlert('Error', e instanceof Error ? e.message : 'Could not add to cart');
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
      appAlert('Coupon applied', `${formatPrice(result.discountAmount)} off`);
    } catch (e: unknown) {
      setCouponPreview(null);
      appAlert('Invalid coupon', e instanceof Error ? e.message : 'Could not apply coupon');
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleBoost = () => {
    if (!listing || !user?.id) return;
    appAlert('Boost listing', 'Boost this listing for 72 hours?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Boost',
        onPress: async () => {
          setActionLoading(true);
          try {
            await boostListing(listing.id, user.id);
            await load();
            appAlert('Boosted', 'Your listing is now boosted for 72 hours.');
          } catch (e: unknown) {
            appAlert('Error', e instanceof Error ? e.message : 'Boost failed');
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
      appAlert('Thanks', 'Your review was submitted.');
    } catch (e: unknown) {
      // Surface the server's reason (e.g. "Reviews are limited to buyers who
      // completed a purchase") instead of a generic failure.
      appAlert('Error', e instanceof Error ? e.message : 'Failed to submit review.');
    } finally {
      setSending(false);
    }
  };

  const handleMarkSold = () => {
    if (!listing || !user?.id) return;
    appAlert('Mark as sold', 'Mark this listing as sold?', [
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
    appAlert('Delete listing', 'This cannot be undone.', [
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
      <Screen bottom="safe">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={brand.text} />
        </View>
      </Screen>
    );
  }

  if (!listing) {
    return (
      <Screen bottom="safe">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-lantern-text mb-4">Listing not found</Text>
          <Button onPress={() => navigation.goBack()}>Go Back</Button>
        </View>
      </Screen>
    );
  }

  const reviewSummary = computeMarketplaceReviewSummary(reviews);
  const avgRating = reviewSummary.average ?? 0;
  const histogramPct = reviewHistogramPercentages(reviewSummary);
  const displayReviews = sortMarketplaceReviews(
    filterReviewsByStar(reviews, reviewStarFilter),
    reviewSort,
  );
  const pricing = listing ? resolveListingDisplayPrice(listing) : null;

  const handleToggleHelpful = async (reviewId: string) => {
    if (votingReviewId) return;
    if (!user?.id) {
      appAlert('Sign in', 'Sign in to mark reviews as helpful.');
      return;
    }
    setVotingReviewId(reviewId);
    try {
      await toggleReviewHelpful(listing.id, reviewId);
    } catch {
      appAlert('Error', 'Could not record that. Please try again.');
    } finally {
      setVotingReviewId(null);
    }
  };
  const crumbs = listingBreadcrumb(listing);
  const specRows = listingSpecRows(listing);
  const rawTypeLabel = listingTypeLabel(listing, category?.name || '');
  /*
   * The breadcrumb already ends with the category this listing sits in
   * ("Lab, Tools & Equipment › Lab instruments for sale"), and the type label
   * below it was frequently that same leaf again, word for word, in a
   * different colour. Say it once.
   */
  const lastCrumb = crumbs.length > 0 ? crumbs[crumbs.length - 1].label : '';
  const typeLabel =
    rawTypeLabel && rawTypeLabel.trim().toLowerCase() === lastCrumb.trim().toLowerCase()
      ? ''
      : rawTypeLabel;

  return (
    <Screen bottom="none">
      <View className="px-4 pt-2 pb-2 flex-row items-center justify-between">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <View className="flex-row items-center gap-1">
          {/* Cart and You on the product page, as on every Amazon page. */}
          <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
          {!own && user?.id ? (
            <Pressable onPress={() => void toggleFavorite(listing.id, user.id)} className="p-2">
              <AppIcon
                name="heart"
                filled={favorited}
                size={22}
                color={favorited ? '#ef4444' : '#64748b'}
              />
            </Pressable>
          ) : null}
          <Pressable onPress={handleShare} className="p-2">
            <AppIcon name="share" size={22} color="#64748b" />
          </Pressable>
          {!own ? (
            <Pressable onPress={() => setShowReport(true)} className="p-2">
              <AppIcon name="flag" size={22} color="#64748b" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: scrollClearanceForActionBar({
            actionBarHeight,
            baseClearance: baseBottomPadding,
          }),
        }}
        keyboardShouldPersistTaps="handled"
      >
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
          {crumbs.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
              <View className="flex-row items-center">
                {crumbs.map((node, index) => (
                  <View key={node.id} className="flex-row items-center">
                    {index > 0 ? (
                      <Text className="text-[11px] text-lantern-text-tertiary mx-1">›</Text>
                    ) : null}
                    <Pressable
                      onPress={() => {
                        if (node.listingCategory) {
                          navigation.navigate('MarketplaceHome');
                        }
                      }}
                    >
                      <Text className="text-[11px] text-lantern-text-secondary">{node.label}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : null}
          {typeLabel ? (
            <Text className="text-xs font-medium text-lantern-primary-text mb-1">
              {typeLabel}
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
            <Text className="text-2xl font-bold text-lantern-primary-text">
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
          {!isDigitalListingKind(listing.listing_kind) ? (
            <View className="flex-row flex-wrap gap-1.5 mt-2">
              {fulfillmentChipLabels(listing, sellerFulfillment ? {
                hall_dropoff_enabled: sellerFulfillment.hallDropoffEnabled,
                shipping_enabled: sellerFulfillment.shippingEnabled,
                shipping_fee_naira: sellerFulfillment.shippingFeeNaira,
              } : { shipping_enabled: false }).map((label) => (
                <View key={label} className="px-2 py-0.5 rounded-full bg-lantern-feature-groups-tint">
                  <Text className="text-label text-lantern-feature-groups-ink">{label}</Text>
                </View>
              ))}
              {sellerFulfillment?.shippingEnabled ? (
                <Text className="text-caption text-lantern-text-secondary self-center">
                  {sellerFulfillment.shippingFeeNaira > 0
                    ? `Ships from ${sellerFulfillment.shipsFromCity || 'campus'} · ₦${sellerFulfillment.shippingFeeNaira.toLocaleString()}`
                    : 'Ships from campus'}
                </Text>
              ) : null}
            </View>
          ) : null}
          {listing.sale_ends_at && pricing?.onSale ? (
            <View className="mt-2">
              <SaleCountdown saleEndsAt={listing.sale_ends_at} />
            </View>
          ) : null}
          {own && isMarketplaceListingModerated(listing.status) ? (
            // Moderation takedown: read-only for the seller (mirrors MyListingsScreen),
            // with the takedown reason + appeal state/one-shot Appeal (Phase 1 · E).
            <ListingTakedownNotice listing={listing} />
          ) : listing.status !== 'active' ? (
            <Text
              className={`text-sm font-semibold mt-2 ${
                isMarketplaceListingModerated(listing.status) ? 'text-red-700 dark:text-red-300' : 'text-amber-600'
              }`}
            >
              {MARKETPLACE_LISTING_STATUS_LABELS[listing.status]}
            </Text>
          ) : null}

          {listing.location ? (
            <View className="flex-row items-center gap-1.5 mt-3">
              <AppIcon name="location" size={16} color="#64748b" />
              <Text className="text-sm text-lantern-text-secondary">{listing.location}</Text>
            </View>
          ) : null}

          {/* Quantity and coupon: read-time choices, next to the price they
              change, rather than stacked in the sticky action bar. */}
          {!own && listing.status === 'active' && !isDigitalListingKind(listing.listing_kind) ? (
            <>
              {listing.price && listing.price > 0 && listing.quantity != null && listing.quantity > 0 ? (
                <View className="flex-row items-center justify-between mt-3">
                  <Text className="text-sm text-lantern-text-secondary">
                    Qty · {listing.quantity} available
                  </Text>
                  <View className="flex-row items-center rounded-lg border border-lantern-border overflow-hidden">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Decrease quantity"
                      className="px-3 py-2"
                      onPress={() => setSelectedQuantity((q) => Math.max(1, q - 1))}
                    >
                      <Text className="text-lantern-text">−</Text>
                    </Pressable>
                    <Text className="px-3 py-2 font-semibold text-lantern-text">
                      {selectedQuantity}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Increase quantity"
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
                <View className="flex-row gap-2 mt-3">
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
            </>
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
              // Digital products are sold by creators — show the creator profile
              // (follows, packs, learners helped) rather than the seller page.
              isDigitalListingKind(listing.listing_kind)
                ? navigation.navigate('CreatorProfile', {
                    userId: listing.user_id || listing.seller_id,
                  })
                : navigation.navigate('SellerProfile', {
                    sellerId: listing.seller_id || listing.user_id,
                  })
            }
            className="flex-row items-center gap-3 mt-4 p-3 rounded-2xl bg-lantern-surface border border-lantern-border"
          >
            <Avatar name={listing.seller?.name || 'Anonymous Seller'} size={44} />
            <View className="flex-1">
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
                  {listing.seller?.name || 'Anonymous Seller'}
                </Text>
                {/* Phase 3 N — see the web screen for why 'new' shows no chip. */}
                {shouldShowTrustChip((listing.seller as { trustLevel?: string } | undefined)?.trustLevel) ? (
                  <View className="rounded-full bg-lantern-primary/15 px-2 py-0.5">
                    <Text className="text-[11px] font-semibold text-lantern-primary-text">
                      {trustLabel((listing.seller as { trustLevel?: string } | undefined)?.trustLevel)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-xs text-lantern-text-secondary">
                {reviews.length > 0
                  ? `${avgRating.toFixed(1)} · ${reviews.length} review${reviews.length === 1 ? '' : 's'}`
                  : 'View seller profile'}
              </Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color="#94a3b8" />
          </Pressable>

          <Card className="mt-4">
            <Text className="text-sm font-semibold text-lantern-text mb-2">Description</Text>
            <Text className="text-sm text-lantern-text-secondary leading-5">
              {listing.description?.trim() || 'No description provided.'}
            </Text>
          </Card>

          {specRows.length > 0 ? (
            <Card className="mt-4">
              <Text className="text-sm font-semibold text-lantern-text mb-2">About this item</Text>
              <View className="flex-row flex-wrap gap-2">
                {specRows.map(row => (
                  <View key={row.key} className="w-[47%] bg-lantern-background-secondary rounded-lg px-3 py-2">
                    <Text className="text-[11px] text-lantern-text-secondary">{row.label}</Text>
                    <Text className="text-sm font-medium text-lantern-text">{row.value}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {bankPreview && bankPreview.questions.length > 0 ? (
            <Card className="mt-4">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-sm font-semibold text-lantern-text">Sample questions</Text>
                <Text className="text-xs text-lantern-text-tertiary">
                  {bankPreview.previewCount} of {bankPreview.questionCount}
                </Text>
              </View>
              {bankPreview.questions.map((question, index) => (
                <View
                  key={question.id || index}
                  className="mb-2 rounded-xl border border-lantern-border p-3"
                >
                  <Text className="text-sm font-medium text-lantern-text">
                    {index + 1}. {question.questionStem || question.text || 'Question'}
                  </Text>
                  {question.options?.map((option, optionIndex) => (
                    <Text
                      key={option.id || optionIndex}
                      className="mt-1 text-xs text-lantern-text-secondary"
                    >
                      {String.fromCharCode(65 + optionIndex)}. {option.text}
                    </Text>
                  ))}
                </View>
              ))}
              <Text className="text-xs text-lantern-text-tertiary">
                Answers and explanations come with the full bank.
              </Text>
            </Card>
          ) : null}

          {studyPackPreview ? (
            <Card className="mt-4">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-sm font-semibold text-lantern-text">What's inside</Text>
                <Text className="text-xs text-lantern-text-tertiary">
                  {summarizeStudyPackCounts(studyPackPreview.counts)}
                </Text>
              </View>

              {studyPackPreview.toc.length > 0 ? (
                <View className="mb-3">
                  <Text className="text-xs font-semibold uppercase text-lantern-text-secondary mb-1">
                    Study guide
                  </Text>
                  {studyPackPreview.toc.slice(0, 8).map((entry, index) => (
                    <Text key={entry.anchor || index} className="text-sm text-lantern-text-secondary">
                      {index + 1}. {entry.title}
                    </Text>
                  ))}
                </View>
              ) : null}

              {studyPackPreview.summaryPreview ? (
                <View className="mb-3">
                  <Text className="text-xs font-semibold uppercase text-lantern-text-secondary mb-1">
                    Summary preview
                  </Text>
                  <Text className="text-sm text-lantern-text-secondary leading-5">
                    {studyPackPreview.summaryPreview}
                    {studyPackPreview.summaryPreview.length >= 600 ? '…' : ''}
                  </Text>
                </View>
              ) : null}

              {studyPackPreview.flashcardFronts.length > 0 ? (
                <View className="mb-3">
                  <Text className="text-xs font-semibold uppercase text-lantern-text-secondary mb-1">
                    Sample flashcards
                  </Text>
                  {studyPackPreview.flashcardFronts.map((front, index) => (
                    <View
                      key={`${index}-${front.slice(0, 24)}`}
                      className="mb-2 overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface"
                    >
                      <View className="h-[3px] bg-lantern-feature-flashcards-ink" />
                      <View className="flex-row items-start gap-3 px-3 py-3">
                        <FeatureDisc feature="flashcards" icon="layers" size={32} />
                        <View className="flex-1 min-w-0">
                          <Text className="text-label font-semibold uppercase tracking-wider text-lantern-feature-flashcards-ink">
                            Question
                          </Text>
                          <Text className="mt-1 text-body text-lantern-text" numberOfLines={3}>
                            {front}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              {studyPackPreview.questions.length > 0 ? (
                <View>
                  <Text className="text-xs font-semibold uppercase text-lantern-text-secondary mb-1">
                    Sample questions
                  </Text>
                  {studyPackPreview.questions.map((question, index) => (
                    <View
                      key={question.id || index}
                      className="mb-2 rounded-xl border border-lantern-border p-3"
                    >
                      <Text className="text-sm font-medium text-lantern-text">
                        {index + 1}. {question.questionStem || question.text || 'Question'}
                      </Text>
                      {question.options?.map((option, optionIndex) => (
                        <Text
                          key={option.id || optionIndex}
                          className="mt-1 text-xs text-lantern-text-secondary"
                        >
                          {String.fromCharCode(65 + optionIndex)}. {option.text}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              <Text className="text-xs text-lantern-text-tertiary mt-1">
                The full guide, flashcards and questions — with answers — come with the pack.
              </Text>
            </Card>
          ) : null}

          <Card className="mt-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm font-semibold text-lantern-text">Reviews</Text>
              {!own && canReview ? (
                <Pressable onPress={() => setShowReview(true)}>
                  <Text className="text-sm font-semibold text-lantern-primary-text">Write review</Text>
                </Pressable>
              ) : !own && user?.id ? (
                <Text className="text-xs text-lantern-text-tertiary max-w-[160px] text-right">
                  Reviews open after a completed purchase
                </Text>
              ) : null}
            </View>
            {reviewSummary.count > 0 ? (
              <View className="flex-row gap-4 mb-3">
                <View className="items-center justify-center">
                  <Text className="text-2xl font-bold text-lantern-text">
                    {avgRating.toFixed(1)}
                  </Text>
                  <StarRow rating={Math.round(avgRating)} />
                  <Text className="text-[11px] text-lantern-text-tertiary mt-0.5">
                    {reviewSummary.count} rating{reviewSummary.count === 1 ? '' : 's'}
                  </Text>
                </View>
                <View className="flex-1 justify-center" accessibilityLabel="Reviews by star rating">
                  {[5, 4, 3, 2, 1].map(star => {
                    const bucketCount = reviewSummary.histogram[star - 1] ?? 0;
                    const pct = histogramPct[star - 1] ?? 0;
                    const active = reviewStarFilter === star;
                    return (
                      <Pressable
                        key={star}
                        disabled={bucketCount === 0 && !active}
                        onPress={() => setReviewStarFilter(active ? null : star)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${star} star: ${bucketCount} review${bucketCount === 1 ? '' : 's'}`}
                        className={`flex-row items-center gap-1.5 py-0.5 ${bucketCount === 0 && !active ? 'opacity-40' : ''}`}
                      >
                        <Text className="w-3 text-[11px] text-lantern-text-secondary">{star}</Text>
                        <AppIcon name="star" size={9} color="#f59e0b" />
                        <View className="flex-1 h-1.5 rounded-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary overflow-hidden">
                          <View
                            className={`h-full rounded-full ${active ? 'bg-lantern-primary-fill' : 'bg-amber-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </View>
                        <Text className="w-8 text-right text-label text-lantern-text-tertiary">{pct}%</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {reviewSummary.count > 1 || reviewStarFilter !== null ? (
              <View className="flex-row flex-wrap items-center gap-1.5 mb-2">
                {reviewSummary.count > 1
                  ? (Object.keys(REVIEW_SORT_LABELS) as ReviewSortOption[]).map(option => (
                      <Pressable
                        key={option}
                        onPress={() => setReviewSort(option)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: reviewSort === option }}
                        className={`px-2 py-1 rounded-full ${
                          reviewSort === option
                            ? 'bg-lantern-primary-fill'
                            : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary'
                        }`}
                      >
                        <Text
                          className={`text-label font-medium ${
                            reviewSort === option ? 'text-white' : 'text-lantern-text-secondary'
                          }`}
                        >
                          {REVIEW_SORT_LABELS[option]}
                        </Text>
                      </Pressable>
                    ))
                  : null}
                {reviewStarFilter !== null ? (
                  <Pressable
                    onPress={() => setReviewStarFilter(null)}
                    accessibilityRole="button"
                    accessibilityLabel={`Showing ${reviewStarFilter}-star reviews only. Clear filter`}
                    className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-lantern-primary/15"
                  >
                    <Text className="text-label font-semibold text-lantern-primary-text">
                      {reviewStarFilter}-star only
                    </Text>
                    <AppIcon name="close" size={11} color={brand.text} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {reviews.length === 0 ? (
              <Text className="text-sm text-lantern-text-secondary">No reviews yet.</Text>
            ) : displayReviews.length === 0 ? (
              <Text className="text-sm text-lantern-text-secondary py-2">
                No {reviewStarFilter}-star reviews.
              </Text>
            ) : (
              displayReviews.map(review => (
                <View
                  key={review.id}
                  className="py-3 border-t border-lantern-border first:border-t-0 first:pt-0"
                >
                  <View className="flex-row items-center justify-between mb-1">
                    <View className="flex-1 flex-row items-center gap-1.5 flex-wrap pr-2">
                      <Text className="text-sm font-medium text-lantern-text">
                        {review.reviewer?.name || review.reviewer?.username || 'User'}
                      </Text>
                      {review.verifiedPurchase ? (
                        <View className="flex-row items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5">
                          <AppIcon name="checkmark-circle" size={10} color="#059669" />
                          <Text className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            Verified purchase
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <StarRow rating={review.rating} />
                  </View>
                  {review.comment ? (
                    <Text className="text-sm text-lantern-text-secondary">{review.comment}</Text>
                  ) : null}
                  {typeof review.helpfulCount === 'number' ? (
                    review.reviewer_id === user?.id ? (
                      review.helpfulCount > 0 ? (
                        <Text className="text-[11px] text-lantern-text-tertiary mt-1.5">
                          {review.helpfulCount}{' '}
                          {review.helpfulCount === 1 ? 'person' : 'people'} found this helpful
                        </Text>
                      ) : null
                    ) : (
                      <Pressable
                        onPress={() => void handleToggleHelpful(review.id)}
                        disabled={votingReviewId === review.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: !!review.viewerMarkedHelpful }}
                        className={`self-start mt-1.5 px-2.5 py-1 rounded-full border ${
                          review.viewerMarkedHelpful
                            ? 'border-lantern-primary bg-lantern-primary/10'
                            : 'border-lantern-border'
                        } ${votingReviewId === review.id ? 'opacity-60' : ''}`}
                      >
                        <Text
                          className={`text-[11px] ${
                            review.viewerMarkedHelpful
                              ? 'text-lantern-primary-text font-semibold'
                              : 'text-lantern-text-secondary'
                          }`}
                        >
                          Helpful{(review.helpfulCount ?? 0) > 0 ? ` (${review.helpfulCount})` : ''}
                        </Text>
                      </Pressable>
                    )
                  ) : null}
                </View>
              ))
            )}
          </Card>

          {similarListings.length > 0 ? (
            <View className="mt-4">
              <Text className="text-sm font-semibold text-lantern-text mb-3">
                Related on campus
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
                      <Text className="text-xs font-semibold text-lantern-primary-text mt-1">
                        {formatPrice(item.price)}
                      </Text>
                      {(item.rating_count ?? 0) > 0 && item.rating_avg != null ? (
                        <View className="flex-row items-center gap-0.5 mt-0.5">
                          <AppIcon name="star" size={10} color="#f59e0b" />
                          <Text className="text-label text-lantern-text-secondary">
                            {Number(item.rating_avg).toFixed(1)} ({item.rating_count})
                          </Text>
                        </View>
                      ) : null}
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

      {/* Digital products (question banks, study packs): own bar — no cart, no offers, instant delivery. */}
      {!own && listing.status === 'active' && isDigitalListingKind(listing.listing_kind) ? (
        <StickyActionBar
          bottomExtra={24}
          onHeightChange={setActionBarHeight}
          className="absolute left-0 right-0 px-4 pt-3 bg-lantern-surface border-t border-lantern-border"
        >
          {bankOwned ? (
            <>
              <Text className="text-xs text-emerald-700 mb-2">
                {listing.listing_kind === 'study_pack'
                  ? 'You own this study pack — find it in your Library.'
                  : 'You own this question bank — find it in Offline Mode.'}
              </Text>
              <Button
                variant="secondary"
                loading={downloadingBank}
                onPress={() => void handleDownloadBank()}
              >
                Download again
              </Button>
            </>
          ) : listing.price && listing.price > 0 ? (
            <>
              <Text className="text-xs text-lantern-text-secondary mb-2">
                {listing.listing_kind === 'study_pack'
                  ? 'Pay in the app and your study pack is delivered instantly to your Library.'
                  : 'Pay in the app and your question bank is delivered instantly to Offline Mode.'}
              </Text>
              <Pressable
                onPress={handleBuyNow}
                disabled={actionLoading}
                className="min-h-[44px] rounded-xl items-center justify-center bg-lantern-feature-groups-ink"
              >
                <Text className="text-body font-semibold text-white">
                  {actionLoading ? 'Starting…' : 'Buy now'}
                </Text>
              </Pressable>
            </>
          ) : (
            <Button loading={downloadingBank} onPress={() => void handleDownloadBank()}>
              Download free
            </Button>
          )}
        </StickyActionBar>
      ) : null}

      {!own && listing.status === 'active' && !isDigitalListingKind(listing.listing_kind) ? (
        <StickyActionBar
          bottomExtra={24}
          onHeightChange={setActionBarHeight}
          className="absolute left-0 right-0 px-4 pt-3 bg-lantern-surface border-t border-lantern-border"
        >
          {/* Quantity and the coupon field used to live HERE, which made this
              bar four rows tall — roughly a third of the screen, permanently,
              over every listing. They are not actions: they are choices you
              make while reading, so they moved up into the page beside the
              price. The bar is what is left: the things you press when you
              have decided. The applied-coupon line stays, because it changes
              what "Buy Now" will charge. */}
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
              <Pressable
                onPress={handleBuyNow}
                disabled={actionLoading}
                className="flex-1 min-h-[44px] rounded-xl items-center justify-center bg-lantern-feature-groups-ink"
              >
                <Text className="text-body font-semibold text-white">
                  {actionLoading ? 'Starting…' : 'Buy now'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </StickyActionBar>
      ) : null}

      {own && listing.status === 'active' ? (
        <StickyActionBar
          bottomExtra={24}
          onHeightChange={setActionBarHeight}
          className="absolute left-0 right-0 px-4 pt-3 bg-lantern-surface border-t border-lantern-border"
        >
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
        </StickyActionBar>
      ) : null}

      {/* Bottom-anchored sheets sit exactly where the keyboard lands, so the
          message box and its Send button were covered outright. */}
      <Modal visible={showContact} transparent animationType="slide" onRequestClose={() => setShowContact(false)}>
        <KeyboardAvoidingView
          behavior={SCREEN_KEYBOARD_BEHAVIOR}
          className="flex-1 justify-end bg-black/40"
        >
          <View className="bg-lantern-surface rounded-t-3xl p-5" style={{ paddingBottom: insets.bottom + 20 }}>
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
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showReview} transparent animationType="slide" onRequestClose={() => setShowReview(false)}>
        <KeyboardAvoidingView
          behavior={SCREEN_KEYBOARD_BEHAVIOR}
          className="flex-1 justify-end bg-black/40"
        >
          <View className="bg-lantern-surface rounded-t-3xl p-5" style={{ paddingBottom: insets.bottom + 20 }}>
            <Text className="text-lg font-bold text-lantern-text mb-3">Write a review</Text>
            <View className="flex-row gap-2 mb-4">
              {[1, 2, 3, 4, 5].map(i => (
                <Pressable key={i} onPress={() => setReviewRating(i)}>
                  <AppIcon name="star" filled={i <= reviewRating} size={28} color="#f59e0b" />
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
        </KeyboardAvoidingView>
      </Modal>

      <ReportContentSheet
        visible={showReport}
        targetType={listing.listing_kind === 'question_bank' ? 'question_bank' : 'listing'}
        targetId={listing.id}
        targetLabel={listing.title}
        onClose={() => setShowReport(false)}
      />
    </Screen>
  );
}
