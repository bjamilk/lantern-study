import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  describeJobConversion,
  type JobPostingAnalytics,
} from "@lantern/shared";
import { fetchJobPostingAnalytics } from "../../services/jobsBoard";
import { JobHiringFunnelStrip } from "./JobHiringFunnelStrip";

interface Props {
  postingId: string;
}

export function JobPostingInsights({ postingId }: Props) {
  const [analytics, setAnalytics] = useState<JobPostingAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAnalytics(null);
    setError(null);
    fetchJobPostingAnalytics(postingId)
      .then((res) => {
        if (active) setAnalytics(res.data);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load posting analytics",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [postingId]);

  if (error) {
    return <Text className="mt-2 text-xs text-red-600">{error}</Text>;
  }

  if (!analytics) {
    return (
      <Text className="mt-2 text-xs text-lantern-text-tertiary">
        Loading posting analytics…
      </Text>
    );
  }

  const { funnel, conversion, timeToFillDays, interviews, offers } = analytics;

  return (
    <View className="mt-3 rounded-xl border border-lantern-border bg-lantern-surface p-3">
      <Text className="text-sm font-semibold text-lantern-text">
        This role’s funnel
      </Text>
      <Text className="mt-0.5 text-xs text-lantern-text-secondary">
        View→apply {describeJobConversion(conversion.viewToApplyPercent)} ·
        Apply→interview{" "}
        {describeJobConversion(conversion.applyToInterviewPercent)}
        {timeToFillDays != null ? ` · Fill ${timeToFillDays}d` : ""}
      </Text>
      <Text className="mt-1 text-xs text-lantern-text-tertiary">
        {funnel.saved} saved · {funnel.externalClicks} external clicks
      </Text>
      <View className="mt-3">
        <JobHiringFunnelStrip funnel={funnel} />
      </View>
      <Text className="mt-3 text-xs text-lantern-text-secondary">
        Interviews confirmed {interviews.confirmed + interviews.completed} ·
        Offers out {offers.sent} · Accepted {offers.accepted}
      </Text>
    </View>
  );
}

export default JobPostingInsights;
