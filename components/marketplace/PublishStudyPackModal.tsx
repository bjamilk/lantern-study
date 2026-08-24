import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import { CampusSearchSelect } from './CampusSearchSelect';
import { publishStudyPack, fetchMarketplaceCampuses, fetchMarketplacePaymentsConfig } from '../../services/supabase';
import { useToastStore } from '../../stores/toastStore';
import {
  ATTESTATION_REQUIRED_MESSAGE,
  SOURCES_CITED_MAX,
  type MarketplaceCampus,
} from '@lantern/shared';
import { summarizeStudyPackCounts, type StudyPackContentInput } from '@lantern/shared/marketplace';
import { BuildingStorefrontIcon } from '@heroicons/react/24/outline';
import { CoursePicker } from '../academic/CoursePicker';
import { TopicPicker } from '../academic/TopicPicker';
import { RightsAttestationCheckbox } from '../moderation/RightsAttestationCheckbox';
import { isInlineSubmitError, parseSourcesCited } from '../../utils/moderationForms';

interface PublishStudyPackModalProps {
  /** Pre-built content (from a deck export, a note, or an AI draft) — shown for counts. */
  content: StudyPackContentInput;
  isOpen: boolean;
  onClose: () => void;
  defaultTitle?: string;
  defaultCourseId?: string | null;
  defaultDescription?: string;
  defaultPrice?: number | null;
  /**
   * When set, publish consumes this ready AI draft server-side (its content is
   * authoritative) and marks it published; `content` is used only for the preview.
   */
  draftId?: string | null;
  /** Called with the new listing id after a successful publish. */
  onPublished?: (listingId: string) => void;
}

/** Local count of the deliverable parts, so we can gate + summarise before publish. */
function countContent(content: StudyPackContentInput) {
  const guideWords = (content.guide?.markdown || '').trim()
    ? (content.guide!.markdown as string).trim().split(/\s+/).length
    : 0;
  return {
    guideWords,
    summaries: content.summaries?.length || 0,
    flashcards: content.flashcards?.length || 0,
    questions: content.questions?.length || 0,
  };
}

/**
 * Publishes a study pack (guide + summaries + flashcards + questions) as a
 * digital listing. Content is built by the caller from a deck, a note, or an
 * AI draft; the server freezes a snapshot, so later edits never change what
 * buyers received.
 */
export const PublishStudyPackModal: React.FC<PublishStudyPackModalProps> = ({
  content,
  isOpen,
  onClose,
  defaultTitle,
  defaultCourseId,
  defaultDescription,
  defaultPrice,
  draftId,
  onPublished,
}) => {
  const [title, setTitle] = useState(defaultTitle || '');
  const [description, setDescription] = useState(defaultDescription || '');
  const [price, setPrice] = useState(defaultPrice != null && defaultPrice > 0 ? String(defaultPrice) : '');
  const [campusId, setCampusId] = useState('');
  const [courseId, setCourseId] = useState<string | null>(defaultCourseId ?? null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [otherCity, setOtherCity] = useState('');
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const [attested, setAttested] = useState(false);
  // AI drafts are AI-assisted by construction; pre-tick it (still editable).
  const [aiAssisted, setAiAssisted] = useState(!!draftId);
  const [sourcesText, setSourcesText] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Lantern's commission on digital sales (from /payments/config; default 15%).
  const [creatorFeeBps, setCreatorFeeBps] = useState(1500);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(defaultTitle || '');
    setCourseId(defaultCourseId ?? null);
    setDescription(defaultDescription || '');
    setPrice(defaultPrice != null && defaultPrice > 0 ? String(defaultPrice) : '');
    setAiAssisted(!!draftId);
    void fetchMarketplaceCampuses('NG')
      .then(setCampuses)
      .catch(() => setCampuses([]));
    void fetchMarketplacePaymentsConfig()
      .then((c) => setCreatorFeeBps(Number(c?.creatorFeeBps ?? 1500)))
      .catch(() => setCreatorFeeBps(1500));
  }, [isOpen, defaultTitle, defaultCourseId, defaultDescription, defaultPrice, draftId]);

  const counts = useMemo(() => countContent(content), [content]);
  const hasContent =
    counts.guideWords > 0 || counts.summaries > 0 || counts.flashcards > 0 || counts.questions > 0;
  const countSummary = summarizeStudyPackCounts(counts);

  const priceValue = price.trim() === '' ? null : Number(price);
  const priceInvalid = price.trim() !== '' && (!Number.isFinite(priceValue!) || priceValue! < 0);
  const parsedSources = parseSourcesCited(sourcesText);
  const sourcesError = parsedSources.ok ? null : parsedSources.error;

  const canSubmit =
    !busy && attested && hasContent && !!title.trim() && !!campusId && !priceInvalid;

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
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        price: priceValue && priceValue > 0 ? priceValue : null,
        campusId,
        location: otherCity.trim() || undefined,
        courseId,
        // A topic without its course is what the server rejects — never send one.
        topicId: courseId ? topicId : null,
        // A ready AI draft is authoritative server-side; otherwise send the
        // client-built content (deck/note).
        ...(draftId ? { draftId } : { content }),
        attestation: true as const,
        aiAssisted,
        sourcesCited: parsedSources.value,
      };
      const result = await publishStudyPack(body);
      useToastStore
        .getState()
        .showToast(
          priceValue && priceValue > 0
            ? 'Study pack published! Buyers get it instantly after payment.'
            : 'Study pack published as a free download!'
        );
      onPublished?.(result.listing?.id);
      onClose();
    } catch (err: any) {
      if (isInlineSubmitError(err)) {
        setSubmitError(err.message);
      } else {
        useToastStore.getState().showToast(err?.message || 'Could not publish study pack', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      ariaLabelledBy="publish-studypack-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden rounded-xl"
    >
      <div className="w-full">
        <div className="flex items-center gap-2 p-5 border-b border-lantern-border">
          <BuildingStorefrontIcon className="w-5 h-5 text-lantern-primary" aria-hidden />
          <h3 id="publish-studypack-title" className="text-lg font-bold text-lantern-text">
            Sell as a Study Pack
          </h3>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="rounded-lg bg-lantern-background-secondary/60 px-3 py-2 text-sm text-lantern-text-secondary">
            {hasContent ? (
              <>
                <span className="font-semibold text-lantern-text">{countSummary}</span>. Buyers get a
                copy in their Library instantly — notes, flashcards and questions, on web and mobile.
              </>
            ) : (
              <span className="text-lantern-error">
                This has nothing to sell yet — add a guide, flashcards or questions first.
              </span>
            )}
          </div>

          <label className="block text-sm">
            <span className="font-semibold text-lantern-text">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2.5 text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
              placeholder="e.g. Cell Biology — Complete Study Pack"
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
              placeholder="What's covered, which course, how it was made…"
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
                <span className="font-semibold text-lantern-text">
                  You receive ₦{Math.round(priceValue * (1 - creatorFeeBps / 10000)).toLocaleString()}
                </span>{' '}
                · Lantern fee {(creatorFeeBps / 100).toFixed(0)}%. Buyers pay the list price; you're
                paid out automatically. Needs your payout bank account set up (Selling → Payouts).
              </span>
            ) : null}
          </label>

          <CoursePicker
            id="publish-studypack-course"
            label={
              <span className="text-sm font-semibold text-lantern-text">
                Course <span className="text-lantern-text-tertiary font-normal">(optional)</span>
              </span>
            }
            value={courseId}
            onChange={(course) => {
              setCourseId(course?.id ?? null);
              setTopicId(null);
            }}
            placeholder="Which course is this pack for?"
          />

          <TopicPicker
            id="publish-studypack-topic"
            label={
              <span className="text-sm font-semibold text-lantern-text">
                Topic <span className="text-lantern-text-tertiary font-normal">(optional)</span>
              </span>
            }
            courseId={courseId}
            value={topicId}
            onChange={(topic) => setTopicId(topic?.id ?? null)}
            placeholder="Which part of the syllabus?"
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
                emptyLabel="Choose the campus this pack is most relevant to"
                id="publish-studypack-campus"
              />
            </div>
          </div>

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
                  Tick if an AI tool generated or rewrote some of this. Recorded with your listing.
                </span>
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-lantern-text">Sources</span>
              <span className="ml-1 text-lantern-text-tertiary">
                (optional, one per line, up to {SOURCES_CITED_MAX})
              </span>
              <textarea
                value={sourcesText}
                onChange={(e) => {
                  setSourcesText(e.target.value);
                  if (submitError) setSubmitError(null);
                }}
                rows={2}
                className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text resize-none focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                placeholder={'e.g. BIO 101 lecture slides, week 3\nMy own notes'}
              />
              {sourcesError ? (
                <span className="mt-1 block text-xs text-lantern-error">{sourcesError}</span>
              ) : null}
            </label>
            <RightsAttestationCheckbox
              id="publish-studypack-attestation"
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
              ? 'Publishing…'
              : priceValue && priceValue > 0
                ? `Publish · ₦${priceValue.toLocaleString()}`
                : 'Publish free'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PublishStudyPackModal;
