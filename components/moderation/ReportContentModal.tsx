import React, { useEffect, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import Modal from '../ui/Modal';
import {
  CONTENT_REPORT_TARGET_LABELS,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASON_LABELS,
  reasonsForTarget,
  type ContentReportReason,
  type ContentReportTargetType,
} from '@lantern/shared';
import { reportContent } from '../../services/moderation';
import { useToastStore } from '../../stores/toastStore';
import { isAlreadyReportedError } from '../../utils/moderationForms';

export interface ReportContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: ContentReportTargetType;
  targetId: string;
  /** What the reporter is looking at, e.g. the listing title or "@username". */
  targetLabel?: string | null;
  /** Called after the API accepted the report (not on "already reported"). */
  onReported?: () => void;
}

/**
 * Shared "Report…" dialog for every reportable thing (listing, seller, note,
 * deck, group, message, DM peer). Reasons come from reasonsForTarget so the
 * select and the API validation can never disagree; a 409 (already reported)
 * is shown as a friendly notice, not an error.
 */
export const ReportContentModal: React.FC<ReportContentModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetLabel,
  onReported,
}) => {
  const showToast = useToastStore((s) => s.showToast);
  const reasons = reasonsForTarget(targetType);
  const [reason, setReason] = useState<ContentReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setDetails('');
    setError(null);
    setBusy(false);
  }, [isOpen, targetType, targetId]);

  const typeLabel = CONTENT_REPORT_TARGET_LABELS[targetType] ?? 'content';
  const detailsRequired = reason === 'other';
  const canSubmit = !busy && !!reason && (!detailsRequired || details.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit || !reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportContent({
        targetType,
        targetId,
        reason,
        details: details.trim() || undefined,
      });
      showToast('Thanks — your report is with Lantern moderation.', 'success');
      onReported?.();
      onClose();
    } catch (err: unknown) {
      if (isAlreadyReportedError(err)) {
        showToast('You have already reported this. Our team is reviewing it.', 'info');
        onClose();
        return;
      }
      setError(err instanceof Error && err.message ? err.message : 'Could not submit the report. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      ariaLabelledBy="report-content-title"
      maxWidthClass="max-w-md"
      closeOnBackdrop={!busy}
      panelClassName="!p-0 overflow-hidden rounded-xl"
    >
      <div className="w-full">
        <div className="flex items-center justify-between gap-3 p-5 border-b border-lantern-border">
          <div className="flex items-center gap-2 min-w-0">
            <AppIcon name="flag" size={20} className="text-red-500 shrink-0" aria-hidden />
            <h3 id="report-content-title" className="text-lg font-bold text-lantern-text truncate">
              Report {typeLabel.toLowerCase()}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-lantern-text-tertiary hover:text-lantern-text hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close report form"
          >
            <AppIcon name="close" size={20} aria-hidden />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {targetLabel ? (
            <p className="text-sm text-lantern-text-secondary">
              Reporting <span className="font-semibold text-lantern-text">{targetLabel}</span>. Reports are
              private — the person you report is not told who reported them.
            </p>
          ) : (
            <p className="text-sm text-lantern-text-secondary">
              Reports are private — the person you report is not told who reported them.
            </p>
          )}

          <label className="block text-sm">
            <span className="font-semibold text-lantern-text">What is wrong?</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ContentReportReason | '')}
              className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary px-3 py-2.5 text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
            >
              <option value="">Select a reason</option>
              {reasons.map((value) => (
                <option key={value} value={value}>
                  {REPORT_REASON_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-semibold text-lantern-text">Details</span>
            <span className="ml-1 text-lantern-text-tertiary">{detailsRequired ? '(required)' : '(optional)'}</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, REPORT_DETAILS_MAX_LENGTH))}
              rows={3}
              maxLength={REPORT_DETAILS_MAX_LENGTH}
              placeholder="Anything that helps us review this quickly — links, what was said, when…"
              className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary px-3 py-2.5 text-lantern-text placeholder:text-lantern-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-lantern-primary"
            />
            <span className="mt-1 block text-right text-[11px] text-lantern-text-tertiary">
              {details.length}/{REPORT_DETAILS_MAX_LENGTH}
            </span>
          </label>

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
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
          >
            {busy ? 'Sending…' : 'Submit report'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ReportContentModal;
