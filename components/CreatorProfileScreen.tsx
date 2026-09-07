import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchCreatorProfile,
  followCreator,
  unfollowCreator,
  type CreatorProfile,
} from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import { AppIcon } from './ui/AppIcon';

interface Props {
  userId: string;
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
  currentUserId?: string;
}

const TRUST_LABEL: Record<string, string> = {
  new: 'New creator',
  rising: 'Rising creator',
  trusted: 'Trusted creator',
  verified: 'Verified creator',
};

/**
 * A creator's public profile: who they are academically, what they've made and
 * how many students they've helped. Never shows earnings (SEC-08).
 */
export const CreatorProfileScreen: React.FC<Props> = ({ userId, onBack, onNavigate, currentUserId }) => {
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showToast = useToastStore((s) => s.showToast);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProfile(await fetchCreatorProfile(userId));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load this creator.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFollow = async () => {
    if (!profile) return;
    const next = !profile.isFollowing;
    setBusy(true);
    // Optimistic: the counter and the button should move together.
    setProfile({
      ...profile,
      isFollowing: next,
      stats: {
        ...profile.stats,
        followerCount: Math.max(0, profile.stats.followerCount + (next ? 1 : -1)),
      },
    });
    try {
      if (next) await followCreator(userId);
      else await unfollowCreator(userId);
    } catch (e: any) {
      showToast(e?.message || 'Could not update follow.', 'error');
      void load();
    } finally {
      setBusy(false);
    }
  };

  const isSelf = currentUserId === userId;

  return (
    <div className="min-h-full bg-lantern-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary transition-colors"
            aria-label="Back"
          >
            <AppIcon name="arrow-back" size={20} />
          </button>
          <h1 className="text-lg font-bold text-lantern-text">Creator</h1>
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-28 rounded-2xl bg-lantern-background-secondary animate-pulse" />
            <div className="h-20 rounded-2xl bg-lantern-background-secondary animate-pulse" />
          </div>
        ) : error || !profile ? (
          <div className="rounded-xl border border-lantern-error/30 bg-lantern-error/5 p-4 text-sm text-lantern-error">
            {error || 'Creator not found.'}
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-lantern-border bg-lantern-surface p-5">
              <div className="flex items-start gap-4">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt=""
                    className="w-16 h-16 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-lantern-primary-background flex items-center justify-center shrink-0">
                    <span className="text-xl font-bold text-lantern-primary">
                      {profile.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold text-lantern-text truncate">{profile.name}</h2>
                    {profile.isVerified && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-lantern-primary/10 px-2 py-0.5 text-[11px] font-semibold text-lantern-primary"
                        title="Confirmed email and an active payout account"
                      >
                        <AppIcon name="badge-check" size={14} /> Verified
                      </span>
                    )}
                    <span className="rounded-full bg-lantern-background-secondary px-2 py-0.5 text-[11px] font-semibold text-lantern-text-secondary">
                      {TRUST_LABEL[profile.trustLevel] || 'New creator'}
                    </span>
                  </div>
                  {profile.username && (
                    <p className="text-sm text-lantern-text-tertiary">@{profile.username}</p>
                  )}
                  {(profile.institution || profile.programme || profile.studyLevel) && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-lantern-text-secondary">
                      <AppIcon name="school" size={16} className="shrink-0" />
                      <span className="truncate">
                        {[profile.institution, profile.programme, profile.studyLevel ? `${profile.studyLevel}L` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </p>
                  )}
                  {profile.bio && (
                    <p className="mt-2 text-sm text-lantern-text whitespace-pre-wrap">{profile.bio}</p>
                  )}
                </div>
                {!isSelf && (
                  <button
                    onClick={() => void toggleFollow()}
                    disabled={busy}
                    className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                      profile.isFollowing
                        ? 'bg-lantern-background-secondary text-lantern-text hover:bg-lantern-border'
                        : 'bg-lantern-primary hover:bg-lantern-primary-dark text-white'
                    }`}
                  >
                    {profile.isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Packs', value: profile.stats.activePacks, icon: 'albums' as const },
                  { label: 'Learners helped', value: profile.stats.learnersHelped, icon: 'people' as const },
                  {
                    label: 'Rating',
                    value: profile.stats.reviewCount > 0 ? profile.stats.avgRating.toFixed(1) : '—',
                    icon: 'star' as const,
                  },
                  { label: 'Followers', value: profile.stats.followerCount, icon: 'people' as const },
                ].map(({ label, value, icon }) => (
                  <div
                    key={label}
                    className="rounded-xl bg-lantern-background-secondary/60 px-3 py-2.5 text-center"
                  >
                    <AppIcon name={icon} size={16} className="mx-auto text-lantern-text-tertiary mb-1" />
                    <p className="text-base font-bold text-lantern-text tabular-nums">{value}</p>
                    <p className="text-[11px] text-lantern-text-tertiary">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <h3 className="mt-6 mb-3 text-sm font-semibold text-lantern-text">
              Study products {profile.packs.length > 0 ? `(${profile.packs.length})` : ''}
            </h3>
            {profile.packs.length === 0 ? (
              <p className="text-sm text-lantern-text-secondary">
                This creator hasn't published anything yet.
              </p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {profile.packs.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => onNavigate('MarketplaceListingDetail', { listingId: p.id })}
                      className="w-full text-left rounded-xl border border-lantern-border bg-lantern-surface p-3 hover:border-lantern-primary/40 transition-colors"
                    >
                      <p className="text-sm font-semibold text-lantern-text truncate">{p.title}</p>
                      <p className="text-xs text-lantern-text-tertiary mt-0.5">
                        {p.listingKind === 'study_pack' ? 'Study Pack' : 'Question Bank'} ·{' '}
                        {p.price && p.price > 0 ? `₦${Number(p.price).toLocaleString()}` : 'Free'}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CreatorProfileScreen;
