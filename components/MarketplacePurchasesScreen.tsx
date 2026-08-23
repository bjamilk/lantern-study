import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchMarketplacePurchases,
  downloadStudyPack,
  downloadQuestionBank,
  type MarketplacePurchase,
} from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  RectangleStackIcon,
  SparklesIcon,
  ArrowDownTrayIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';

interface Props {
  onBack: () => void;
  onNavigate: (screen: string, params?: any) => void;
}

const KIND_LABEL: Record<MarketplacePurchase['kind'], string> = {
  study_pack: 'Study Pack',
  question_bank: 'Question Bank',
};

/**
 * The buyer's library of purchased digital products (question banks + study
 * packs), from GET /marketplace/purchases. Shows an Update button whenever the
 * seller has published a newer version than the copy the buyer holds.
 */
export const MarketplacePurchasesScreen: React.FC<Props> = ({ onBack, onNavigate }) => {
  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const showToast = useToastStore((s) => s.showToast);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPurchases(await fetchMarketplacePurchases());
    } catch (e: any) {
      setError(e?.message || 'Could not load your purchases.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdate = async (purchase: MarketplacePurchase) => {
    setUpdatingId(purchase.listingId);
    try {
      if (purchase.kind === 'study_pack') {
        await downloadStudyPack(purchase.listingId);
      } else {
        await downloadQuestionBank(purchase.listingId);
      }
      setPurchases((prev) =>
        prev.map((p) =>
          p.listingId === purchase.listingId
            ? { ...p, versionAtDownload: p.version, updateAvailable: false }
            : p
        )
      );
      showToast(
        purchase.kind === 'study_pack'
          ? 'Study pack updated in your Library.'
          : 'Question bank updated in Offline Mode.'
      );
    } catch (e: any) {
      showToast(e?.message || 'Could not update this item.', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const updatesCount = purchases.filter((p) => p.updateAvailable).length;

  return (
    <div className="min-h-full bg-lantern-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary transition-colors"
            aria-label="Back"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-lantern-text">Your purchases</h1>
            <p className="text-sm text-lantern-text-secondary">
              Study packs and question banks you own — synced to every device.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="p-2 rounded-lg text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary transition-colors disabled:opacity-50"
            aria-label="Refresh"
          >
            <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {updatesCount > 0 && (
          <div className="mb-4 rounded-xl border border-lantern-primary/30 bg-lantern-primary/5 px-4 py-2.5 text-sm text-lantern-text">
            {updatesCount} {updatesCount === 1 ? 'item has' : 'items have'} a newer version available.
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-lantern-background-secondary animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-lantern-error/30 bg-lantern-error/5 p-4 text-sm text-lantern-error">
            {error}
            <button onClick={() => void load()} className="ml-2 font-semibold underline">
              Retry
            </button>
          </div>
        ) : purchases.length === 0 ? (
          <div className="rounded-2xl border border-lantern-border bg-lantern-surface p-8 text-center">
            <ShoppingBagIcon className="w-10 h-10 mx-auto text-lantern-text-tertiary mb-3" />
            <p className="text-lantern-text font-semibold">No purchases yet</p>
            <p className="text-sm text-lantern-text-secondary mt-1 mb-4">
              Study packs and question banks you buy or download show up here.
            </p>
            <button
              onClick={() => onNavigate('Marketplace')}
              className="px-4 py-2 rounded-lg bg-lantern-primary hover:bg-lantern-primary-dark text-white text-sm font-semibold transition-colors"
            >
              Browse the marketplace
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {purchases.map((p) => {
              const isStudyPack = p.kind === 'study_pack';
              const Icon = isStudyPack ? RectangleStackIcon : SparklesIcon;
              return (
                <li
                  key={p.listingId}
                  className="rounded-xl border border-lantern-border bg-lantern-surface p-4 flex items-start gap-3"
                >
                  <div className="mt-0.5 shrink-0 w-9 h-9 rounded-lg bg-lantern-primary-background flex items-center justify-center">
                    <Icon className="w-5 h-5 text-lantern-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-lantern-background-secondary px-2 py-0.5 text-[11px] font-semibold text-lantern-text-secondary">
                        {KIND_LABEL[p.kind]}
                      </span>
                      {p.updateAvailable && (
                        <span className="inline-flex items-center rounded-full bg-lantern-primary/15 px-2 py-0.5 text-[11px] font-semibold text-lantern-primary">
                          Update available
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onNavigate('MarketplaceListingDetail', { listingId: p.listingId })}
                      className="mt-1 block text-left text-sm font-semibold text-lantern-text hover:text-lantern-primary transition-colors truncate w-full"
                      title={p.title}
                    >
                      {p.title}
                    </button>
                    <p className="text-xs text-lantern-text-tertiary mt-0.5 truncate">
                      {p.sellerName} · v{p.version}
                      {p.updateAvailable ? ` (you have v${p.versionAtDownload})` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 self-center">
                    {p.updateAvailable ? (
                      <button
                        onClick={() => void handleUpdate(p)}
                        disabled={updatingId === p.listingId}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lantern-primary hover:bg-lantern-primary-dark disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                      >
                        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                        {updatingId === p.listingId ? 'Updating…' : 'Update'}
                      </button>
                    ) : (
                      <span className="text-[11px] text-lantern-text-tertiary">Up to date</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default MarketplacePurchasesScreen;
