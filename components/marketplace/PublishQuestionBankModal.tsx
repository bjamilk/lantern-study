import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { CampusSearchSelect } from './CampusSearchSelect';
import {
  publishQuestionBank,
  updateQuestionBankContent,
  fetchMyQuestionBanks,
  fetchMarketplaceCampuses,
  type MyQuestionBank,
} from '../../services/supabase';
import { useToastStore } from '../../stores/toastStore';
import type { OfflineSessionBundle } from '../../types';
import {
  ATTESTATION_REQUIRED_MESSAGE,
  SOURCES_CITED_MAX,
  type MarketplaceCampus,
} from '@lantern/shared';
import { BuildingStorefrontIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { CoursePicker } from '../academic/CoursePicker';
import { RightsAttestationCheckbox } from '../moderation/RightsAttestationCheckbox';
import { isInlineSubmitError, parseSourcesCited } from '../../utils/moderationForms';

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
  const [courseId, setCourseId] = useState<string | null>(
    bundle.courseId ?? (bundle.config as { courseId?: string | null })?.courseId ?? null
  );
  const [otherCity, setOtherCity] = useState('');
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const [attested, setAttested] = useState(false);
  const [aiAssisted, setAiAssisted] = useState(false);
  // One source per line → sourcesCited (≤ 20 × 200 chars, validated by parseSourcesCited).
  const [sourcesText, setSourcesText] = useState('');
  // 400s the seller can fix in the form (missing attestation, blocked wording).
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Existing listing published from the same group, if any — offered as an
  // update target so republishing doesn't spawn duplicate listings.
  const [existingBank, setExistingBank] = useState<MyQuestionBank | null>(null);
  const [mode, setMode] = useState<'new' | 'update'>('new');

  useEffect(() => {
    if (!isOpen) return;
    void fetchMarketplaceCampuses('NG')
      .then(setCampuses)
      .catch(() => setCampuses([]));

    const groupId = (bundle.config as { groupId?: string })?.groupId;
    if (!groupId) return;
    void fetchMyQuestionBanks()
      .then((mine) => {
        const match = mine.find(
          (b) => b.sourceGroupId === groupId && b.status !== 'removed'
        );
        if (match) {
          setExistingBank(match);
          setMode('update');
        }
      })
      .catch(() => setExistingBank(null));
  }, [isOpen, bundle]);

  const questionCount = bundle.questions?.length || 0;
  const priceValue = price.trim() === '' ? null : Number(price);
  const priceInvalid =
    price.trim() !== '' && (!Number.isFinite(priceValue!) || priceValue! < 0);
  const isUpdate = mode === 'update' && !!existingBank;
  const canSubmit =
    !busy &&
    attested &&
    questionCount > 0 &&
    (isUpdate || (!!title.trim() && !!campusId && !priceInvalid));

  const parsedSources = parseSourcesCited(sourcesText);
  const sourcesError = parsedSources.ok ? null : parsedSources.error;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!attested) {
      setSubmitError(ATTESTATION_REQUIRED_MESSAGE);
      return;
    }
    if (!parsedSources.ok) {
      setSubmitError(parsedSources.error);
      return;
    }
    setSubmitError(null);
    setBusy(true);
    // Both the first publish and every republish carry the attestation: the
    // API refuses either without it (docs/phase1-rights-moderation-contract.md §3).
    const provenance = {
      attestation: true as const,
      aiAssisted,
      sourcesCited: parsedSources.value,
    };
    try {
      if (isUpdate && existingBank) {
        const result = await updateQuestionBankContent(
          existingBank.listingId,
          {
            config: bundle.config as unknown as Record<string, unknown>,
            questions: bundle.questions,
          },
          provenance
        );
        useToastStore
          .getState()
          .showToast(
            `"${existingBank.title}" updated to version ${result.version}. Buyers will see an update.`
          );
        onPublished?.(existingBank.listingId);
        onClose();
        return;
      }
      const result = await publishQuestionBank({
        title: title.trim(),
        description: description.trim() || undefined,
        price: priceValue && priceValue > 0 ? priceValue : null,
        campusId,
        location: otherCity.trim() || undefined,
        groupId: (bundle.config as { groupId?: string })?.groupId || null,
        courseId,
        content: {
          config: bundle.config as unknown as Record<string, unknown>,
          questions: bundle.questions,
        },
        ...provenance,
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
      if (isInlineSubmitError(err)) {
        setSubmitError(err.message);
      } else {
        useToastStore.getState().showToast(err?.message || 'Could not publish question bank', 'error');
      }
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

          {existingBank ? (
            <div className="rounded-lg border border-lantern-primary/30 bg-lantern-primary/5 p-3 space-y-2">
              <p className="text-sm text-lantern-text">
                You already published{' '}
                <span className="font-semibold">"{existingBank.title}"</span> (v
                {existingBank.version}, {existingBank.questionCount} questions) from this group.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMode('update')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    mode === 'update'
                      ? 'bg-lantern-primary text-white'
                      : 'bg-lantern-background-secondary text-lantern-text-secondary hover:text-lantern-text'
                  }`}
                >
                  <ArrowPathIcon className="w-3.5 h-3.5" aria-hidden />
                  Update it to v{existingBank.version + 1}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('new')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    mode === 'new'
                      ? 'bg-lantern-primary text-white'
                      : 'bg-lantern-background-secondary text-lantern-text-secondary hover:text-lantern-text'
                  }`}
                >
                  Publish as a separate listing
                </button>
              </div>
              {isUpdate ? (
                <p className="text-xs text-lantern-text-tertiary">
                  Title, price, and campus stay as they are. Buyers keep their current copy and
                  get an "Update" button in Offline Mode.
                </p>
              ) : null}
            </div>
          ) : null}

          {!isUpdate && (
          <>
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

          <CoursePicker
            id="publish-qbank-course"
            label={<span className="text-sm font-semibold text-lantern-text">Course <span className="text-lantern-text-tertiary font-normal">(optional)</span></span>}
            value={courseId}
            onChange={(course) => setCourseId(course?.id ?? null)}
            placeholder="Which course is this bank for?"
          />

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
          </>
          )}

          <div className="space-y-3 rounded-lg border border-lantern-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              Rights &amp; provenance
            </p>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={aiAssisted}
                onChange={(e) => setAiAssisted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-lantern-border text-lantern-primary focus:ring-lantern-primary"
              />
              <span className="text-lantern-text-secondary">
                This pack was AI-assisted
                <span className="block text-xs text-lantern-text-tertiary">
                  Tick if an AI tool generated or rewrote some of these questions. Recorded with your listing.
                </span>
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-lantern-text">Sources</span>
              <span className="ml-1 text-lantern-text-tertiary">(optional, one per line, up to {SOURCES_CITED_MAX})</span>
              <textarea
                value={sourcesText}
                onChange={(e) => {
                  setSourcesText(e.target.value);
                  if (submitError) setSubmitError(null);
                }}
                rows={2}
                className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text resize-none focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                placeholder={'e.g. GST 101 lecture slides, week 3\nPast papers 2022/2023 (public)'}
              />
              {sourcesError ? (
                <span className="mt-1 block text-xs text-lantern-error">{sourcesError}</span>
              ) : null}
            </label>
            <RightsAttestationCheckbox
              id="publish-qbank-attestation"
              checked={attested}
              onChange={(checked) => {
                setAttested(checked);
                if (checked && submitError === ATTESTATION_REQUIRED_MESSAGE) setSubmitError(null);
              }}
              disabled={busy}
            />
          </div>
          {submitError ? (
            <p role="alert" className="text-sm text-lantern-error">
              {submitError}
            </p>
          ) : null}
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
            {busy
              ? isUpdate ? 'Updating…' : 'Publishing…'
              : isUpdate && existingBank
                ? `Update to v${existingBank.version + 1}`
                : priceValue && priceValue > 0
                  ? `Publish · ₦${priceValue.toLocaleString()}`
                  : 'Publish free'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PublishQuestionBankModal;
