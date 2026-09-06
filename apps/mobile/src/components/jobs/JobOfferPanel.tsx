import React, { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
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
import { JobMessageTemplatePicker } from "./JobMessageTemplatePicker";

interface Props {
  applicationId: string;
  candidateName: string;
  /** Seeds the form with the posting's own terms, which are usually right. */
  posting?: JobPosting | null;
}

function defaultExpiry(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(23, 59, 0, 0);
  return date;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  const [amount, setAmount] = useState(
    seed?.amountMin != null ? String(seed.amountMin) : "",
  );
  const [period, setPeriod] = useState<JobCompensationPeriod>(
    seed?.period || "month",
  );
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date>(defaultExpiry());
  const [locationText, setLocationText] = useState(posting?.locationText || "");
  const [details, setDetails] = useState("");
  const [closePosting, setClosePosting] = useState(true);
  const [picker, setPicker] = useState<"start" | "expires" | null>(null);

  const currency = seed?.currency || "NGN";

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

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const target = picker;
    setPicker(null);
    if (!target || event.type === "dismissed" || !selected) return;
    if (target === "start") setStartDate(selected);
    else {
      const next = new Date(selected);
      next.setHours(23, 59, 0, 0);
      setExpiresAt(next);
    }
  };

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
        startDate: startDate ? startDate.toISOString() : null,
        locationText: locationText.trim() || undefined,
        details: details.trim() || undefined,
        expiresAt: expiresAt.toISOString(),
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
    <View className="mt-3 border-t border-lantern-border pt-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-lantern-text">Offer</Text>
        {!formOpen && !blocked ? (
          <Pressable
            onPress={() => setFormOpen(true)}
            accessibilityRole="button"
          >
            <Text className="text-xs font-semibold text-lantern-primary-text">
              {offers.length ? "Send another offer" : "Send offer"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-2 text-xs font-medium text-red-600"
        >
          {error}
        </Text>
      ) : null}

      {formOpen ? (
        <View className="mt-3 rounded-lg border border-lantern-border bg-lantern-background p-3">
          <Text className="text-xs font-medium text-lantern-text-secondary">
            Amount ({currency}) — leave blank to discuss
          </Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="150000"
            className="mt-1 rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
          />

          <Text className="mt-3 text-xs font-medium text-lantern-text-secondary">
            Pay period
          </Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {JOB_COMPENSATION_PERIODS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setPeriod(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: period === value }}
                className={`rounded-full border px-3 py-1.5 ${
                  period === value
                    ? "border-lantern-primary bg-lantern-primary-fill"
                    : "border-lantern-border"
                }`}
              >
                <Text
                  className={`text-xs ${
                    period === value
                      ? "font-semibold text-white"
                      : "text-lantern-text"
                  }`}
                >
                  {JOB_COMPENSATION_PERIOD_LABELS[value]}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => setPicker("start")}
              accessibilityRole="button"
              className="flex-1 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2"
            >
              <Text className="text-xs text-lantern-text-secondary">
                Start date
              </Text>
              <Text className="text-sm text-lantern-text">
                {startDate ? formatDate(startDate) : "Not set"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPicker("expires")}
              accessibilityRole="button"
              className="flex-1 rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2"
            >
              <Text className="text-xs text-lantern-text-secondary">
                Respond by
              </Text>
              <Text className="text-sm text-lantern-text">
                {formatDate(expiresAt)}
              </Text>
            </Pressable>
          </View>

          {picker ? (
            <DateTimePicker
              value={picker === "start" ? startDate || new Date() : expiresAt}
              mode="date"
              minimumDate={picker === "expires" ? new Date() : undefined}
              onChange={onPickerChange}
            />
          ) : null}

          <Text className="mt-3 text-xs font-medium text-lantern-text-secondary">
            Work location
          </Text>
          <TextInput
            value={locationText}
            onChangeText={setLocationText}
            maxLength={JOB_OFFER_LOCATION_MAX_LENGTH}
            placeholder="Remote, or 12 Campus Road"
            className="mt-1 rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
          />

          <Text className="mt-3 text-xs font-medium text-lantern-text-secondary">
            Terms and next steps (optional)
          </Text>
          <TextInput
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={JOB_OFFER_DETAILS_MAX_LENGTH}
            placeholder="Reports to the team lead. Two-week paid onboarding."
            className="mt-1 min-h-[72px] rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
          />
          <JobMessageTemplatePicker kind="offer" onSelect={setDetails} />

          <View className="mt-3 flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-xs text-lantern-text-secondary">
              Close this job when {candidateName} accepts
            </Text>
            <Switch value={closePosting} onValueChange={setClosePosting} />
          </View>

          <View className="mt-3 flex-row justify-end gap-2">
            <Pressable
              onPress={() => setFormOpen(false)}
              accessibilityRole="button"
              className="rounded-lg border border-lantern-border px-3 py-1.5"
            >
              <Text className="text-sm font-medium text-lantern-text">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              disabled={saving}
              onPress={() => void submit()}
              accessibilityRole="button"
              className={`rounded-lg bg-lantern-primary-fill px-3 py-1.5 ${
                saving ? "opacity-50" : ""
              }`}
            >
              <Text className="text-sm font-semibold text-white">
                {saving ? "Sending…" : "Send offer"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading ? (
        <Text className="mt-2 text-xs text-lantern-text-tertiary">
          Loading offers…
        </Text>
      ) : offers.length === 0 && !formOpen ? (
        <Text className="mt-2 text-xs text-lantern-text-tertiary">
          No offer sent. {candidateName} accepting an offer is what marks this
          hire.
        </Text>
      ) : (
        offers.map((offer) => {
          const status = effectiveJobOfferStatus(offer);
          const deadline = describeJobOfferDeadline(offer);
          return (
            <View
              key={offer.id}
              className="mt-2 rounded-lg border border-lantern-border bg-lantern-background p-3"
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-sm font-medium text-lantern-text">
                  {describeJobOffer(offer)}
                </Text>
                <Text className="text-xs font-semibold text-lantern-text-tertiary">
                  {JOB_OFFER_STATUS_LABELS[status]}
                </Text>
              </View>
              {deadline && status === "sent" ? (
                <Text className="mt-1 text-xs text-lantern-text-secondary">
                  {deadline}
                </Text>
              ) : null}
              {offer.locationText ? (
                <Text className="mt-1 text-xs text-lantern-text-secondary">
                  {offer.locationText}
                </Text>
              ) : null}
              {offer.details ? (
                <Text className="mt-1 text-xs text-lantern-text-secondary">
                  {offer.details}
                </Text>
              ) : null}
              {offer.declineReason ? (
                <Text className="mt-1 text-xs text-lantern-text-secondary">
                  Candidate said: {offer.declineReason}
                </Text>
              ) : null}
              {status === "sent" && canEmployerWithdrawJobOffer(offer) ? (
                <Pressable
                  onPress={() => void withdraw(offer)}
                  accessibilityRole="button"
                  className="mt-2"
                >
                  <Text className="text-xs font-semibold text-lantern-text-tertiary">
                    Withdraw offer
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

export default JobOfferPanel;
