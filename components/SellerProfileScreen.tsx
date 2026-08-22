import React, { useState, useEffect } from 'react';
import { fetchSellerProfile } from '../services/supabase';
import { SellerProfile, MarketplaceListing, MarketplaceReview } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { shareShopLink } from '../utils/shareShop';
import EditShopModal from './EditShopModal';
import ReportContentModal from './moderation/ReportContentModal';
import {
  ArrowLeftIcon,
  StarIcon,
  ShoppingBagIcon,
  EyeIcon,
  ChatBubbleLeftEllipsisIcon,
  HeartIcon,
  CheckBadgeIcon,
  ClockIcon,
  PencilSquareIcon,
  ShareIcon,
  FlagIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';

interface SellerProfileScreenProps {
  userId: string;
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
  guestMode?: boolean;
  onSignInRequired?: () => void;
}

const SellerProfileScreen: React.FC<SellerProfileScreenProps> = ({
  userId,
  onBack,
  onNavigate,
  guestMode = false,
  onSignInRequired,
}) => {
  const { currentUser } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const isOwner = !!currentUser?.id && currentUser.id === userId;

  useEffect(() => {
    loadProfile();
  }, [userId]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSellerProfile(userId);
      setProfile(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load seller profile');
    } finally {
      setLoading(false);
    }
  };

  const memberSince = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) =>
      i < Math.round(rating) ? (
        <StarSolidIcon key={i} className="w-4 h-4 text-amber-400" />
      ) : (
        <StarIcon key={i} className="w-4 h-4 text-lantern-text-tertiary" />
      )
    );
  };

  const handleListingClick = (listing: MarketplaceListing) => {
    onNavigate('MarketplaceListingDetail', { listingId: listing.id });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-lantern-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lantern-primary" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-lantern-background p-6">
        <p className="text-red-500 text-center mb-4">{error || 'Profile not found'}</p>
        <button onClick={onBack} className="text-lantern-primary font-medium hover:underline">Go Back</button>
      </div>
    );
  }

  const shopName = profile.shop?.shopName || profile.user?.name || 'Shop';
  const coverUrl = profile.shop?.coverImageUrl
    ? normalizeStorageUrl(profile.shop.coverImageUrl)
    : null;

  const handleShare = async () => {
    try {
      const result = await shareShopLink(userId, shopName);
      if (result === 'copied') showToast('Shop link copied', 'success');
    } catch (err: any) {
      if (err?.name !== 'AbortError') showToast('Could not share shop link', 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-lantern-background overflow-hidden">
      {/* Cover + shop header */}
      <div className="relative">
        <div
          className={`h-28 sm:h-36 w-full ${
            coverUrl
              ? 'bg-lantern-background-secondary'
              : 'bg-gradient-to-br from-lantern-primary via-lantern-primary-dark to-emerald-800'
          }`}
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        </div>
        <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-white/95 hover:text-white transition-colors bg-black/25 rounded-lg px-2 py-1.5"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </button>
          <div className="flex items-center gap-1.5">
            {isOwner ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/30 text-white text-xs font-semibold"
              >
                <PencilSquareIcon className="w-3.5 h-3.5" />
                Edit shop
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleShare()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/30 text-white text-xs font-semibold"
            >
              <ShareIcon className="w-3.5 h-3.5" />
              Share
            </button>
            {!isOwner ? (
              <button
                type="button"
                onClick={() => {
                  if (guestMode || !currentUser?.id) {
                    onSignInRequired?.();
                    return;
                  }
                  setReportOpen(true);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/30 text-white text-xs font-semibold hover:bg-red-600/70"
                aria-label="Report this seller"
                title="Report this seller"
              >
                <FlagIcon className="w-3.5 h-3.5" />
                Report
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 -mt-8 relative z-[1]">
        <div className="flex items-end gap-3">
          <div className="w-16 h-16 rounded-2xl bg-lantern-surface flex items-center justify-center text-lantern-primary text-2xl font-bold ring-2 ring-white dark:ring-lantern-border overflow-hidden flex-shrink-0 shadow-md">
            {profile.user.avatar_url ? (
              <img src={profile.user.avatar_url} alt={shopName} className="w-full h-full object-cover" />
            ) : (
              shopName?.charAt(0)?.toUpperCase() || '?'
            )}
          </div>
          <div className="min-w-0 pb-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-lantern-text truncate">{shopName}</h1>
              {(profile as any).stats?.isVerified && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                  <CheckBadgeIcon className="w-3.5 h-3.5" />
                  Verified
                </span>
              )}
            </div>
            {profile.user?.name && shopName !== profile.user.name ? (
              <p className="text-xs text-lantern-text-secondary truncate">by {profile.user.name}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex items-center gap-0.5">{renderStars(profile.stats.avgRating)}</div>
          <span className="text-sm text-lantern-text-secondary">
            {profile.stats.avgRating > 0 ? profile.stats.avgRating.toFixed(1) : 'No ratings'}
            {profile.stats.totalReviews > 0 && ` (${profile.stats.totalReviews})`}
          </span>
        </div>
        {profile.shop?.bio ? (
          <p className="text-sm text-lantern-text-secondary mt-2 leading-relaxed">{profile.shop.bio}</p>
        ) : null}
        <p className="text-xs text-lantern-text-tertiary mt-1.5 flex items-center gap-1">
          <ClockIcon className="w-3 h-3" />
          Member since {memberSince(profile.user.created_at)}
        </p>
      </div>

      <EditShopModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{
          shopName,
          bio: profile.shop?.bio ?? null,
          coverImageUrl: profile.shop?.coverImageUrl ?? null,
        }}
        onSaved={(shop) => {
          setProfile((prev) => (prev ? { ...prev, shop } : prev));
          showToast('Shop updated', 'success');
        }}
      />
      {!isOwner && reportOpen ? (
        <ReportContentModal
          isOpen={reportOpen}
          onClose={() => setReportOpen(false)}
          targetType="user"
          targetId={userId}
          targetLabel={shopName}
        />
      ) : null}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: 'Active',
              value: profile.stats.activeListings ?? 0,
              icon: ShoppingBagIcon,
              color: 'text-lantern-primary bg-lantern-primary-background dark:text-lantern-primary-light',
            },
            {
              label: 'Reviews',
              value: profile.stats.totalReviews ?? 0,
              icon: StarIcon,
              color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400',
            },
            isOwner
              ? {
                  label: 'Views',
                  value: profile.stats.totalViews ?? 0,
                  icon: EyeIcon,
                  color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400',
                }
              : {
                  label: 'Listings',
                  value: profile.stats.activeListings ?? 0,
                  icon: HeartIcon,
                  color: 'text-rose-600 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-400',
                },
          ].map((stat) => (
            <div key={stat.label} className="bg-lantern-surface rounded-xl p-3 ring-1 ring-lantern-border/60 text-center">
              <div className={`mx-auto w-8 h-8 rounded-lg flex items-center justify-center mb-1.5 ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-lantern-text">{Number(stat.value || 0).toLocaleString()}</p>
              <p className="text-xs text-lantern-text-secondary">{stat.label}</p>
            </div>
          ))}
        </div>

        {isOwner ? (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total', value: profile.stats.totalListings },
              { label: 'Sold', value: profile.stats.soldListings },
              { label: 'Inquiries', value: profile.stats.totalInquiries },
            ].map((stat) => (
              <div key={stat.label} className="bg-lantern-surface rounded-xl p-3 ring-1 ring-lantern-border/60 text-center">
                <p className="text-lg font-bold text-lantern-text">{Number(stat.value || 0).toLocaleString()}</p>
                <p className="text-xs text-lantern-text-secondary">{stat.label}</p>
              </div>
            ))}
          </div>
        ) : null}

        {(profile as any).stats?.isVerified && (
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <CheckBadgeIcon className="w-5 h-5" />
            <p className="text-sm font-medium">
              This seller is verified based on consistent sales activity, strong review quality, and listing history.
            </p>
          </div>
        )}

        {/* Badges */}
        {profile.badges.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-lantern-text mb-3 flex items-center gap-1.5">
              <CheckBadgeIcon className="w-4 h-4 text-lantern-primary" />
              Marketplace Badges
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile.badges.map(badge => (
                <div
                  key={badge.id}
                  className="inline-flex items-center gap-1.5 bg-gradient-to-r from-lantern-primary-background to-purple-50 dark:from-lantern-primary-background dark:to-purple-900/20 px-3 py-1.5 rounded-full ring-1 ring-lantern-primary/20 dark:ring-lantern-primary/30"
                >
                  <span className="text-sm">{badge.icon}</span>
                  <span className="text-xs font-semibold text-lantern-primary">{badge.name}</span>
                  <span className="text-[10px] text-lantern-primary">Lv.{badge.level}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shop listings (active + reserved for owner) */}
        {profile.recentListings.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-lantern-text mb-3 flex items-center gap-1.5">
              <ShoppingBagIcon className="w-4 h-4 text-emerald-500" />
              {isOwner ? 'Shop listings' : 'Active Listings'} ({profile.recentListings.length})
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {profile.recentListings.map(listing => (
                <button
                  key={listing.id}
                  onClick={() => handleListingClick(listing)}
                  className="bg-lantern-surface rounded-xl overflow-hidden ring-1 ring-lantern-border/60 hover:ring-lantern-primary/30 transition-all text-left group"
                >
                  <div className="aspect-[4/3] bg-lantern-background-secondary dark:bg-lantern-surface-secondary relative">
                    {listing.images && listing.images.length > 0 ? (
                      <img src={listing.images[0]} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBagIcon className="w-8 h-8 text-lantern-text-tertiary" />
                      </div>
                    )}
                    {listing.status === 'reserved' ? (
                      <span className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-900 dark:bg-amber-900/80 dark:text-amber-100">
                        Sale in progress
                      </span>
                    ) : null}
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm font-semibold text-lantern-text line-clamp-1 group-hover:text-lantern-primary transition-colors">{listing.title}</p>
                    <p className="text-base font-bold text-lantern-primary mt-0.5">
                      {listing.price ? `₦${listing.price.toLocaleString()}` : 'Free'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
            {isOwner ? (
              <button
                type="button"
                onClick={() => onNavigate('MarketplaceOrders')}
                className="mt-3 text-sm font-semibold text-lantern-primary hover:underline"
              >
                View orders & receipts
              </button>
            ) : null}
          </div>
        )}

        {/* Reviews */}
        <div>
          <h2 className="text-sm font-semibold text-lantern-text mb-3 flex items-center gap-1.5">
            <StarIcon className="w-4 h-4 text-amber-500" />
            Reviews ({profile.stats.totalReviews})
          </h2>
          {profile.recentReviews.length > 0 ? (
            <div className="space-y-3">
              {profile.recentReviews.map(review => (
                <div key={review.id} className="bg-lantern-surface rounded-xl p-4 ring-1 ring-lantern-border/60">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="flex">{renderStars(review.rating)}</div>
                        <span className="text-xs text-lantern-text-secondary font-medium">{review.rating}/5</span>
                      </div>
                      {(review as any).listing_title && (
                        <p className="text-xs text-lantern-primary mt-1 font-medium truncate">
                          Re: {(review as any).listing_title}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-lantern-text-tertiary flex-shrink-0">{new Date(review.created_at).toLocaleDateString()}</p>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-lantern-text-secondary mt-2 leading-relaxed">{review.comment}</p>
                  )}
                  {review.reviewer && (
                    <p className="text-xs text-lantern-text-tertiary mt-2">— {review.reviewer.name}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-lantern-surface rounded-xl p-6 text-center ring-1 ring-lantern-border/60">
              <StarIcon className="w-8 h-8 mx-auto text-lantern-text-tertiary mb-2" />
              <p className="text-sm text-lantern-text-secondary">No reviews yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SellerProfileScreen;
