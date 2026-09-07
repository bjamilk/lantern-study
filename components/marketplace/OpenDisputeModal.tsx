import React, { useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import {
  DISPUTE_CATEGORIES,
  DISPUTE_CATEGORY_LABELS,
  DISPUTE_REASON_MAX,
  type DisputeCategory,
} from '@lantern/shared/network';

/**
 * Open a dispute on an order (Phase 3 · N).
 *
 * `open_dispute` has existed server-side since Phase 1 with no client able to
 * reach it — this is that client. A dispute needs a CATEGORY (so support can
 * triage without reading every note) and free text, and it deliberately warns
 * that opening one holds the seller's payout: a buyer should know that before
 * clicking, not discover it afterwards.
 */
export interface OpenDisputeModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { disputeCategory: DisputeCategory; disputeReason: string }) => Promise<void>;
  listingTitle?: string;
  /**
   * The category labels are buyer-voiced ("I never received it"). A seller
   * opening a dispute must not be pre-filled with a claim they are not making.
   */
  viewerIsSeller?: boolean;
}

export const OpenDisputeModal: React.FC<OpenDisputeModalProps> = ({
  open,
  onClose,
  onSubmit,
  listingTitle,
  viewerIsSeller = false,
}) => {
  const [category, setCategory] = useState<DisputeCategory>(
    viewerIsSeller ? 'other' : 'not_received'
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError('Tell us what went wrong so we can help.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ disputeCategory: category, disputeReason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispute-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-lantern-border bg-lantern-background p-5"
      >
        <div className="mb-3 flex items-start gap-2">
          <AppIcon name="warning" size={20} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
          <div>
            <h2 id="dispute-title" className="text-base font-semibold text-lantern-text">
              Open a dispute
            </h2>
            <p className="text-xs text-lantern-text-secondary">
              {listingTitle ? `For "${listingTitle}". ` : ''}
              Our team will review it. The seller&apos;s payout is held until it&apos;s resolved.
            </p>
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-lantern-text" htmlFor="dispute-category">
          What went wrong?
        </label>
        <select
          id="dispute-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as DisputeCategory)}
          className="mb-3 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text"
        >
          {DISPUTE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {DISPUTE_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-lantern-text" htmlFor="dispute-reason">
          Tell us more
        </label>
        <textarea
          id="dispute-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, DISPUTE_REASON_MAX))}
          rows={4}
          placeholder="What happened, and what would resolve it?"
          className="w-full resize-none rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text placeholder:text-lantern-text-secondary"
        />
        <p className="mt-1 text-right text-label tracking-normal text-lantern-text-secondary">
          {reason.length}/{DISPUTE_REASON_MAX}
        </p>

        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 min-h-[44px] rounded-lg px-3 text-sm text-lantern-text-secondary sm:min-h-[36px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-9 min-h-[44px] rounded-lg bg-amber-500 px-4 text-sm font-medium text-white disabled:opacity-60 sm:min-h-[36px]"
          >
            {submitting ? 'Opening…' : 'Open dispute'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default OpenDisputeModal;
