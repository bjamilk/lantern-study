import React, { useState } from "react";
import {
  JOB_OFFER_DECLINE_REASON_MAX_LENGTH,
  JOB_OFFER_STATUS_LABELS,
  canApplicantRespondToJobOffer,
  describeJobOffer,
  describeJobOfferDeadline,
  effectiveJobOfferStatus,
  formatJobEngagementDuration,
  type JobOffer,
} from "@lantern/shared";
import { respondToJobOffer } from "../../services/jobsBoard";

interface Props {
  offer: JobOffer;
  onUpdated: (offer: JobOffer) => void;
}

/** Candidate view of an offer: read the terms, then accept or decline. */
export function JobOfferCard({ offer, onUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [reason, setReason] = useState("");

  const status = effectiveJobOfferStatus(offer);
  const canRespond = canApplicantRespondToJobOffer(offer);
  const deadline = describeJobOfferDeadline(offer);
  const duration = formatJobEngagementDuration(offer.engagementDuration);

  const respond = async (action: "accept" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      const res = await respondToJobOffer(
        offer.id,
        action,
        action === "decline" ? reason.trim() || undefined : undefined,
      );
      onUpdated(res.data);
      setDecliningOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your response");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-lantern-text">
          {canRespond ? "You have an offer" : "Offer"}
        </p>
        <span className="text-xs font-semibold text-lantern-text-secondary">
          {JOB_OFFER_STATUS_LABELS[status]}
        </span>
      </div>

      <p className="mt-1 text-sm font-medium text-lantern-text">
        {describeJobOffer(offer)}
      </p>
      {duration ? (
        <p className="mt-0.5 text-xs text-lantern-text-secondary">{duration}</p>
      ) : null}
      {offer.locationText ? (
        <p className="mt-0.5 break-words text-xs text-lantern-text-secondary">
          {offer.locationText}
        </p>
      ) : null}
      {offer.details ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-lantern-text-secondary">
          {offer.details}
        </p>
      ) : null}
      {deadline && canRespond ? (
        <p className="mt-1 text-xs font-medium text-lantern-text-secondary">
          {deadline}
        </p>
      ) : null}

      {canRespond ? (
        decliningOpen ? (
          <div className="mt-2 space-y-2">
            <label
              htmlFor={`offer-decline-${offer.id}`}
              className="text-xs font-medium text-lantern-text-secondary"
            >
              Anything you want them to know? (optional)
            </label>
            <textarea
              id={`offer-decline-${offer.id}`}
              rows={2}
              value={reason}
              maxLength={JOB_OFFER_DECLINE_REASON_MAX_LENGTH}
              onChange={(event) => setReason(event.target.value)}
              className="w-full resize-y rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDecliningOpen(false)}
                className="rounded-lg border border-lantern-border px-3 py-1.5 text-xs font-medium text-lantern-text"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond("decline")}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Confirm decline
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond("accept")}
              className="rounded-lg bg-lantern-success px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Accept offer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDecliningOpen(true)}
              className="text-xs font-medium text-lantern-text-tertiary underline hover:text-red-600 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        )
      ) : null}

      {status === "accepted" ? (
        <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          You accepted this offer. Congratulations.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default JobOfferCard;
