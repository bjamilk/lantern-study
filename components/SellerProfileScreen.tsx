import React, { useState, useEffect } from 'react';
import { fetchSellerProfile } from '../services/supabase';
import { SellerProfile, MarketplaceListing, MarketplaceReview } from '../types';
import {
  ArrowLeftIcon,
  StarIcon,
  ShoppingBagIcon,
  EyeIcon,
  ChatBubbleLeftEllipsisIcon,
  HeartIcon,
  CheckBadgeIcon,
  ClockIcon,
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
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex-1 flex flex-col bg-lantern-background overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-br from-lantern-primary via-lantern-primary-dark to-purple-700 px-4 py-5">
        <button onClick={onBack} className="flex items-center gap-1.5 text-white/90 hover:text-white mb-4 transition-colors">
          <ArrowLeftIcon className="w-4 h-4" />
          <span className="text-sm font-medium">Back</span>
        </button>

        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-lantern-surface/20 flex items-center justify-center text-white text-2xl font-bold ring-2 ring-white/30 overflow-hidden flex-shrink-0">
            {profile.user.avatar_url ? (
              <img src={profile.user.avatar_url} alt={profile.user.name} className="w-full h-full object-cover" />
            ) : (
              profile.user.name?.charAt(0)?.toUpperCase() || '?'
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white truncate">{profile.user.name}</h1>
              {(profile as any).stats?.isVerified && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-100 text-xs font-semibold ring-1 ring-emerald-300/30">
                  <CheckBadgeIcon className="w-3.5 h-3.5" />
                  Verified Seller
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-0.5">{renderStars(profile.stats.avgRating)}</div>
              <span className="text-sm text-white/85">
                {profile.stats.avgRating > 0 ? profile.stats.avgRating.toFixed(1) : 'No ratings'}
                {profile.stats.totalReviews > 0 && ` (${profile.stats.totalReviews})`}
              </span>
            </div>
            <p className="text-xs text-white/80 mt-0.5 flex items-center gap-1">
              <ClockIcon className="w-3 h-3" />
              Member since {memberSince(profile.user.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Listings', value: profile.stats.totalListings, icon: ShoppingBagIcon, color: 'text-lantern-primary bg-lantern-primary-background dark:text-lantern-primary-light' },
            { label: 'Total Views', value: profile.stats.totalViews, icon: EyeIcon, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400' },
            { label: 'Inquiries', value: profile.stats.totalInquiries, icon: ChatBubbleLeftEllipsisIcon, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400' },
          ].map(stat => (
            <div key={stat.label} className="bg-lantern-surface rounded-xl p-3 ring-1 ring-lantern-border/60 text-center">
              <div className={`mx-auto w-8 h-8 rounded-lg flex items-center justify-center mb-1.5 ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-lantern-text">{stat.value.toLocaleString()}</p>
              <p className="text-xs text-lantern-text-secondary">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Active', value: profile.stats.activeListings },
            { label: 'Sold', value: profile.stats.soldListings },
            { label: 'Favourites', value: profile.stats.totalFavorites },
          ].map(stat => (
            <div key={stat.label} className="bg-lantern-surface rounded-xl p-3 ring-1 ring-lantern-border/60 text-center">
              <p className="text-lg font-bold text-lantern-text">{stat.value.toLocaleString()}</p>
              <p className="text-xs text-lantern-text-secondary">{stat.label}</p>
            </div>
          ))}
        </div>

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

        {/* Active Listings */}
        {profile.recentListings.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-lantern-text mb-3 flex items-center gap-1.5">
              <ShoppingBagIcon className="w-4 h-4 text-emerald-500" />
              Active Listings ({profile.stats.activeListings})
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
