import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { CampusSearchSelect } from './CampusSearchSelect';
import { publishQuestionBank, fetchMarketplaceCampuses } from '../../services/supabase';
import { useToastStore } from '../../stores/toastStore';
import type { OfflineSessionBundle } from '../../types';
import type { MarketplaceCampus } from '@lantern/shared';
import { BuildingStorefrontIcon } from '@heroicons/react/24/outline';

interface PublishQuestionBankModalProps {
  bundle: OfflineSessionBundle;
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new listing id after a successful publish. */
  onPublished?: (listingId: string) => void;
}

/**
 * Publishes an offline test bundle as a digital question-bank listing.
 * The server freezes a snapshot, so later edits to the group's questions
 * never change what buyers received.
 */
export const PublishQuestionBankModal: React.FC<PublishQuestionBankModalProps> = ({
  bundle,
  isOpen,
  onClose,
  onPublished,
}) => {
  const [title, setTitle] = useState(bundle.displayName || bundle.groupName || '');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [campusId, setCampusId] = useState('');
  const [otherCity, setOtherCity] = useState('');
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void fetchMarketplaceCampuses('NG')
      .then(setCampuses)
      .catch(() => setCampuses([]));
  }, [isOpen]);

  const questionCount = bundle.questions?.length || 0;
  const priceValue = price.trim() === '' ? null : Number(price);
  const priceInvalid =
    price.trim() !== '' && (!Number.isFinite(priceValue!) || priceValue! < 0);
  const canSubmit =
    !busy && !!title.trim() && !!campusId && !priceInvalid && attested && questionCount > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await publishQuestionBank({
        title: title.trim(),
        description: description.trim() || undefined,
        price: priceValue && priceValue > 0 ? priceValue : null,
        campusId,
        location: otherCity.trim() || undefined,
        groupId: (bundle.config as { groupId?: string })?.groupId || null,
        content: {
          config: bundle.config as unknown as Record<string, unknown>,
          questions: bundle.questions,
        },
      });
      useToastStore
        .getState()
        .showToast(
          priceValue && priceValue > 0
            ? 'Question bank published! Buyers get it instantly after payment.'
            : 'Question bank published as a free download!'
        );
      onPublished?.(result.listing?.id);
      onClose();
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not publish question bank', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      ariaLabelledBy="publish-qbank-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden rounded-xl"
    >
      <div className="w-full">
        <div className="flex items-center gap-2 p-5 border-b border-lantern-border">
          <BuildingStorefrontIcon className="w-5 h-5 text-lantern-primary" aria-hidden />
          <h3 id="publish-qbank-title" className="text-lg font-bold text-lantern-text">
            Publish to Marketplace
          </h3>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="rounded-lg bg-lantern-background-secondary/60 px-3 py-2 text-sm text-lantern-text-secondary">
            {questionCount} question{questionCount !== 1 ? 's' : ''} from{' '}
            <span className="font-semibold text-lantern-text">{bundle.groupName}</span>. Buyers
            receive a copy in their Offline Mode instantly — on web and mobile.
          </div>

          <label className="block text-sm">
            <span className="font-semibold text-lantern-text">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2.5 text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
              placeholder="e.g. GST 101 Past Questions (2024/2025)"
            />
          </label>

          <label className="block text-sm">
            <span className="font-semibold text-lantern-text">Description</span>
            <span className="ml-1 text-lantern-text-tertiary">(optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2.5 text-lantern-text resize-none focus:outline-none focus:ring-2 focus:ring-lantern-primary"
              placeholder="What's covered, which sessions, how the questions were made…"
            />
          </label>

          <label className="block text-sm">
            <span className="font-semibold text-lantern-text">Price (₦)</span>
            <span className="ml-1 text-lantern-text-tertiary">(leave empty for free)</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={100}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2.5 text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
              placeholder="Free"
            />
            {priceInvalid ? (
              <span className="mt-1 block text-xs text-lantern-error">Enter a valid price</span>
            ) : priceValue && priceValue > 0 ? (
              <span className="mt-1 block text-xs text-lantern-text-tertiary">
                Paid banks need your payout bank account set up (Selling → Payouts). Buyers pay
                through the app and you're paid out automatically on purchase.
              </span>
            ) : null}
          </label>

          <div className="text-sm">
            <span className="font-semibold text-lantern-text">Campus</span>
            <div className="mt-1.5">
              <CampusSearchSelect
                campuses={campuses}
                value={campusId}
                onChange={(id) => setCampusId(id || '')}
                otherCity={otherCity}
                onOtherCityChange={setOtherCity}
                emptyLabel="Choose the campus this bank is most relevant to"
                id="publish-qbank-campus"
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-lantern-border text-lantern-primary focus:ring-lantern-primary"
            />
            <span className="text-lantern-text-secondary">
              I confirm this content is original or I'm authorized to share it, and it doesn't
              reproduce copyrighted exam papers without permission.
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-lantern-border">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background font-semibold transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-primary/50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
          >
            {busy ? 'Publishing…' : priceValue && priceValue > 0 ? `Publish · ₦${priceValue.toLocaleString()}` : 'Publish free'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PublishQuestionBankModal;
