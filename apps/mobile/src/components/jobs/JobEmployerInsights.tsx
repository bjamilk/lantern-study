import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  describeJobConversion,
  type JobEmployerAnalytics,
} from "@lantern/shared";
import { fetchJobEmployerAnalytics } from "../../services/jobsBoard";
import { JobHiringFunnelStrip } from "./JobHiringFunnelStrip";

interface Props {
  onOpenPosting?: (postingId: string) => void;
}

export function JobEmployerInsights({ onOpenPosting }: Props) {
  const [analytics, setAnalytics] = useState<JobEmployerAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJobEmployerAnalytics()
      .then((res) => {
        if (active) setAnalytics(res.data);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load hiring analytics",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <View className="mt-4 rounded-xl border border-lantern-border bg-lantern-surface p-4">
        <Text className="text-sm text-lantern-text-tertiary">
          Loading hiring analytics…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="mt-4 rounded-xl border border-lantern-border bg-lantern-surface p-4">
        <Text className="text-sm text-red-600">{error}</Text>
      </View>
    );
  }

  if (!analytics || analytics.totals.postings === 0) return null;

  const {
    totals,
    funnel,
    conversion,
    avgTimeToFillDays,
    topPostings,
    attention,
  } = analytics;

  return (
    <View className="mt-4 space-y-3 rounded-xl border border-lantern-border bg-lantern-surface p-4">
      <View>
        <Text className="text-sm font-semibold text-lantern-text">
          Hiring performance
        </Text>
        <Text className="mt-0.5 text-xs text-lantern-text-secondary">
          Views through to hires across your posts.
        </Text>
      </View>

      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        <Metric label="Active" value={totals.activePostings} />
        <Metric label="Views" value={totals.views} />
        <Metric label="Applicants" value={totals.applications} />
        <Metric label="Hired" value={totals.hired} accent />
      </View>

      <Text className="text-xs text-lantern-text-secondary">
        View→apply {describeJobConversion(conversion.viewToApplyPercent)} ·
        Apply→interview{" "}
        {describeJobConversion(conversion.applyToInterviewPercent)} · Offer→hire{" "}
        {describeJobConversion(conversion.offerToHirePercent)}
        {avgTimeToFillDays != null ? ` · Avg fill ${avgTimeToFillDays}d` : ""}
      </Text>

      <JobHiringFunnelStrip funnel={funnel} />

      {topPostings.slice(0, 4).map((posting) => (
        <Pressable
          key={posting.id}
          onPress={() => onOpenPosting?.(posting.id)}
          accessibilityRole="button"
          className="rounded-lg border border-lantern-border bg-lantern-background px-3 py-2"
        >
          <Text
            className="text-sm font-medium text-lantern-text"
            numberOfLines={1}
          >
            {posting.title}
          </Text>
          <Text className="mt-0.5 text-xs text-lantern-text-secondary">
            {posting.views} views · {posting.applications} apps ·{" "}
            {posting.hired} hired
          </Text>
        </Pressable>
      ))}

      {attention.highViewsLowApply.map((item) => (
        <Pressable
          key={`views-${item.id}`}
          onPress={() => onOpenPosting?.(item.id)}
          accessibilityRole="button"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <Text
            className="text-sm font-medium text-lantern-text"
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text className="mt-0.5 text-xs text-lantern-text-secondary">
            {item.views} views, {item.applications} applicants — refresh the
            brief.
          </Text>
        </Pressable>
      ))}

      {attention.staleActive.map((item) => (
        <Pressable
          key={`stale-${item.id}`}
          onPress={() => onOpenPosting?.(item.id)}
          accessibilityRole="button"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <Text
            className="text-sm font-medium text-lantern-text"
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text className="mt-0.5 text-xs text-lantern-text-secondary">
            Open {item.daysOpen} days with little traction.
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <View className="min-w-[45%] flex-1 rounded-lg border border-lantern-border bg-lantern-background p-3">
      <Text className="text-[11px] font-medium text-lantern-text-secondary">
        {label}
      </Text>
      <Text
        className={`mt-0.5 text-xl font-bold ${
          accent ? "text-lantern-primary" : "text-lantern-text"
        }`}
      >
        {value}
      </Text>
    </View>
  );
}

export default JobEmployerInsights;
