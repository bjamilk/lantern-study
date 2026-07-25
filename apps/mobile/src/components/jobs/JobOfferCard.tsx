import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
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
    <View className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-sm font-semibold text-lantern-text">
          {canRespond ? "You have an offer" : "Offer"}
        </Text>
        <Text className="text-xs font-semibold text-lantern-text-secondary">
          {JOB_OFFER_STATUS_LABELS[status]}
        </Text>
      </View>

      <Text className="mt-1 text-sm font-medium text-lantern-text">
        {describeJobOffer(offer)}
      </Text>
      {duration ? (
        <Text className="mt-0.5 text-xs text-lantern-text-secondary">
          {duration}
        </Text>
      ) : null}
      {offer.locationText ? (
        <Text className="mt-0.5 text-xs text-lantern-text-secondary">
          {offer.locationText}
        </Text>
      ) : null}
      {offer.details ? (
        <Text className="mt-1 text-xs text-lantern-text-secondary">
          {offer.details}
        </Text>
      ) : null}
      {deadline && canRespond ? (
        <Text className="mt-1 text-xs font-medium text-lantern-text-secondary">
          {deadline}
        </Text>
      ) : null}

      {canRespond ? (
        decliningOpen ? (
          <View className="mt-2">
            <Text className="text-xs font-medium text-lantern-text-secondary">
              Anything you want them to know? (optional)
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={JOB_OFFER_DECLINE_REASON_MAX_LENGTH}
              className="mt-1 min-h-[64px] rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
            />
            <View className="mt-2 flex-row justify-end gap-2">
              <Pressable
                onPress={() => setDecliningOpen(false)}
                accessibilityRole="button"
                className="rounded-lg border border-lantern-border px-3 py-1.5"
              >
                <Text className="text-xs font-medium text-lantern-text">
                  Back
                </Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => void respond("decline")}
                accessibilityRole="button"
                className={`rounded-lg bg-red-600 px-3 py-1.5 ${
                  busy ? "opacity-50" : ""
                }`}
              >
                <Text className="text-xs font-semibold text-white">
                  Confirm decline
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View className="mt-2 flex-row flex-wrap items-center gap-3">
            <Pressable
              disabled={busy}
              onPress={() => void respond("accept")}
              accessibilityRole="button"
              className={`rounded-lg bg-lantern-success px-3 py-2 ${
                busy ? "opacity-50" : ""
              }`}
            >
              <Text className="text-sm font-semibold text-white">
                Accept offer
              </Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => setDecliningOpen(true)}
              accessibilityRole="button"
            >
              <Text className="text-xs font-medium text-lantern-text-tertiary">
                Decline
              </Text>
            </Pressable>
          </View>
        )
      ) : null}

      {status === "accepted" ? (
        <Text className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          You accepted this offer. Congratulations.
        </Text>
      ) : null}

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-2 text-xs font-medium text-red-600"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export default JobOfferCard;
