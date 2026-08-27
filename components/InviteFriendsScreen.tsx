import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardIcon, CheckIcon, ShareIcon, SparklesIcon } from '@heroicons/react/24/outline';
import {
  REFERRAL_ACTIVATION_EXPLAINER,
  REFERRAL_REWARD_REFEREE,
  REFERRAL_REWARD_REFERRER,
  referralLink,
  referralShareMessage,
  referralStatusLabel,
  type ReferralSummary,
} from '@lantern/shared/network';
import { fetchReferralSummary, fetchAmbassadors, fetchGamificationLeaderboard } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

/**
 * Invite friends (Phase 4 · Q).
 *
 * The screen is deliberately honest about the gate: the bonus lands when the
 * person you invited actually starts studying, not when they sign up. Saying so
 * here is what prevents the "I invited five people and got nothing" support
 * ticket — and the gate itself is what stops a script minting coins, since
 * mobile signup has no captcha.
 */
export interface InviteFriendsScreenProps {
  onBack?: () => void;
}

export const InviteFriendsScreen: React.FC<InviteFriendsScreenProps> = ({ onBack }) => {
  const institutionId = useAuthStore((s) => s.currentUser?.institutionId ?? null);
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [ambassadors, setAmbassadors] = useState<
    Array<{ id: string; name: string; avatarUrl: string | null; programme: string | null }>
  >([]);
  const [ambassadorBoard, setAmbassadorBoard] = useState<
    Array<{ rank: number; user: { id: string; name: string; points: number } }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await fetchReferralSummary());
      if (institutionId) {
        const [list, board] = await Promise.all([
          fetchAmbassadors(institutionId).catch(() => []),
          fetchGamificationLeaderboard({ ambassador: true, institutionId, limit: 10 }).catch(() => []),
        ]);
        setAmbassadors(list);
        setAmbassadorBoard(board);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your invite link');
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const code = summary?.code ?? null;
  const link = code ? referralLink(code) : '';

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the link and copy it manually.');
    }
  };

  const handleShare = async () => {
    if (!code) return;
    const text = referralShareMessage(code);
    // Web Share exists on mobile browsers and is how this actually gets sent;
    // clipboard is the desktop fallback rather than an error.
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: 'Lantern Study',
          text,
        });
        return;
      } catch {
        // user dismissed the sheet — not an error
        return;
      }
    }
    void handleCopy();
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-5">
      <header>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-2 text-sm text-lantern-text-secondary hover:text-lantern-text"
          >
            ← Back
          </button>
        )}
        <h1 className="text-2xl font-semibold text-lantern-text">Invite friends</h1>
        <p className="text-sm text-lantern-text-secondary">
          You get {REFERRAL_REWARD_REFERRER} coins, they get {REFERRAL_REWARD_REFEREE}.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-lantern-text-secondary" role="status">
          Loading…
        </p>
      )}

      {!loading && code && (
        <>
          <section className="rounded-xl border border-lantern-border bg-lantern-background p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
              Your invite link
            </p>
            <p className="mt-1 break-all font-mono text-sm text-lantern-text">{link}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex h-9 min-h-[44px] items-center gap-1.5 rounded-lg bg-lantern-primary px-3 text-sm font-medium text-white sm:min-h-[36px]"
              >
                {copied ? (
                  <CheckIcon className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ClipboardIcon className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                type="button"
                onClick={() => void handleShare()}
                className="inline-flex h-9 min-h-[44px] items-center gap-1.5 rounded-lg bg-lantern-background-secondary px-3 text-sm font-medium text-lantern-text sm:min-h-[36px]"
              >
                <ShareIcon className="h-4 w-4" aria-hidden="true" />
                Share
              </button>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-lantern-text-secondary">
              <SparklesIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lantern-primary" aria-hidden="true" />
              {REFERRAL_ACTIVATION_EXPLAINER}
            </p>
          </section>

          <section className="grid grid-cols-3 gap-3">
            {[
              { label: 'Invited', value: summary?.total ?? 0 },
              { label: 'Started', value: summary?.qualified ?? 0 },
              { label: 'Coins earned', value: summary?.coinsEarned ?? 0 },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-lantern-border bg-lantern-background p-3 text-center"
              >
                <p className="text-lg font-semibold text-lantern-text tabular-nums">{stat.value}</p>
                <p className="text-[11px] text-lantern-text-secondary">{stat.label}</p>
              </div>
            ))}
          </section>

          {summary && summary.referrals.length > 0 && (
            <section aria-label="People you invited">
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
                People you invited
              </h2>
              <ul className="divide-y divide-lantern-border/60 rounded-xl border border-lantern-border bg-lantern-background">
                {summary.referrals.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-lantern-text">{r.refereeName || 'A student'}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        r.status === 'rewarded'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-lantern-background-secondary text-lantern-text-secondary'
                      }`}
                    >
                      {referralStatusLabel(r.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {!loading && (ambassadors.length > 0 || ambassadorBoard.length > 0) && (
        <section aria-label="Campus ambassadors">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
            Campus ambassadors
          </h2>
          <p className="mb-2 text-xs text-lantern-text-tertiary">
            People representing your campus. Earnings stay private.
          </p>
          {ambassadors.length > 0 ? (
            <ul className="divide-y divide-lantern-border/60 rounded-xl border border-lantern-border bg-lantern-background">
              {ambassadors.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-lantern-text">{a.name}</span>
                  <span className="text-[10px] font-medium text-lantern-text-secondary">
                    {a.programme || 'Ambassador'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {ambassadorBoard.length > 0 ? (
            <ol className="mt-3 divide-y divide-lantern-border/60 rounded-xl border border-lantern-border bg-lantern-background">
              {ambassadorBoard.map((row) => (
                <li key={row.user.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-lantern-text">
                    {row.rank}. {row.user.name}
                  </span>
                  <span className="text-[11px] tabular-nums text-lantern-text-secondary">
                    {row.user.points} XP
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      )}

      {!loading && !code && !error && (
        <p className="text-sm text-lantern-text-secondary">
          Your invite link isn&apos;t ready yet. Refresh in a moment.
        </p>
      )}
    </div>
  );
};

export default InviteFriendsScreen;
