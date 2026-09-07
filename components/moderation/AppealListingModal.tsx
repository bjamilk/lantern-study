import React, { useEffect, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import Modal from '../ui/Modal';
import {
  APPEAL_NOTE_MAX_LENGTH,
  LEGAL_PATHS,
  MARKETPLACE_LISTING_STATUS_LABELS,
  listingAppealRefusal,
  type ListingAppealStatus,
  type MarketplaceListing,
} from '@lantern/shared';
import { appealListingTakedown } from '../../services/moderation';
import { useToastStore } from '../../stores/toastStore';

export interface AppealListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Pick<MarketplaceListing, 'id' | 'title' | 'status'> & {
    takedown_reason?: string | null;
    appeal_status?: ListingAppealStatus;
  };
  /** Called with the new appeal state after the API accepted the appeal. */
  onAppealed?: (result: { appeal_status: ListingAppealStatus; appealed_at: string }) => void;
}

/**
 * One-shot seller appeal of a moderation takedown. The note goes to the
 * admin appeals queue; the listing stays read-only until a decision.
 */
export const AppealListingModal: React.FC<AppealListingModalProps> = ({
  isOpen,
  onClose,
  listing,
  onAppealed,
}) => {
  const showToast = useToastStore((s) => s.showToast);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setNote('');
    setError(null);
    setBusy(false);
  }, [isOpen, listing.id]);

  const refusal = listingAppealRefusal(listing);
  const canSubmit = !busy && !refusal && note.trim().length >= 10;
  const statusLabel =
    (MARKETPLACE_LISTING_STATUS_LABELS as Record<string, string>)[listing.status] ?? listing.status;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await appealListingTakedown(listing.id, note.trim());
      showToast('Appeal submitted. Lantern moderation will review it and notify you.', 'success');
      onAppealed?.({ appeal_status: result.appeal_status, appealed_at: result.appealed_at });
      onClose();
    } catch (err: unknown) {
      const status = (err as Error & { status?: number })?.status;
      if (status === 409) {
        showToast('An appeal is already under review for this listing.', 'info');
        onAppealed?.({ appeal_status: 'requested', appealed_at: new Date().toISOString() });
        onClose();
        return;
      }
      setError(err instanceof Error && err.message ? err.message : 'Could not submit the appeal. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      ariaLabelledBy="appeal-listing-title"
      maxWidthClass="max-w-md"
      closeOnBackdrop={!busy}
      panelClassName="!p-0 overflow-hidden rounded-xl"
    >
      <div className="w-full">
        <div className="flex items-center justify-between gap-3 p-5 border-b border-lantern-border">
          <div className="flex items-center gap-2 min-w-0">
            <AppIcon name="scale" size={20} className="text-lantern-primary shrink-0" aria-hidden />
            <h3 id="appeal-listing-title" className="text-lg font-bold text-lantern-text truncate">
              Appeal takedown
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-lantern-text-tertiary hover:text-lantern-text hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close appeal form"
          >
            <AppIcon name="close" size={20} aria-hidden />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-lantern-background-secondary/60 px-3 py-2 text-sm">
            <p className="font-semibold text-lantern-text truncate">{listing.title}</p>
            <p className="text-xs text-lantern-text-secondary mt-0.5">
              {statusLabel}
              {listing.takedown_reason ? ` · Reason given: ${listing.takedown_reason}` : ''}
            </p>
          </div>

          {refusal ? (
            <p role="alert" className="text-sm text-lantern-text-secondary">
              {refusal}
            </p>
          ) : (
            <>
              <p className="text-sm text-lantern-text-secondary">
                Tell us why this listing should be restored — for example that you wrote the material
                yourself, hold the rights, or that it is not an unreleased exam. You can appeal once; a
                reviewer will reply through your notifications. See the{' '}
                <a
                  href={LEGAL_PATHS['seller-terms']}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lantern-primary underline hover:no-underline"
                >
                  Seller &amp; Creator Terms
                </a>
                .
              </p>
              <label className="block text-sm">
                <span className="font-semibold text-lantern-text">Your note</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, APPEAL_NOTE_MAX_LENGTH))}
                  rows={4}
                  maxLength={APPEAL_NOTE_MAX_LENGTH}
                  placeholder="Explain why the takedown was a mistake (at least 10 characters)…"
                  className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary px-3 py-2.5 text-lantern-text placeholder:text-lantern-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                />
                <span className="mt-1 block text-right text-[11px] text-lantern-text-tertiary">
                  {note.length}/{APPEAL_NOTE_MAX_LENGTH}
                </span>
              </label>
            </>
          )}

          {error ? (
            <p role="alert" className="text-sm text-lantern-error">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-lantern-border">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary font-semibold transition-colors disabled:opacity-50"
          >
            {refusal ? 'Close' : 'Cancel'}
          </button>
          {!refusal ? (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-primary/50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
            >
              {busy ? 'Submitting…' : 'Submit appeal'}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

export default AppealListingModal;
