import React, { useEffect, useState } from "react";
import {
  JOB_COMPENSATION_PERIODS,
  JOB_COMPENSATION_PERIOD_LABELS,
  JOB_OFFER_DETAILS_MAX_LENGTH,
  JOB_OFFER_LOCATION_MAX_LENGTH,
  JOB_OFFER_STATUS_LABELS,
  canEmployerWithdrawJobOffer,
  describeJobOffer,
  describeJobOfferDeadline,
  effectiveJobOfferStatus,
  hasOpenJobOffer,
  type JobCompensationPeriod,
  type JobOffer,
  type JobPosting,
} from "@lantern/shared";
import {
  fetchJobOffers,
  sendJobOffer,
  withdrawJobOffer,
} from "../../services/jobsBoard";

interface Props {
  applicationId: string;
  candidateName: string;
  /** Seeds the form with the posting's own terms, which are usually right. */
  posting?: JobPosting | null;
}

function defaultExpiryValue(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

/** Employer view: send an offer, then track or withdraw it. */
export function JobOfferPanel({
  applicationId,
  candidateName,
  posting,
}: Props) {
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const seed = posting?.compensation;
  const [currency, setCurrency] = useState(seed?.currency || "NGN");
  const [amount, setAmount] = useState(
    seed?.amountMin != null ? String(seed.amountMin) : "",
  );
  const [period, setPeriod] = useState<JobCompensationPeriod>(
    seed?.period || "month",
  );
  const [startDate, setStartDate] = useState("");
  const [locationText, setLocationText] = useState(posting?.locationText || "");
  const [details, setDetails] = useState("");
  const [expiresOn, setExpiresOn] = useState(defaultExpiryValue());
  const [closePosting, setClosePosting] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJobOffers(applicationId)
      .then((res) => {
        if (active) setOffers(res.data || []);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load offers");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId]);

  const blocked =
    hasOpenJobOffer(offers) ||
    offers.some((offer) => offer.status === "accepted");

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const parsedAmount = amount.trim() ? Number(amount) : null;
      const res = await sendJobOffer(applicationId, {
        compensation:
          parsedAmount != null && Number.isFinite(parsedAmount)
            ? { kind: "paid", currency, amountMin: parsedAmount, period }
            : { kind: "discuss", currency },
        startDate: startDate || null,
        locationText: locationText.trim() || undefined,
        details: details.trim() || undefined,
        // The input is date-only; send end of that day so the candidate has it.
        expiresAt: expiresOn
          ? new Date(`${expiresOn}T23:59:00`).toISOString()
          : undefined,
        closePostingOnAccept: closePosting,
      });
      setOffers((prev) => [res.data, ...prev]);
      setFormOpen(false);
      setDetails("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the offer");
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (offer: JobOffer) => {
    setError(null);
    try {
      const res = await withdrawJobOffer(offer.id);
      setOffers((prev) =>
        prev.map((item) => (item.id === offer.id ? res.data : item)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw the offer");
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-lantern-text">Offer</h3>
        {!formOpen && !blocked ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="text-xs font-semibold text-lantern-primary underline"
          >
            {offers.length ? "Send another offer" : "Send offer"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}

      {formOpen ? (
        <div className="space-y-3 rounded-lg border border-lantern-border bg-lantern-background p-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label
                htmlFor="job-offer-currency"
                className="text-xs font-medium text-lantern-text-secondary"
              >
                Currency
              </label>
              <input
                id="job-offer-currency"
                type="text"
                value={currency}
                maxLength={3}
                onChange={(event) =>
                  setCurrency(event.target.value.toUpperCase())
                }
                className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
              />
            </div>
            <div>
              <label
                htmlFor="job-offer-amount"
                className="text-xs font-medium text-lantern-text-secondary"
              >
                Amount
              </label>
              <input
                id="job-offer-amount"
                type="number"
                min={0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Leave blank to discuss"
                className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text placeholder:text-lantern-text-tertiary"
              />
            </div>
            <div>
              <label
                htmlFor="job-offer-period"
                className="text-xs font-medium text-lantern-text-secondary"
              >
                Per
              </label>
              <select
                id="job-offer-period"
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as JobCompensationPeriod)
                }
                className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
              >
                {JOB_COMPENSATION_PERIODS.map((value) => (
                  <option key={value} value={value}>
                    {JOB_COMPENSATION_PERIOD_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="job-offer-start"
                className="text-xs font-medium text-lantern-text-secondary"
              >
                Start date
              </label>
              <input
                id="job-offer-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
              />
            </div>
            <div>
              <label
                htmlFor="job-offer-expires"
                className="text-xs font-medium text-lantern-text-secondary"
              >
                Respond by
              </label>
              <input
                id="job-offer-expires"
                type="date"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
                className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="job-offer-location"
              className="text-xs font-medium text-lantern-text-secondary"
            >
              Work location
            </label>
            <input
              id="job-offer-location"
              type="text"
              value={locationText}
              maxLength={JOB_OFFER_LOCATION_MAX_LENGTH}
              onChange={(event) => setLocationText(event.target.value)}
              placeholder="Remote, or 12 Campus Road"
              className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text placeholder:text-lantern-text-tertiary"
            />
          </div>

          <div>
            <label
              htmlFor="job-offer-details"
              className="text-xs font-medium text-lantern-text-secondary"
            >
              Terms and next steps (optional)
            </label>
            <textarea
              id="job-offer-details"
              rows={3}
              value={details}
              maxLength={JOB_OFFER_DETAILS_MAX_LENGTH}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Reports to the team lead. Two-week paid onboarding."
              className="mt-1 w-full resize-y rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text placeholder:text-lantern-text-tertiary"
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-lantern-text-secondary">
            <input
              type="checkbox"
              checked={closePosting}
              onChange={(event) => setClosePosting(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Close this job when {candidateName} accepts. Turn this off if you
              are still hiring for more than one person.
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-lg border border-lantern-border px-3 py-1.5 text-sm font-medium text-lantern-text"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="rounded-lg bg-lantern-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Sending…" : "Send offer"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-lantern-text-tertiary">Loading offers…</p>
      ) : offers.length === 0 && !formOpen ? (
        <p className="text-xs text-lantern-text-tertiary">
          No offer sent. {candidateName} accepting an offer is what marks this
          hire.
        </p>
      ) : (
        <ul className="space-y-2">
          {offers.map((offer) => {
            const status = effectiveJobOfferStatus(offer);
            const deadline = describeJobOfferDeadline(offer);
            return (
              <li
                key={offer.id}
                className="rounded-lg border border-lantern-border bg-lantern-background p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-lantern-text">
                    {describeJobOffer(offer)}
                  </p>
                  <span className="shrink-0 text-xs font-semibold text-lantern-text-tertiary">
                    {JOB_OFFER_STATUS_LABELS[status]}
                  </span>
                </div>
                {deadline && status === "sent" ? (
                  <p className="mt-1 text-xs text-lantern-text-secondary">
                    {deadline}
                  </p>
                ) : null}
                {offer.locationText ? (
                  <p className="mt-1 break-words text-xs text-lantern-text-secondary">
                    {offer.locationText}
                  </p>
                ) : null}
                {offer.details ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-lantern-text-secondary">
                    {offer.details}
                  </p>
                ) : null}
                {offer.declineReason ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-lantern-text-secondary">
                    Candidate said: {offer.declineReason}
                  </p>
                ) : null}
                {status === "sent" && canEmployerWithdrawJobOffer(offer) ? (
                  <button
                    type="button"
                    onClick={() => void withdraw(offer)}
                    className="mt-2 text-xs font-semibold text-lantern-text-tertiary underline hover:text-red-600"
                  >
                    Withdraw offer
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default JobOfferPanel;
